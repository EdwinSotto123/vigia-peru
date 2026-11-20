/**
 * SUSALUD → las tablas de Gobserva Salud (migración 432). Semanal (calendario.ts) y a mano con /correr.
 *
 * Fuentes oficiales, todas de la Superintendencia Nacional de Salud (verificadas el 2026-11-20 desde el Perú):
 *   · RENIPRESS, el registro de IPRESS: CSV de su portal de datos abiertos (DKAN, datos.susalud.gob.pe; la API
 *     `api/3/action/package_show` responde y da la URL del archivo vigente: hoy RENIPRESS_2026_v8.csv, 36 mil filas).
 *   · Registro de Sanciones aplicables a IAFAS, IPRESS y UGIPRESS: XLSX en gob.pe (informes y publicaciones 455207; se
 *     reemplaza con cada actualización, el nombre lleva la fecha). Sólo sanciones FIRMES.
 *   · Reporte anonimizado de consultas y denuncias por protección de derechos en salud: un CSV por año.
 *   · Consulta A (recursos de salud por IPRESS) y Consulta H (producción de intervenciones quirúrgicas): un CSV por mes.
 *
 * El diccionario de RENIPRESS dice NORTE = longitud y ESTE = latitud, pero los datos traen la latitud en NORTE (-11,7) y
 * la longitud en ESTE (-76,2): se valida contra la caja del Perú y, si vienen al revés, se dan vuelta.
 *
 * Privacidad: ninguno de estos archivos trae nombres de personas (los de denuncias están anonimizados por SUSALUD; de
 * esos sólo se guarda el conteo por institución). El detalle por IPRESS, que sí trae al director médico y al
 * representante legal, lo lee susalud_detalle.ts sin guardar sus nombres ni documentos.
 *
 * Cada paso es idempotente (upsert por clave; con el mismo sha256 no se recarga) y queda en datasets_cargas.
 */

import type { WorkflowStep } from "cloudflare:workers";
import * as XLSX from "xlsx";
import { Almacen, nombreArchivo, uri, type Entrada } from "../almacen.ts";
import { registrarCarga, yaCargado } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { decodificarCp1252, leerCsv } from "../csv.ts";
import { conDb, type Db } from "../db.ts";
import { ErrorHttp, obtener } from "../http.ts";
import { registrar } from "../registro.ts";
import { CARGA, DESCARGA, LECTURA } from "./comun.ts";

export const FUENTE = "susalud";
export const PORTAL = "http://datos.susalud.gob.pe";
export const PAGINA_SANCIONES = "https://www.gob.pe/institucion/susalud/informes-publicaciones/455207-registro-de-sanciones-aplicables-a-las-iafas-ipress-y-ugipress";

/** Los conjuntos del portal de datos abiertos de SUSALUD que se leen (su `name` en DKAN). */
export const DATASETS = {
  renipress: "registro-nacional-de-ipress-renipress",
  denuncias: "reporte-anonimizado-de-consultas-y-denuncias-por-protección-de-derechos-en-salud-nivel",
  recursos: (anio: number) => `consulta-recursos-de-salud-${anio}`,
  cirugias: (anio: number) => `consulta-h-producción-asistencial-de-intervenciones-quirúrgicas-${anio}`,
} as const;

// ─── Utilidades puras ──────────────────────────────────────────────────────────────────────────────

/** Sin espacios de más; vacío, «-», «NO TIENE», «ACTUALIZAR» → null. */
export function limpio(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  if (!t || /^(-+|\.|0+(\.0+)?|null|none|nan|no tiene|actualizar|no aplica)$/i.test(t)) return null;
  return t;
}

/** Mayúsculas sin tildes ni signos, como mef_norm() de la base: para buscar y cruzar. */
export function normalizar(v: string | null | undefined): string {
  return (v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** «1995-01-01 00:00:00», «27/10/2026», «20260115» o una fecha de Excel → AAAA-MM-DD; 1900-01-01 y lo ilegible → null. */
export function fecha(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const t = String(v).trim();
  let a: number, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (r) [a, m, d] = [+r[1], +r[2], +r[3]];
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(t))) [a, m, d] = [+r[3], +r[2], +r[1]];
  else if ((r = /^(\d{4})(\d{2})(\d{2})$/.exec(t))) [a, m, d] = [+r[1], +r[2], +r[3]];
  else return null;
  if (a < 1950 || a > 2100) return null;
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return f.toISOString().slice(0, 10);
}

/** Un conteo de SUSALUD: «12» → 12; «NE_0001» (no especificado) y lo que no es número → null. */
export function entero(v: unknown): number | null {
  const t = String(v ?? "").trim().replace(/\.0+$/, "");
  return /^-?\d+$/.test(t) ? Number(t) : null;
}

/** «2,50» o «2.5» → 2.5; «NE_0001» → null. */
export function decimal(v: unknown): number | null {
  const t = String(v ?? "").trim().replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/** El código de IPRESS con sus 8 cifras («5969» → «00005969»); null si no es un número. */
export function codigoIpress(v: unknown): string | null {
  const t = String(v ?? "").trim().replace(/\.0+$/, "");
  return /^\d{1,8}$/.test(t) ? t.padStart(8, "0") : null;
}

/** Caja del Perú (con margen). */
const LAT = [-18.6, 0.2] as const;
const LON = [-81.6, -68.4] as const;
const enLat = (x: number) => x >= LAT[0] && x <= LAT[1];
const enLon = (x: number) => x >= LON[0] && x <= LON[1];

/** Las coordenadas de RENIPRESS: [lat, lon] dentro del Perú (dadas vuelta si vienen al revés) o [null, null]. */
export function coordenadas(norte: unknown, este: unknown): [number | null, number | null] {
  const a = decimal(norte);
  const b = decimal(este);
  if (a === null || b === null || (a === 0 && b === 0)) return [null, null];
  if (enLat(a) && enLon(b)) return [a, b];
  if (enLat(b) && enLon(a)) return [b, a];
  return [null, null];
}

/** El sector de una IPRESS por su institución. */
export function sectorDe(institucion: string | null): "publico" | "privado" | "otro" {
  const t = normalizar(institucion);
  if (t === "PRIVADO") return "privado";
  if (!t || t === "OTRO") return "otro";
  return "publico";
}

/** Separa por `;` (o `,`) un CSV de SUSALUD (UTF-8 con BOM; si no es UTF-8 válido, latin-1). */
export function textoCsv(datos: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(datos).replace(/^﻿/, "");
  } catch {
    return decodificarCp1252(datos);
  }
}

