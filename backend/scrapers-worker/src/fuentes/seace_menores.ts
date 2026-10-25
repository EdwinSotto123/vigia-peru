/**
 * Contratos menores (≤8 UIT) del SEACE → `seace_menores` (migraciones 129/130). Dos fuentes unidas por el código CM:
 *   · prod4 (Buscador de Contratos del Estado, api …:9000): el contrato con entidad+RUC, proveedor+RUC, monto, objeto,
 *     fechas y el id del PDF del contrato. SIN WAF → fetch directo. Un dump por año (~55k filas, ~9k menores en 2026).
 *   · prod6 (buscador de procesos): el requerimiento/TDR en PDF + ventana de cotización. CON WAF que bloquea el egress
 *     de Cloudflare salvo por el colo de Zúrich → se llama por el relay `vigia-relay` (obtener(…, {relay:true})).
 *
 * El requerimiento se espeja a R2 (DOCUMENTOS, clave `seace/menores/req/<id>.pdf`), que es lo que sirve la API
 * (/menores/:id/requerimiento). Idempotente (match_prod6, req_r2) y reanudable por pasos.
 *
 * Recursos SEPARADOS para no competir con `documentos` (que también usa el relay): cron propio (martes 05:00 Lima,
 * minuto 0, lejos del :40 de documentos), concurrencia modesta al relay (CONCURRENCIA) y tope por corrida
 * (MAX_POR_CORRIDA): tras el backfill, cada semana sólo quedan unos cientos nuevos.
 *
 * Cron semanal (año en curso, que es donde aparecen los menores nuevos). Con desde/hasta (AAAA) procesa esos años.
 */

import type { WorkflowStep } from "cloudflare:workers";
import { registrarCarga, yaCargado } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { conDb, type Db } from "../db.ts";
import { obtener } from "../http.ts";
import { registrar } from "../registro.ts";
import { CARGA, DESCARGA, fechaLima } from "./comun.ts";

const FUENTE = "seace_menores";
const PROD4 = "https://prod4.seace.gob.pe:9000/api/bus/contrato/query";
const PROD6 = "https://prod6.seace.gob.pe/v1/s8uit-services";
const LOTE_DB = 2000;          // filas por sentencia de upsert (bajo el límite de Hyperdrive)
const LOTE_REQ = 120;          // requerimientos por paso (cada paso abre/cierra su conexión)
const CONCURRENCIA = 4;        // pedidos simultáneos al relay (probado: ~4-6 sin que el WAF corte seguido)
const MAX_POR_CORRIDA = 1500;  // tope de requerimientos por corrida (el backfill masivo va aparte, desde la PC)
const PASO_REQ = { retries: { limit: 2, delay: "1 minute", backoff: "exponential" }, timeout: "30 minutes" } as const;

interface FilaMenor {
  id_contrato: number; codigo: string | null; numero_contrato: string | null; objeto: string | null;
  descripcion: string | null; entidad: string | null; entidad_ruc: string | null; proveedor: string | null;
  proveedor_ruc: string | null; monto: number | null; moneda: string | null; estado: string | null;
  fecha_suscripcion: string | null; fecha_inicio: string | null; fecha_fin: string | null; anio: number; id_documento_contrato: string | null;
}
const COLS = ["id_contrato", "codigo", "numero_contrato", "objeto", "descripcion", "entidad", "entidad_ruc",
  "proveedor", "proveedor_ruc", "monto", "moneda", "estado", "fecha_suscripcion", "fecha_inicio", "fecha_fin",
  "anio", "id_documento_contrato"] as const;
const TIPOS = "id_contrato INTEGER, codigo TEXT, numero_contrato TEXT, objeto TEXT, descripcion TEXT, entidad TEXT, " +
  "entidad_ruc TEXT, proveedor TEXT, proveedor_ruc TEXT, monto NUMERIC, moneda TEXT, estado TEXT, " +
  "fecha_suscripcion DATE, fecha_inicio DATE, fecha_fin DATE, anio SMALLINT, id_documento_contrato TEXT";

