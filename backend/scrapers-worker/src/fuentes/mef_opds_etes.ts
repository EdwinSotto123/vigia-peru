/**
 * MEF: el gasto de los organismos públicos descentralizados (`<año>-Gasto-OPDS.zip`) y de las empresas municipales
 * (`<año>-Gastos-ETES.zip`) → mef_opds_etes_anual + mef_opds_etes_gasto (migración 152) → refrescar_mef_presupuesto().
 *
 * Son entidades que contratan con el Estado (SAT de Lima, Serpar, EPS Loreto, EMAPA Pisco, SEDA Juliaca…) y que no están
 * en el `<año>-Gasto.zip` del SIAF: la OECE les da un CODIGO_SIAF 500xxx y, hasta la migración 152, su ficha quedaba sin
 * presupuesto. Cada archivo es chico (~2 MB, ~50 MB de CSV): todos los años caben en una corrida (~1 s de CPU cada uno,
 * medido en Node con los 21 archivos de 2015-2026). Lo puro está en src/mef_agregado_opds_etes.ts.
 *
 * Sus cifras van SOLO a la ficha de cada entidad: no se suman a las del departamento (mef_region_budget), que siguen
 * siendo las del SIAF.
 *
 * Semanal (martes, el día después de mef_presupuesto: así sus dos refrescos de mef_entity_budget no se cruzan). Como el
 * SIAF, el año actual y, entre enero y marzo, también el anterior; con `desde`/`hasta` (AAAA), el rango pedido. Un año
 * que el MEF todavía no publica (404) queda como `ausente` y no corta la corrida.
 */

import type { WorkflowStep } from "cloudflare:workers";
import { BUCKET } from "../almacen.ts";
import { registrarCarga } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { conDb } from "../db.ts";
import { UA } from "../http.ts";
import {
  COLS_ANUAL_ENTE, COLS_GASTO_ENTE, ORIGENES, PRIMER_ANIO, agregarZipEnte, archivoEnte, csvEnte, type OrigenEnte,
} from "../mef_agregado_opds_etes.ts";
import { registrar } from "../registro.ts";
import { CARGA, LECTURA, fechaLima } from "./comun.ts";
import { aniosPedidos } from "./mef_presupuesto.ts";