export function tablaCsv(datos: Uint8Array): Record<string, string>[] {
  const texto = textoCsv(datos);
  const fin = texto.indexOf("\n");
  const primera = texto.slice(0, fin < 0 ? 2000 : fin);
  const sep = (primera.match(/;/g)?.length ?? 0) >= (primera.match(/,/g)?.length ?? 0) ? ";" : ",";
  const filas = leerCsv(texto, sep);
  const cab = (filas.shift() ?? []).map((c) => c.replace(/^﻿/, "").trim().toUpperCase());
  return filas
    .filter((f) => f.some((c) => c.trim()))
    .map((f) => Object.fromEntries(cab.map((c, i) => [c, f[i] ?? ""])));
}

// ─── RENIPRESS ─────────────────────────────────────────────────────────────────────────────────────

export interface FilaIpress {
  codigo: string; nombre: string; nombre_norm: string; institucion: string | null; sector: string; clasificacion: string | null;
  tipo: string | null; categoria: string | null; estado: string | null; activo: boolean; departamento: string | null;
  provincia: string | null; distrito: string | null; ubigeo: string | null; direccion: string | null; disa: string | null;
  red: string | null; microred: string | null; unidad_ejecutora: string | null; cod_ue: number | null; telefono: string | null;
  horario: string | null; inicio_actividad: string | null; lat: number | null; lon: number | null; imagenes: string[];
}

const CATEGORIAS = new Set(["I-1", "I-2", "I-3", "I-4", "II-1", "II-2", "II-E", "III-1", "III-2", "III-E"]);
const RE_COLUMNAS_RENIPRESS = ["COD_IPRESS", "NOMBRE", "CATEGORIA", "ESTADO", "UBIGEO", "NORTE", "ESTE"];

