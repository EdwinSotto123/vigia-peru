/**
 * Declaraciones Juradas de Intereses (Contraloría) vía PNDA → `dji_funcionarios` / `dji_empleos`: port de
 * backend/scrapers/pnda_dji/pipeline.py (fuentes, columnas y el cruce de "puerta giratoria" en su
 * docstring). Los reportes son fotos completas: TRUNCATE + COPY en una transacción, solo si el sha256
 * cambió (`datasets_cargas`, clave = parte).
 *
 * Diferencias con Python, por los límites de Workers e Hyperdrive:
 * - El CSV (268 y 442 MB) va de R2 a COPY en streaming, decodificado como en Python (UTF-8 con
 *   reemplazo y saltos de línea universales) y en varias sentencias COPY de ≤ 40 s (Hyperdrive documenta
 *   un tope de 60 s por sentencia), cortadas en fin de registro; la primera lleva HEADER.
 * - El `UPDATE … ruc_entidad` de dji_empleos va por rangos de páginas (ctid), cada uno corto.
 * - En seco carga en una tabla temporal igual a la destino y la descarta (cuenta filas reales sin
 *   tocar las tablas).
 *
 * Qué archivo (2026-11-18): la Contraloría sube cada corte como un recurso NUEVO del mismo dataset, con otro nombre, y
 * deja el anterior en la página. El 2 de noviembre de 2026 publicó `ListadoDDJJ.csv` y `ListadoEmpleos.csv` (al 28 de
 * octubre) junto a los `Reporte1.csv` y `Reporte3.csv` de julio; el cargador pedía los Reporte por su nombre y seguía
 * tomando julio (109 mil declaraciones de atraso, y el catálogo decía «el portal no trae archivo nuevo»). Ahora toma el
 * CSV más reciente del dataset (Last-Modified de cada recurso) y, antes de vaciar la tabla, comprueba que su cabecera sea
 * la que el COPY espera: un archivo con otras columnas detiene la carga en vez de entrar corrido.
 */

import type { WorkflowStep } from "cloudflare:workers";
import { Almacen, nombreArchivo, uri } from "../almacen.ts";
import type { Entrada } from "../almacen.ts";
import { registrarCarga, yaCargado } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { CortadorCsv } from "../csv.ts";
import { conDb } from "../db.ts";
import type { Copia, Db } from "../db.ts";
import { UA } from "../http.ts";
import { obtenerDataset, recursosDeDatos, urlDataset, type Dataset, type Recurso } from "../pnda.ts";
import { registrar } from "../registro.ts";
import { DESCARGA } from "./comun.ts";

const FUENTE = "pnda_dji";
const DATASETS: Record<string, string> = {
  funcionarios: "declaraciones-juradas-de-intereses-presentadas-ante-la-contraloría",
  empleos: "empleos-declarados-en-las-declaraciones-juradas-de-intereses-contraloría",
  familiares: "familiares-declarados-en-las-declaraciones-juradas-de-intereses-contraloría",
};
/** La cabecera del CSV de cada parte, en el orden de las columnas del COPY (la de Reporte1/3 y la de Listado*). */
export const CABECERAS: Record<string, string[]> = {
  funcionarios: ["CODIGO_DDJJ", "TIPO_DOCUMENTO_FUNCIONARIO", "APELLIDO_PATERNO", "APELLIDO_MATERNO", "NOMBRES", "ENTIDAD", "CARGO",
    "FECHA_ELABORACION_DDJJ", "FECHA_PRESENTACION_DDJJ", "FECHA_INICIO_CARGO", "FECHA_CESE_CARGO"],
  empleos: ["CODIGO_DDJJ", "RUC_ENTIDAD_LABORO", "NOMBRE_ENTIDAD_LABORO", "CARGO_ENTIDAD_LABORO", "FECHA_INICIO_CARGO", "FECHA_CESE_CARGO",
    "FECHA_ELABORACION_DDJJ", "FECHA_PRESENTACION_DDJJ"],
};
/** (tabla destino, columnas en el orden del CSV). familiares (723 MB, sin nombres) queda solo como crudo. */
const DESTINOS: Record<string, [tabla: string, cols: string[]]> = {
  funcionarios: ["dji_funcionarios", ["codigo_ddjj", "tipo_documento", "apellido_paterno", "apellido_materno", "nombres",
    "entidad", "cargo", "fecha_elaboracion", "fecha_presentacion", "fecha_inicio_cargo", "fecha_cese_cargo"]],
  empleos: ["dji_empleos", ["codigo_ddjj", "ruc_entidad_raw", "nombre_entidad", "cargo", "fecha_inicio", "fecha_cese",
    "fecha_elaboracion", "fecha_presentacion"]],
};
const PARTES = ["funcionarios", "empleos"];
/** Una sentencia COPY se cierra pasado esto (Hyperdrive corta a los 60 s). */
const COPY_MAX_MS = 40_000;
/** Páginas de 8 KB por UPDATE de ruc_entidad (~150 mil filas). */
const PAGINAS_POR_UPDATE = 4000;
/** Paso de carga: hasta 30 min, un reintento (TRUNCATE + COPY en una transacción: un corte no deja nada a medias). */
const CARGA_GRANDE = { retries: { limit: 1, delay: "2 minutes" }, timeout: "30 minutes" } as const;

