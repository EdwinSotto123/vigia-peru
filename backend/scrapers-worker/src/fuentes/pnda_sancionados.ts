/**
 * Proveedores sancionados por el Tribunal de Contrataciones (OECE) vía PNDA → `osce_sancionados`: port de
 * backend/scrapers/pnda_sancionados/pipeline.py (fuentes y columnas verificadas en su docstring).
 * El CSV del Tribunal viene con `;` y en CP1252. Cruce: RUC con sanción vigente como ganador, postor o
 * socio → bandera CRÍTICA (art. 50 TUO Ley 30225).
 */

import type { WorkflowStep } from "cloudflare:workers";
import { Almacen, nombreArchivo } from "../almacen.ts";
import type { Entrada } from "../almacen.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { decodificarCp1252, filasDict, leerCsv } from "../csv.ts";
import { conDb } from "../db.ts";
import { DatasetInexistente, obtenerDataset, recursosDeDatos } from "../pnda.ts";
import { asciiNfkd, colapsar, strip } from "../py.ts";
import { registrar } from "../registro.ts";
import { CARGA, DESCARGA } from "./comun.ts";

const FUENTE = "pnda_sancionados";
const SLUGS = [
  "proveedores-sancionados-2025",
  "proveedores-sancionados-con-inhabilitación-vigente-organismo-especializado-para-las",
  "proveedores-sancionados-con-multa-organismo-especializado-para-las-contrataciones-públicas",
  "proveedores-sancionados-con-inhabilitación-organismo-especializado-para-las-contrataciones",
];
const TIPOS = new Set(["definitivo", "temporal", "multa"]);
const COLS = ["tipo", "razon_social", "razon_social_norm", "ruc", "es_persona_natural", "resolucion", "periodo",
  "fecha_desde", "fecha_hasta", "infraccion"] as const;

export interface Sancion {
  tipo: string;
  razon_social: string;
  razon_social_norm: string;
  ruc: string;
  es_persona_natural: boolean;
  resolucion: string;
  periodo: string | null;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  infraccion: string | null;
}

function fechaValida(a: number, m: number, d: number): string | null {
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d || a < 1) return null;
  return `${String(a).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** `_date`: AAAAMMDD, DD/MM/AAAA o AAAA-MM-DD (como `strptime`: día y mes de 1 o 2 dígitos). */
export function fechaSancion(s: string | null): string | null {
  const t = strip(s ?? "");
  if (/^\d{8}$/.test(t)) return fechaValida(Number(t.slice(0, 4)), Number(t.slice(4, 6)), Number(t.slice(6)));
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return fechaValida(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  return m ? fechaValida(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

const normRazon = (s: string) => colapsar(asciiNfkd(s).toUpperCase());

/** CSV del Tribunal (ya decodificado) → filas para osce_sancionados (`normalize_csv`). */
export function normalizarCsv(texto: string): Sancion[] {
  const out: Sancion[] = [];
  for (const r of filasDict(leerCsv(texto, ";"))) {
    const ruc = strip(r.RUC ?? "");
    if (!/^\d+$/.test(ruc)) continue;
    const inh = strip(r.INH ?? "").toLowerCase();
    const rs = strip(r.RAZON_SOCIAL ?? "");
    out.push({
      tipo: TIPOS.has(inh) ? inh : "temporal",
      razon_social: rs,
      razon_social_norm: normRazon(rs),
      ruc: ruc.padStart(11, "0"),
      es_persona_natural: ruc.startsWith("10"),
      resolucion: strip(r.RESOLUCION ?? ""),
      periodo: strip(r.PERIODO_INH ?? "") || null,
      fecha_desde: fechaSancion(r.DESDE),
      fecha_hasta: fechaSancion(r.HASTA),
      infraccion: strip(`${r.INFRACCION ?? ""} ${r.OTRA_INFRACCION ?? ""}`) || null,
    });
  }
  return out;
}

export async function correrSancionados(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const entradas: Entrada[] = [];
  for (const [i, slug] of SLUGS.entries()) {
    const es = await step.do(`dataset ${i + 1}`, DESCARGA, async () => {
      const almacen = new Almacen(env, FUENTE);
      let ds;
      try {
        ds = await obtenerDataset(env, slug);
      } catch (e) {
        if (e instanceof DatasetInexistente) {
          registrar("WARNING", e.message, { fuente: FUENTE, instancia: id });
          return [];
        }
        throw e;
      }
      const out: Entrada[] = [];
      for (const r of recursosDeDatos(ds, [".csv", ".xlsx", ".xls"])) {
        out.push(await almacen.bajar(r.url, { archivo: r.archivo, modificado: ds.modificado, forzar: p.forzar }));
      }
      return out;
    });
    entradas.push(...es);
  }

  return step.do("cargar", CARGA, async () => {
    const almacen = new Almacen(env, FUENTE);
    const filas: Sancion[] = [];
    const archivos: Record<string, number | string> = {};
    for (const e of entradas) {
      const nombre = nombreArchivo(e);
      if (!nombre.toLowerCase().endsWith(".csv")) {
        archivos[nombre] = "XLSX sin parser todavía (ver load_sancionados_osce.py para el formato de 3 hojas)";
        continue;
      }
      const r = normalizarCsv(decodificarCp1252(await almacen.leer(e)));
      archivos[nombre] = r.length;
      registrar("INFO", `   ${nombre} → ${r.length} sanciones (${[...new Set(r.map((x) => x.tipo))].sort().join(", ")})`, { fuente: FUENTE, instancia: id });
      filas.push(...r);
    }
    if (p.seco || !filas.length) return { archivos, filas: filas.length, seco: !!p.seco };
    const nuevas = await conDb(env.HYPERDRIVE, (db) => db.transaccion(async () => {
      // Columnas mínimas de backend/db/schemas/osce_sancionados_schema.sql; el índice único (ruc,
      // resolucion) evita duplicar entre los 4 datasets.
      await db.ejecutar("CREATE UNIQUE INDEX IF NOT EXISTS osce_sancionados_ruc_res_uq ON osce_sancionados (ruc, resolucion)");
      let n = 0;
      for (let i = 0; i < filas.length; i += 1000) {
        const tanda = filas.slice(i, i + 1000);
        const vals: unknown[] = [];
        const tuplas = tanda.map((f) => {
          const b = vals.length;
          vals.push(...COLS.map((c) => f[c]));
          return `(${COLS.map((c, k) => `$${b + k + 1}${c.startsWith("fecha") ? "::date" : c === "es_persona_natural" ? "::boolean" : ""}`).join(", ")})`;
        });
        n += await db.ejecutar(`INSERT INTO osce_sancionados (${COLS.join(", ")}) VALUES ${tuplas.join(", ")} ON CONFLICT (ruc, resolucion) DO NOTHING`, vals);
      }
      return n;
    }));
    registrar("INFO", `   → osce_sancionados: ${nuevas} filas nuevas`, { fuente: FUENTE, instancia: id });
    return { archivos, filas: filas.length, nuevas };
  });
}
