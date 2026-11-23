/**
 * Workflow `CorrerFuente`: una corrida de una fuente (lo que en GCP era una ejecución del Cloud Run Job
 * `scraper-<fuente>`). Cada fuente arma sus pasos en src/fuentes/<fuente>.ts: las lecturas y
 * descargas se reintentan; las cargas son idempotentes (upsert o reemplazo por clave en una
 * transacción), así que un reintento no duplica nada.
 */

import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import type { Env, ParamsCorrida } from "./config.ts";
import { colo, diagnosticar } from "./diagnostico.ts";
import { correrJne } from "./fuentes/jne_infogob.ts";
import { correrMef, correrMefCargarGasto, correrMefDetalle } from "./fuentes/mef_presupuesto.ts";
import { correrMefOpdsEtes } from "./fuentes/mef_opds_etes.ts";
import { correrConosce } from "./fuentes/conosce.ts";
import { correrContraloria } from "./fuentes/contraloria_informes.ts";
import { correrPte } from "./fuentes/pte_personal.ts";
import { correrOrdenes } from "./fuentes/conosce_ordenes.ts";
import { correrGastos } from "./fuentes/onpe_gastos.ts";
import { correrOcds } from "./fuentes/oece_ocds.ts";
import { correrHistorico } from "./fuentes/oece_historico.ts";
import { correrDocumentos } from "./fuentes/documentos.ts";
import { correrOnpe } from "./fuentes/onpe_claridad.ts";
import { correrDji } from "./fuentes/pnda_dji.ts";
import { correrPndaOece } from "./fuentes/pnda_oece.ts";
import { correrSancionados } from "./fuentes/pnda_sancionados.ts";
import { correrPenalidades } from "./fuentes/osce_penalidades.ts";
import { correrVisitas } from "./fuentes/pnda_visitas.ts";
import { correrCongresoVisitas } from "./fuentes/congreso_visitas.ts";
import { correrSeaceMenores } from "./fuentes/seace_menores.ts";
import { correrSeaceCotizaciones } from "./fuentes/seace_cotizaciones.ts";
import { correrOeceEntidades } from "./fuentes/oece_entidades.ts";
import { correrSunatPadron } from "./fuentes/sunat_padron.ts";
import { correrInviertePe } from "./fuentes/invierte_pe.ts";
import { correrServir } from "./fuentes/servir_convocatorias.ts";
import { correrPracticas } from "./fuentes/servir_practicas.ts";
import { correrInfobras } from "./fuentes/infobras.ts";
import { correrSaludLima } from "./fuentes/salud_lima.ts";
import { correrOeceFichas } from "./fuentes/oece_fichas.ts";
import { correrSusalud } from "./fuentes/susalud.ts";
import { correrSusaludDetalle } from "./fuentes/susalud_detalle.ts";
import { correrDigemid } from "./fuentes/digemid.ts";
import { correrMtcCar } from "./fuentes/mtc_car.ts";
import { conDb } from "./db.ts";
import { registrar } from "./registro.ts";

type Corredor = (env: Env, p: ParamsCorrida, step: WorkflowStep, id: string) => Promise<unknown>;

export const FUENTES: Record<string, Corredor> = {
  oece_ocds: correrOcds,
  oece_historico: correrHistorico,
  documentos: correrDocumentos,
  pnda_sancionados: correrSancionados,
  osce_penalidades: correrPenalidades,
  pnda_visitas: correrVisitas,
  congreso_visitas: correrCongresoVisitas,
  pnda_dji: correrDji,
  jne_infogob: correrJne,
  pnda_oece: correrPndaOece,
  mef_presupuesto: correrMef,
  mef_detalle: correrMefDetalle,
  mef_cargar_gasto: correrMefCargarGasto,
  mef_opds_etes: correrMefOpdsEtes,
  conosce: correrConosce,
  conosce_ordenes: correrOrdenes,
  oece_entidades: correrOeceEntidades,
  sunat_padron: correrSunatPadron,
  invierte_pe: correrInviertePe,
  servir_convocatorias: correrServir,
  servir_practicas: correrPracticas,
  infobras: correrInfobras,
  salud_lima: correrSaludLima,
  oece_fichas: correrOeceFichas,
  susalud: correrSusalud,
  susalud_detalle: correrSusaludDetalle,
  digemid: correrDigemid,
  mtc_car: correrMtcCar,
  onpe_gastos: correrGastos,
  onpe_claridad: correrOnpe,
  contraloria_informes: correrContraloria,
  pte_personal: correrPte,
  seace_menores: correrSeaceMenores,
  seace_cotizaciones: correrSeaceCotizaciones,
};

