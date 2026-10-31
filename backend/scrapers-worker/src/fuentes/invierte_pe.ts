/**
 * Invierte.pe (MEF) → inversion_mef (migración 160): las inversiones activas (DETALLE_INVERSIONES.csv, ~150 mil filas de 68
 * columnas, ~240 MB) y las cerradas (CIERRE_INVERSIONES.csv, ~120 mil filas de 57 columnas, ~120 MB) de
 * https://fs.datosabiertos.mef.gob.pe/datastorefiles/, una fila por CUI. Es la parte de Invierte.pe de
 * backend/scripts/cargar_obras.py (COLUMNAS_MEF, LECTORES, leer_mef y cargar), que la cargaba desde la PC junto con
 * INFOBRAS. El MEF responde desde la nube (es el servidor de mef_presupuesto); INFOBRAS sigue en la PC.
 *
 * Pasos:
 *   1. `descargar <clave>`: cada CSV a R2 con Almacen.bajar y el Last-Modified del MEF (si no cambió, no se vuelve a
 *      bajar). En R2 queda sólo la última copia de cada archivo (raw/invierte_pe/<clave>/).
 *   2. `cargar inversion_mef`: si los dos sha256 ya se cargaron y no se pide `forzar`, nada (tampoco el paso 3). Si no, en
 *      UNA transacción: cada CSV, tal como viene, a una tabla temporal de texto con las columnas de su cabecera (COPY en
 *      tramos de ≤ 40 s); un INSERT … SELECT por archivo lo normaliza a _inversion_mef con las funciones norm_* de la
 *      migración 223 (los LECTORES de Python, en SQL): sin CUI no entra, y de un CUI repetido queda la primera fila, con
 *      las activas antes que las cerradas (el `vistos` de leer_mef). Después, el upsert por CUI, que sólo reescribe la
 *      fila que cambió (otra huella) o que vuelve después de retirada; lo que ya no vino queda `retirada`, salvo que lo
 *      copiado sea menos del 90 % de lo vivo (sería un archivo incompleto). Registra los dos archivos en datasets_cargas.
 *      En seco hace todo igual y termina con ROLLBACK.
 *   3. `refrescar_obras`: refrescar_obras(true) (~6,5 min en producción), sólo si algo cambió. Lo que hacía --propagar
 *      (casos_cruce y empresas) lo hace la cadena de cruces de cada mañana.
 *
 * La primera corrida reescribe todas las filas una vez: la huella se arma en SQL y no coincide con la de Python (ver la
 * migración 223).
 *
 * Privacidad: nunca se baja DIRECTORIO_INVIERTE.csv (correos y teléfonos de funcionarios). RESPONSABLE_UEI (el nombre de
 * una persona, en CIERRE_INVERSIONES) y la descripción de la alternativa (ALTERNATIVA, en DETALLE_INVERSIONES) vienen en
 * los CSV: pasan por la tabla temporal, que se borra con la transacción, y ninguna consulta las lee.
 */

import type { WorkflowStep } from "cloudflare:workers";
import { Almacen, nombreArchivo, uri } from "../almacen.ts";
import type { Entrada } from "../almacen.ts";
import { registrarCarga, yaCargado } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { cuentaCsv, normalizarCsv } from "../csv.ts";
import { conDb } from "../db.ts";
import type { Db } from "../db.ts";
import { ErrorHttp, UA } from "../http.ts";
import { registrar } from "../registro.ts";
import { CARGA, DESCARGA } from "./comun.ts";
import { describirArreglos, revisarCuenta, separarCabecera } from "./conosce.ts";
import type { Arreglos } from "./conosce.ts";
import { copiarEnTramos } from "./pnda_dji.ts";

const FUENTE = "invierte_pe";
export const MEF = "https://fs.datosabiertos.mef.gob.pe/datastorefiles";
const TABLA = "inversion_mef";
/** Un archivo más chico no es el del MEF (cargar_obras.py pedía lo mismo); hoy pesan ~240 y ~120 MB. */
const MINIMO_BYTES = 50_000_000;
/** Si lo copiado es menos que esta parte de las inversiones vivas, el archivo vino incompleto: no se marcan retiradas. */
const MINIMO_COMPLETO = 0.9;
/** El paso de carga, como CARGA_GRANDE de pnda_dji: hasta 30 min y un reintento (la transacción entera o nada). */
const CARGA_GRANDE = { retries: { limit: 1, delay: "2 minutes" }, timeout: "30 minutes" } as const;
/** En las tablas temporales, el número de fila del CSV (el orden del archivo): ninguna columna de la cabecera se llama así. */
const FILA = "_fila";

