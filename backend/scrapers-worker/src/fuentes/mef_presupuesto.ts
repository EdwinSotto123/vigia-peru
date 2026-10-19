/**
 * MEF — Presupuesto y Ejecución de Gasto → mef_ejecutora_anual + mef_departamento_desglose + mef_ejecutora_gasto →
 * `refrescar_mef_presupuesto()` (migración 47) → mef_region_budget / mef_entity_budget, que lee la web.
 * Mismo pipeline que backend/scrapers/mef_presupuesto/pipeline.py.
 *
 * El MEF quitó `datastore_search_sql` y vació el recurso comparativo que se usaba; lo que queda completo es
 * `<año>-Gasto-Diario.zip` (2026: 549 MB zip / 8,2 GB CSV / 8,95 M filas, regenerado a diario). Se baja en
 * streaming: cabecera local del ZIP (ZIP64) → inflado síncrono con fflate → líneas → agregado por unidad
 * ejecutora (≈ 2 900) y por departamento (src/mef_agregado.ts). Medido con el archivo de 2026: ~125 s de CPU,
 * 10 MB de heap y 36 MB fuera del heap, dentro de un paso (limits.cpu_ms = 300 000). Un año por paso; el
 * agregado (~1,5 MB) se carga en el mismo paso y queda en R2 como CSV.
 *
 * El desglose de en qué gasta cada unidad ejecutora (migraciones 63 y 64) no cabe en un solo paso: el primero carga,
 * además de lo de siempre, partida, función y proyecto; después, otros pasos vuelven a leer el ZIP para las demás
 * miradas (MIRADAS_POR_PASO), cada uno con su memoria. Sólo corren si el primero cargó un archivo nuevo (o con `forzar`).
 *
 * Semanal (lunes). Entre enero y marzo corre también el año anterior: el MEF cierra diciembre recién en febrero.
 * Con `desde`/`hasta` (AAAA) se elige el rango de años.
 */

import type { WorkflowStep } from "cloudflare:workers";
import { BUCKET } from "../almacen.ts";
import { registrarCarga } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { conDb } from "../db.ts";
import { UA } from "../http.ts";
import { MIRADAS_POR_PASO, agregarZip, csvAgregado, flujoGasto, type TipoGasto } from "../mef_agregado.ts";
import { registrar } from "../registro.ts";
import { CARGA, LECTURA, fechaLima } from "./comun.ts";

const FUENTE = "mef_presupuesto";
const DATASET_URL = "https://datosabiertos.mef.gob.pe/dataset/presupuesto-y-ejecucion-de-gasto";
export const zipDelAnio = (anio: number) => `https://fs.datosabiertos.mef.gob.pe/datastorefiles/${anio}-Gasto-Diario.zip`;
const COLS_EJEC = "anio, sec_ejec, ejecutora, ejecutora_nombre, pliego, pliego_nombre, sector, sector_nombre, nivel_gobierno, departamento, " +
  "departamento_nombre, provincia, provincia_nombre, distrito, distrito_nombre, pia, pim, certificado, comprometido_anual, comprometido, " +
  "devengado, girado, filas, corte";

/** Años a cargar: el actual (y el anterior hasta marzo), o el rango pedido. */
export function aniosPedidos(p: Pick<ParamsCorrida, "desde" | "hasta">, hoy: string): number[] {
  const actual = Number(hoy.slice(0, 4));
  if (p.desde || p.hasta) {
    const d = Number((p.desde ?? p.hasta)!.slice(0, 4));
    const h = Number((p.hasta ?? p.desde)!.slice(0, 4));
    return Array.from({ length: Math.max(0, h - d + 1) }, (_, i) => d + i);
  }
  return Number(hoy.slice(5, 7)) <= 3 ? [actual - 1, actual] : [actual];
}