export function leerRenipress(datos: Uint8Array): { filas: FilaIpress[]; cuenta: Record<string, number> } {
  const tabla = tablaCsv(datos);
  const cuenta: Record<string, number> = {};
  const sumar = (k: string) => { cuenta[k] = (cuenta[k] ?? 0) + 1; };
  if (!tabla.length) throw new Error("RENIPRESS vacío");
  const faltan = RE_COLUMNAS_RENIPRESS.filter((c) => !(c in tabla[0]));
  if (faltan.length) throw new Error(`RENIPRESS sin las columnas ${faltan.join(", ")}: cambió el formato`);
  const porCodigo = new Map<string, FilaIpress>();
  for (const f of tabla) {
    sumar("leidas");
    const codigo = codigoIpress(f.COD_IPRESS);
    const nombre = limpio(f.NOMBRE);
    if (!codigo || !nombre) { sumar("descartadas: sin código o nombre"); continue; }
    const [lat, lon] = coordenadas(f.NORTE, f.ESTE);
    if (lat === null && (f.NORTE || f.ESTE)) sumar("coordenadas fuera del Perú");
    const cat = (limpio(f.CATEGORIA) ?? "").toUpperCase();
    const estado = limpio(f.ESTADO)?.toUpperCase() ?? null;
    const institucion = limpio(f.INSTITUCION)?.toUpperCase() ?? null;
    const ue = entero(f.COD_UE);
    if (porCodigo.has(codigo)) sumar("códigos repetidos (queda el último)");
    porCodigo.set(codigo, {
      codigo, nombre, nombre_norm: normalizar(nombre), institucion, sector: sectorDe(institucion),
      clasificacion: limpio(f.CLASIFICACION), tipo: limpio(f.TIPO_ESTABLECIMIENTO), categoria: CATEGORIAS.has(cat) ? cat : null,
      estado, activo: estado === "ACTIVO",
      departamento: limpio(f.DEPARTAMENTO), provincia: limpio(f.PROVINCIA), distrito: limpio(f.DISTRITO),
      ubigeo: /^\d{6}$/.test((f.UBIGEO ?? "").trim()) ? f.UBIGEO.trim() : null,
      direccion: limpio(f.DIRECCION), disa: limpio(f.DISA), red: limpio(f.RED), microred: limpio(f.MICRORED),
      unidad_ejecutora: limpio(f.UNIDAD_EJECUTORA), cod_ue: ue && ue > 0 ? ue : null,
      telefono: limpio(f.TELEFONO), horario: limpio(f.HORARIO), inicio_actividad: fecha(f.INICIO_ACTIVIDAD),
      lat, lon,
      imagenes: ["IMAGEN_1", "IMAGEN_2", "IMAGEN_3"].map((k) => (f[k] ?? "").trim()).filter((u) => /^https?:\/\//.test(u)),
    });
  }
  return { filas: [...porCodigo.values()], cuenta };
}

const CAMPOS_IPRESS = ["codigo", "nombre", "nombre_norm", "institucion", "sector", "clasificacion", "tipo", "categoria", "estado",
  "activo", "departamento", "provincia", "distrito", "ubigeo", "direccion", "disa", "red", "microred", "unidad_ejecutora", "cod_ue",
  "telefono", "horario", "inicio_actividad", "lat", "lon", "imagenes"] as const;
const CAST_IPRESS: Partial<Record<(typeof CAMPOS_IPRESS)[number], string>> = {
  activo: "::boolean", cod_ue: "::int", inicio_actividad: "::date", lat: "::float8", lon: "::float8", imagenes: "::text[]",
};
/** Lo que se compara entre cargas (la huella) y lo que se anota como cambio. */
const HUELLA = ["nombre", "institucion", "clasificacion", "tipo", "categoria", "estado", "direccion", "ubigeo", "telefono", "horario", "lat", "lon"];
const SEGUIDOS = ["nombre", "estado", "categoria", "tipo", "institucion", "clasificacion", "direccion"];

/** Inserta filas en una tabla temporal en tandas de 500 (parámetros de pg). */
export async function insertarTandas(db: Db, tabla: string, campos: readonly string[], filas: Record<string, unknown>[],
  casts: Record<string, string> = {}, tanda = 500): Promise<void> {
  for (let k = 0; k < filas.length; k += tanda) {
    const vals: unknown[] = [];
    const tuplas = filas.slice(k, k + tanda).map((f) => {
      const b = vals.length;
      vals.push(...campos.map((c) => f[c] ?? null));
      return `(${campos.map((c, j) => `$${b + j + 1}${casts[c] ?? ""}`).join(", ")})`;
    });
    await db.ejecutar(`INSERT INTO ${tabla} (${campos.join(", ")}) VALUES ${tuplas.join(", ")}`, vals);
  }
}

export async function cargarRenipress(db: Db, filas: FilaIpress[], archivo: string): Promise<Record<string, number>> {
  return db.transaccion(async () => {
    await db.ejecutar("SET LOCAL lock_timeout = '10s'");
    await db.ejecutar(`CREATE TEMP TABLE _ip (LIKE salud_ipress INCLUDING DEFAULTS) ON COMMIT DROP`);
    await db.ejecutar("ALTER TABLE _ip ALTER COLUMN huella DROP NOT NULL");
    await insertarTandas(db, "_ip", CAMPOS_IPRESS, filas as unknown as Record<string, unknown>[], CAST_IPRESS as Record<string, string>);
    await db.ejecutar(`UPDATE _ip SET huella = md5(concat_ws('|', ${HUELLA.map((c) => `${c}::text`).join(", ")}))`);
    const [{ n: antes }] = await db.filas<{ n: number }>("SELECT count(*)::int AS n FROM salud_ipress");
    // Los cambios, campo por campo, antes de pisar la fila (la historia que el CSV no guarda).
    const cambios = await db.ejecutar(`
      INSERT INTO salud_ipress_cambio (codigo, campo, antes, despues, fuente)
      SELECT r.codigo, v.campo, v.antes, v.despues, 'renipress_csv'
        FROM _ip r JOIN salud_ipress i ON i.codigo = r.codigo
       CROSS JOIN LATERAL (VALUES ${SEGUIDOS.map((c) => `('${c}', i.${c}::text, r.${c}::text)`).join(", ")}) v(campo, antes, despues)
       WHERE i.huella IS DISTINCT FROM r.huella AND v.antes IS DISTINCT FROM v.despues`);
    // Una IPRESS nueva es un alta, salvo en la primera carga (todas serían nuevas).
    const altas = antes > 0
      ? await db.ejecutar(`INSERT INTO salud_ipress_cambio (codigo, campo, antes, despues, fuente)
                            SELECT r.codigo, 'alta', NULL, r.estado, 'renipress_csv' FROM _ip r
                             WHERE NOT EXISTS (SELECT 1 FROM salud_ipress i WHERE i.codigo = r.codigo)`)
      : 0;
    const bajas = await db.ejecutar(`
      WITH b AS (UPDATE salud_ipress i SET en_registro = false
                  WHERE i.en_registro AND NOT EXISTS (SELECT 1 FROM _ip r WHERE r.codigo = i.codigo) RETURNING i.codigo, i.estado)
      INSERT INTO salud_ipress_cambio (codigo, campo, antes, despues, fuente) SELECT codigo, 'baja_registro', estado, NULL, 'renipress_csv' FROM b`);
    const cols = CAMPOS_IPRESS.filter((c) => c !== "codigo");
    const escritas = await db.filas<{ nueva: boolean }>(`
      INSERT INTO salud_ipress AS t (${CAMPOS_IPRESS.join(", ")}, huella, fuente_archivo, visto_at, en_registro)
      SELECT ${CAMPOS_IPRESS.join(", ")}, huella, $1, now(), true FROM _ip
      ON CONFLICT (codigo) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}, huella = EXCLUDED.huella,
        fuente_archivo = EXCLUDED.fuente_archivo, visto_at = now(), en_registro = true,
        cambio_at = CASE WHEN t.huella IS DISTINCT FROM EXCLUDED.huella THEN now() ELSE t.cambio_at END
      RETURNING (xmax = 0) AS nueva`, [archivo]);
    await db.ejecutar("ANALYZE salud_ipress");
    const nuevas = escritas.filter((e) => e.nueva).length;
    return { ipress: filas.length, nuevas, cambios, altas, bajas, sin_coordenadas: filas.filter((f) => f.lat === null).length };
  });
}

// ─── Registro de Sanciones ─────────────────────────────────────────────────────────────────────────

export interface FilaSancion {
  administrada_tipo: string | null; naturaleza: string | null; institucion: string | null; codigo_registro: string | null;
  nombre: string; pas: string | null; resolucion: string | null; fecha_emision: string | null; fecha_notificacion: string | null;
  fecha_inscripcion: string | null; tipo_sancion: string; tipo_sancion_texto: string | null; multa_uit: number | null;
  medidas_correctivas: string | null; ejecucion_forzosa: string | null; judicializacion: string | null; judicializada: boolean;
  cancelacion: string | null; departamento: string | null; provincia: string | null; distrito: string | null;
  infraccion_codigo: string | null; gravedad: string | null; infraccion: string | null; normas: string | null;
}

export interface FilaInfraccion { codigo: string; administrado: string | null; anexo: string | null; gravedad: string | null; detalle: string | null }

/** «Amonestación escrita» → amonestacion; «MULTA» → multa; «Cierre Definitivo» → cierre_definitivo. */
export function tipoSancion(v: string | null): string {
  const t = normalizar(v);
  if (t.startsWith("AMONEST")) return "amonestacion";
  if (t.startsWith("MULTA")) return "multa";
  if (t.includes("CIERRE") && t.includes("DEFINITIV")) return "cierre_definitivo";
  if (t.includes("CIERRE")) return "cierre_temporal";
  if (t.includes("REVOC")) return "revocacion";
  return "otra";
}

/** «III-A-Grave-1» → grave; «I-A-Leve-16» → leve; «III-B-Muy Grave-3» → muy_grave. */
export function gravedadDe(codigo: string | null): string | null {
  const t = normalizar(codigo);
  if (/MUY ?GRAVE/.test(t)) return "muy_grave";
  if (/\bGRAVE\b/.test(t)) return "grave";
  if (/\bLEVE\b/.test(t)) return "leve";
  return null;
}

/** Un texto del registro que dice que no hay nada («No se reportó», «Ninguna», «No aplica») → null. */
function nada(v: unknown): string | null {
  const t = limpio(v);
  if (!t) return null;
  return /^(no se report[oó]|ninguna?|no aplica|sin informaci[oó]n)\.?$/i.test(t) ? null : t;
}

/** Un valor de una celda de SheetJS (con cellDates): Date, número o texto. */
const celda = (v: unknown): unknown => (v instanceof Date ? v : v === undefined ? null : v);

export function leerSanciones(datos: Uint8Array): { filas: FilaSancion[]; infracciones: FilaInfraccion[]; cuenta: Record<string, number> } {
  const libro = XLSX.read(datos, { type: "array", cellDates: true, sheets: ["BasedeDatos", "RIS"] });
  const hoja = libro.Sheets.BasedeDatos;
  if (!hoja) throw new Error("el Registro de Sanciones no trae la hoja BasedeDatos: cambió el formato");
  const filas = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, raw: true, defval: null });
  const cab = (filas.shift() ?? []).map((c) => normalizar(String(c ?? "")));
  const col = (prefijo: string) => {
    const i = cab.findIndex((c) => c.startsWith(prefijo));
    if (i < 0) throw new Error(`el Registro de Sanciones no trae la columna «${prefijo}»`);
    return i;
  };
  const C = {
    tipo: col("ADMINISTRADA SANCIONADA"), naturaleza: col("NATURALEZA"), institucion: col("INSTITUCION A LA QUE"),
    codigo: col("CODIGO DE REGISTRO"), nombre: col("RAZON SOCIAL"), pas: col("PROCEDIMIENTO ADMINISTRATIVO"),
    resolucion: col("NUMERO DE RESOLUCION"), emision: col("EMISION"), notificacion: col("NOTIFICACION"),
    inscripcion: col("INSCRIPCION"), sancion: col("TIPO DE SANCION"), uit: col("VALOR DE SANCION"), correctivas: col("MEDIDAS CORRECTIVAS"),
    forzosa: col("MEDIDAS DE EJECUCION"), judicial: col("ESTADO DE JUDICIALIZACION"), cancelacion: col("CANCELACION"),
    depto: col("DEPARTAMENTO"), prov: col("PROVINCIA"), dist: col("DISTRITO"), infCodigo: cab.findIndex((c) => c === "CODIGO"),
    infraccion: col("INFRACCION TIPIFICADA"), normas: col("NORMAS SUSTANTIVAS"),
  };
  const cuenta: Record<string, number> = {};
  const sumar = (k: string) => { cuenta[k] = (cuenta[k] ?? 0) + 1; };
  const out: FilaSancion[] = [];
  for (const f of filas) {
    if (!f || !f.some((c) => c !== null && String(c).trim() !== "")) continue;
    sumar("leidas");
    const nombre = limpio(f[C.nombre]);
    if (!nombre) { sumar("descartadas: sin nombre"); continue; }
    const texto = limpio(f[C.sancion]);
    const uit = decimal(f[C.uit]);
    const judicial = nada(f[C.judicial]);
    const infCodigo = C.infCodigo >= 0 ? limpio(f[C.infCodigo]) : null;
    out.push({
      administrada_tipo: limpio(f[C.tipo])?.toUpperCase() ?? null, naturaleza: limpio(f[C.naturaleza]), institucion: limpio(f[C.institucion]),
      codigo_registro: limpio(f[C.codigo]), nombre, pas: limpio(f[C.pas]), resolucion: limpio(f[C.resolucion]),
      fecha_emision: fecha(celda(f[C.emision])), fecha_notificacion: fecha(celda(f[C.notificacion])), fecha_inscripcion: fecha(celda(f[C.inscripcion])),
      tipo_sancion: tipoSancion(texto), tipo_sancion_texto: texto, multa_uit: uit,
      medidas_correctivas: nada(f[C.correctivas]), ejecucion_forzosa: nada(f[C.forzosa]),
      judicializacion: judicial, judicializada: !!judicial && /expediente|judicial|contencioso|juzgado|sala|proceso/i.test(judicial),
      cancelacion: nada(f[C.cancelacion]), departamento: limpio(f[C.depto]), provincia: limpio(f[C.prov]), distrito: limpio(f[C.dist]),
      infraccion_codigo: infCodigo, gravedad: gravedadDe(infCodigo), infraccion: limpio(f[C.infraccion]), normas: limpio(f[C.normas]),
    });
    sumar(`tipo: ${tipoSancion(texto)}`);
  }
  const infracciones: FilaInfraccion[] = [];
  const ris = libro.Sheets.RIS;
  if (ris) {
    const r = XLSX.utils.sheet_to_json<unknown[]>(ris, { header: 1, raw: true, defval: null });
    const h = (r.shift() ?? []).map((c) => normalizar(String(c ?? "")));
    const i = (p: string) => h.findIndex((c) => c.startsWith(p));
    const [iTipo, iAnexo, iGrav, iCad, iDet] = [i("TIPO DE ADMINISTRADO"), i("ANEXO"), i("GRAVEDAD"), i("CADENA"), i("DETALLE DE INFRACCION")];
    const vistos = new Set<string>();
    for (const f of r) {
      const codigo = iCad >= 0 ? limpio(f?.[iCad]) : null;
      if (!codigo || vistos.has(codigo)) continue;
      vistos.add(codigo);
      infracciones.push({ codigo, administrado: limpio(f[iTipo]), anexo: limpio(f[iAnexo]), gravedad: limpio(f[iGrav]), detalle: limpio(f[iDet]) });
    }
  }
  return { filas: out, infracciones, cuenta };
}