const txt = (v: unknown) => (v == null ? null : String(v).trim() || null);
function splitRuc(s: unknown): [string | null, string | null] {
  const t = txt(s);
  const m = t ? /^\s*(\d{11})\s*-\s*(.*)$/.exec(t) : null;
  return m ? [m[1], m[2].trim() || null] : [null, t];
}
function fechaDmy(s: unknown): string | null {
  const m = txt(s) ? /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s)) : null;
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}
function fechaIso(s: unknown): string | null {
  const m = txt(s) ? /^\s*(\d{4}-\d{2}-\d{2})/.exec(String(s)) : null;
  return m ? m[1] : null;
}
function monedaNorm(s: unknown): string | null {
  const t = txt(s); if (!t) return null;
  return ["S/.", "S/", "SOLES", "NUEVOS SOLES", "PEN"].includes(t.toUpperCase()) ? "PEN" : t;
}
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function filtrarMenores(data: Record<string, unknown>[], anio: number): FilaMenor[] {
  const out: FilaMenor[] = [];
  for (const raw of data) {
    if (String(raw.indContratosMenores) !== "1") continue;
    const monto = num(raw.monto);
    if (!monto || monto <= 0) continue;
    const idc = Number(raw.idContrato);
    if (!Number.isFinite(idc)) continue;
    const [entRuc, entNom] = splitRuc(raw.entidad);
    const [provRuc, provNom] = splitRuc(raw.rucContratista);
    out.push({
      id_contrato: idc, codigo: txt(raw.nomenclaturaProceso), numero_contrato: txt(raw.numeroContrato),
      objeto: txt(raw.desObjeto), descripcion: txt(raw.desContrato), entidad: entNom, entidad_ruc: entRuc,
      proveedor: provNom, proveedor_ruc: provRuc, monto, moneda: monedaNorm(raw.moneda), estado: txt(raw.estado),
      fecha_suscripcion: fechaDmy(raw.fechaSuscriContrato), fecha_inicio: fechaDmy(raw.fechaIniContrato),
      fecha_fin: fechaDmy(raw.fechaFinContrato), anio: Number(raw.anioContrato) || anio, id_documento_contrato: txt(raw.idDocumentoContrato),
    });
  }
  return out;
}

