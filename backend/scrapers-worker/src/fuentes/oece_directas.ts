/**
 * Las contrataciones directas que faltan en `convocatorias` (auditoría del 2026-11-23): oece_ocds las pide a
 * `/releasesAfter`, que filtra por `tender.tenderPeriod.startDate`, y una directa no tiene periodo de convocatoria (sólo
 * `datePublished`). Así nunca entraban: Vigía tenía 30 directas contra ~11 mil desde 2024 en CONOSCE, y sin la fila no
 * había ficha, análisis, cruces ni documentos (el alquiler de oficinas de la Municipalidad de Lima, directa
 * DIRECTA-PROC-3-2023-MML de S/ 5.76 M con seis PDF en el OECE, salía «sin banderas»).
 *
 *   1. pendientes: los códigos de CONOSCE (conosce_adjudicaciones) con tipo «Contratación Directa…» y buena pro en la
 *      ventana (`desde`/`hasta`; por omisión los últimos 120 días) que no están en `convocatorias`, lo más nuevo primero.
 *   2. lotes de LOTE códigos: GET /api/v1/record/<ocid> por el relay (Zúrich, como oece_ocds), su `compiledRelease` por
 *      `normalizarRelease` (la misma fila que la carga diaria: clasificación, payload con tender, documentos, contratos)
 *      y `cargar` (el mismo upsert). El crudo de cada lote queda en R2.
 *   3. refresh_financiamiento() y la cadena de cruces (salvo `relleno`, para tramos en paralelo que se refrescan una vez).
 *
 * Idempotente: lo ya cargado no vuelve a ser pendiente; el upsert no pisa lo que cargó el orquestador.
 */

import type { WorkflowStep } from "cloudflare:workers";
import type { Env, ParamsCorrida } from "../config.ts";
import { conDb } from "../db.ts";
import { esDict, get } from "../py.ts";
import type { Dict } from "../py.ts";
import { registrar } from "../registro.ts";
import { ZonaIndex } from "../ubigeo.ts";
import { CARGA, LECTURA, cadenaCruces, crucesDe, fechaLima, refrescar, sumarDias } from "./comun.ts";
import { BASE, OCID_PREFIJO, cargar, leerZonas, normalizarRelease, obtenerJson } from "./oece_ocds.ts";
import type { Fila } from "./oece_ocds.ts";

/** Códigos por paso: ~200 pedidos al OECE, de a CONCURRENCIA. */
const LOTE = 200;
const CONCURRENCIA = 4;
/** Tope de pendientes por corrida (el relleno se parte en tramos por fecha). */
const TOPE = 40_000;
/** La ventana por omisión (la corrida semanal, después de `conosce`): lo adjudicado en los últimos 120 días. */
const VENTANA_DIAS = 120;

/**
 * La directa de CONOSCE: `mef_norm(tipo_proceso)` empieza con «CONTRATACION DIRECTA» (como mcp_adjudicacion, migración
 * 254). Sólo códigos numéricos del SEACE v3 (el OCID es el prefijo más el código).
 */
export const SQL_PENDIENTES = `
  SELECT a.codigo_convocatoria AS codigo, min(a.fecha_buenapro)::text AS fecha
    FROM conosce_adjudicaciones a
   WHERE mef_norm(a.tipo_proceso) LIKE 'CONTRATACION DIRECTA%'
     AND a.codigo_convocatoria ~ '^[0-9]{3,9}$'
     AND a.fecha_buenapro BETWEEN $1::date AND $2::date
     AND NOT EXISTS (SELECT 1 FROM convocatorias c WHERE c.codigo = a.codigo_convocatoria OR c.ocid = a.codigo_convocatoria)
   GROUP BY a.codigo_convocatoria
   ORDER BY min(a.fecha_buenapro) DESC, a.codigo_convocatoria DESC
   LIMIT $3`;

/** El release compilado de la respuesta de /record (`records[0].compiledRelease`), o null. */
export function releaseDeRecord(datos: Dict | null): Dict | null {
  const records = get(datos ?? {}, "records");
  const r0 = Array.isArray(records) ? records[0] : null;
  const rel = esDict(r0) ? get(r0, "compiledRelease") : null;
  return esDict(rel) ? rel : null;
}

