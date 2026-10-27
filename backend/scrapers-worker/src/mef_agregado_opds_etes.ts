/**
 * Lo puro (sin E/S) de los archivos del MEF de los organismos públicos descentralizados y de las empresas municipales, que
 * no están en el `<año>-Gasto.zip` del SIAF (migración 152):
 *   · OPDS  `<año>-Gasto-OPDS.zip`   desde 2018: SAT de Lima, Serpar, Parque de las Leyendas, CETICOS/ZED, hospitales
 *           municipales… (GRUPO_ENTIDAD 14 municipales, 17 regionales). 58 columnas, con los 7 montos del SIAF.
 *   · ETES  `<año>-Gastos-ETES.zip`  desde 2015: EPS de agua, eléctricas, inmobiliarias, mercados y terminales municipales.
 *           51 columnas y sólo tres montos: PIA, PIM y MONTO_EJECUCION, lo ejecutado que la empresa reporta (mensual o
 *           trimestral), sin partirlo en devengado y girado.
 * Cada uno es un ZIP de una entrada (~2 MB, ~50 MB de CSV, 45-95 mil filas), todo entre comillas, en UTF-8.
 *
 * Se agrega como el SIAF (src/mef_agregado.ts), por unidad ejecutora (sec_ejec 500xxx, el CODIGO_SIAF que la OECE da a
 * esas entidades) y en las mismas ocho miradas de en qué gasta (partida, función, proyecto, específica, rubro, mes,
 * programa, producto), con los mismos códigos, para que la API arme el mismo árbol. Sin desglose por departamento: estas
 * cifras no se suman a las de la región. En las ETE la ejecución va en el lugar del devengado (y certificado, comprometido y
 * girado quedan vacíos: no los publican); `origen` lo dice en la base.
 *
 * Hasta 2018 el archivo de ETES trae también las OPD (grupos 14 y 17), y en 2018 están en los dos archivos. Ahí su
 * «ejecución» no es su devengado (SAT de Lima 2018: S/ 455 M de «ejecución» con un PIM de S/ 124 M; en el de OPDS, S/ 108 M
 * devengados), así que en el de ETES se saltan: las OPD salen sólo del archivo de OPDS.
 *
 * Los archivos son chicos: cada línea se parte entera (no hace falta el truco de src/mef_agregado.ts para 9 M de filas).
 */

import { Inflate } from "fflate";
import { entradaZip } from "./mef_agregado.ts";

export type OrigenEnte = "opds" | "etes";
export const ORIGENES: readonly OrigenEnte[] = ["opds", "etes"];
/** El primer año que el MEF publica de cada archivo (2026-10-27: OPDS 2018-2026, ETES 2015-2026). */
export const PRIMER_ANIO: Record<OrigenEnte, number> = { opds: 2018, etes: 2015 };
export const archivoEnte = (origen: OrigenEnte, anio: number) => (origen === "opds" ? `${anio}-Gasto-OPDS.zip` : `${anio}-Gastos-ETES.zip`);
/** Los grupos de entidad de las OPD (municipales y regionales): en el archivo de ETES se saltan (ver arriba). */
export const GRUPOS_OPD = new Set(["14", "17"]);

/** Cada unidad, como en mef_opds_etes_anual: código, nombres, grupo y lugar (de su primera fila). */
export const ATRIBUTOS_ENTE = ["SEC_EJEC", "EJECUTORA", "EJECUTORA_NOMBRE", "GRUPO_ENTIDAD", "GRUPO_ENTIDAD_NOMBRE",
  "DEPARTAMENTO_EJECUTORA", "DEPARTAMENTO_EJECUTORA_NOMBRE", "PROVINCIA_EJECUTORA", "PROVINCIA_EJECUTORA_NOMBRE",
  "DISTRITO_EJECUTORA", "DISTRITO_EJECUTORA_NOMBRE"] as const;
/**
 * Los 7 montos en el orden de la tabla (pia, pim, certificado, comprometido_anual, comprometido, devengado, girado) y la
 * columna de cada archivo de la que salen; null = el archivo no lo trae (queda NULL en la base).
 */