async function sha256(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Upsert de las filas de prod4 (lotes de 2000, 1 parámetro jsonb por lote). */
async function cargarMenores(db: Db, filas: FilaMenor[]): Promise<void> {
  const set = COLS.filter((c) => c !== "id_contrato").map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  await db.transaccion(async () => {
    for (let i = 0; i < filas.length; i += LOTE_DB) {
      await db.ejecutar(
        `INSERT INTO seace_menores (${COLS.join(", ")}, match_prod6)
         SELECT ${COLS.join(", ")}, 'pendiente' FROM jsonb_to_recordset($1::jsonb) AS x (${TIPOS})
         ON CONFLICT (id_contrato) DO UPDATE SET ${set}`,
        [JSON.stringify(filas.slice(i, i + LOTE_DB))]);
    }
  });
}

/** prod6: por el relay, enriquece y espeja a R2 el requerimiento de un contrato menor. Devuelve el estado logrado. */
async function procesarReq(env: Env, idc: number, codigo: string): Promise<"ok" | "sin_req" | "bloqueado"> {
  const buscar = await obtener(env, `${PROD6}/buscadorpublico/contrataciones/buscador?anio=2026&palabra_clave=${encodeURIComponent(codigo)}&page=1&page_size=5`, { relay: true, sinReintentos: true });
  if (buscar.status !== 200) { await buscar.body?.cancel(); return "bloqueado"; }
  const data = ((await buscar.json()) as { data?: Record<string, unknown>[] }).data ?? [];
  const row = data.find((r) => String(r.desContratacion ?? "").trim() === codigo);
  if (!row) return "sin_req";
  const idc6 = Number(row.idContrato);
  const arch = await obtener(env, `${PROD6}/archivo/archivos-publico/listar-archivos-contrato/${idc6}/1`, { relay: true, sinReintentos: true });
  if (arch.status !== 200) { await arch.body?.cancel(); return "bloqueado"; }
  const lista = (await arch.json()) as Array<{ idContratoArchivo?: number; nombre?: string }> | { data?: Array<{ idContratoArchivo?: number; nombre?: string }> };
  const items = Array.isArray(lista) ? lista : lista.data ?? [];
  const req = items[0];
  const rid = req?.idContratoArchivo;
  // guardar el enriquecimiento (aunque no haya requerimiento)
  const enriquecer = async (db: Db) => db.ejecutar(
    `UPDATE seace_menores SET id_contrato_prod6=$1, estado_prod6=$2, fec_publica=$3, fec_ini_cotizacion=$4,
       fec_fin_cotizacion=$5, id_requerimiento=$6, requerimiento_nombre=$7, match_prod6='exacto' WHERE id_contrato=$8`,
    [idc6, txt(row.nomEstadoContrato), fechaIso(row.fecPublica), fechaIso(row.fecIniCotizacion), fechaIso(row.fecFinCotizacion),
     rid != null ? String(rid) : null, txt(req?.nombre), idc]);
  if (rid == null) { await conDb(env.HYPERDRIVE, enriquecer); return "sin_req"; }
  const pdf = await obtener(env, `${PROD6}/archivo/archivos-publico/descargar-archivo-contrato/${rid}`, { relay: true, timeoutMs: null, sinReintentos: true });
  if (pdf.status !== 200) { await pdf.body?.cancel(); await conDb(env.HYPERDRIVE, enriquecer); return "bloqueado"; }
  const bytes = await pdf.arrayBuffer();
  if (bytes.byteLength < 5 || new Uint8Array(bytes.slice(0, 5)).join() !== "37,80,68,70,45") {  // "%PDF-"
    await conDb(env.HYPERDRIVE, enriquecer); return "bloqueado";
  }
  await env.DOCUMENTOS.put(`seace/menores/req/${idc}.pdf`, bytes, { httpMetadata: { contentType: "application/pdf" } });
  await conDb(env.HYPERDRIVE, async (db) => { await enriquecer(db); await db.ejecutar("UPDATE seace_menores SET req_r2=true WHERE id_contrato=$1", [idc]); });
  return "ok";
}

/** Procesa un lote de requerimientos con concurrencia modesta (para no saturar el relay/WAF). */
async function procesarLote(env: Env, lote: { id_contrato: number; codigo: string }[]): Promise<{ ok: number; sin_req: number; bloqueado: number }> {
  const r = { ok: 0, sin_req: 0, bloqueado: 0 };
  for (let i = 0; i < lote.length; i += CONCURRENCIA) {
    const res = await Promise.all(lote.slice(i, i + CONCURRENCIA).map((m) =>
      procesarReq(env, m.id_contrato, m.codigo).catch(() => "bloqueado" as const)));
    for (const x of res) r[x]++;
  }
  return r;
}

export async function correrSeaceMenores(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const hoy = fechaLima();
  const actual = Number(hoy.slice(0, 4));
  const desde = Number((p.desde ?? String(actual)).slice(0, 4));
  const hasta = Number((p.hasta ?? String(actual)).slice(0, 4));
  const resumen: Record<string, unknown> = {};

  for (let anio = hasta; anio >= desde; anio--) {
    // 1) prod4: metadata de los menores del año (directo, sin WAF). Upsert idempotente.
    const meta = await step.do(`prod4 ${anio}`, DESCARGA, async () => {
      const r = await obtener(env, `${PROD4}/${anio}`, { timeoutMs: null });
      if (!r.ok) { await r.body?.cancel(); throw new Error(`prod4 ${anio} HTTP ${r.status}`); }
      const data = (await r.json()) as Record<string, unknown>[];
      const filas = filtrarMenores(data, anio);
      const sha = await sha256(filas.map((f) => `${f.id_contrato}|${f.monto}`).sort().join(","));
      if (p.seco) return { total: data.length, menores: filas.length, seco: true };
      return conDb(env.HYPERDRIVE, async (db) => {
        if (!p.forzar && (await yaCargado(db, FUENTE, String(anio), sha))) return { menores: filas.length, ya_cargado: true };
        await cargarMenores(db, filas);
        await registrarCarga(db, {
          fuente: FUENTE, clave: String(anio), tabla: "seace_menores", archivo: `prod4/${anio}/${hoy}`,
          gcs_uri: `prod4:query/${anio}`, sha256: sha, bytes: 0, filas: filas.length,
          fuente_url: `${PROD4}/${anio}`, descargado_at: new Date().toISOString(),
        });
        registrar("INFO", `   prod4 ${anio}: ${filas.length} contratos menores`, { fuente: FUENTE, instancia: id });
        return { menores: filas.length, cargado: true };
      });
    });
    resumen[`prod4_${anio}`] = meta;
    if (p.seco) continue;

    // 2) prod6 por el relay: enriquecer + espejar requerimientos pendientes (tope por corrida, en lotes por paso).
    const pendientes = await step.do(`pendientes ${anio}`, CARGA, () => conDb(env.HYPERDRIVE, (db) =>
      db.filas<{ id_contrato: number; codigo: string }>(
        `SELECT id_contrato, codigo FROM seace_menores WHERE anio=$1 AND match_prod6='pendiente' AND codigo IS NOT NULL
         ORDER BY fecha_suscripcion DESC NULLS LAST LIMIT $2`, [anio, MAX_POR_CORRIDA])));
    const tot = { ok: 0, sin_req: 0, bloqueado: 0 };
    for (let i = 0; i < pendientes.length; i += LOTE_REQ) {
      const lote = pendientes.slice(i, i + LOTE_REQ);
      const r = await step.do(`req ${anio} ${i + 1}-${i + lote.length}`, PASO_REQ, () => procesarLote(env, lote));
      tot.ok += r.ok; tot.sin_req += r.sin_req; tot.bloqueado += r.bloqueado;
    }
    resumen[`req_${anio}`] = { pendientes: pendientes.length, ...tot };
    registrar("INFO", `   prod6 ${anio}: ${tot.ok} requerimientos a R2, ${tot.sin_req} sin, ${tot.bloqueado} bloqueados`, { fuente: FUENTE, instancia: id });
  }
  return resumen;
}