export interface ResumenDirectas {
  ventana: string;
  pendientes: number;
  pedidos: number;
  sin_record: number;
  convocatorias: number;
  cargadas?: number;
  refresh_s?: number;
  cruces?: { tipo: string; filas: number }[];
}

export async function correrDirectas(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<ResumenDirectas> {
  const hoy = fechaLima();
  const desde = p.desde && p.desde.length === 10 ? p.desde : p.desde ? `${p.desde.slice(0, 4)}-01-01` : sumarDias(hoy, -VENTANA_DIAS);
  const hasta = p.hasta && p.hasta.length === 10 ? p.hasta : p.hasta ? `${p.hasta.slice(0, 4)}-12-31` : hoy;
  const pendientes = await step.do("pendientes", LECTURA, () =>
    conDb(env.HYPERDRIVE, (db) => db.filas<{ codigo: string; fecha: string }>(SQL_PENDIENTES, [desde, hasta, TOPE])).then((xs) => xs.map((x) => x.codigo)));
  registrar("INFO", `   ventana ${desde} → ${hasta}: ${pendientes.length} directas de CONOSCE sin fila en convocatorias`, { fuente: "oece_directas", instancia: id });
  const zonas = await step.do("zonas", LECTURA, () => leerZonas(env));
  const ix = ZonaIndex.desdeFilas(zonas);

  let pedidos = 0;
  let sinRecord = 0;
  let convocatorias = 0;
  let cargadas = 0;
  for (let i = 0; i < pendientes.length; i += LOTE) {
    const lote = pendientes.slice(i, i + LOTE);
    const n = i / LOTE + 1;
    const r = await step.do(`lote ${n}`, { retries: { limit: 3, delay: "1 minute", backoff: "exponential" }, timeout: "30 minutes" }, async () => {
      const filas: Fila[] = [];
      let sin = 0;
      for (let k = 0; k < lote.length; k += CONCURRENCIA) {
        const tanda = lote.slice(k, k + CONCURRENCIA);
        // Un record que no responde (tras los reintentos de obtenerJson) cuenta como «sin record»: no tumba el lote.
        const rels = await Promise.all(tanda.map((codigo) =>
          obtenerJson(env, `${BASE}/record/${OCID_PREFIJO}${codigo}`).then(releaseDeRecord, () => null)));
        for (const rel of rels) {
          const f = rel ? normalizarRelease(rel, ix) : null;
          if (f) filas.push(f);
          else sin++;
        }
      }
      if (p.seco || !filas.length) return { pedidos: lote.length, sin, filas: filas.length, cargadas: 0 };
      await env.CRUDOS.put(`raw/oece_directas/${hoy}/${id}/lote-${n}.ndjson`, filas.map((f) => JSON.stringify(f)).join("\n") + "\n",
        { httpMetadata: { contentType: "application/x-ndjson" } });
      const c = await conDb(env.HYPERDRIVE, (db) => cargar(db, filas));
      return { pedidos: lote.length, sin, filas: filas.length, cargadas: c.convocatorias };
    });
    pedidos += r.pedidos;
    sinRecord += r.sin;
    convocatorias += r.filas;
    cargadas += r.cargadas;
    registrar("INFO", `   lote ${n}: ${r.pedidos} pedidos · ${r.filas} convocatorias · ${r.sin} sin record`, { fuente: "oece_directas", instancia: id });
  }
  const resumen: ResumenDirectas = { ventana: `${desde} → ${hasta}`, pendientes: pendientes.length, pedidos, sin_record: sinRecord, convocatorias };
  if (p.seco) return resumen;
  resumen.cargadas = cargadas;
  if (!cargadas || p.relleno) return resumen;

  const refresh = await step.do("refresh_financiamiento", CARGA, async () => {
    const t0 = Date.now();
    await conDb(env.HYPERDRIVE, (db) => db.ejecutar("SELECT refresh_financiamiento()"));
    return Math.round((Date.now() - t0) / 1000);
  });
  // Los cruces de los ganadores (y todo lo que se arma sobre ellos): de ahí salen las banderas de cada directa.
  const cruces = crucesDe(await refrescar(env, step, id, cadenaCruces()));
  registrar("INFO", `   → ${cargadas} directas cargadas · refresh ${refresh}s · cruces: ${cruces.map((c) => `${c.tipo} ${c.filas}`).join(" · ")}`,
    { fuente: "oece_directas", instancia: id });
  return { ...resumen, refresh_s: refresh, cruces };
}