const MONTOS: Record<OrigenEnte, readonly (string | null)[]> = {
  opds: ["MONTO_PIA", "MONTO_PIM", "MONTO_CERTIFICADO", "MONTO_COMPROMETIDO_ANUAL", "MONTO_COMPROMETIDO", "MONTO_DEVENGADO", "MONTO_GIRADO"],
  etes: ["MONTO_PIA", "MONTO_PIM", null, null, null, "MONTO_EJECUCION", null],
};
const DEVENGADO = 5;
/** Lo que hace falta para las ocho miradas (las mismas columnas que en el SIAF). */
const CAMPOS_GASTO = ["MES_EJE", "PROGRAMA_PPTO", "PROGRAMA_PPTO_NOMBRE", "TIPO_ACT_PROY", "PRODUCTO_PROYECTO", "PRODUCTO_PROYECTO_NOMBRE",
  "FUNCION", "FUNCION_NOMBRE", "FUENTE_FINANCIAMIENTO_NOMBRE", "RUBRO", "RUBRO_NOMBRE", "GENERICA", "GENERICA_NOMBRE", "SUBGENERICA",
  "SUBGENERICA_DET", "SUBGENERICA_DET_NOMBRE", "ESPECIFICA", "ESPECIFICA_DET", "ESPECIFICA_DET_NOMBRE"] as const;
/** Más del 0,5 % de líneas con otro número de campos que la cabecera: el formato cambió y no se carga. */
const TOPE_MALAS = 0.005;

export interface UnidadEnte {
  atributos: string[];
  /** Los 7 montos; los que el archivo no trae quedan en 0 y salen vacíos (ver `MONTOS`). */
  montos: Float64Array;
  filas: number;
}

export interface AgregadoEnte {
  origen: OrigenEnte;
  anio: number;
  filas: number;
  /** Las filas de OPD del archivo de ETES, que no se cuentan (ver arriba). */
  saltadas: number;
  /** Las líneas con otro número de campos que la cabecera (no se cuentan). */
  malas: number;
  unidades: Map<string, UnidadEnte>;
  /** `${sec_ejec}\t${tipo}\t${codigo}` → pia, pim, devengado (en las ETE, la ejecución). */
  gasto: Map<string, Float64Array>;
  /** `${tipo}\t${codigo}` → [nombre, grupo], como en el SIAF. */
  nombres: Map<string, [string, string]>;
}

/**
 * Los campos de una línea CSV: entre comillas (con `""` dentro) o sueltos, separados por coma. Una línea del MEF nunca
 * trae saltos de línea dentro de un campo (lo comprueba el conteo de campos contra la cabecera).
 */
export function partirLinea(linea: string): string[] {
  const out: string[] = [];
  const n = linea.length;
  let i = 0;
  for (;;) {
    if (linea.charCodeAt(i) === 34) {
      let j = i + 1;
      let s = "";
      for (;;) {
        const k = linea.indexOf('"', j);
        if (k < 0) {
          s += linea.slice(j);
          i = n;
          break;
        }
        if (linea.charCodeAt(k + 1) === 34) {
          s += linea.slice(j, k + 1);
          j = k + 2;
          continue;
        }
        s += linea.slice(j, k);
        i = k + 1;
        break;
      }
      out.push(s);
      if (i >= n) return out;
      // Tras la comilla de cierre va la coma; si no (un campo mal cerrado), lo que sigue hasta la coma es parte del campo.
      const coma = linea.indexOf(",", i);
      if (coma < 0) {
        out[out.length - 1] += linea.slice(i);
        return out;
      }
      if (coma > i) out[out.length - 1] += linea.slice(i, coma);
      i = coma + 1;
      if (i >= n) {
        out.push("");
        return out;
      }
    } else {
      const coma = linea.indexOf(",", i);
      if (coma < 0) {
        out.push(linea.slice(i));
        return out;
      }
      out.push(linea.slice(i, coma));
      i = coma + 1;
      if (i >= n) {
        out.push("");
        return out;
      }
    }
  }
}

/**
 * Una copia propia del texto: un trozo de la línea (slice) mantiene vivo en V8 todo el bloque inflado del que salió, y
 * las claves y nombres que se guardan retendrían todo el CSV (~100 MB en memoria con un archivo de 50 MB).
 */
const copiar = (s: string): string => JSON.parse(JSON.stringify(s));

/** Un monto del MEF ("1234.5", "-0.3", ""): 0 si viene vacío. */
const monto = (v: string | undefined) => (v === undefined || v === "" || v === "0" ? 0 : +v);