/**
 * El texto como lo lee Python (`open(encoding="utf-8", errors="replace")`): bytes inválidos → U+FFFD y
 * \r\n o \r → \n. El tramo termina en fin de registro, así que no parte caracteres ni pares \r\n.
 */
export function comoPython(tramo: Uint8Array): Uint8Array {
  const texto = new TextDecoder("utf-8").decode(tramo);
  return new TextEncoder().encode(texto.includes("\r") ? texto.replace(/\r\n?/g, "\n") : texto);
}

/** Manda el CSV a COPY en varias sentencias (cada una ≤ COPY_MAX_MS), cortadas en fin de registro. */
export async function copiarEnTramos(db: Db, tabla: string, cols: string[], origen: ReadableStream<Uint8Array>,
                                     maxMs = COPY_MAX_MS): Promise<{ filas: number; sentencias: number }> {
  const sql = (cabecera: boolean) =>
    `COPY ${tabla} (${cols.join(", ")}) FROM STDIN WITH (FORMAT csv${cabecera ? ", HEADER true" : ""}, NULL '')`;
  const cortador = new CortadorCsv();
  let copia: Copia | null = null;
  let desde = 0;
  let filas = 0;
  let sentencias = 0;
  const escribir = async (bytes: Uint8Array) => {
    if (!copia) {
      copia = await db.abrirCopia(sql(sentencias === 0));
      sentencias++;
      desde = Date.now();
    }
    await copia.escribir(comoPython(bytes));
    if (Date.now() - desde > maxMs) {
      filas += await copia.cerrar();
      copia = null;
    }
  };
  for await (const trozo of origen) {
    const listo = cortador.agregar(trozo);
    if (listo) await escribir(listo);
  }
  const final = cortador.fin();
  if (final) await escribir(final);
  if (copia) filas += await (copia as Copia).cerrar();
  return { filas, sentencias };
}

/**
 * 'RUC:20100211034' → '20100211034', por rangos de páginas de la tabla recién cargada. Solo las filas que
 * traen un RUC: las demás quedarían en NULL igual (como el UPDATE de Python), y así sus versiones nuevas no
 * caen en un rango que falta recorrer. Devuelve cuántas filas quedan con RUC.
 */
