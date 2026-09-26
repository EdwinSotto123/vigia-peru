/**
 * Workflow `ProcesarContratos`: un HILO de una corrida del dispatcher. Equivale a uno de los
 * DISPATCHER_PARALLEL hilos del ThreadPoolExecutor de main.py: procesa el contrato que la corrida
 * reclamó para él y, mientras dure la ventana de reclamo (`plazo`) y ningún análisis haya abortado,
 * reclama el siguiente (`reclamar_procesamientos(1, worker)`) con la misma identidad de corrida.
 *
 * Pasos por contrato (prefijo `c<k>`):
 *   preparar  → clasificación, servicio por tipo y documentos (solo lecturas, con reintentos)
 *   pendiente / espera → `dejar_pendiente` / `esperar_documentos` (escrituras: sin reintento)
 *   tramo-<i> → OCDS + POST ?stream=1 + NDJSON, en tramos de DISPATCHER_TRAMO_S (src/stream.ts)
 *   alerta, gracia<n>-<j> → comprobaciones del cierre (src/cierre.ts)
 *   terminar  → `terminar()` + refresco del ranking si quedó procesado
 *
 * Las escrituras que no son idempotentes (reclamar, dejar_pendiente, esperar_documentos, terminar
 * ABORT) van sin reintento: si fallan, el procesamiento queda `procesando` sin latido y
 * `reclamar_procesamientos` lo re-encola a los 20 min, como cuando el job de Cloud Run muere.
 */

import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { leerConfig } from "./config.ts";
import type { Config, Env, ParamsSlot } from "./config.ts";
import { conDb } from "./db.ts";
import { urlPara } from "./rutas.ts";
import {
  ABORT, ESPERA, FAIL, OK, PENDIENTE, alertaPersistida, clasificacionDe, dejarPendiente, documentosEnGcs,
  esperarDocumentos, latir, reclamar, refrescarVistas, reprTipo, terminar,
} from "./sql.ts";
import type { Clasificacion, Resultado } from "./sql.ts";
import { abrir, interrumpido, seguir } from "./stream.ts";
import type { Checkpoint, Contexto } from "./stream.ts";
import { decidirCierre } from "./cierre.ts";
import { isoSegundos } from "./py.ts";
import { registrar } from "./registro.ts";

const LECTURA: WorkflowStepConfig = { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "5 minutes" };
const UNA_VEZ: WorkflowStepConfig = { retries: { limit: 0, delay: 0 }, timeout: "5 minutes" };
// Un tramo dura DISPATCHER_TRAMO_S (≤ 25 min): el timeout de 30 min es el máximo que admite un paso.
const TRAMO: WorkflowStepConfig = { retries: { limit: 2, delay: "15 seconds" }, timeout: "30 minutes" };
const GRACIA: WorkflowStepConfig = { retries: { limit: 3, delay: "15 seconds" }, timeout: "15 minutes" };
/** Cada paso de la espera de gracia sondea a lo sumo esto (la espera completa son GRACE_MINUTES). */
const GRACIA_POR_PASO_MS = 10 * 60 * 1000;
const SONDEO_MS = 30_000;

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Plan =
  | { accion: "pendiente"; motivo: string | null; aviso: string }
  | { accion: "espera" }
  | {
      accion: "analizar"; url: string; perfil: string; tipo: string | null; clas: Clasificacion | null;
      docs: Record<string, string> | null; desde: string; t0: number;
    };

export interface Resumen {
  worker: string;
  slot: number;
  procesados: number;
  fallidos: number;
  abortados: number;
  pendientes_de_procesamiento: number;
  esperando_documentos: number;
}

