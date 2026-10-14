/**
 * CONOSCE (OECE) → conosce_adjudicaciones / conosce_postores / conosce_contratos (migración 49), por año.
 *
 * Los reportes del SEACE están sueltos en el portal CONOSCE, sin login ni WAF, y se regeneran los viernes:
 *   <BASE>/<carpeta>/<año>/CONOSCE_<PREFIJO><año>_<n>.csv   (o .xlsx: 2019, 2023 y 2024 sólo vienen así,
 *                                                            y los postores siempre)
 * Cada archivo se baja a R2 y va a COPY en streaming: el CSV tal cual; el XLSX leído por rangos desde R2 y
 * convertido a CSV al vuelo (src/xlsx_flujo.ts). COPY va a una tabla temporal con las columnas de la cabecera
 * del archivo (los nombres cambian un poco entre años); de ahí un INSERT … SELECT elige cada columna por sus
 * nombres posibles y convierte fechas y montos (`conosce_fecha`, `conosce_num`). El año se borra y se vuelve a
 * cargar en una transacción; si los archivos no cambiaron (sha256), no se toca.
 *
 * Semanal (sábados): el año actual y el anterior (el SEACE sigue completando contratos del año pasado). Con
 * `desde`/`hasta` (AAAA) se elige el rango; hay datos desde 2018. Al final rehace los cruces (migración 48).
 */

import type { WorkflowStep } from "cloudflare:workers";
import { Almacen, nombreArchivo, uri } from "../almacen.ts";
import type { Entrada } from "../almacen.ts";
import { registrarCarga, yaCargado } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { leerCsv } from "../csv.ts";
import { conDb } from "../db.ts";
import { UA } from "../http.ts";
import { registrar } from "../registro.ts";
import { xlsxComoCsv } from "../xlsx_flujo.ts";
import { CARGA, fechaLima } from "./comun.ts";
import { copiarEnTramos } from "./pnda_dji.ts";

const FUENTE = "conosce";
export const BASE = "https://conosce.osce.gob.pe/buscador/assets/67ae6c4a/reportes";
const FUENTE_URL = "https://conosce.osce.gob.pe/buscador/";
const PRIMER_ANIO = 2018;
/** Partes por año que se prueban (`_0`, `_1`…): hoy todos los años vienen en una. */
const MAX_PARTES = 6;

type Tipo = "t" | "n" | "i" | "d";
/** Columna destino ← nombres posibles en la cabecera (ya normalizados: minúsculas, `_`). */
type Mapa = [destino: string, origenes: string[], tipo: Tipo][];

interface Conjunto {
  carpeta: string;
  prefijo: string;
  tabla: string;
  mapa: Mapa;
}