/** Los pasos de la bitácora: cortos, y si fallan la corrida sigue (anotar nunca la corta). */
const BITACORA: WorkflowStepConfig = { retries: { limit: 2, delay: "5 seconds" }, timeout: "1 minute" };

/** Una sentencia en corridas_fuente (migración 74). false si no se pudo (sin tabla, sin base): sólo se registra. */
async function anotar(env: Env, sql: string, vals: unknown[]): Promise<boolean> {
  try {
    await conDb(env.HYPERDRIVE, (db) => db.ejecutar(sql, vals));
    return true;
  } catch (e) {
    registrar("WARNING", `   bitácora: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
    return false;
  }
}

/** El resumen de la fuente para la bitácora, recortado a ~20 KB. */
function resumenJson(r: unknown): string {
  const s = JSON.stringify(r ?? null);
  return s.length <= 20_000 ? s : JSON.stringify({ recortado: true, inicio: s.slice(0, 20_000) });
}

export class CorrerFuente extends WorkflowEntrypoint<Env, ParamsCorrida> {
  async run(event: Readonly<WorkflowEvent<ParamsCorrida>>, step: WorkflowStep): Promise<unknown> {
    const p = event.payload;
    const id = event.instanceId;
    const t0 = Date.now();
    registrar("INFO", `━━ ${p.fuente}${p.seco ? " (en seco)" : ""} · ${p.origen}`, { fuente: p.fuente, instancia: id });
    // Bitácora (migración 74): /admin/fuentes la muestra. Parámetros sin `fuente` ni `origen`, que van en su columna.
    const { fuente: _f, origen: _o, ...params } = p;
    await step.do("bitácora: inicio", BITACORA, () =>
      anotar(this.env, `INSERT INTO corridas_fuente (instancia, fuente, origen, params) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (instancia) DO NOTHING`,
        [id, p.fuente, p.origen, JSON.stringify(params)]));
    try {
      let r: unknown;
      if (p.fuente === "diagnostico") {
        r = await step.do("diagnostico", { retries: { limit: 0, delay: 0 }, timeout: "5 minutes" }, async () => ({
          colo_paso: await colo(),
          ...(await diagnosticar(this.env, new Set(["pnda", "relay", "oece", "mef_vel"]))),
        }));
      } else {
        const correr = FUENTES[p.fuente];
        if (!correr) throw new Error(`fuente desconocida: ${p.fuente}`);
        r = await correr(this.env, p, step, id);
      }
      await step.do("bitácora: fin", BITACORA, () =>
        anotar(this.env, `UPDATE corridas_fuente SET estado = 'ok', fin = now(), segundos = extract(epoch FROM now() - inicio)::int,
                                 resumen = $2::jsonb WHERE instancia = $1`, [id, resumenJson(r)]));
      registrar("INFO", `✓ ${p.fuente} en ${Math.round((Date.now() - t0) / 1000)}s`, { fuente: p.fuente, instancia: id });
      return r;
    } catch (e) {
      const mensaje = String((e as Error)?.message ?? e);
      registrar("ERROR", `✗ ${p.fuente}: ${mensaje}`, { fuente: p.fuente, instancia: id });
      await step.do("bitácora: error", BITACORA, () =>
        anotar(this.env, `UPDATE corridas_fuente SET estado = 'error', fin = now(), segundos = extract(epoch FROM now() - inicio)::int,
                                 error = $2 WHERE instancia = $1`, [id, mensaje.slice(0, 2000)]));
      throw e;
    }
  }
}