async function completarRuc(db: Db, tabla: string): Promise<number> {
  const [{ paginas }] = await db.filas<{ paginas: number }>(
    "SELECT (pg_relation_size($1::regclass) / current_setting('block_size')::int)::int AS paginas", [tabla]);
  for (let p = 0; p <= paginas; p += PAGINAS_POR_UPDATE) {
    await db.ejecutar(String.raw`UPDATE ${tabla} SET ruc_entidad = substring(ruc_entidad_raw from '\d{11}')
      WHERE ruc_entidad IS NULL AND ruc_entidad_raw ~ '\d{11}' AND ctid >= '(${p},0)'::tid AND ctid < '(${p + PAGINAS_POR_UPDATE},0)'::tid`);
  }
  const [{ n }] = await db.filas<{ n: number }>(`SELECT count(ruc_entidad)::int AS n FROM ${tabla}`);
  return n;
}

interface Bajado {
  parte: string;
  entrada: Entrada;
  fuente_url: string;
  /** El nombre con que la Contraloría publicó el archivo elegido. */
  origen: string;
}

/** De varios recursos con su fecha (ms; 0 si el portal no la dio), el más reciente; si empatan, el último de la página. */
export function elegirMasReciente<T extends { modificado: number }>(recursos: T[]): T | null {
  let mejor: T | null = null;
  for (const r of recursos) if (!mejor || r.modificado >= mejor.modificado) mejor = r;
  return mejor;
}

