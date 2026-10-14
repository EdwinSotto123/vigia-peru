/**
 * JNE — autoridades vigentes y electas por ubigeo (PNDA) → `jne_autoridades`: port de
 * backend/scrapers/jne_infogob/pipeline.py (gotchas del archivo en su docstring: sin DNI, UBIGEO en
 * codificación RENIEC/JNE, fechas como seriales de Excel). El XLS se lee con src/xls.ts (semántica de
 * xlrd). El snapshot manual de Infogob (`--root`) sigue en Python.
 */

import type { WorkflowStep } from "cloudflare:workers";
import { Almacen, nombreArchivo, uri } from "../almacen.ts";
import type { Entrada } from "../almacen.ts";
import { registrarCarga, yaCargado } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { conDb } from "../db.ts";
import { obtenerDataset, recursosDeDatos, urlDataset } from "../pnda.ts";
import { colapsar, cortar, flotante, reprFlotante, sinMarcasNfd, strip } from "../py.ts";
import { registrar } from "../registro.ts";
import { ZonaIndex, resolverUbigeo } from "../ubigeo.ts";
import type { FilaZona } from "../ubigeo.ts";
import { fechaExcel, leerXls, textoCelda, verdadCelda } from "../xls.ts";
import type { Celda } from "../xls.ts";
import { CARGA, DESCARGA, LECTURA } from "./comun.ts";

const FUENTE = "jne_infogob";
const PARTES: Record<string, [slug: string, prefijo: string, vigente: boolean]> = {
  vigentes: ["autoridades-vigentes-nivel-nacional-jurado-nacional-de-elecciones", "autoridades_vigentes", true],
  electas: ["autoridades-electas-en-procesos-electorales-jurado-nacional-de-elecciones", "autoridades_electas", false],
};

const txt = (v: Celda | undefined) => textoCelda(v, reprFlotante);
/** `str(v or "")`. */
const tx = (v: Celda | undefined) => (verdadCelda(v) ? txt(v) : "");

/** `norm` de jne_infogob: NFD sin marcas, mayúsculas, espacios colapsados. */
export function normJne(v: Celda | undefined | string | null): string {
  const s = typeof v === "string" ? v : v === null || v === undefined ? "" : tx(v);
  return colapsar(sinMarcasNfd(s).toUpperCase());
}

/** El reporte "electas" usa prefijo TX/NU/FE en las cabeceras; se normalizan a las de "vigentes". */
function columna(nombre: string): string {
  const n = strip(nombre).toUpperCase();
  return n.startsWith("FE") ? n : n.replace(/^(TX|NU|FE)(?=[A-Z])/, "");
}

/** `float(v)` de Python sobre un valor de xlrd; null si lanzaría. */
function flotanteCelda(v: Celda): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") return flotante(v);
  return v.entero;
}

/** 'ELECCIONES REGIONALES Y MUNICIPALES 2022' → 'ERM2022'; 'ELECCIONES GENERALES 2026' → 'EG2026'. */
export function codigoProceso(texto: Celda | string, anio: Celda | undefined): string {
  const t = normJne(texto);
  let y: string;
  if (anio !== undefined && anio !== "") {
    const f = flotanteCelda(anio);
    if (f === null || !Number.isFinite(f)) throw new Error(`ANIOELECCION inválido: ${JSON.stringify(anio)}`);
    y = String(Math.trunc(f));
  } else y = /(20\d\d)/.exec(t)?.[1] ?? "";
  if (t.includes("COMPLEMENTARIAS")) return `EMC${y}`;
  if (t.includes("REGIONALES") && t.includes("MUNICIPALES")) return `ERM${y}`;
  if (t.includes("SEGUNDA ELECCI") && t.includes("REGIONAL")) return `SER${y}`;
  if (t.includes("GENERALES")) return `EG${y}`;
  return t ? cortar(t.replaceAll(" ", ""), 12) + y : `DESCONOCIDO${y}`;
}

type FilaCruda = Record<string, Celda> & { _vigente: boolean; _fechas: Record<string, string | null> };