const CAMPOS_SANCION = ["administrada_tipo", "naturaleza", "institucion", "codigo_registro", "nombre", "pas", "resolucion", "fecha_emision",
  "fecha_notificacion", "fecha_inscripcion", "tipo_sancion", "tipo_sancion_texto", "multa_uit", "medidas_correctivas", "ejecucion_forzosa",
  "judicializacion", "judicializada", "cancelacion", "departamento", "provincia", "distrito", "infraccion_codigo", "gravedad", "infraccion",
  "normas"] as const;
const CAST_SANCION: Record<string, string> = {
  fecha_emision: "::date", fecha_notificacion: "::date", fecha_inscripcion: "::date", multa_uit: "::numeric", judicializada: "::boolean",
};

export async function cargarSanciones(db: Db, filas: FilaSancion[], infracciones: FilaInfraccion[], archivo: string, url: string): Promise<Record<string, number>> {
  return db.transaccion(async () => {
    await db.ejecutar("SET LOCAL lock_timeout = '10s'");
    await db.ejecutar(`CREATE TEMP TABLE _sa (LIKE salud_sancion INCLUDING DEFAULTS) ON COMMIT DROP`);
    await db.ejecutar("ALTER TABLE _sa ALTER COLUMN id DROP NOT NULL, ADD COLUMN orden int");
    await insertarTandas(db, "_sa", [...CAMPOS_SANCION, "orden"], filas.map((f, i) => ({ ...f, orden: i })), CAST_SANCION, 300);
    // La identidad de una fila: lo que la distingue en el registro, sin lo que cambia con el tiempo (judicialización,
    // cancelación, medidas). Dos filas idénticas (pasa) se numeran.
    await db.ejecutar(`
      WITH b AS (SELECT orden, md5(concat_ws('|', administrada_tipo, codigo_registro, mef_norm(nombre), pas, resolucion, fecha_emision,
                                             tipo_sancion_texto, multa_uit, infraccion_codigo, left(infraccion, 300), left(normas, 300))) AS h FROM _sa),
           n AS (SELECT orden, h || CASE WHEN row_number() OVER (PARTITION BY h ORDER BY orden) > 1
                                         THEN '-' || row_number() OVER (PARTITION BY h ORDER BY orden) ELSE '' END AS id FROM b)
      UPDATE _sa s SET id = n.id FROM n WHERE n.orden = s.orden`);
    const fuera = await db.ejecutar(`UPDATE salud_sancion s SET en_registro = false
                                      WHERE s.en_registro AND NOT EXISTS (SELECT 1 FROM _sa x WHERE x.id = s.id)`);
    const cols = CAMPOS_SANCION as readonly string[];
    const escritas = await db.filas<{ nueva: boolean }>(`
      INSERT INTO salud_sancion AS t (id, ${cols.join(", ")}, fuente_url, fuente_archivo, visto_at, en_registro)
      SELECT id, ${cols.join(", ")}, $1, $2, now(), true FROM _sa
      ON CONFLICT (id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}, fuente_url = EXCLUDED.fuente_url,
        fuente_archivo = EXCLUDED.fuente_archivo, visto_at = now(), en_registro = true
      RETURNING (xmax = 0) AS nueva`, [url, archivo]);
    if (infracciones.length) {
      // El catálogo se reemplaza entero (viene completo en cada archivo).
      await db.ejecutar("DELETE FROM salud_infraccion");
      await insertarTandas(db, "salud_infraccion", ["codigo", "administrado", "anexo", "gravedad", "detalle"],
        infracciones as unknown as Record<string, unknown>[]);
    }
    return { sanciones: filas.length, nuevas: escritas.filter((e) => e.nueva).length, ya_no_figuran: fuera, infracciones: infracciones.length };
  });
}