export class ProcesarContratos extends WorkflowEntrypoint<Env, ParamsSlot> {
  async run(event: Readonly<WorkflowEvent<ParamsSlot>>, step: WorkflowStep): Promise<Resumen> {
    const p = event.payload;
    const cfg = leerConfig(this.env);
    const r: Resumen = {
      worker: p.worker, slot: p.slot, procesados: 0, fallidos: 0, abortados: 0,
      pendientes_de_procesamiento: 0, esperando_documentos: 0,
    };
    let ocid: string | null = p.ocid;
    for (let k = 1; ocid; k++) {
      let res: Resultado;
      try {
        res = await this.procesar(step, cfg, event.instanceId, p.worker, ocid, `c${k}`);
      } catch (e) {
        // Falló hasta el cierre en DB: el timeout de latido lo re-encola (como "sin cierre" en main.py).
        registrar("ERROR", `✗ ${ocid} (sin cierre): ${String((e as Error)?.message ?? e)}`, { ocid, worker: p.worker });
        res = FAIL;
      }
      if (res === OK) r.procesados++;
      else if (res === ABORT) r.abortados++;
      else if (res === PENDIENTE) r.pendientes_de_procesamiento++;
      else if (res === ESPERA) r.esperando_documentos++;
      else r.fallidos++;
      if (res === ABORT) {
        // Un aborto (fuente OECE inaccesible, sin permiso, sin capacidad) frena la corrida.
        registrar("INFO", "corto la corrida: fuente OECE inaccesible", { worker: p.worker });
        break;
      }
      ocid = await step.do(`c${k}-reclamar`, UNA_VEZ, async () => {
        if (Date.now() >= p.plazo) {
          registrar("INFO", `corto la corrida: tope de ${cfg.maxMin} min`, { worker: p.worker });
          return null;
        }
        const [siguiente] = await conDb(this.env.HYPERDRIVE, (db) => reclamar(db, 1, p.worker));
        if (!siguiente) registrar("INFO", "cola vacía", { worker: p.worker });
        return siguiente ?? null;
      });
    }
    if (r.procesados) {
      await step.do("refrescar-zonas", LECTURA, () => conDb(this.env.HYPERDRIVE, (db) => refrescarVistas(db, true)));
    }
    registrar("INFO", `fin · procesados=${r.procesados} fallidos=${r.fallidos} abortados=${r.abortados} ` +
      `pendientes_de_procesamiento=${r.pendientes_de_procesamiento} esperando_documentos=${r.esperando_documentos}`, { worker: p.worker });
    return r;
  }