export const CONJUNTOS: Record<string, Conjunto> = {
  adjudicaciones: {
    carpeta: "adjudicaciones", prefijo: "CONOSCE_ADJUDICACIONES", tabla: "conosce_adjudicaciones",
    mapa: [
      ["codigo_entidad", ["codigoentidad", "codigo_entidad"], "t"],
      ["entidad_ruc", ["entidad_ruc", "ruc_entidad"], "t"],
      ["entidad", ["entidad"], "t"],
      ["tipo_entidad", ["tipoentidad", "tipo_entidad"], "t"],
      ["entidad_departamento", ["entidad_departamento"], "t"],
      ["codigo_convocatoria", ["codigoconvocatoria", "codigo_convocatoria"], "t"],
      ["objeto", ["objetocontractual", "objeto_contractual"], "t"],
      ["tipo_proceso", ["tipoprocesoseleccion", "tipo_proceso_seleccion"], "t"],
      ["nomenclatura", ["proceso", "nomenclatura"], "t"],
      ["descripcion_proceso", ["descripcion_proceso"], "t"],
      ["n_item", ["n_item", "num_item"], "i"],
      ["descripcion_item", ["descripcion_item"], "t"],
      ["estado_item", ["estado_item"], "t"],
      ["cantidad", ["cantidad_adjudicado_item", "cantidad_adjudicada_item"], "n"],
      ["monto_referencial", ["monto_referencial_item_soles", "monto_referencial_item"], "n"],
      ["monto_adjudicado", ["monto_adjudicado_item_soles", "monto_adjudicado_item"], "n"],
      ["departamento_item", ["departamento_item"], "t"],
      ["moneda", ["moneda"], "t"],
      ["unidad_medida", ["unidad_medida"], "t"],
      ["ruc_proveedor", ["ruc_proveedor"], "t"],
      ["proveedor", ["proveedor"], "t"],
      ["tipo_proveedor", ["tipo_proveedor"], "t"],
      ["fecha_convocatoria", ["fecha_convocatoria", "fechaconvocatoria"], "d"],
      ["fecha_buenapro", ["fecha_buenapro", "fecha_buena_pro"], "d"],
      ["fecha_consentimiento", ["fecha_consentimiento_bp", "fecha_consentimiento"], "d"],
    ],
  },
  postores: {
    carpeta: "postor", prefijo: "CONOSCE_POSTOR", tabla: "conosce_postores",
    mapa: [
      ["codigo_convocatoria", ["codigo_convocatoria", "codigoconvocatoria"], "t"],
      ["fecha_convocatoria", ["fechaconvocatoria", "fecha_convocatoria"], "d"],
      ["n_item", ["n_item", "num_item"], "i"],
      ["ruc_postor", ["ruc_codigo_postor", "ruc_postor"], "t"],
      ["postor", ["postor"], "t"],
      ["fecha_propuesta", ["fecha_presentacion_propuesta"], "d"],
    ],
  },
  contratos: {
    carpeta: "contratos", prefijo: "CONOSCE_CONTRATOS", tabla: "conosce_contratos",
    mapa: [
      ["codigo_entidad", ["codigoentidad", "codigo_entidad"], "t"],
      ["codigo_convocatoria", ["codigoconvocatoria", "codigo_convocatoria"], "t"],
      ["descripcion_proceso", ["descripcion_proceso"], "t"],
      ["n_cod_contrato", ["n_cod_contrato"], "t"],
      ["codigo_contrato", ["codigo_contrato"], "t"],
      ["num_contrato", ["num_contrato"], "t"],
      ["num_item", ["num_item", "n_item"], "i"],
      ["monto_contratado_total", ["monto_contratado_total"], "n"],
      ["monto_contratado_item", ["monto_contratado_item"], "n"],
      ["monto_adicional", ["monto_adicional"], "n"],
      ["monto_reduccion", ["monto_reduccion"], "n"],
      ["monto_prorroga", ["monto_prorroga"], "n"],
      ["monto_complementario", ["monto_complementario"], "n"],
      ["moneda", ["moneda"], "t"],
      ["ruc_contratista", ["ruc_contratista"], "t"],
      ["ruc_destinatario_pago", ["ruc_destinatario_pago"], "t"],
      ["tiene_resolucion", ["tieneresolucion", "tiene_resolucion"], "t"],
      ["url_contrato", ["urlcontrato", "url_contrato"], "t"],
      ["es_publicado", ["espublicado", "es_publicado"], "t"],
      ["fecha_publicacion", ["fecha_publicacion_contrato"], "d"],
      ["fecha_suscripcion", ["fecha_suscripcion_contrato"], "d"],
      ["fecha_vigencia_inicial", ["fecha_vigencia_inicial"], "d"],
      ["fecha_vigencia_final", ["fecha_vigencia_final"], "d"],
      ["fecha_vigencia_fin_actualizada", ["fecha_vigencia_fin_actualizada"], "d"],
    ],
  },
};