// ─── Consultas y denuncias (anonimizadas) ──────────────────────────────────────────────────────────

export interface FilaDenuncia { codigo: string; anio: number; tipo_inst: string | null; nombre: string | null; consultas: number; denuncias: number; de_oficio: number }

/** Cuenta, por institución y año, las consultas, las denuncias y las intervenciones de oficio. Nada más del archivo se guarda. */
export function leerDenuncias(datos: Uint8Array, anioArchivo: number): { filas: FilaDenuncia[]; cuenta: Record<string, number> } {
  const tabla = tablaCsv(datos);
  const cuenta: Record<string, number> = {};
  const sumar = (k: string) => { cuenta[k] = (cuenta[k] ?? 0) + 1; };
  const por = new Map<string, FilaDenuncia>();
  for (const f of tabla) {
    sumar("leidas");
    const tipoInst = limpio(f.DE_TIPO_INST);
    const crudo = (f.CO_INSTITUCION ?? "").trim();
    if (!crudo) { sumar("sin institución"); continue; }
    const codigo = /^ipress$/i.test(tipoInst ?? "") ? codigoIpress(crudo) ?? crudo : crudo;
    const anio = Number(/(\d{4})/.exec(f.FE_REGISTRO ?? "")?.[1] ?? anioArchivo) || anioArchivo;
    const k = `${codigo}|${anio}`;
    const d = por.get(k) ?? { codigo, anio, tipo_inst: tipoInst, nombre: limpio(f.DE_INSTITUCION), consultas: 0, denuncias: 0, de_oficio: 0 };
    const t = normalizar(f.DE_TIPO_SOLICITUD);
    if (t.startsWith("DENUNCIA")) d.denuncias++;
    else if (t.startsWith("CONSULTA")) d.consultas++;
    else if (t.includes("OFICIO")) d.de_oficio++;
    else sumar(`tipo desconocido: ${t.slice(0, 30)}`);
    por.set(k, d);
  }
  return { filas: [...por.values()], cuenta };
}