  /** Un contrato: `procesar()` de main.py, repartido en pasos. */
  private async procesar(step: WorkflowStep, cfg: Config, instancia: string, worker: string, ocid: string,
                         pre: string): Promise<Resultado> {
    const env = this.env;
    const plan = await step.do(`${pre}-preparar`, LECTURA, () => conDb(env.HYPERDRIVE, async (db): Promise<Plan> => {
      const t0 = Date.now();
      registrar("INFO", `▶ ${ocid}`, { ocid, worker });
      const clas = await clasificacionDe(db, ocid);
      if (clas !== null && !clas.procesable) {
        return { accion: "pendiente", motivo: clas.motivo_no_procesable,
                 aviso: `${clas.tipo}/${clas.etapa} · ${clas.motivo_no_procesable}` };
      }
      const tipo = clas !== null ? clas.tipo : null;
      const [url, perfil] = urlPara(tipo, env as unknown as Record<string, unknown>);
      if (!url) {
        const motivo = perfil
          ? `servicio de agentes para ${tipo} no desplegado (AGENT_URL_${perfil.toUpperCase()})`
          : `tipo de contratación desconocido: ${reprTipo(tipo)}`;
        return { accion: "pendiente", motivo, aviso: motivo };
      }
      const docs = await documentosEnGcs(db, ocid);
      if (docs !== null && !Object.keys(docs).length && cfg.requiereDocsGcs) return { accion: "espera" };
      registrar("INFO", `servicio ${perfil} (${url}) para ${ocid} · ${tipo || "sin clasificación"}`, { ocid, worker });
      // margen de 1 min por desfase de relojes, como t0_utc en main.py
      return { accion: "analizar", url, perfil: perfil!, tipo, clas, docs, desde: isoSegundos(t0 - 60_000), t0 };
    }));

    if (plan.accion === "pendiente") {
      await step.do(`${pre}-pendiente`, UNA_VEZ, () => conDb(env.HYPERDRIVE, async (db) => {
        await dejarPendiente(db, ocid, plan.motivo);
        registrar("INFO", `⏸ ${ocid} pendiente de procesamiento · ${plan.aviso}`, { ocid, worker });
      }));
      return PENDIENTE;
    }
    if (plan.accion === "espera") {
      await step.do(`${pre}-espera`, UNA_VEZ, () => conDb(env.HYPERDRIVE, async (db) => {
        await esperarDocumentos(db, ocid);
        registrar("INFO", `⏳ ${ocid} esperando documentos · pedido de descarga abierto (lote nocturno)`, { ocid, worker });
      }));
      return ESPERA;
    }

    // ─── Stream en tramos ───
    const clave = `${instancia}/${pre}`;
    const contexto = (db: Contexto["db"]): Contexto => ({ db, ocid, worker, cfg, env, clave, dueno: this });
    let cp: Checkpoint = await step.do(`${pre}-tramo-1`, TRAMO, (c) =>
      c.attempt > 1 ? Promise.resolve(interrumpido(clave, null, c.attempt)) : conDb(env.HYPERDRIVE, (db) => abrir(contexto(db), plan)));
    for (let i = 2; cp.etapa === "stream"; i++) {
      const previo: Checkpoint = cp;
      cp = await step.do(`${pre}-tramo-${i}`, TRAMO, (c) =>
        c.attempt > 1 ? Promise.resolve(interrumpido(clave, previo, c.attempt)) : conDb(env.HYPERDRIVE, (db) => seguir(contexto(db), previo)));
    }

    if (cp.etapa === "cerrar" && cp.resultado === PENDIENTE) {
      const motivo = cp.motivo;
      await step.do(`${pre}-pendiente`, UNA_VEZ, () => conDb(env.HYPERDRIVE, (db) => dejarPendiente(db, ocid, motivo)));
      return PENDIENTE;
    }

    let cierre: { resultado: Resultado; err: string | null; aviso: string | null };
    if (cp.etapa === "cerrar") {
      cierre = { resultado: cp.resultado, err: cp.err, aviso: null }; // 401/403 o sin capacidad: ABORT
    } else {
      let esperas = 0;
      cierre = await decidirCierre(cp, ocid, {
        alertaPersistida: () => step.do(`${pre}-alerta`, LECTURA, () => conDb(env.HYPERDRIVE, (db) => alertaPersistida(db, ocid))),
        esperarAlerta: () => this.esperarAlerta(step, `${pre}-gracia${++esperas}`, cfg, worker, ocid, plan.desde),
      });
    }
    const { resultado, err, aviso } = cierre;
    await step.do(`${pre}-terminar`, resultado === OK || resultado === FAIL ? LECTURA : UNA_VEZ, () =>
      conDb(env.HYPERDRIVE, async (db) => {
        if (aviso) registrar("WARNING", aviso, { ocid, worker });
        await terminar(db, ocid, resultado, err);
        const marca = resultado === OK ? "✓" : resultado === ABORT ? "↩" : "✗";
        registrar(resultado === OK ? "INFO" : "WARNING",
          `${marca} ${ocid} · ${Math.round((Date.now() - plan.t0) / 1000)} s${err ? ` · ${err}` : ""}`, { ocid, worker, resultado });
      }));
    return resultado;
  }

  /**
   * `esperar_alerta` de main.py: el stream se cortó sin `final` pero el orquestador sigue corriendo
   * en su contenedor y persistirá la alerta igual. Sondea la DB cada 30 s con latido hasta
   * DISPATCHER_GRACE_MINUTES, en pasos de a lo sumo 10 min (el plazo se fija en el primero).
   */
  private async esperarAlerta(step: WorkflowStep, pre: string, cfg: Config, worker: string, ocid: string,
                              desde: string): Promise<boolean> {
    const env = this.env;
    const limite = await step.do(`${pre}-plazo`, LECTURA, async () => Date.now() + cfg.graceMin * 60_000);
    for (let j = 1; ; j++) {
      const r = await step.do(`${pre}-${j}`, GRACIA, () => conDb(env.HYPERDRIVE, async (db) => {
        const hastaPaso = Date.now() + GRACIA_POR_PASO_MS;
        for (;;) {
          if (await alertaPersistida(db, ocid, desde)) return "si";
          if (Date.now() >= limite) return "no";
          if (Date.now() >= hastaPaso) return "sigue";
          await latir(db, [ocid], worker);
          await dormir(SONDEO_MS);
        }
      }));
      if (r !== "sigue") return r === "si";
    }
  }
}