export type Origen = "activa" | "cerrada";

export interface ArchivoMef {
  /** Clave en datasets_cargas y carpeta en R2. */
  clave: string;
  nombre: string;
  origen: Origen;
  /** La tabla temporal a la que se copia tal como viene. */
  temporal: string;
}

/** En este orden: de un CUI que viene en los dos archivos queda la fila de las activas (como en leer_mef). */
export const ARCHIVOS: readonly ArchivoMef[] = [
  { clave: "detalle_inversiones", nombre: "DETALLE_INVERSIONES.csv", origen: "activa", temporal: "_invierte_activa" },
  { clave: "cierre_inversiones", nombre: "CIERRE_INVERSIONES.csv", origen: "cerrada", temporal: "_invierte_cerrada" },
];

export type Tipo = "texto" | "numero" | "entero" | "fecha_iso" | "cui" | "snip" | "si" | "ubigeo" | "coordenada";

/** La función de la migración 223 que hace lo del lector de Python y el tipo de lo que devuelve (para un NULL). */
const LECTOR: Record<Tipo, [funcion: string, tipo: string]> = {
  texto: ["norm_texto", "text"], numero: ["norm_monto", "numeric"], entero: ["norm_entero", "int"],
  fecha_iso: ["norm_fecha_iso", "date"], cui: ["norm_cui", "text"], snip: ["norm_snip", "text"], si: ["norm_si", "boolean"],
  ubigeo: ["norm_ubigeo", "text"], coordenada: ["norm_coordenada", "numeric"],
};