/** `parse_xls`: filas por cabecera normalizada, con FEINICIOVIGENCIA/FEFINVIGENCIA ya como fechas. */
export function parsearXls(archivo: Uint8Array, vigente: boolean): FilaCruda[] {
  const { datemode, filas } = leerXls(archivo);
  if (!filas.length) return [];
  const cab = filas[0].map((c) => columna(txt(c)));
  const out: FilaCruda[] = [];
  for (let i = 1; i < filas.length; i++) {
    const r = {} as FilaCruda;
    cab.forEach((k, j) => {
      if (j < filas[i].length) r[k] = filas[i][j];
    });
    r._fechas = {};
    for (const k of ["FEINICIOVIGENCIA", "FEFINVIGENCIA"]) {
      const v = r[k];
      let f: string | null = null;
      if (typeof v === "number" && v > 0) f = fechaExcel(v, datemode);
      else if (typeof v === "string" && strip(v)) {
        const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(cortar(strip(v), 10));
        if (m) {
          const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
          if (d.getUTCDate() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1) f = d.toISOString().slice(0, 10);
        }
      }
      r._fechas[k] = f;
    }
    r._vigente = vigente;
    out.push(r);
  }
  return out;
}

export interface Autoridad {
  proceso: string;
  ubigeo: string | null;
  ubigeo_jne: string | null;
  departamento: string | null;
  provincia: string | null;
  distrito: string | null;
  cargo: string;
  nombre: string;
  nombre_norm: string;
  dni: null;
  organizacion_politica: string | null;
  periodo_inicio: string | null;
  periodo_fin: string | null;
  periodo_texto: string | null;
  posicion: number | null;
  ambito: string | null;
  pronunciamiento: string | null;
  es_reemplazo: boolean;
  genero: string | null;
  vigente: boolean;
  fuente: string;
  fuente_url: string;
}

export const COLS = ["proceso", "ubigeo", "ubigeo_jne", "departamento", "provincia", "distrito", "cargo", "nombre", "nombre_norm",
  "dni", "organizacion_politica", "periodo_inicio", "periodo_fin", "periodo_texto", "posicion", "ambito",
  "pronunciamiento", "es_reemplazo", "genero", "vigente", "fuente", "fuente_url"] as const;
const COLS_SQL = [...COLS, "sha256", "descargado_at"];
const CASTS: Record<string, string> = {
  periodo_inicio: "::date", periodo_fin: "::date", posicion: "::int", es_reemplazo: "::boolean", vigente: "::boolean", descargado_at: "::timestamptz",
};

/** `normalize_rows`. */
export function normalizarFilas(crudas: FilaCruda[], ix: ZonaIndex | null, fuenteUrl: string): Autoridad[] {
  const out: Autoridad[] = [];
  for (const r of crudas) {
    const nombres = strip(tx(r.NOMBRES));
    const ap1 = strip(tx(r.APELLIDOPATERNO));
    const ap2 = strip(tx(r.APELLIDOMATERNO));
    const nombre = [ap1, ap2, nombres].filter(Boolean).join(" ");
    const cargo = normJne(r.CARGO);
    if (!nombre || !cargo) continue;
    const [region, prov, dist] = ["REGION", "PROVINCIA", "DISTRITO"].map((k) => strip(tx(r[k])) || null);
    const pos = r.POSICION;
    let proceso = codigoProceso(verdadCelda(r.PROCESOELECTORAL) ? r.PROCESOELECTORAL : "", r.ANIOELECCION);
    if (proceso.startsWith("DESCONOCIDO") && tx(r.PERIODO).includes("2023 - 2026")) proceso = "ERM2022";
    let posicion: number | null = null;
    if (pos !== undefined && pos !== "") {
      const f = flotanteCelda(pos);
      if (f === null || !Number.isFinite(f)) throw new Error(`POSICION inválida: ${JSON.stringify(pos)}`);
      posicion = Math.trunc(f);
    }
    out.push({
      proceso,
      ubigeo: ix && region ? resolverUbigeo(ix, region, prov, dist) : null,
      ubigeo_jne: strip(tx(r.UBIGEO)) || null,
      departamento: region, provincia: prov, distrito: dist,
      cargo,
      nombre,
      nombre_norm: normJne(nombre),
      dni: null,
      organizacion_politica: strip(tx(r.ORGANIZACIONPOLITICA)) || null,
      periodo_inicio: r._fechas.FEINICIOVIGENCIA ?? null,
      periodo_fin: r._fechas.FEFINVIGENCIA ?? null,
      periodo_texto: strip(tx(r.PERIODO)) || null,
      posicion,
      ambito: normJne(r.AMBITO) || null,
      pronunciamiento: strip(tx(r.PRONUNCIAMIENTO)) || null,
      es_reemplazo: !["", "0", "0.0"].includes(strip(tx(r.AUTORIDADREEMPLAZO))),
      genero: strip(tx(r.GENERO)) || null,
      vigente: r._vigente,
      fuente: "jne_pnda",
      fuente_url: fuenteUrl,
    });
  }
  return out;
}