const FUENTE = "mef_opds_etes";
const DATASET_URL = "https://datosabiertos.mef.gob.pe/dataset/presupuesto-y-ejecucion-de-gasto";
export const urlEnte = (origen: OrigenEnte, anio: number) => `https://fs.datosabiertos.mef.gob.pe/datastorefiles/${archivoEnte(origen, anio)}`;

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function correrMefOpdsEtes(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const hoy = fechaLima();
  const resumen: Record<string, unknown> = {};
  let cargados = 0;
  for (const anio of aniosPedidos(p, hoy)) {
    for (const origen of ORIGENES) {
      if (anio < PRIMER_ANIO[origen]) continue;
      const clave = `${origen}-${anio}`;
      const url = urlEnte(origen, anio);
      // Last-Modified primero: si es el de la última carga, no se baja el ZIP.
      const cab = await step.do(`corte ${clave}`, LECTURA, async () => {
        const r = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA } });
        if (r.status === 404) return { ausente: true, corte: null };
        if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
        const lm = r.headers.get("last-modified");
        return { ausente: false, corte: lm ? new Date(lm).toISOString() : null };
      });
      if (cab.ausente) {
        registrar("INFO", `   ${clave}: el MEF no publica ${archivoEnte(origen, anio)}`, { fuente: FUENTE, instancia: id });
        resumen[clave] = { ausente: true };
        continue;
      }
      const corte = cab.corte;
      const r = await step.do(`agregar y cargar ${clave}`, { retries: { limit: 1, delay: "1 minute" }, timeout: "15 minutes" }, async () => {
        if (!p.forzar && !p.seco && corte) {
          const ya = await conDb(env.HYPERDRIVE, (db) => db.filas(
            "SELECT 1 FROM datasets_cargas WHERE fuente = $1 AND clave = $2 AND estado = 'ok' AND descargado_at = $3::timestamptz",
            [FUENTE, clave, corte]));
          if (ya.length) return { ya_cargado: true, corte };
        }
        const resp = await fetch(url, { headers: { "User-Agent": UA } });
        if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status} en ${url}`);
        // ~2 MB: entero en memoria para el sha256; el CSV (~50 MB) se infla y se agrega en flujo.
        const zip = new Uint8Array(await resp.arrayBuffer());
        const sha256 = hex(await crypto.subtle.digest("SHA-256", zip));
        const t0 = Date.now();
        const a = await agregarZipEnte(new Blob([zip]).stream(), origen);
        if (a.anio !== anio) throw new Error(`el archivo ${archivoEnte(origen, anio)} trae ANO_EJE ${a.anio}`);
        const { anual, gasto } = csvEnte(a, corte);
        const totales = [...a.unidades.values()].reduce((s, u) => [s[0] + u.montos[0], s[1] + u.montos[1], s[2] + u.montos[5]], [0, 0, 0]);
        const stats = {
          origen, anio, corte, filas: a.filas, saltadas: a.saltadas, malas: a.malas, unidades: a.unidades.size, gasto: a.gasto.size,
          kb: Math.round(zip.length / 1e3), segundos: Math.round((Date.now() - t0) / 1000),
          millones: { pia: +(totales[0] / 1e6).toFixed(2), pim: +(totales[1] / 1e6).toFixed(2), ejecutado: +(totales[2] / 1e6).toFixed(2) },
        };
        registrar("INFO", `   ${clave}: ${stats.filas} filas → ${stats.unidades} unidades, ${stats.gasto} claves de gasto` +
          `${a.saltadas ? ` (${a.saltadas} filas de OPD saltadas)` : ""}, PIM ${stats.millones.pim} M`, { fuente: FUENTE, instancia: id });
        if (p.seco) return { ...stats, seco: true };
        const archivo = `raw/${FUENTE}/${origen}/${anio}/${hoy}-anual.csv`;
        await env.CRUDOS.put(archivo, anual, { httpMetadata: { contentType: "text/csv" } });
        await conDb(env.HYPERDRIVE, (db) => db.transaccion(async () => {
          await db.ejecutar("DELETE FROM mef_opds_etes_anual WHERE origen = $1 AND anio = $2", [origen, anio]);
          await db.copiar(`COPY mef_opds_etes_anual (${COLS_ANUAL_ENTE}) FROM STDIN WITH (FORMAT csv)`, new Blob([anual]).stream());
          await db.ejecutar("DELETE FROM mef_opds_etes_gasto WHERE origen = $1 AND anio = $2", [origen, anio]);
          await db.copiar(`COPY mef_opds_etes_gasto (${COLS_GASTO_ENTE}) FROM STDIN WITH (FORMAT csv)`, new Blob([gasto]).stream());
          await registrarCarga(db, {
            fuente: FUENTE, clave, tabla: "mef_opds_etes_anual", archivo: archivoEnte(origen, anio), gcs_uri: `r2://${BUCKET}/${archivo}`,
            sha256, bytes: zip.length, filas: a.filas, fuente_url: DATASET_URL, descargado_at: corte,
          });
        }));
        return stats;
      });
      resumen[clave] = r;
      if (!(r as { ya_cargado?: boolean }).ya_cargado && !p.seco) cargados++;
    }
  }
  if (p.seco || !cargados) return resumen;
  resumen.refresco = await step.do("refrescar", CARGA, () =>
    conDb(env.HYPERDRIVE, async (db) => (await db.filas<{ regiones: number; entidades: number }>("SELECT * FROM refrescar_mef_presupuesto()"))[0]));
  registrar("INFO", `   → ${JSON.stringify(resumen.refresco)}`, { fuente: FUENTE, instancia: id });
  return resumen;
}
