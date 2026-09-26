/**
 * Una CORRIDA del dispatcher (lo que en Cloud Run es una ejecución del job): el cron o
 * `POST /ejecutar` reclaman hasta DISPATCHER_PARALLEL contratos con `reclamar_procesamientos()`
 * (FOR UPDATE SKIP LOCKED: convive con el job de Cloud Run sin reclamos dobles) y arrancan un
 * Workflow por contrato reclamado; cada Workflow es un hilo de la corrida (src/workflow.ts).
 *
 * `simular()` es la corrida en seco de `GET /simular`: qué se reclamaría, a qué servicio iría y en
 * qué estado están sus documentos y su OCDS, dentro de una transacción READ ONLY que se descarta.
 */

import { leerConfig, plazoDeReclamo } from "./config.ts";
import type { Config, Env, ParamsSlot } from "./config.ts";
import { conDb } from "./db.ts";
import { urlPara, urlsPorPerfil } from "./rutas.ts";
import { clasificacionDe, documentosEnGcs, reclamar, recordEnDb, reprTipo } from "./sql.ts";
import type { Consultor } from "./sql.ts";
import { audienciaDe, idTokenCuenta } from "./google.ts";
import { cuerpo } from "./stream.ts";
import { cortar, o } from "./py.ts";
import { registrar } from "./registro.ts";

export interface ResultadoCiclo {
  ok: boolean;
  worker?: string;
  reclamados?: string[];
  instancias?: string[];
  plazo?: string;
  error?: string;
}

const sinBarra = (s: string | undefined) => (s ?? "").replace(/\/+$/, "");