export async function cargarDenuncias(db: Db, filas: FilaDenuncia[], anio: number, archivo: string): Promise<Record<string, number>> {
  return db.transaccion(async () => {
    // El archivo de un año reemplaza ese año entero (puede traer registros de años vecinos: se reemplazan también).
    const anios = [...new Set(filas.map((f) => f.anio))];
    await db.ejecutar("DELETE FROM salud_denuncia_anual WHERE fuente_archivo = $1 OR anio = ANY($2::int[])", [archivo, anios.length ? anios : [anio]]);
    await insertarTandas(db, "salud_denuncia_anual", ["codigo", "anio", "tipo_inst", "nombre", "consultas", "denuncias", "de_oficio", "fuente_archivo"],
      filas.map((f) => ({ ...f, fuente_archivo: archivo })));
    return { instituciones: filas.length, denuncias: filas.reduce((s, f) => s + f.denuncias, 0), consultas: filas.reduce((s, f) => s + f.consultas, 0) };
  });
}

// ─── Recursos (Consulta A) y cirugías (Consulta H) ────────────────────────────────────────────────

export function leerRecursos(datos: Uint8Array): Record<string, unknown>[] {
  return tablaCsv(datos).flatMap((f) => {
    const codigo = codigoIpress(f.CO_IPRESS);
    const anio = entero(f.ANHO);
    const mes = entero(f.MES);
    if (!codigo || !anio || !mes) return [];
    return [{
      codigo, anio, mes, consultorios: entero(f.CA_CONSULTORIOS), consultorios_funcionales: entero(f.CA_CONSULTORIOS_FN), camas: entero(f.CA_CAMAS),
      medicos: entero(f.CA_MEDICOS_TOTAL), medicos_serums: entero(f.CA_MEDICOS_SERUM), medicos_residentes: entero(f.CA_MEDICOS_RESIDENTES),
      enfermeras: entero(f.CA_ENFERMERAS), odontologos: entero(f.CA_ODONTOLOGOS), psicologos: entero(f.CA_PSICOLOGOS),
      nutricionistas: entero(f.CA_NUTRICIONISTAS), tecnologos: entero(f.CA_TECNOLOGOS_MEDICOS), obstetrices: entero(f.CA_OBSTETRICES),
      farmaceuticos: entero(f.CA_FARMACEUTICOS), auxiliares: entero(f.CA_AUXILIARES), otros_profesionales: entero(f.CA_OTROS_PROF),
      ambulancias: entero(f.CA_AMBULANCIAS),
    }];
  });
}
const CAMPOS_RECURSOS = ["codigo", "anio", "mes", "consultorios", "consultorios_funcionales", "camas", "medicos", "medicos_serums",
  "medicos_residentes", "enfermeras", "odontologos", "psicologos", "nutricionistas", "tecnologos", "obstetrices", "farmaceuticos", "auxiliares",
  "otros_profesionales", "ambulancias", "fuente_archivo"];

export async function cargarRecursos(db: Db, filas: Record<string, unknown>[], archivo: string): Promise<number> {
  return db.transaccion(async () => {
    await db.ejecutar("CREATE TEMP TABLE _re (LIKE salud_recursos) ON COMMIT DROP");
    await insertarTandas(db, "_re", CAMPOS_RECURSOS, filas.map((f) => ({ ...f, fuente_archivo: archivo })));
    // Sólo pisa si el mes es igual o más nuevo que el que ya está.
    return db.ejecutar(`INSERT INTO salud_recursos AS t SELECT DISTINCT ON (codigo) * FROM _re ORDER BY codigo
                        ON CONFLICT (codigo) DO UPDATE SET ${CAMPOS_RECURSOS.filter((c) => c !== "codigo").map((c) => `${c} = EXCLUDED.${c}`).join(", ")}
                        WHERE (EXCLUDED.anio, EXCLUDED.mes) >= (t.anio, t.mes)`);
  });
}

export function leerCirugias(datos: Uint8Array): Record<string, unknown>[] {
  const por = new Map<string, Record<string, unknown>>();
  for (const f of tablaCsv(datos)) {
    const codigo = codigoIpress(f.CO_IPRESS);
    const anio = entero(f.ANHO);
    const mes = entero(f.MES);
    if (!codigo || !anio || !mes) continue;
    const programacion = entero(f.DE_PROGRAMC) ?? 0;
    por.set(`${codigo}|${anio}|${mes}|${programacion}`, {
      codigo, anio, mes, programacion, mayores: entero(f.TOTAL_CIRUJ_MAY), menores: entero(f.TOTAL_CIRUJ_MEN),
      horas_programadas: decimal(f.HORAS_PROGRAMADAS), horas_efectivas: decimal(f.HORAS_EFECTIVAS), horas_acto: decimal(f.HORAS_ACT_QUIRURJ),
      suspendidas: entero(f.CIRUJ_SUSPEND),
    });
  }
  return [...por.values()];
}
const CAMPOS_CIRUGIA = ["codigo", "anio", "mes", "programacion", "mayores", "menores", "horas_programadas", "horas_efectivas", "horas_acto", "suspendidas", "fuente_archivo"];