/** El CSV más reciente de un dataset, por el Last-Modified de cada recurso (un HEAD por archivo). */
async function csvMasReciente(ds: Dataset): Promise<(Recurso & { modificado: number; cuando: string | null }) | null> {
  const csvs = recursosDeDatos(ds, [".csv"]);
  const conFecha = [];
  for (const r of csvs) {
    let cuando: string | null = null;
    try {
      const h = await fetch(r.url, { method: "HEAD", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
      cuando = h.ok ? h.headers.get("last-modified") : null;
    } catch {
      cuando = null;
    }
    conFecha.push({ ...r, cuando, modificado: cuando ? Date.parse(cuando) || 0 : 0 });
  }
  return elegirMasReciente(conFecha);
}

/** Los nombres de columna de la primera línea de un CSV (sin BOM ni comillas, en mayúsculas). */
export function cabeceraCsv(inicio: string): string[] {
  const linea = inicio.replace(/^\uFEFF/, "").split(/\r?\n/)[0] ?? "";
  return linea.split(",").map((c) => c.trim().replace(/^"|"$/g, "").toUpperCase());
}

/** La primera línea del archivo guardado, sin leerlo entero. */
async function primeraLinea(env: Env, e: Entrada): Promise<string> {
  const cuerpo = (await new Almacen(env, FUENTE).abrir(e)).body;
  const lector = cuerpo.getReader();
  let texto = "";
  const dec = new TextDecoder("utf-8");
  while (!texto.includes("\n") && texto.length < 8192) {
    const { value, done } = await lector.read();
    if (done) break;
    texto += dec.decode(value, { stream: true });
  }
  await lector.cancel().catch(() => undefined);
  return texto;
}

export async function correrDji(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const bajados: Bajado[] = [];
  for (const parte of PARTES) {
    const slug = DATASETS[parte];
    const b = await step.do(`descargar ${parte}`, DESCARGA, async (): Promise<Bajado | null> => {
      const ds = await obtenerDataset(env, slug);
      const r = await csvMasReciente(ds);
      if (!r) {
        registrar("WARNING", `${parte}: no encontré ningún CSV en ${urlDataset(slug)}`, { fuente: FUENTE, instancia: id });
        return null;
      }
      registrar("INFO", `   ${parte}: ${r.archivo} (${r.cuando ?? "sin fecha"}), de ${ds.recursos.filter((x) => x.ext === ".csv").length} CSV del dataset`,
        { fuente: FUENTE, instancia: id });
      // La fecha del recurso, no la del dataset: con un archivo nuevo de otro nombre, la del dataset puede no cambiar.
      const entrada = await new Almacen(env, FUENTE).bajar(r.url, { archivo: `dji_${parte}.csv`, modificado: r.cuando ?? ds.modificado, forzar: p.forzar, subdir: parte });
      return { parte, entrada, fuente_url: urlDataset(slug), origen: r.archivo };
    });
    if (b) bajados.push(b);
  }

  const resumen: Record<string, unknown> = {};
  for (const b of bajados) {
    const [tabla, cols] = DESTINOS[b.parte];
    resumen[b.parte] = await step.do(`cargar ${b.parte}`, CARGA_GRANDE, () => conDb(env.HYPERDRIVE, async (db) => {
      if (!p.seco && !p.forzar && (await yaCargado(db, FUENTE, b.parte, b.entrada.sha256))) {
        registrar("INFO", `   ${b.parte}: ya cargado con el mismo sha256, se salta`, { fuente: FUENTE, instancia: id });
        return { ya_cargado: true, sha256: b.entrada.sha256 };
      }
      // Antes de vaciar nada: el archivo trae las columnas que el COPY espera, en ese orden.
      const cabecera = cabeceraCsv(await primeraLinea(env, b.entrada));
      const esperada = CABECERAS[b.parte];
      if (cabecera.length !== esperada.length || cabecera.some((c, k) => c !== esperada[k])) {
        throw new Error(`[${FUENTE}] ${b.origen} trae otra cabecera (${cabecera.join(", ").slice(0, 300)}): no se carga ${tabla}`);
      }
      const t0 = Date.now();
      await db.ejecutar("BEGIN");
      try {
        let destino = tabla;
        if (p.seco) {
          destino = `seco_${tabla}`;
          await db.ejecutar(`CREATE TEMP TABLE ${destino} (LIKE ${tabla} INCLUDING DEFAULTS) ON COMMIT DROP`);
        } else {
          await db.ejecutar(`TRUNCATE ${tabla}`);   // los reportes son fotos completas, no deltas
        }
        const crudo = await new Almacen(env, FUENTE).abrir(b.entrada);
        const { filas, sentencias } = await copiarEnTramos(db, destino, cols, crudo.body);
        registrar("INFO", `   ${nombreArchivo(b.entrada)} → ${destino}: ${filas} filas en ${sentencias} COPY (${Math.round((Date.now() - t0) / 1000)}s)`,
          { fuente: FUENTE, instancia: id });
        const conRuc = tabla === "dji_empleos" ? await completarRuc(db, destino) : null;
        if (p.seco) {
          await db.ejecutar("ROLLBACK");
          return { seco: true, filas, sentencias, con_ruc: conRuc, segundos: Math.round((Date.now() - t0) / 1000) };
        }
        await registrarCarga(db, {
          fuente: FUENTE, clave: b.parte, tabla, archivo: nombreArchivo(b.entrada), gcs_uri: uri(b.entrada), sha256: b.entrada.sha256,
          bytes: b.entrada.bytes, filas, fuente_url: b.fuente_url, descargado_at: b.entrada.downloaded_at,
        });
        await db.ejecutar("COMMIT");
        return { filas, sentencias, con_ruc: conRuc, segundos: Math.round((Date.now() - t0) / 1000) };
      } catch (e) {
        await db.ejecutar("ROLLBACK").catch(() => undefined);
        throw e;
      }
    }));
  }
  // Con algo nuevo: el RUC de cada entidad del registro (migración 185), sus jefaturas vigentes y los nombres de oficinas
  // con que el organigrama lee las siglas de una planilla (186). Cada una, si ya existe en la base.
  const nuevo = Object.values(resumen).some((r) => r && typeof r === "object" && "filas" in r && !("seco" in r));
  if (nuevo) {
    for (const f of ["refrescar_dji_entidad_ruc", "refrescar_dji_jefatura", "refrescar_organo_nombre_global"]) {
      resumen[f] = await step.do(f, CARGA_GRANDE, () => conDb(env.HYPERDRIVE, async (db) => {
        const [{ existe }] = await db.filas<{ existe: boolean }>("SELECT to_regprocedure($1) IS NOT NULL AS existe", [`${f}()`]);
        return existe ? Number((await db.filas<{ n: number }>(`SELECT ${f}() AS n`))[0]?.n ?? 0) : null;
      }));
    }
  }
  return resumen;
}