/** Procesa línea por línea el CSV (la primera es la cabecera) sobre el agregado `a`. */
function procesador(a: AgregadoEnte): (linea: string) => void {
  let ix: Record<string, number> | null = null;
  let ancho = 0;
  let cols: number[] = [];
  const m = new Float64Array(7);
  const sumar = (sec: string, tipo: string, codigo: string, nombre: () => [string, string]) => {
    const clave = `${sec}\t${tipo}\t${codigo}`;
    let d = a.gasto.get(clave);
    if (!d) {
      a.gasto.set(copiar(clave), (d = new Float64Array(3)));
      const n = `${tipo}\t${codigo}`;
      if (!a.nombres.has(n)) {
        const [x, g] = nombre();
        a.nombres.set(copiar(n), [copiar(x.trim()), copiar(g.trim())]);
      }
    }
    d[0] += m[0];
    d[1] += m[1];
    d[2] += m[DEVENGADO];
  };
  return (linea: string) => {
    if (!ix) {
      const cab = partirLinea(linea.replace(/^﻿/, "")).map((c) => c.trim());
      ix = Object.fromEntries(cab.map((c, i) => [c, i]));
      const montos = MONTOS[a.origen].filter((c): c is string => c !== null);
      const falta = [...ATRIBUTOS_ENTE, ...CAMPOS_GASTO, ...montos, "ANO_EJE"].filter((c) => !(c in ix!));
      if (falta.length) throw new Error(`el CSV de ${a.origen.toUpperCase()} del MEF cambió: faltan ${falta.join(", ")}`);
      ancho = cab.length;
      cols = MONTOS[a.origen].map((c) => (c === null ? -1 : ix![c]));
      return;
    }
    const f = partirLinea(linea);
    if (f.length !== ancho) {
      a.malas++;
      return;
    }
    const x = ix;
    if (!a.anio) a.anio = Number(f[x.ANO_EJE]);
    if (a.origen === "etes" && GRUPOS_OPD.has(f[x.GRUPO_ENTIDAD])) {
      a.saltadas++;
      return;
    }
    a.filas++;
    const sec = f[x.SEC_EJEC].trim();
    let u = a.unidades.get(sec);
    if (!u) {
      u = { atributos: ATRIBUTOS_ENTE.map((k) => copiar(f[x[k]].trim())), montos: new Float64Array(7), filas: 0 };
      a.unidades.set(copiar(sec), u);
    }
    u.filas++;
    for (let k = 0; k < 7; k++) {
      m[k] = cols[k] < 0 ? 0 : monto(f[cols[k]]);
      u.montos[k] += m[k];
    }
    // En qué gasta: sólo las filas con algún monto (las de ejecución en cero no crean claves), como en el SIAF.
    if (m[0] === 0 && m[1] === 0 && m[DEVENGADO] === 0) return;
    const partida = `${f[x.GENERICA]}.${f[x.SUBGENERICA]}.${f[x.SUBGENERICA_DET]}`;
    sumar(sec, "partida", partida, () => [f[x.SUBGENERICA_DET_NOMBRE], f[x.GENERICA_NOMBRE]]);
    sumar(sec, "funcion", f[x.FUNCION], () => [f[x.FUNCION_NOMBRE], ""]);
    const tipoActividad = f[x.TIPO_ACT_PROY];
    if (tipoActividad === "2") sumar(sec, "proyecto", f[x.PRODUCTO_PROYECTO], () => [f[x.PRODUCTO_PROYECTO_NOMBRE], ""]);
    sumar(sec, "especifica", `${partida}.${f[x.ESPECIFICA]}.${f[x.ESPECIFICA_DET]}`, () => [f[x.ESPECIFICA_DET_NOMBRE], partida]);
    sumar(sec, "rubro", f[x.RUBRO], () => [f[x.RUBRO_NOMBRE], f[x.FUENTE_FINANCIAMIENTO_NOMBRE]]);
    // Lo ejecutado por mes (las filas del mes 0 traen PIA y PIM, no ejecución).
    if (m[DEVENGADO] !== 0 && f[x.MES_EJE] !== "0") sumar(sec, "mes", f[x.MES_EJE], () => ["", ""]);
    const programa = f[x.PROGRAMA_PPTO];
    sumar(sec, "programa", programa, () => [f[x.PROGRAMA_PPTO_NOMBRE], ""]);
    if (tipoActividad === "3") sumar(sec, "producto", `${programa}.${f[x.PRODUCTO_PROYECTO]}`, () => [f[x.PRODUCTO_PROYECTO_NOMBRE], programa]);
  };
}