/** Reemplaza, para el año, las filas de `mef_ejecutora_gasto` de esas miradas (las demás no se tocan). */
async function cargarGasto(
  db: { ejecutar: (sql: string, vals?: unknown[]) => Promise<unknown>; copiar: (sql: string, flujo: ReadableStream<Uint8Array>) => Promise<unknown> },
  anio: number,
  miradas: readonly TipoGasto[],
  a: Awaited<ReturnType<typeof agregarZip>>,
): Promise<void> {
  await db.ejecutar("DELETE FROM mef_ejecutora_gasto WHERE anio = $1 AND tipo = ANY($2::text[])", [anio, [...miradas]]);
  await db.copiar("COPY mef_ejecutora_gasto (anio, sec_ejec, tipo, codigo, nombre, grupo, pia, pim, devengado) FROM STDIN WITH (FORMAT csv)",
    flujoGasto(a));
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function correrMef(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const hoy = fechaLima();
  const resumen: Record<string, unknown> = {};
  let cargados = 0;
  for (const anio of aniosPedidos(p, hoy)) {
    // Last-Modified primero: si es el de la última carga, no se baja el ZIP.
    const corte = await step.do(`corte ${anio}`, LECTURA, async () => {
      const r = await fetch(zipDelAnio(anio), { method: "HEAD", headers: { "User-Agent": UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status} en ${zipDelAnio(anio)}`);
      const lm = r.headers.get("last-modified");
      return lm ? new Date(lm).toISOString() : null;
    });
    resumen[anio] = await step.do(`agregar y cargar ${anio}`, { retries: { limit: 1, delay: "2 minutes" }, timeout: "30 minutes" }, async () => {
      if (!p.forzar && !p.seco && corte) {
        const ya = await conDb(env.HYPERDRIVE, (db) => db.filas(
          "SELECT 1 FROM datasets_cargas WHERE fuente = $1 AND clave = $2 AND estado = 'ok' AND descargado_at = $3::timestamptz",
          [FUENTE, String(anio), corte]));
        if (ya.length) {
          registrar("INFO", `   ${anio}: ya cargado con el archivo del ${corte}`, { fuente: FUENTE, instancia: id });
          return { ya_cargado: true, corte };
        }
      }
      const r = await fetch(zipDelAnio(anio), { headers: { "User-Agent": UA } });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} en ${zipDelAnio(anio)}`);
      const t0 = Date.now();
      // sha256 del ZIP al pasar (trazabilidad en datasets_cargas, como el Python).
      const resumenSha = new crypto.DigestStream("SHA-256");
      const escritor = resumenSha.getWriter();
      let bytes = 0;
      const medidor = new TransformStream<Uint8Array, Uint8Array>({
        async transform(t, c) {
          bytes += t.byteLength;
          await escritor.write(t);
          c.enqueue(t);
        },
        async flush() {
          await escritor.close();
        },
      });
      const a = await agregarZip(r.body.pipeThrough(medidor));
      // entradaZip deja de pasar datos al final de la entrada: el resto (directorio central) se descarta.
      const sha256 = hex(await resumenSha.digest.catch(() => new ArrayBuffer(0)));
      if (a.anio !== anio) throw new Error(`el archivo de ${anio} trae ANO_EJE ${a.anio}`);
      const { ejecutoras, desglose } = csvAgregado(a, corte);
      const base = `raw/${FUENTE}/${anio}/${hoy}`;
      await env.CRUDOS.put(`${base}-ejecutoras.csv`, ejecutoras, { httpMetadata: { contentType: "text/csv" } });
      await env.CRUDOS.put(`${base}-desglose.csv`, desglose, { httpMetadata: { contentType: "text/csv" } });
      const totales = [...a.ejecutoras.values()].reduce((s, e) => [s[0] + e.montos[0], s[1] + e.montos[1], s[2] + e.montos[5]], [0, 0, 0]);
      const stats = {
        anio, corte, filas: a.filas, ejecutoras: a.ejecutoras.size, desglose: a.desglose.size, gasto: a.gasto.size, mb: Math.round(bytes / 1e6),
        segundos: Math.round((Date.now() - t0) / 1000),
        millones: { pia: +(totales[0] / 1e6).toFixed(2), pim: +(totales[1] / 1e6).toFixed(2), devengado: +(totales[2] / 1e6).toFixed(2) },
      };
      registrar("INFO", `   ${anio}: ${stats.filas} filas del MEF → ${stats.ejecutoras} ejecutoras · ${stats.desglose} de desglose · ` +
        `PIM ${stats.millones.pim} M · devengado ${stats.millones.devengado} M (${stats.segundos}s)`, { fuente: FUENTE, instancia: id });
      if (p.seco) return { ...stats, seco: true };
      await conDb(env.HYPERDRIVE, (db) => db.transaccion(async () => {
        await db.ejecutar("DELETE FROM mef_ejecutora_anual WHERE anio = $1", [anio]);
        await db.copiar(`COPY mef_ejecutora_anual (${COLS_EJEC}) FROM STDIN WITH (FORMAT csv)`, new Blob([ejecutoras]).stream());
        await db.ejecutar("DELETE FROM mef_departamento_desglose WHERE anio = $1", [anio]);
        await db.copiar("COPY mef_departamento_desglose (anio, departamento_nombre, tipo, nombre, pia, pim, devengado) FROM STDIN WITH (FORMAT csv)",
          new Blob([desglose]).stream());
        // En qué gasta cada unidad ejecutora (migración 63): partida, función y proyecto. Sale del agregado como flujo
        // (≈ 28 MB con 2026) y no se guarda en R2: se rehace del ZIP, que es la fuente.
        await cargarGasto(db, anio, MIRADAS_POR_PASO[0], a);
        await registrarCarga(db, {
          fuente: FUENTE, clave: String(anio), tabla: "mef_ejecutora_anual", archivo: `${anio}-Gasto-Diario.zip`,
          gcs_uri: `r2://${BUCKET}/${base}-ejecutoras.csv`, sha256: sha256 || `sin-sha-${hoy}`, bytes, filas: a.filas,
          fuente_url: DATASET_URL, descargado_at: corte,
        });
      }));
      return stats;
    });
    if (!(resumen[anio] as { ya_cargado?: boolean }).ya_cargado) {
      cargados++;
      // Las demás miradas del desglose, cada una en su paso (otra lectura del ZIP, con su propia memoria).
      if (!p.seco) {
        for (let k = 1; k < MIRADAS_POR_PASO.length; k++) {
          const miradas = MIRADAS_POR_PASO[k];
          resumen[`${anio} · ${miradas.join(", ")}`] = await step.do(`detalle ${anio} · ${miradas.join(", ")}`,
            { retries: { limit: 1, delay: "2 minutes" }, timeout: "30 minutes" }, async () => {
              const r = await fetch(zipDelAnio(anio), { headers: { "User-Agent": UA } });
              if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} en ${zipDelAnio(anio)}`);
              const t0 = Date.now();
              const a = await agregarZip(r.body, miradas);
              if (a.anio !== anio) throw new Error(`el archivo de ${anio} trae ANO_EJE ${a.anio}`);
              await conDb(env.HYPERDRIVE, (db) => db.transaccion(() => cargarGasto(db, anio, miradas, a)));
              registrar("INFO", `   ${anio}: ${a.gasto.size} claves de ${miradas.join(", ")} (${Math.round((Date.now() - t0) / 1000)}s)`,
                { fuente: FUENTE, instancia: id });
              return { claves: a.gasto.size, segundos: Math.round((Date.now() - t0) / 1000) };
            });
        }
      }
    }
  }
  if (p.seco || !cargados) return resumen;
  resumen.refresco = await step.do("refrescar", CARGA, () =>
    conDb(env.HYPERDRIVE, async (db) => (await db.filas<{ regiones: number; entidades: number }>("SELECT * FROM refrescar_mef_presupuesto()"))[0]));
  registrar("INFO", `   → ${JSON.stringify(resumen.refresco)}`, { fuente: FUENTE, instancia: id });
  return resumen;
}