/** Columna de inversion_mef ← (columna en DETALLE_INVERSIONES, en CIERRE_INVERSIONES, tipo): COLUMNAS_MEF de Python. */
export const COLUMNAS: readonly (readonly [destino: string, activa: string | null, cerrada: string | null, tipo: Tipo])[] = [
  ["cui", "CODIGO_UNICO", "CODIGO_UNICO", "cui"],
  ["snip", "CODIGO_SNIP", "CODIGO_SNIP", "snip"],
  ["nombre", "NOMBRE_INVERSION", "NOMBRE_INVERSION", "texto"],
  ["nivel", "NIVEL", "NIVEL", "texto"],
  ["sector", "SECTOR", "SECTOR", "texto"],
  ["entidad_nombre", "ENTIDAD", "ENTIDAD", "texto"],
  ["sec_ejec", "SEC_EJEC", "SEC_EJEC", "entero"],
  ["uei", "NOMBRE_UEI", "NOM_UEI", "texto"],
  ["uep", "NOMBRE_UEP", "NOM_UEP", "texto"],
  ["estado", "ESTADO", "ESTADO", "texto"],
  ["situacion", "SITUACION", "SITUACION", "texto"],
  ["monto_viable", "MONTO_VIABLE", "MONTO_VIABLE", "numero"],
  ["costo_actualizado", "COSTO_ACTUALIZADO", "COSTO_ACTUALIZADO", "numero"],
  ["control_concurrente", "CTRL_CONCURR", "CONTROL_CONCURR", "numero"],
  ["monto_laudo", "MONTO_LAUDO", "MONTO_LAUDO", "numero"],
  ["monto_fianza", "MONTO_FIANZA", "MONTO_FIANZA", "numero"],
  ["fecha_registro", "FECHA_REGISTRO", "FECHA_REGISTRO", "fecha_iso"],
  ["fecha_viabilidad", "FECHA_VIABILIDAD", "FECHA_VIABILIDAD", "fecha_iso"],
  ["funcion", "FUNCION", "FUNCION", "texto"],
  ["programa", "PROGRAMA", "PROGRAMA", "texto"],
  ["subprograma", "SUBPROGRAMA", "SUBPROGRAMA", "texto"],
  ["marco", "MARCO", "MARCO", "texto"],
  ["tipo_inversion", "TIPO_INVERSION", "TIPO_INVERSION", "texto"],
  ["modalidad", "DES_MODALIDAD", "DES_MODALIDAD", "texto"],
  ["tipologia", "DES_TIPOLOGIA", "DES_TIPOLOGIA", "texto"],
  ["expediente_tecnico", "EXPEDIENTE_TECNICO", "EXPEDIENTE_TECNICO", "si"],
  ["informe_cierre", "INFORME_CIERRE", "INFORME_CIERRE", "si"],
  ["primer_devengado", "PRIMER_DEVENGADO", "PRIMER_DEVENGADO", "entero"],
  ["ultimo_devengado", "ULTIMO_DEVENGADO", "ULTIMO_DEVENGADO", "entero"],
  ["devengado_acumulado", null, "DEVEN_ACUMULADO", "numero"],     // activas: años anteriores + el del año (DEVENGADO_ACTIVAS)
  ["devengado_anio", "DEV_ANIO_ACTUAL", null, "numero"],
  ["pim_anio", "PIM_ANIO_ACTUAL", null, "numero"],
  ["saldo_ejecutar", "SALDO_EJECUTAR", null, "numero"],
  ["avance_fisico", "AVANCE_FISICO", null, "numero"],
  ["avance_ejecucion", "AVANCE_EJECUCION", null, "numero"],
  ["monto_et", "MONTO_ET_F8", null, "numero"],
  ["departamento", "DEPARTAMENTO", "DEPARTAMENTO", "texto"],
  ["provincia", "PROVINCIA", "PROVINCIA", "texto"],
  ["distrito", "DISTRITO", "DISTRITO", "texto"],
  ["ubigeo", "UBIGEO", "UBIGEO", "ubigeo"],
  ["lat", "LATITUD", "LATITUD", "coordenada"],
  ["lon", "LONGITUD", "LONGITUD", "coordenada"],
  ["inicio_ejecucion", "FEC_INI_EJECUCION", null, "fecha_iso"],
  ["fin_ejecucion", "FEC_FIN_EJECUCION", null, "fecha_iso"],
  ["inicio_fisica", "FEC_INI_EJEC_FISICA", "INICIO_EJEC_FISICA", "fecha_iso"],
  ["fin_fisica", "FEC_FIN_EJEC_FISICA", "CULMINA_EJEC_FISICA", "fecha_iso"],
  ["beneficiarios", "NUM_HABITANTES_BENEF", "BENEFICIARIO", "entero"],
  ["fecha_cierre", null, "FEC_CIERRE", "fecha_iso"],
  ["liquidacion", null, "TOTAL_LIQUIDACION", "numero"],
  ["fecha_liquidacion", null, "FEC_LIQUIDACION", "fecha_iso"],
  ["anio_proceso", "ANIO_PROCESO", "ANIO_PROCESO", "entero"],
];

/**
 * Activas: devengado_acumulado = DEVEN_ACUMUL_ANIO_ANT + DEV_ANIO_ACTUAL, NULL si no se lee ninguno (leer_mef). Python la
 * leía con r.get() (sin ella, el acumulado quedaba sólo con el del año); aquí, si falta, la carga se detiene.
 */
const DEVENGADO_ACTIVAS = ["DEVEN_ACUMUL_ANIO_ANT", "DEV_ANIO_ACTUAL"] as const;

/** Lo que pasa de _inversion_mef a inversion_mef (CAMPOS_INVERSION de Python). */
const CAMPOS = [...COLUMNAS.map(([c]) => c), "origen", "huella", "dataset_fecha"];

/** Un nombre como identificador de Postgres, entre comillas (los de la cabecera vienen de afuera). */
export const ident = (nombre: string) => `"${nombre.replaceAll('"', '""')}"`;

/**
 * Las columnas de la tabla temporal: la cabecera en minúsculas, sin el BOM ni los espacios de los extremos. Una vacía se
 * llama columna_<n> y una repetida lleva _2, _3… (Postgres no admite dos con el mismo nombre).
 */
export function columnasCabecera(cabecera: string[]): string[] {
  const vistas = new Set([FILA]);
  return cabecera.map((h, i) => {
    const base = (h.charCodeAt(0) === 0xfeff ? h.slice(1) : h).trim().toLowerCase() || `columna_${i + 1}`;
    let nombre = base;
    for (let k = 2; vistas.has(nombre); k++) nombre = `${base}_${k}`;
    vistas.add(nombre);
    return nombre;
  });
}