const nuevo = (origen: OrigenEnte): AgregadoEnte => ({
  origen, anio: 0, filas: 0, saltadas: 0, malas: 0, unidades: new Map(), gasto: new Map(), nombres: new Map(),
});

/** Corta el texto en líneas (\n o \r\n) entre trozos. */
function cortador(procesar: (linea: string) => void) {
  let resto = "";
  return {
    agregar(trozo: string) {
      const t = resto ? resto + trozo : trozo;
      let desde = 0;
      let k: number;
      while ((k = t.indexOf("\n", desde)) >= 0) {
        const fin = t.charCodeAt(k - 1) === 13 ? k - 1 : k;
        if (fin > desde) procesar(t.slice(desde, fin));
        desde = k + 1;
      }
      resto = t.slice(desde);
    },
    fin() {
      if (resto.trim()) procesar(resto.replace(/\r$/, ""));
      resto = "";
    },
  };
}

function cerrar(a: AgregadoEnte): AgregadoEnte {
  const total = a.filas + a.saltadas + a.malas;
  if (a.malas > 0 && a.malas / Math.max(1, total) > TOPE_MALAS) {
    throw new Error(`el CSV de ${a.origen.toUpperCase()} del MEF cambió: ${a.malas} de ${total} líneas no tienen el número de campos de la cabecera`);
  }
  return a;
}

/** Agrega el CSV ya como texto (pruebas). */
export async function agregarEnte(texto: ReadableStream<string>, origen: OrigenEnte): Promise<AgregadoEnte> {
  const a = nuevo(origen);
  const c = cortador(procesador(a));
  for await (const trozo of texto) c.agregar(trozo);
  c.fin();
  return cerrar(a);
}

/** Agrega el ZIP desde su cuerpo HTTP: entrada única, inflada con fflate de forma síncrona (como agregarZip). */
export async function agregarZipEnte(cuerpo: ReadableStream<Uint8Array>, origen: OrigenEnte): Promise<AgregadoEnte> {
  const a = nuevo(origen);
  const c = cortador(procesador(a));
  const dec = new TextDecoder("utf-8");
  const inflador = new Inflate((datos, final) => {
    c.agregar(dec.decode(datos, { stream: !final }));
  });
  const lector = entradaZip(cuerpo).getReader();
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    if (value?.length) inflador.push(value);
  }
  inflador.push(new Uint8Array(0), true);
  c.agregar(dec.decode());
  c.fin();
  return cerrar(a);
}

const celda = (v: unknown) => (v === null || v === undefined || v === "" ? "" : `"${String(v).replaceAll('"', '""')}"`);

export const COLS_ANUAL_ENTE = "origen, anio, sec_ejec, ejecutora, ejecutora_nombre, grupo_entidad, grupo_entidad_nombre, departamento, " +
  "departamento_nombre, provincia, provincia_nombre, distrito, distrito_nombre, pia, pim, certificado, comprometido_anual, comprometido, " +
  "devengado, girado, filas, corte";
export const COLS_GASTO_ENTE = "origen, anio, sec_ejec, tipo, codigo, nombre, grupo, pia, pim, devengado";

/**
 * El agregado como los CSV de `COPY mef_opds_etes_anual (COLS_ANUAL_ENTE)` y `COPY mef_opds_etes_gasto (COLS_GASTO_ENTE)`.
 * Un monto que el archivo no trae (las ETE no publican certificado, comprometido ni girado) sale vacío: NULL, no 0.
 */
export function csvEnte(a: AgregadoEnte, corte: string | null): { anual: string; gasto: string } {
  const trae = MONTOS[a.origen].map((c) => c !== null);
  const anual = [...a.unidades.values()].map((u) =>
    [a.origen, a.anio, ...u.atributos, ...Array.from(u.montos, (v, k) => (trae[k] ? v.toFixed(2) : null)), u.filas, corte ?? ""].map(celda).join(","));
  const gasto = [...a.gasto.entries()].map(([clave, d]) => {
    const [sec, tipo, codigo] = clave.split("\t");
    const [nombre, grupo] = a.nombres.get(`${tipo}\t${codigo}`) ?? ["", ""];
    return [a.origen, a.anio, sec, tipo, codigo, nombre, grupo, d[0].toFixed(2), d[1].toFixed(2), d[2].toFixed(2)].map(celda).join(",");
  });
  return { anual: anual.join("\n") + "\n", gasto: gasto.join("\n") + "\n" };
}
