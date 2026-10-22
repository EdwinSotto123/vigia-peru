/**
 * CONOSCE (OECE), órdenes de compra y de servicio → conosce_ordenes (migración 51), por mes de registro; después
 * rehace ordenes_fraccionadas (posible fraccionamiento: varias órdenes "hasta 8 UIT" a la misma empresa en un
 * mismo día que juntas pasan el tope) y los cruces.
 *
 *   <BASE>/ordenes/<año>/CONOSCE_ORDENESCOMPRA<MES><año>_0.xlsx   (MES: ENERO … SEPTIEMBRE … DICIEMBRE)
 *
 * Unas 275 000 órdenes por mes (60–90 MB de XLSX). Mismo camino que conosce.ts: el archivo a R2, de ahí a la
 * tabla temporal leído por rangos y de ahí al destino; el mes se borra y se vuelve a cargar en una transacción, y
 * si el archivo no cambió (sha256) no se toca. Hay copias viejas "SETIEMBRE" con banner y otra cabecera: no se
 * usan, y si un mes viniera así la carga falla avisando las columnas que faltan.
 *
 * Semanal (sábados): los últimos 3 meses (las entidades registran órdenes con atraso). Con `desde`/`hasta`
 * (AAAA o AAAA-MM), ese rango; hay datos desde 2018.
 *
 * Tras cargar se rehace, desde 6 meses antes del primer mes cargado (una orden se registra después de emitirse):
 * el fraccionamiento y las personas contratadas (migración 91: órdenes por persona y año, y sus señales), y después
 * los cruces. Con `relleno` (la historia, de a muchos meses) no se rehace nada: se corre una vez al terminar, fuera
 * de Hyperdrive (rehacerlo todo pasa su corte de ~10 min).
 */

import type { WorkflowStep } from "cloudflare:workers";
import { Almacen, nombreArchivo, uri } from "../almacen.ts";
import { registrarCarga, yaCargado } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { conDb } from "../db.ts";
import { UA } from "../http.ts";
import { registrar } from "../registro.ts";
import { CARGA, fechaLima, refrescarCasosCruce } from "./comun.ts";
import { BASE, copiarATemporal, selectDestino } from "./conosce.ts";
import type { Mapa } from "./conosce.ts";
import { mesesEntre } from "./pnda_visitas.ts";

const FUENTE = "conosce_ordenes";
const FUENTE_URL = "https://conosce.osce.gob.pe/buscador/";
const TABLA = "conosce_ordenes";
const PRIMER_MES: [number, number] = [2018, 1];
const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
/** Sin estas columnas el archivo no es el reporte de órdenes que se conoce. */
const OBLIGATORIAS = ["ruc_entidad", "ruc_contratista", "monto_total_orden_original", "fecha_de_emision"];

export const MAPA_ORDENES: Mapa = [
  ["entidad", ["entidad"], "t"],
  ["entidad_ruc", ["ruc_entidad"], "t"],
  ["departamento", ["departamento_entidad"], "t"],
  ["tipo_orden", ["tipoorden", "tipo_orden"], "t"],
  ["nro_orden", ["nro_de_orden", "nro_orden"], "t"],
  ["orden", ["orden"], "t"],
  ["descripcion", ["descripcion_orden"], "t"],
  ["objeto", ["objetocontractual", "objeto_contractual"], "t"],
  ["estado", ["estadocontratacion", "estado_contratacion"], "t"],
  ["tipo_contratacion", ["tipodecontratacion", "tipo_de_contratacion"], "t"],
  ["monto", ["monto_total_orden_original"], "n"],
  ["moneda", ["moneda"], "t"],
  ["ruc_contratista", ["ruc_contratista"], "t"],
  ["contratista", ["nombre_razon_contratista"], "t"],
  ["fecha_registro", ["fecha_registro"], "d"],
  ["fecha_emision", ["fecha_de_emision"], "d"],
  ["fecha_compromiso", ["fecha_compromiso_presupuestal"], "d"],
  ["fecha_notificacion", ["fecha_de_notificacion"], "d"],
];

export const urlOrdenes = (anio: number, mes: number, ext = "xlsx") =>
  `${BASE}/ordenes/${anio}/CONOSCE_ORDENESCOMPRA${MESES[mes - 1]}${anio}_0.${ext}`;

const aMes = (t: string, fin: boolean): [number, number] => {
  const [a, m] = t.split("-").map(Number);
  return [a, m || (fin ? 12 : 1)];
};
const menor = (x: [number, number], y: [number, number]) => x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);

/** Por defecto los últimos 3 meses (con el actual); con `desde`/`hasta` (AAAA o AAAA-MM), ese rango, desde 2018. */
export function mesesOrdenes(p: Pick<ParamsCorrida, "desde" | "hasta">, hoy: string): [number, number][] {
  const actual = aMes(hoy, false);
  if (!p.desde && !p.hasta) {
    const [a, m] = actual;
    return mesesEntre(m > 2 ? [a, m - 2] : [a - 1, m + 10], actual);
  }
  let d = aMes(p.desde ?? p.hasta!, false);
  let h = aMes(p.hasta ?? p.desde!, true);
  if (menor(d, PRIMER_MES)) d = PRIMER_MES;
  if (menor(actual, h)) h = actual;
  return menor(h, d) ? [] : mesesEntre(d, h);
}