/** Las columnas del CSV que se leen de cada origen, en minúsculas. */
export function columnasRequeridas(origen: Origen): string[] {
  const cols: string[] = COLUMNAS.map(([, a, c]) => (origen === "activa" ? a : c)).filter((x): x is string => !!x);
  if (origen === "activa") cols.push(...DEVENGADO_ACTIVAS);
  return [...new Set(cols.map((c) => c.toLowerCase()))];
}

export const faltanColumnas = (cols: string[], origen: Origen) => columnasRequeridas(origen).filter((c) => !cols.includes(c));

/** La tabla temporal de un archivo: el número de fila y una columna de texto por columna de la cabecera. */
export const sqlTemporal = (tabla: string, cols: string[]) =>
  `CREATE TEMP TABLE ${tabla} (${FILA} bigint GENERATED ALWAYS AS IDENTITY, ${cols.map((c) => `${ident(c)} text`).join(", ")}) ON COMMIT DROP`;

/** La expresión que da una columna de inversion_mef a partir de la tabla temporal `s` de un origen. */
export function expresion(destino: string, origen: Origen): string {
  const c = COLUMNAS.find(([d]) => d === destino);
  if (!c) throw new Error(`inversion_mef no tiene la columna ${destino}`);
  if (origen === "activa" && destino === "devengado_acumulado") {
    return `norm_suma_montos(${DEVENGADO_ACTIVAS.map((x) => `s.${ident(x.toLowerCase())}`).join(", ")})`;
  }
  const [, activa, cerrada, tipo] = c;
  const col = origen === "activa" ? activa : cerrada;
  const [funcion, tipoSql] = LECTOR[tipo];
  return col ? `${funcion}(s.${ident(col.toLowerCase())})` : `NULL::${tipoSql}`;
}

/** Cuántas filas de la temporal de un archivo no traen un CUI (las descarta el INSERT). */
export const sqlSinCui = (a: ArchivoMef) => `SELECT count(*)::int AS n FROM ${a.temporal} s WHERE ${expresion("cui", a.origen)} IS NULL`;

/** La tabla con una fila por CUI, como inversion_mef: la llave hace que un CUI no entre dos veces. */
export const SQL_DESTINO = `CREATE TEMP TABLE _inversion_mef (LIKE ${TABLA} INCLUDING DEFAULTS, PRIMARY KEY (cui)) ON COMMIT DROP`;

/**
 * El INSERT … SELECT que normaliza la temporal de un archivo en _inversion_mef ($1: su dataset_fecha). Va un archivo por
 * sentencia, en el orden de ARCHIVOS, así que de cada CUI queda la primera fila de las activas o, si no está ahí, la
 * primera de las cerradas (en el orden del archivo): lo mismo que un DISTINCT ON de las dos juntas, en dos sentencias de la
 * mitad de largo. Sin CUI no entra. La huella es el md5 de los valores normalizados y el origen: un valor que se guarda
 * distinto cambia la huella (y escribir «1.50» o «1.5» no, porque norm_monto no deja ceros de más).
 * El OFFSET 0 hace que cada celda se normalice una sola vez: sin él, Postgres aplana la subconsulta y repite cada expresión
 * dentro del md5 (medido con los archivos reales: 16 s en vez de 9 s para las activas).
 */
export function sqlNormalizar(a: ArchivoMef): string {
  const destinos = COLUMNAS.map(([d]) => d);
  const x = destinos.map((d) => `x.${d}`).join(", ");
  return `INSERT INTO _inversion_mef (${destinos.join(", ")}, origen, huella, dataset_fecha)
SELECT DISTINCT ON (x.cui) ${x}, x.origen, md5(ROW(${x}, x.origen)::text), $1::date
  FROM (SELECT s.${FILA} AS fila, '${a.origen}'::text AS origen,
${destinos.map((d) => `               ${expresion(d, a.origen)} AS ${d}`).join(",\n")}
          FROM ${a.temporal} s
        OFFSET 0) x
 WHERE x.cui IS NOT NULL
 ORDER BY x.cui, x.fila
ON CONFLICT (cui) DO NOTHING`;
}

/**
 * El upsert de cargar_obras.py (SQL_UPSERT): sólo reescribe la fila que cambió (otra huella) o que vuelve después de
 * retirada, y dataset_fecha queda como la del archivo que trajo esa versión. Cuenta las nuevas (xmax = 0: se insertó) y las
 * que cambiaron, sin traer una fila por inversión.
 */