/** "RUC PROVEEDOR" / "﻿CODIGOENTIDAD" / "Fecha Buena Pro" → ruc_proveedor / codigoentidad / fecha_buena_pro. */
export function normalizarCabecera(cabecera: string[]): string[] {
  const vistos = new Map<string, number>();
  return cabecera.map((h, i) => {
    let n = h.replace(/^﻿/, "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `col${i + 1}`;
    const k = vistos.get(n) ?? 0;
    vistos.set(n, k + 1);
    if (k) n = `${n}_${k + 1}`;
    return n;
  });
}

/** El SELECT que pasa de la tabla temporal (columnas = cabecera) a la tabla destino. */
export function selectDestino(mapa: Mapa, columnas: Set<string>, anio: number): { cols: string; select: string } {
  const exprs = mapa.map(([, origenes, tipo]) => {
    const o = origenes.find((x) => columnas.has(x));
    if (!o) return "NULL";
    const x = `"${o}"`;
    return tipo === "n" ? `conosce_num(${x})` : tipo === "i" ? `conosce_num(${x})::int` : tipo === "d" ? `conosce_fecha(${x})` : `NULLIF(btrim(${x}), '')`;
  });
  return { cols: ["anio", ...mapa.map(([d]) => d)].join(", "), select: [String(anio), ...exprs].join(", ") };
}

/** La primera línea del CSV (la cabecera) sin consumir el stream: devuelve otro que la vuelve a emitir. */
export async function separarCabecera(origen: ReadableStream<Uint8Array>): Promise<{ cabecera: string[]; flujo: ReadableStream<Uint8Array> }> {
  const lector = origen.getReader();
  const vistos: Uint8Array[] = [];
  const dec = new TextDecoder("utf-8");
  let texto = "";
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    vistos.push(value);
    texto += dec.decode(value, { stream: true });
    if (texto.includes("\n")) break;
  }
  const linea = texto.split(/\r?\n/, 1)[0];
  const cabecera = leerCsv(linea + "\n")[0] ?? [];
  const flujo = new ReadableStream<Uint8Array>({
    async pull(ctl) {
      const v = vistos.shift();
      if (v) return ctl.enqueue(v);
      const { value, done } = await lector.read();
      if (done) ctl.close();
      else ctl.enqueue(value);
    },
    cancel(r) {
      return lector.cancel(r);
    },
  });
  return { cabecera, flujo };
}

const urlParte = (c: Conjunto, anio: number, parte: number, ext: string) => `${BASE}/${c.carpeta}/${anio}/${c.prefijo}${anio}_${parte}.${ext}`;

/** Los archivos publicados de un conjunto y año: por parte, el CSV si está y si no el XLSX. */
async function archivosDelAnio(c: Conjunto, anio: number): Promise<{ url: string; modificado: string | null }[]> {
  const out: { url: string; modificado: string | null }[] = [];
  for (let parte = 0; parte < MAX_PARTES; parte++) {
    let hallado = false;
    for (const ext of ["csv", "xlsx"]) {
      const url = urlParte(c, anio, parte, ext);
      const r = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA } });
      if (r.ok) {
        const lm = r.headers.get("last-modified");
        out.push({ url, modificado: lm ? new Date(lm).toISOString() : null });
        hallado = true;
        break;
      }
      if (r.status !== 404) throw new Error(`HTTP ${r.status} en ${url}`);
    }
    if (!hallado) break;
  }
  return out;
}

/** Años a cargar: el actual y el anterior, o el rango pedido (AAAA). */
export function aniosConosce(p: Pick<ParamsCorrida, "desde" | "hasta">, hoy: string): number[] {
  const actual = Number(hoy.slice(0, 4));
  if (!p.desde && !p.hasta) return [actual - 1, actual];
  const d = Math.max(PRIMER_ANIO, Number((p.desde ?? p.hasta)!.slice(0, 4)));
  const h = Math.min(actual, Number((p.hasta ?? p.desde)!.slice(0, 4)));
  return Array.from({ length: Math.max(0, h - d + 1) }, (_, i) => d + i);
}

const PASO = { retries: { limit: 1, delay: "2 minutes" }, timeout: "30 minutes" } as const;