export async function cargarCirugias(db: Db, filas: Record<string, unknown>[], archivo: string): Promise<number> {
  return db.transaccion(async () => {
    const meses = [...new Set(filas.map((f) => `${f.anio}-${f.mes}`))];
    for (const am of meses) {
      const [a, m] = am.split("-").map(Number);
      await db.ejecutar("DELETE FROM salud_cirugia_mes WHERE anio = $1 AND mes = $2", [a, m]);
    }
    await insertarTandas(db, "salud_cirugia_mes", CAMPOS_CIRUGIA, filas.map((f) => ({ ...f, fuente_archivo: archivo })));
    return filas.length;
  });
}

// ─── Descubrir los archivos (DKAN y gob.pe) ────────────────────────────────────────────────────────

export interface Recurso { url: string; nombre: string; formato: string }

/** Los recursos de un conjunto del portal de SUSALUD (package_show de su API compatible con CKAN). */
export async function recursosDe(env: Env, conjunto: string): Promise<Recurso[]> {
  const url = `${PORTAL}/api/3/action/package_show?id=${encodeURIComponent(conjunto)}`;
  const r = await pedir(env, url);
  if (r.status === 404) return [];
  if (!r.ok) throw new ErrorHttp(r.status, url);
  const d = (await r.json()) as { success?: boolean; result?: unknown };
  const res = Array.isArray(d.result) ? d.result[0] : d.result;
  const lista = ((res as { resources?: { url?: string; name?: string; format?: string }[] })?.resources ?? []);
  return lista
    .filter((x) => typeof x.url === "string" && /^https?:\/\//.test(x.url))
    .map((x) => ({ url: x.url!, nombre: x.name ?? "", formato: (x.format ?? "").toLowerCase() }));
}

/** El XLSX vigente del Registro de Sanciones, sacado de su página en gob.pe. */
export function enlaceSanciones(html: string): string | null {
  const m = /href="(https:\/\/cdn\.www\.gob\.pe\/uploads\/document\/file\/[^"]+registro-de-sanciones[^"]*\.xlsx[^"]*)"/i.exec(html);
  return m ? m[1].replaceAll("&amp;", "&") : null;
}

/**
 * Directo y, si el sitio no contesta desde Cloudflare (gob.pe da 418 fuera del Perú), por el relay de Lima. Devuelve la
 * respuesta tal cual.
 */
export async function pedir(env: Env, url: string): Promise<Response> {
  try {
    const r = await obtener(env, url, { timeoutMs: 45_000, sinReintentos: true });
    if (r.ok || r.status === 404) return r;
    await r.body?.cancel();
  } catch (e) {
    registrar("INFO", `   ${url.split("?")[0]} directo: ${(e as Error).message.slice(0, 120)}; por el relay de Lima`, { fuente: FUENTE });
  }
  if (!env.RELAY_LIMA) throw new Error(`${url}: no responde directo y falta el relay de Lima`);
  return obtener(env, url, { relay: "lima", timeoutMs: 120_000 });
}

/** ¿Se baja directo o hace falta el relay? Se prueba con un HEAD/GET corto. */
async function relayPara(env: Env, url: string): Promise<boolean | "lima"> {
  try {
    const r = await obtener(env, url, { timeoutMs: 20_000, sinReintentos: true });
    await r.body?.cancel();
    if (r.ok) return false;
  } catch { /* al relay */ }
  return env.RELAY_LIMA ? "lima" : false;
}

// ─── La corrida ────────────────────────────────────────────────────────────────────────────────────

interface Archivo { clave: string; recurso: Recurso; tipo: "renipress" | "sanciones" | "denuncias" | "recursos" | "cirugias"; anio?: number; mes?: number }

const MESES: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, setiembre: 9, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };

/** «…_2026_10.csv» o «…Octubre 2026» → [2026, 10]. */
export function anioMes(r: Recurso): [number, number] | null {
  let m = /_(\d{4})_(\d{1,2})(?:_\d+)?\.csv$/i.exec(r.url);
  if (m) return [Number(m[1]), Number(m[2])];
  const n = normalizar(r.nombre).toLowerCase();
  m = /(enero|febrero|marzo|abril|mayo|junio|julio|agosto|setiembre|septiembre|octubre|noviembre|diciembre)\s+(\d{4})/.exec(n);
  if (m) return [Number(m[2]), MESES[m[1]]];
  return null;
}