export const SQL_UPSERT = `WITH up AS (
  INSERT INTO ${TABLA} AS t (${CAMPOS.join(", ")}, retirada, cargado_at, cambiado_at)
  SELECT DISTINCT ON (cui) ${CAMPOS.join(", ")}, false, now(), now() FROM _inversion_mef ORDER BY cui
  ON CONFLICT (cui) DO UPDATE SET ${CAMPOS.filter((c) => c !== "cui").map((c) => `${c} = EXCLUDED.${c}`).join(", ")},
    retirada = false, cambiado_at = now()
  WHERE t.huella IS DISTINCT FROM EXCLUDED.huella OR t.retirada
  RETURNING (xmax = 0) AS nueva)
SELECT count(*) FILTER (WHERE nueva)::int AS nuevas, count(*) FILTER (WHERE NOT nueva)::int AS cambiadas FROM up`;

/** Lo que ya no vino en los archivos queda retirada (sólo con los dos archivos completos, como en Python). */
export const SQL_RETIRAR = `UPDATE ${TABLA} t SET retirada = true, cambiado_at = now()
 WHERE NOT t.retirada AND NOT EXISTS (SELECT 1 FROM _inversion_mef x WHERE x.cui = t.cui)`;

/** dataset_fecha de las filas de un archivo: el día de su Last-Modified o, sin él, el de la descarga (en UTC, como Python). */
export const fechaDelArchivo = (e: Pick<Entrada, "modified" | "downloaded_at">) => (e.modified ?? e.downloaded_at).slice(0, 10);