const ENRIQUECER_DNI_SQL = `
WITH cand AS (
  SELECT DISTINCT ON (nombre_norm, organizacion_norm, proceso) nombre_norm, organizacion_norm, proceso, dni
  FROM (SELECT upper(immutable_unaccent(apellidos || ' ' || nombres)) AS nombre_norm,
               upper(immutable_unaccent(organizacion)) AS organizacion_norm, proceso, dni
          FROM onpe_candidatos WHERE dni ~ '^[0-9]{8}$') c
  ORDER BY nombre_norm, organizacion_norm, proceso, dni
)
UPDATE jne_autoridades a
   SET dni = cand.dni
  FROM cand
 WHERE a.dni IS NULL
   AND cand.nombre_norm = a.nombre_norm
   AND cand.organizacion_norm = upper(immutable_unaccent(a.organizacion_politica))
   AND cand.proceso = a.proceso`;

// jne_candidaturas (Infogob) no trae documento: se completa desde onpe_candidatos (nombre + organización + año).
const CANDIDATURAS_DNI_SQL = String.raw`
WITH cand AS (
  SELECT DISTINCT ON (nombre_norm, org_norm, anio) nombre_norm, upper(immutable_unaccent(organizacion)) AS org_norm,
         substring(proceso from '\d{4}')::int AS anio, dni
    FROM onpe_candidatos
   WHERE dni ~ '^[0-9]{8}$' AND proceso ~ '\d{4}'
   ORDER BY nombre_norm, org_norm, anio, dni
)
UPDATE jne_candidaturas c
   SET numero_documento = cand.dni
  FROM cand
 WHERE c.numero_documento IS NULL
   AND cand.nombre_norm = c.nombre
   AND cand.org_norm = upper(immutable_unaccent(c.partido))
   AND cand.anio = c.año`;