export async function correrSusalud(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const hoy = new Date();
  const anio = hoy.getUTCFullYear();
  // 1. Qué archivos hay hoy.
  const archivos = await step.do("descubrir archivos", LECTURA, async () => {
    const out: Archivo[] = [];
    const ren = (await recursosDe(env, DATASETS.renipress)).filter((r) => r.formato === "csv" || /\.csv$/i.test(r.url));
    if (!ren.length) throw new Error("RENIPRESS: el portal no trae el CSV");
    out.push({ clave: "renipress", recurso: ren[ren.length - 1], tipo: "renipress" });

    const pagina = await pedir(env, PAGINA_SANCIONES);
    const html = pagina.ok ? await pagina.text() : "";
    const xlsx = enlaceSanciones(html);
    if (xlsx) out.push({ clave: "sanciones", recurso: { url: xlsx, nombre: "Registro de Sanciones", formato: "xlsx" }, tipo: "sanciones" });
    else registrar("WARNING", `   sanciones: la página de gob.pe no trae el XLSX (status ${pagina.status})`, { fuente: FUENTE, instancia: id });

    // Denuncias: el año en curso y el anterior (o todos, con `forzar` o `desde`).
    const desdeAnio = p.desde ? Number(p.desde.slice(0, 4)) : p.forzar ? 2019 : anio - 1;
    for (const r of await recursosDe(env, DATASETS.denuncias)) {
      const a = Number(/(\d{4})/.exec(r.url.split("/").pop() ?? "")?.[1]);
      if (r.formato === "csv" && a >= desdeAnio) out.push({ clave: `denuncias_${a}`, recurso: r, tipo: "denuncias", anio: a });
    }
    // Recursos: el último mes publicado.
    for (const a of [anio, anio - 1]) {
      const rs = (await recursosDe(env, DATASETS.recursos(a))).filter((r) => r.formato === "csv").map((r) => ({ r, am: anioMes(r) }))
        .filter((x): x is { r: Recurso; am: [number, number] } => !!x.am).sort((x, y) => x.am[0] - y.am[0] || x.am[1] - y.am[1]);
      if (rs.length) {
        const u = rs[rs.length - 1];
        out.push({ clave: `recursos_${u.am[0]}_${u.am[1]}`, recurso: u.r, tipo: "recursos", anio: u.am[0], mes: u.am[1] });
        break;
      }
    }
    // Cirugías: los últimos 13 meses publicados.
    const cir: Archivo[] = [];
    for (const a of [anio, anio - 1]) {
      for (const r of await recursosDe(env, DATASETS.cirugias(a))) {
        const am = r.formato === "csv" ? anioMes(r) : null;
        if (am) cir.push({ clave: `cirugias_${am[0]}_${am[1]}`, recurso: r, tipo: "cirugias", anio: am[0], mes: am[1] });
      }
    }
    cir.sort((x, y) => (y.anio! - x.anio!) || (y.mes! - x.mes!));
    out.push(...cir.slice(0, 13));
    return out;
  });
  registrar("INFO", `   ${archivos.length} archivos: ${archivos.map((a) => a.clave).join(", ")}`, { fuente: FUENTE, instancia: id });

  // 2. Bajar y cargar cada uno (un paso por archivo: si uno falla, los demás quedan cargados).
  const resultados: Record<string, unknown> = {};
  let cambio = false;
  for (const a of archivos) {
    const entrada = await step.do(`bajar ${a.clave}`, DESCARGA, async () => {
      const relay = await relayPara(env, a.recurso.url);
      return new Almacen(env, FUENTE).bajar(a.recurso.url, { forzar: true, subdir: a.clave, relay });
    });
    const r = await step.do(`cargar ${a.clave}`, CARGA, async (): Promise<Record<string, number | boolean>> => {
      const datos = await new Almacen(env, FUENTE).leer(entrada);
      return conDb(env.HYPERDRIVE, async (db) => {
        if (!p.forzar && (await yaCargado(db, FUENTE, a.clave, entrada.sha256))) return { ya_cargado: true };
        const archivo = nombreArchivo(entrada);
        let res: Record<string, number | boolean>;
        let filas = 0;
        let tabla = "";
        if (a.tipo === "renipress") {
          const { filas: fs, cuenta } = leerRenipress(datos);
          if (fs.length < 20_000) throw new Error(`RENIPRESS con sólo ${fs.length} IPRESS: no parece el registro completo`);
          filas = fs.length; tabla = "salud_ipress";
          res = p.seco ? { seco: true, ...cuenta } : { ...(await cargarRenipress(db, fs, archivo)), ...cuenta };
        } else if (a.tipo === "sanciones") {
          const { filas: fs, infracciones, cuenta } = leerSanciones(datos);
          if (fs.length < 500) throw new Error(`Registro de Sanciones con sólo ${fs.length} filas`);
          filas = fs.length; tabla = "salud_sancion";
          res = p.seco ? { seco: true, ...cuenta } : { ...(await cargarSanciones(db, fs, infracciones, archivo, a.recurso.url)), ...cuenta };
        } else if (a.tipo === "denuncias") {
          const { filas: fs, cuenta } = leerDenuncias(datos, a.anio!);
          filas = fs.length; tabla = "salud_denuncia_anual";
          res = p.seco ? { seco: true, ...cuenta } : { ...(await cargarDenuncias(db, fs, a.anio!, archivo)), leidas: cuenta.leidas };
        } else if (a.tipo === "recursos") {
          const fs = leerRecursos(datos);
          filas = fs.length; tabla = "salud_recursos";
          res = p.seco ? { seco: true, filas: fs.length } : { filas: await cargarRecursos(db, fs, archivo) };
        } else {
          const fs = leerCirugias(datos);
          filas = fs.length; tabla = "salud_cirugia_mes";
          res = p.seco ? { seco: true, filas: fs.length } : { filas: await cargarCirugias(db, fs, archivo) };
        }
        if (!p.seco) {
          await registrarCarga(db, {
            fuente: FUENTE, clave: a.clave, tabla, archivo, gcs_uri: uri(entrada), sha256: entrada.sha256, bytes: entrada.bytes, filas,
            fuente_url: a.recurso.url, descargado_at: entrada.downloaded_at,
          });
        }
        return res;
      });
    });
    resultados[a.clave] = r;
    if (r && typeof r === "object" && !("ya_cargado" in r) && !("seco" in r)) cambio = true;
  }

  // 3. Unir las sanciones y rehacer los indicadores.
  if (cambio || p.forzar) {
    resultados.salud_refrescar = await step.do("salud_refrescar", CARGA, () =>
      conDb(env.HYPERDRIVE, async (db) => (await db.filas<{ r: unknown }>("SELECT salud_refrescar() AS r"))[0]?.r ?? null));
  }
  return resultados;
}

export type { Entrada };