/** Un Last-Modified de HTTP en ISO (lo que Almacen anota como `modified`), o null si no viene o no se entiende. */
export function isoDeHttp(fecha: string | null): string | null {
  const t = Date.parse(fecha ?? "");
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** De cada archivo: sus filas, las que no traían CUI y cuántas quedaron en _inversion_mef (una por CUI). */
export interface CuentaArchivo {
  filas: number;
  sin_cui: number;
  quedan: number;
}

export interface ResumenCarga {
  /** Por archivo: filas del CSV, descartadas sin CUI y CUI repetidos (queda la primera fila de cada CUI). */
  archivos: Record<string, { filas: number; sin_cui: number; cui_repetidos: number }>;
  /** Inversiones distintas (por CUI) que trajeron los dos archivos y se compararon con inversion_mef. */
  copiadas: number;
  nuevas: number;
  cambiadas: number;
  iguales: number;
  retiradas: number;
  sin_cui: number;
  cui_repetidos: number;
  segundos: number;
  /** Por qué no se marcaron retiradas, si no se marcaron. */
  sin_retirar?: string;
  /** Registros de los CSV que hubo que arreglar para COPY (src/csv.ts). */
  arreglos?: Arreglos[];
  seco?: boolean;
}

export type ResultadoCarga = ResumenCarga | { ya_cargado: true; sha256: Record<string, string> };

/** El resumen de la carga: lo de cada archivo, los totales y las iguales (las que no se reescribieron). */
export function armarResumen(archivos: Record<string, CuentaArchivo>, upsert: { nuevas: number; cambiadas: number },
                             retiradas: number, segundos: number): ResumenCarga {
  const r: ResumenCarga = {
    archivos: {}, copiadas: 0, nuevas: upsert.nuevas, cambiadas: upsert.cambiadas, iguales: 0, retiradas, sin_cui: 0,
    cui_repetidos: 0, segundos,
  };
  for (const [clave, c] of Object.entries(archivos)) {
    const repetidos = c.filas - c.sin_cui - c.quedan;
    r.archivos[clave] = { filas: c.filas, sin_cui: c.sin_cui, cui_repetidos: repetidos };
    r.copiadas += c.quedan;
    r.sin_cui += c.sin_cui;
    r.cui_repetidos += repetidos;
  }
  r.iguales = r.copiadas - r.nuevas - r.cambiadas;
  return r;
}

/** Si la carga tocó inversion_mef (y hay que correr refrescar_obras). */
export const hayCambios = (r: Pick<ResumenCarga, "nuevas" | "cambiadas" | "retiradas">) => r.nuevas + r.cambiadas + r.retiradas > 0;

/** Un archivo ya en R2. */
export interface Bajado {
  clave: string;
  entrada: Entrada;
}

/** El paso de carga (ver el comentario del principio). Corre dentro de una conexión; la transacción es suya. */
export async function cargarInversiones(env: Env, db: Db, bajados: Bajado[], p: Pick<ParamsCorrida, "seco" | "forzar">,
                                        id: string): Promise<ResultadoCarga> {
  const entradaDe = (a: ArchivoMef): Entrada => {
    const b = bajados.find((x) => x.clave === a.clave);
    if (!b) throw new Error(`falta la descarga de ${a.nombre}`);
    return b.entrada;
  };
  const log = { fuente: FUENTE, instancia: id };
  if (!p.seco && !p.forzar) {
    let todos = true;
    for (const a of ARCHIVOS) if (!(await yaCargado(db, FUENTE, a.clave, entradaDe(a).sha256))) todos = false;
    if (todos) {
      registrar("INFO", "   los dos archivos ya se cargaron con el mismo sha256: no se carga ni se refresca nada", log);
      return { ya_cargado: true, sha256: Object.fromEntries(ARCHIVOS.map((a) => [a.clave, entradaDe(a).sha256])) };
    }
  }
  const t0 = Date.now();
  const almacen = new Almacen(env, FUENTE);
  const cuentas: Record<string, CuentaArchivo> = {};
  const arreglos: Arreglos[] = [];
  await db.ejecutar("BEGIN");
  try {
    // Como cargar_obras.py: no esperar más de 20 s un bloqueo (un refrescar_obras() que corre desde la PC, por ejemplo) y
    // sin tope por sentencia. Y memoria para ordenar por CUI las ~270 mil filas sin ir a disco.
    await db.ejecutar("SET LOCAL lock_timeout = '20s'");
    await db.ejecutar("SET LOCAL statement_timeout = 0");
    await db.ejecutar("SET LOCAL work_mem = '256MB'");
    for (const a of ARCHIVOS) {
      const e = entradaDe(a);
      const obj = await almacen.abrir(e);
      if (obj.size !== e.bytes) {
        await obj.body.cancel();
        throw new Error(`${a.nombre}: en R2 hay ${obj.size} bytes y la descarga anotó ${e.bytes} (¿otra corrida lo reemplazó?)`);
      }
      // Como en conosce: el CSV pasa por NormalizadorCsv (comillas, registros de otro ancho) y la cabecera da las columnas.
      const cuenta = cuentaCsv();
      const { cabecera, flujo } = await separarCabecera(normalizarCsv(obj.body, cuenta));
      const cols = columnasCabecera(cabecera);
      const faltan = faltanColumnas(cols, a.origen);
      if (faltan.length) {
        await flujo.cancel();
        throw new Error(`${a.nombre}: faltan columnas ${faltan.map((c) => c.toUpperCase()).join(", ")} (de ${cols.length})`);
      }
      await db.ejecutar(sqlTemporal(a.temporal, cols));
      const t1 = Date.now();
      const { filas, sentencias } = await copiarEnTramos(db, a.temporal, cols.map(ident), flujo);
      // COPY tiene que haber leído los mismos registros que se contaron al normalizar el CSV.
      if (filas !== cuenta.registros) throw new Error(`${a.nombre}: COPY cargó ${filas} filas y el archivo tiene ${cuenta.registros}`);
      const arreglo = revisarCuenta(a.nombre, cuenta);
      if (arreglo) {
        arreglos.push(arreglo);
        registrar("WARNING", `   ${describirArreglos(arreglo)}`, log);
      }
      const [{ n }] = await db.filas<{ n: number }>(sqlSinCui(a));
      cuentas[a.clave] = { filas, sin_cui: n, quedan: 0 };
      registrar("INFO", `   ${a.nombre} → ${a.temporal}: ${filas} filas en ${sentencias} COPY, ${n} sin CUI (${Math.round((Date.now() - t1) / 1000)}s)`, log);
    }
    await db.ejecutar(SQL_DESTINO);
    let copiadas = 0;
    for (const a of ARCHIVOS) {
      const t1 = Date.now();
      cuentas[a.clave].quedan = await db.ejecutar(sqlNormalizar(a), [fechaDelArchivo(entradaDe(a))]);
      copiadas += cuentas[a.clave].quedan;
      registrar("INFO", `   ${a.temporal} → _inversion_mef: ${cuentas[a.clave].quedan} inversiones (${Math.round((Date.now() - t1) / 1000)}s)`, log);
    }
    const [upsert] = await db.filas<{ nuevas: number; cambiadas: number }>(SQL_UPSERT);
    const [{ vivas }] = await db.filas<{ vivas: number }>(`SELECT count(*)::int AS vivas FROM ${TABLA} WHERE NOT retirada`);
    let retiradas = 0;
    let sinRetirar: string | undefined;
    if (copiadas < MINIMO_COMPLETO * vivas) {
      sinRetirar = `los archivos traen ${copiadas} de ${vivas} inversiones vivas: no se marcan retiradas (¿archivo incompleto?)`;
      registrar("WARNING", `   ${TABLA}: ${sinRetirar}`, log);
    } else {
      retiradas = await db.ejecutar(SQL_RETIRAR);
    }
    const resumen = armarResumen(cuentas, upsert, retiradas, Math.round((Date.now() - t0) / 1000));
    if (sinRetirar) resumen.sin_retirar = sinRetirar;
    if (arreglos.length) resumen.arreglos = arreglos;
    registrar("INFO", `   ${TABLA}${p.seco ? " (en seco)" : ""}: ${resumen.copiadas} inversiones, ${resumen.nuevas} nuevas, ` +
      `${resumen.cambiadas} cambiadas, ${resumen.iguales} iguales, ${resumen.retiradas} retiradas; ${resumen.sin_cui} sin CUI, ` +
      `${resumen.cui_repetidos} CUI repetidos (${resumen.segundos}s)`, log);
    if (p.seco) {
      await db.ejecutar("ROLLBACK");
      return { ...resumen, seco: true };
    }
    for (const a of ARCHIVOS) {
      const e = entradaDe(a);
      await registrarCarga(db, {
        fuente: FUENTE, clave: a.clave, tabla: TABLA, archivo: nombreArchivo(e), gcs_uri: uri(e), sha256: e.sha256, bytes: e.bytes,
        filas: cuentas[a.clave].filas, fuente_url: e.url, descargado_at: e.modified ?? e.downloaded_at,
      });
    }
    await db.ejecutar("COMMIT");
    return resumen;
  } catch (err) {
    await db.ejecutar("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

/** El Last-Modified del archivo en el servidor del MEF, o null si no lo manda. */
async function ultimaModificacion(url: string): Promise<string | null> {
  const r = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA } });
  await r.body?.cancel();
  if (!r.ok) throw new ErrorHttp(r.status, url);
  return isoDeHttp(r.headers.get("last-modified"));
}

export async function correrInviertePe(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const log = { fuente: FUENTE, instancia: id };
  const bajados: Bajado[] = [];
  for (const a of ARCHIVOS) {
    bajados.push(await step.do(`descargar ${a.clave}`, DESCARGA, async (): Promise<Bajado> => {
      const url = `${MEF}/${a.nombre}`;
      const modificado = await ultimaModificacion(url);
      // Sin Last-Modified, Almacen daría por buena la copia de R2 para siempre: se baja otra vez (el sha256 dice si cambió).
      const entrada = await new Almacen(env, FUENTE).bajar(url, { archivo: a.nombre, modificado, forzar: p.forzar || !modificado, subdir: a.clave });
      if (entrada.bytes < MINIMO_BYTES) throw new Error(`${a.nombre}: ${entrada.bytes} bytes, no parece el archivo del MEF`);
      return { clave: a.clave, entrada };
    }));
  }
  const carga = await step.do("cargar inversion_mef", CARGA_GRANDE, () =>
    conDb(env.HYPERDRIVE, (db) => cargarInversiones(env, db, bajados, p, id)));
  const resumen: { carga: ResultadoCarga; refrescar_obras?: Record<string, number> | null } = { carga };
  if ("ya_cargado" in carga || carga.seco) return resumen;
  if (!hayCambios(carga)) {
    registrar("INFO", "   inversion_mef sin cambios: no se corre refrescar_obras()", log);
    return resumen;
  }
  // La entidad de cada inversión, sus banderas, obra ↔ contrato y los cruces del contrato (migración 160).
  resumen.refrescar_obras = await step.do("refrescar_obras", CARGA, () => conDb(env.HYPERDRIVE, async (db) =>
    (await db.filas<{ r: Record<string, number> | null }>("SELECT refrescar_obras(true) AS r"))[0]?.r ?? null));
  registrar("INFO", `   refrescar_obras → ${JSON.stringify(resumen.refrescar_obras)}`, log);
  return resumen;
}