/** Identidad única por corrida, distinguible de las del job (`vigia-dispatcher-…`). */
export function nuevoWorker(): string {
  return `cloudflare-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

function sinServicios(env: Env): boolean {
  return !sinBarra(env.AGENT_URL) && !Object.values(urlsPorPerfil(env as unknown as Record<string, unknown>)).some(Boolean);
}

export async function ejecutarCiclo(env: Env, origen: string): Promise<ResultadoCiclo> {
  const cfg = leerConfig(env);
  if (sinServicios(env)) {
    registrar("ERROR", "falta AGENT_URL (o AGENT_URL_BIENES/SERVICIOS/OBRAS/OTROS)");
    return { ok: false, error: "sin_servicios_de_agentes" };
  }
  const inicio = Date.now();
  const plazo = plazoDeReclamo(inicio, cfg);
  if (plazo <= inicio) {
    registrar("ERROR", `el timeout de la tarea (${cfg.taskTimeoutS} s) no alcanza para un análisis de ${cfg.analisisMaxS} s más la gracia: no se reclama nada`);
    return { ok: false, error: "plazo_de_reclamo_vencido" };
  }
  const worker = nuevoWorker();
  const urls = urlsPorPerfil(env as unknown as Record<string, unknown>);
  registrar("INFO", `worker=${worker} parallel=${cfg.parallel} reclama durante ${Math.round((plazo - inicio) / 60_000)} min ` +
    `(tarea ${cfg.taskTimeoutS} s), agent=${sinBarra(env.AGENT_URL) || "-"}, por perfil: ` +
    Object.entries(urls).map(([p, u]) => `${p}=${u || "-"}`).join(", "), { worker, origen });
  const ocids = await conDb(env.HYPERDRIVE, (db) => reclamar(db, cfg.parallel, worker));
  if (!ocids.length) {
    registrar("INFO", "cola vacía", { worker });
    return { ok: true, worker, reclamados: [], instancias: [], plazo: new Date(plazo).toISOString() };
  }
  const lote: { id: string; params: ParamsSlot }[] = ocids.map((ocid, i) => ({
    id: `${worker}-${i + 1}`,
    params: { worker, slot: i + 1, ocid, inicio, plazo },
  }));
  try {
    await env.PROCESAR.createBatch(lote);
  } catch (e) {
    // Los reclamados quedan `procesando` sin latido: reclamar_procesamientos los re-encola a los 20 min.
    registrar("ERROR", `no se pudieron crear los Workflows de ${ocids.join(", ")}: ${String((e as Error)?.message ?? e)}`, { worker });
    return { ok: false, worker, reclamados: ocids, instancias: [], error: "workflows_no_creados" };
  }
  return { ok: true, worker, reclamados: ocids, instancias: lote.map((l) => l.id), plazo: new Date(plazo).toISOString() };
}

// ─── Corrida en seco ─────────────────────────────────────────────────────────
interface Candidato {
  ocid: string;
  intentos: number;
  encolado_at: unknown;
  clasificacion: unknown;
  decision: "pendiente_de_procesamiento" | "esperando_documentos" | "analizar";
  /** Texto que quedaría en `procesamientos.error`. */
  error?: string;
  servicio?: { perfil: string | null; url: string | null };
  documentos: number | null;
  ocds: { en_db: boolean; titulo: string | null; bytes: number | null };
  cuerpo_bytes?: number;
}

async function candidato(db: Consultor, env: Env, cfg: Config, ocid: string, intentos: number, encoladoAt: unknown): Promise<Candidato> {
  const clas = await clasificacionDe(db, ocid);
  const docs = await documentosEnGcs(db, ocid);
  const ocds = await recordEnDb(db, ocid);
  const base = {
    ocid, intentos, encolado_at: encoladoAt, clasificacion: clas,
    documentos: docs === null ? null : Object.keys(docs).length,
    ocds: { en_db: ocds !== null, titulo: ocds?.titulo ?? null, bytes: ocds ? new TextEncoder().encode(ocds.texto).length : null },
  };
  const pendiente = (motivo: string | null) => ({
    ...base, decision: "pendiente_de_procesamiento" as const,
    error: cortar(`pendiente de procesamiento: ${o(motivo, "no procesable")}`, 500),
  });
  if (clas !== null && !clas.procesable) return pendiente(clas.motivo_no_procesable);
  const tipo = clas !== null ? clas.tipo : null;
  const [url, perfil] = urlPara(tipo, env as unknown as Record<string, unknown>);
  if (!url) {
    return pendiente(perfil
      ? `servicio de agentes para ${tipo} no desplegado (AGENT_URL_${perfil.toUpperCase()})`
      : `tipo de contratación desconocido: ${reprTipo(tipo)}`);
  }
  if (docs !== null && !Object.keys(docs).length && cfg.requiereDocsGcs) {
    return { ...base, servicio: { perfil, url }, decision: "esperando_documentos",
             error: "esperando documentos: se descargan en el lote nocturno" };
  }
  return {
    ...base, servicio: { perfil, url }, decision: "analizar",
    cuerpo_bytes: new TextEncoder().encode(cuerpo(ocid, ocds?.texto ?? null, docs, clas)).length,
  };
}

export async function simular(env: Env, opciones: { n?: number; tokens?: boolean }): Promise<Record<string, unknown>> {
  const cfg = leerConfig(env);
  const inicio = Date.now();
  const plazo = plazoDeReclamo(inicio, cfg);
  const n = Math.max(1, Math.min(50, Math.trunc(opciones.n ?? cfg.parallel) || cfg.parallel));
  const datos = await conDb(env.HYPERDRIVE, async (db) => {
    await db.query("BEGIN TRANSACTION READ ONLY", []);
    try {
      const vencidos = await db.query(
        "SELECT ocid, intentos, worker, latido_at FROM procesamientos " +
          "WHERE estado = 'procesando' AND latido_at < now() - interval '20 minutes' ORDER BY latido_at", []);
      const enCola = await db.query("SELECT count(*)::int FROM procesamientos WHERE estado = 'encolado' AND intentos < 3", []);
      const enCurso = await db.query(
        "SELECT ocid, worker, fase_actual, fase_index, iniciado_at, latido_at FROM procesamientos " +
          "WHERE estado = 'procesando' ORDER BY iniciado_at", []);
      const filas = await db.query(
        "SELECT ocid, intentos, encolado_at FROM procesamientos WHERE estado = 'encolado' AND intentos < 3 " +
          "ORDER BY encolado_at, ocid LIMIT $1", [n]);
      const candidatos: Candidato[] = [];
      for (const [ocid, intentos, encoladoAt] of filas) {
        candidatos.push(await candidato(db, env, cfg, ocid as string, intentos as number, encoladoAt));
      }
      return { vencidos, enCola: enCola[0]?.[0] ?? 0, enCurso, candidatos };
    } finally {
      await db.query("ROLLBACK", []).catch(() => undefined);
    }
  });

  const salida: Record<string, unknown> = {
    simulacion: true,
    config: {
      activo: cfg.activo, parallel: cfg.parallel, tramo_s: cfg.tramoS, grace_min: cfg.graceMin,
      stream_timeout_s: cfg.streamTimeoutS, requiere_docs_gcs: cfg.requiereDocsGcs, prefetch_ocds: cfg.prefetchOcds,
      ventana_de_reclamo_min: Math.round((plazo - inicio) / 60_000),
      agent_url: sinBarra(env.AGENT_URL) || null, por_perfil: urlsPorPerfil(env as unknown as Record<string, unknown>),
    },
    // reclamar_procesamientos() primero re-encola (o pasa a error con 3 intentos) los que no laten hace 20 min.
    se_reencolarian: datos.vencidos.map(([ocid, intentos, worker, latido]) => ({
      ocid, intentos, worker, latido_at: latido, pasaria_a: (intentos as number) >= 3 ? "error" : "encolado",
    })),
    en_cola: datos.enCola,
    en_curso: datos.enCurso.map(([ocid, worker, fase, indice, iniciado, latido]) => ({
      ocid, worker, fase_actual: fase, fase_index: indice, iniciado_at: iniciado, latido_at: latido,
      replica: String(worker ?? "").startsWith("cloudflare-") ? "cloudflare" : "cloud_run",
    })),
    se_reclamarian: datos.candidatos,
  };

  if (opciones.tokens) {
    const urls = new Set<string>();
    for (const c of datos.candidatos) if (c.servicio?.url) urls.add(c.servicio.url);
    for (const u of Object.values(urlsPorPerfil(env as unknown as Record<string, unknown>))) if (u) urls.add(u);
    const tokens: Record<string, unknown>[] = [];
    for (const u of urls) {
      const audiencia = audienciaDe(u);
      if ((env.AGENT_ID_TOKEN ?? "").trim()) {
        tokens.push({ audiencia, ok: true, origen: "AGENT_ID_TOKEN" });
        continue;
      }
      try {
        await idTokenCuenta(env.GCP_SA_KEY, audiencia);
        tokens.push({ audiencia, ok: true, origen: "GCP_SA_KEY" });
      } catch (e) {
        tokens.push({ audiencia, ok: false, error: String((e as Error)?.message ?? e) });
      }
    }
    salida.id_tokens = tokens;
  }
  return salida;
}