export async function correrJne(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const zonas = await step.do("zonas", LECTURA, () =>
    conDb(env.HYPERDRIVE, (db) => db.filas<FilaZona>("SELECT ubigeo, nivel, nombre, padre_ubigeo FROM zonas")));
  const resumen: Record<string, unknown> = {};
  for (const [parte, [slug, prefijo, vigente]] of Object.entries(PARTES)) {
    const entrada = await step.do(`descargar ${parte}`, DESCARGA, async (): Promise<Entrada | null> => {
      const ds = await obtenerDataset(env, slug);
      const res = recursosDeDatos(ds, [".xls", ".xlsx", ".csv"]).filter((r) => r.archivo.toLowerCase().startsWith(prefijo));
      if (!res.length) {
        registrar("WARNING", `   ${parte}: no encontré ${prefijo}*.xls en ${urlDataset(slug)}`, { fuente: FUENTE, instancia: id });
        return null;
      }
      // El más reciente por la fecha AAAAMMDD del nombre (sort estable de Python, de mayor a menor).
      const clave = (a: string) => a.replace(/\D/g, "");
      res.sort((a, b) => (clave(a.archivo) < clave(b.archivo) ? 1 : clave(a.archivo) > clave(b.archivo) ? -1 : 0));
      return new Almacen(env, FUENTE).bajar(res[0].url, { archivo: res[0].archivo, modificado: ds.modificado, forzar: p.forzar, subdir: parte });
    });
    if (!entrada) continue;
    resumen[parte] = await step.do(`cargar ${parte}`, CARGA, async () => {
      if (!nombreArchivo(entrada).toLowerCase().endsWith(".xls")) throw new Error(`${nombreArchivo(entrada)}: se esperaba un .xls`);
      const datos = await new Almacen(env, FUENTE).leer(entrada);
      const filas = normalizarFilas(parsearXls(datos, vigente), ZonaIndex.desdeFilas(zonas), urlDataset(slug));
      const distritales = filas.filter((r) => r.ambito === "DISTRITAL");
      const stats = {
        archivo: nombreArchivo(entrada), autoridades: filas.length, con_ubigeo: filas.filter((r) => r.ubigeo).length,
        distritales_6: `${distritales.filter((r) => r.ubigeo?.length === 6).length}/${distritales.length}`,
        procesos: [...new Set(filas.map((r) => r.proceso))].sort(),
      };
      registrar("INFO", `   ${stats.archivo} → ${stats.autoridades} autoridades · ${stats.con_ubigeo} con ubigeo INEI (${stats.distritales_6} distritales a 6 dígitos)`,
        { fuente: FUENTE, instancia: id });
      if (p.seco) return { ...stats, seco: true };
      return conDb(env.HYPERDRIVE, (db) => db.transaccion(async () => {
        if (!p.forzar && (await yaCargado(db, FUENTE, parte, entrada.sha256))) {
          registrar("INFO", `   ${parte} ya cargado con el mismo sha256`, { fuente: FUENTE, instancia: id });
          return { ...stats, ya_cargado: true };
        }
        // "vigentes" es la foto completa → reemplaza todo lo de la fuente; "electas" solo agrega o
        // actualiza (proclamados que todavía no asumen) sobre esa foto.
        const borradas = parte === "vigentes" ? await db.ejecutar("DELETE FROM jne_autoridades WHERE fuente = 'jne_pnda'") : 0;
        // Tandas de 2000 como execute_values: un ON CONFLICT DO UPDATE no admite la misma clave dos veces
        // en una sentencia, así que el corte tiene que ser el mismo que en Python.
        for (let i = 0; i < filas.length; i += 2000) {
          const vals: unknown[] = [];
          const tuplas = filas.slice(i, i + 2000).map((f) => {
            const b = vals.length;
            vals.push(...COLS.map((c) => f[c]), entrada.sha256, entrada.downloaded_at);
            return `(${COLS_SQL.map((c, k) => `$${b + k + 1}${CASTS[c] ?? ""}`).join(", ")})`;
          });
          await db.ejecutar(
            `INSERT INTO jne_autoridades (${COLS.join(", ")}, sha256, descargado_at) VALUES ${tuplas.join(", ")} ` +
            "ON CONFLICT (proceso, cargo, nombre_norm, COALESCE(ubigeo, '')) DO UPDATE SET " +
            "organizacion_politica = EXCLUDED.organizacion_politica, periodo_inicio = EXCLUDED.periodo_inicio, " +
            "periodo_fin = EXCLUDED.periodo_fin, es_reemplazo = EXCLUDED.es_reemplazo, vigente = jne_autoridades.vigente OR EXCLUDED.vigente, " +
            "ubigeo_jne = EXCLUDED.ubigeo_jne, sha256 = EXCLUDED.sha256, descargado_at = EXCLUDED.descargado_at", vals);
        }
        await registrarCarga(db, {
          fuente: FUENTE, clave: parte, tabla: "jne_autoridades", archivo: nombreArchivo(entrada), gcs_uri: uri(entrada),
          sha256: entrada.sha256, bytes: entrada.bytes, filas: filas.length, fuente_url: urlDataset(slug), descargado_at: entrada.downloaded_at,
        });
        registrar("INFO", `   → jne_autoridades (${parte}): -${borradas} +${filas.length}`, { fuente: FUENTE, instancia: id });
        return { ...stats, borradas, insertadas: filas.length };
      }));
    });
  }
  if (p.seco) return resumen;
  // DNI desde onpe_candidatos (Claridad publica el DNI de cada candidato): nombre + organización + proceso.
  resumen.dni = await step.do("completar dni", CARGA, () => conDb(env.HYPERDRIVE, (db) => db.transaccion(async () => {
    const [{ existe }] = await db.filas<{ existe: string | null }>("SELECT to_regclass('onpe_candidatos')::text AS existe");
    if (!existe) return "onpe_candidatos no existe todavía: DNI sin completar (correr onpe_claridad --candidatos)";
    const n = await db.ejecutar(ENRIQUECER_DNI_SQL);
    const [a] = await db.filas<{ tot: string; con: string }>("SELECT count(*)::text AS tot, count(dni)::text AS con FROM jne_autoridades");
    let m = 0;
    let c = { tot: "0", con: "0" };
    const [{ existe: hayCand }] = await db.filas<{ existe: string | null }>("SELECT to_regclass('jne_candidaturas')::text AS existe");
    if (hayCand) {
      m = await db.ejecutar(CANDIDATURAS_DNI_SQL);
      [c] = await db.filas<{ tot: string; con: string }>("SELECT count(*)::text AS tot, count(numero_documento)::text AS con FROM jne_candidaturas");
    }
    const msg = `DNI completado desde onpe_candidatos: jne_autoridades +${n} (${a.con}/${a.tot} con DNI) · jne_candidaturas +${m} (${c.con}/${c.tot} con DNI)`;
    registrar("INFO", `   ${msg}`, { fuente: FUENTE, instancia: id });
    return msg;
  })));
  return resumen;
}