async function sha256Texto(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function correrConosce(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const resumen: Record<string, unknown> = {};
  let cargados = 0;
  for (const anio of aniosConosce(p, fechaLima())) {
    for (const [nombre, c] of Object.entries(CONJUNTOS)) {
      const r = await step.do(`${nombre} ${anio}`, PASO, async () => {
        const almacen = new Almacen(env, FUENTE);
        const archivos = await archivosDelAnio(c, anio);
        if (!archivos.length) return { sin_archivos: true };
        const entradas: Entrada[] = [];
        for (const a of archivos) {
          entradas.push(await almacen.bajar(a.url, { modificado: a.modificado, forzar: p.forzar, subdir: `${nombre}/${anio}` }));
        }
        const sha = entradas.length === 1 ? entradas[0].sha256 : await sha256Texto(entradas.map((e) => e.sha256).join("+"));
        const clave = `${nombre}/${anio}`;
        return conDb(env.HYPERDRIVE, async (db) => {
          if (!p.seco && !p.forzar && (await yaCargado(db, FUENTE, clave, sha))) {
            registrar("INFO", `   ${clave}: sin cambios (sha256), se salta`, { fuente: FUENTE, instancia: id });
            return { ya_cargado: true };
          }
          const t0 = Date.now();
          await db.ejecutar("BEGIN");
          try {
            let columnas: string[] | null = null;
            let copiadas = 0;
            for (const e of entradas) {
              const obj = await almacen.abrir(e);
              const origen = nombreArchivo(e).toLowerCase().endsWith(".xlsx")
                ? (await obj.body.cancel(), xlsxComoCsv(async (o, l) => {
                    const parte = await env.CRUDOS.get(`raw/${e.file}`, { range: { offset: o, length: l } });
                    if (!parte) throw new Error(`falta el crudo raw/${e.file}`);
                    return parte.body;
                  }, e.bytes))
                : obj.body;
              const { cabecera, flujo } = await separarCabecera(origen);
              const cols = normalizarCabecera(cabecera);
              if (!columnas) {
                columnas = cols;
                await db.ejecutar(`CREATE TEMP TABLE _st (${cols.map((x) => `"${x}" text`).join(", ")}) ON COMMIT DROP`);
              } else if (cols.join() !== columnas.join()) {
                throw new Error(`${nombreArchivo(e)}: cabecera distinta a la de la primera parte`);
              }
              copiadas += (await copiarEnTramos(db, "_st", cols.map((x) => `"${x}"`), flujo)).filas;
            }
            const { cols, select } = selectDestino(c.mapa, new Set(columnas ?? []), anio);
            const faltan = c.mapa.filter(([, o]) => !o.some((x) => columnas!.includes(x))).map(([d]) => d);
            if (faltan.length) registrar("WARNING", `   ${clave}: sin columna para ${faltan.join(", ")}`, { fuente: FUENTE, instancia: id });
            if (p.seco) {
              await db.ejecutar("ROLLBACK");
              return { seco: true, filas: copiadas, columnas, faltan };
            }
            await db.ejecutar(`DELETE FROM ${c.tabla} WHERE anio = $1`, [anio]);
            const filas = await db.ejecutar(`INSERT INTO ${c.tabla} (${cols}) SELECT ${select} FROM _st`);
            await registrarCarga(db, {
              fuente: FUENTE, clave, tabla: c.tabla, archivo: entradas.map(nombreArchivo).join(" + "), gcs_uri: uri(entradas[0]), sha256: sha,
              bytes: entradas.reduce((s, e) => s + e.bytes, 0), filas, fuente_url: FUENTE_URL, descargado_at: entradas[0].downloaded_at,
            });
            await db.ejecutar("COMMIT");
            const segundos = Math.round((Date.now() - t0) / 1000);
            registrar("INFO", `   ${clave}: ${filas} filas → ${c.tabla} (${entradas.map(nombreArchivo).join(", ")}, ${segundos}s)`, { fuente: FUENTE, instancia: id });
            return { filas, faltan, segundos };
          } catch (err) {
            await db.ejecutar("ROLLBACK").catch(() => undefined);
            throw err;
          }
        });
      });
      resumen[`${nombre} ${anio}`] = r;
      if (r && "filas" in r && !("seco" in r)) cargados++;
    }
  }
  if (p.seco || !cargados) return resumen;
  resumen.cruces = await step.do("refrescar_cruces", CARGA, () =>
    conDb(env.HYPERDRIVE, (db) => db.filas<{ tipo: string; filas: number }>("SELECT * FROM refrescar_cruces()")));
  return resumen;
}