/** Seis meses antes del primer mes cargado, AAAA-MM-01: desde ahí se rehace lo que sale de las órdenes. */
export function desdeRefresco([a, m]: [number, number]): string {
  const total = a * 12 + (m - 1) - 6;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

const PASO = { retries: { limit: 1, delay: "2 minutes" }, timeout: "30 minutes" } as const;

export async function correrOrdenes(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const resumen: Record<string, unknown> = {};
  let cargados = 0;
  let primero: [number, number] | null = null;
  for (const [anio, mes] of mesesOrdenes(p, fechaLima())) {
    const clave = `${anio}-${String(mes).padStart(2, "0")}`;
    const r = await step.do(`órdenes ${clave}`, PASO, async () => {
      let archivo: { url: string; modificado: string | null } | null = null;
      for (const ext of ["xlsx", "csv"]) {
        const url = urlOrdenes(anio, mes, ext);
        const h = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA } });
        if (h.ok) {
          const lm = h.headers.get("last-modified");
          archivo = { url, modificado: lm ? new Date(lm).toISOString() : null };
          break;
        }
        if (h.status !== 404) throw new Error(`HTTP ${h.status} en ${url}`);
      }
      if (!archivo) return { sin_archivo: true };
      const almacen = new Almacen(env, FUENTE);
      const e = await almacen.bajar(archivo.url, { modificado: archivo.modificado, forzar: p.forzar, subdir: String(anio) });
      return conDb(env.HYPERDRIVE, async (db) => {
        if (!p.seco && !p.forzar && (await yaCargado(db, FUENTE, clave, e.sha256))) {
          registrar("INFO", `   ${clave}: sin cambios (sha256), se salta`, { fuente: FUENTE, instancia: id });
          return { ya_cargado: true };
        }
        const t0 = Date.now();
        await db.ejecutar("BEGIN");
        try {
          const { columnas, copiadas } = await copiarATemporal(env, db, almacen, [e]);
          const faltan = OBLIGATORIAS.filter((c) => !columnas.includes(c));
          if (faltan.length) throw new Error(`${nombreArchivo(e)}: no es el reporte de órdenes esperado (faltan ${faltan.join(", ")})`);
          if (p.seco || !copiadas) {
            // Un mes futuro viene como plantilla vacía: no borra lo que haya.
            await db.ejecutar("ROLLBACK");
            return { seco: p.seco || undefined, vacio: !copiadas || undefined, filas: copiadas };
          }
          const { cols, select } = selectDestino(MAPA_ORDENES, new Set(columnas), { anio, mes });
          await db.ejecutar(`DELETE FROM ${TABLA} WHERE anio = $1 AND mes = $2`, [anio, mes]);
          const filas = await db.ejecutar(`INSERT INTO ${TABLA} (${cols}) SELECT ${select} FROM _st`);
          // El RUC o el número de la orden escrito como monto (migración 97): queda NULL.
          await db.ejecutar(`SELECT limpiar_montos_ordenes($1, $2)`, [anio, mes]);
          await registrarCarga(db, {
            fuente: FUENTE, clave, tabla: TABLA, archivo: nombreArchivo(e), gcs_uri: uri(e), sha256: e.sha256,
            bytes: e.bytes, filas, fuente_url: FUENTE_URL, descargado_at: e.downloaded_at,
          });
          await db.ejecutar("COMMIT");
          const segundos = Math.round((Date.now() - t0) / 1000);
          registrar("INFO", `   ${clave}: ${filas} órdenes → ${TABLA} (${nombreArchivo(e)}, ${segundos}s)`, { fuente: FUENTE, instancia: id });
          return { filas, segundos };
        } catch (err) {
          await db.ejecutar("ROLLBACK").catch(() => undefined);
          throw err;
        }
      });
    });
    resumen[clave] = r;
    if (r && "segundos" in r) {
      cargados++;
      if (!primero) primero = [anio, mes];
    }
  }
  if (p.seco || !cargados) return resumen;
  // Las estadísticas de los montos dudosos (migración 102): con las viejas, el planificador dejaba de usar el índice
  // parcial y la API recorría los 29 M de órdenes para contarlos (106 s, el 2026-10-22). Unos segundos (muestra).
  await step.do("analizar montos dudosos", CARGA, () => conDb(env.HYPERDRIVE, (db) => db.ejecutar("ANALYZE conosce_ordenes (monto_dudoso, monto)")));
  if (!primero || p.relleno) return resumen;
  const desde = desdeRefresco(primero);
  const uno = (nombre: string, sql: string, params: unknown[] = []) => step.do(nombre, CARGA, () =>
    conDb(env.HYPERDRIVE, async (db) => Number((await db.filas<{ n: number }>(sql, params))[0]?.n ?? 0)));
  resumen.fraccionamiento = await uno("refrescar_fraccionamiento", "SELECT refrescar_fraccionamiento($1::date) AS n", [desde]);
  resumen.personas_ordenes = await uno("refrescar_personas_ordenes", "SELECT refrescar_personas_ordenes($1::date) AS n", [desde]);
  // Sólo las personas con órdenes desde ese año (migración 94) y, en otro paso, el resumen de cada alcance.
  resumen.personas = await uno("refrescar_personas_senales", "SELECT refrescar_personas_senales($1::date) AS n", [desde]);
  resumen.personas_resumen = await uno("refrescar_personas_resumen", "SELECT refrescar_personas_resumen() AS n");
  resumen.cruces = await step.do("refrescar_cruces", CARGA, () =>
    conDb(env.HYPERDRIVE, (db) => db.filas<{ tipo: string; filas: number }>("SELECT * FROM refrescar_cruces()")));
  // Casos cruzados (migración 57) y lo que los alimenta, en pasos separados (comun.ts: refrescarCasosCruce).
  await refrescarCasosCruce(env, step);
  return resumen;
}
