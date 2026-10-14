/**
 * Lo puro del MEF (sin E/S): sacar la única entrada del `<año>-Gasto-Diario.zip` y agregar su CSV por unidad
 * ejecutora y por departamento × sector/pliego/programa/genérica. Mismo resultado que `agregar_zip` de
 * backend/scrapers/mef_presupuesto/pipeline.py (lo prueba test/mef.test.ts con vectores de Python).
 *
 * El CSV del MEF trae todos los campos entre comillas y 63 columnas, de las cuales las 7 últimas son los
 * montos. Para no partir 9 millones de líneas enteras, se buscan solo los campos que hacen falta.
 */

import { Inflate } from "fflate";

const SEP = '","';
const N_MONTOS = 7;   // PIA, PIM, CERTIFICADO, COMPROMETIDO_ANUAL, COMPROMETIDO, DEVENGADO, GIRADO (las 7 últimas columnas)
export const ATRIBUTOS = ["SEC_EJEC", "EJECUTORA", "EJECUTORA_NOMBRE", "PLIEGO", "PLIEGO_NOMBRE", "SECTOR", "SECTOR_NOMBRE", "NIVEL_GOBIERNO",
  "DEPARTAMENTO_EJECUTORA", "DEPARTAMENTO_EJECUTORA_NOMBRE", "PROVINCIA_EJECUTORA", "PROVINCIA_EJECUTORA_NOMBRE",
  "DISTRITO_EJECUTORA", "DISTRITO_EJECUTORA_NOMBRE"] as const;
const MONTOS = ["MONTO_PIA", "MONTO_PIM", "MONTO_CERTIFICADO", "MONTO_COMPROMETIDO_ANUAL", "MONTO_COMPROMETIDO", "MONTO_DEVENGADO", "MONTO_GIRADO"];

/**
 * Del cuerpo de un ZIP de UNA entrada sin descriptor de datos (el del MEF: deflate, flag 0), los bytes
 * comprimidos de esa entrada. Lee la cabecera local y corta en el tamaño comprimido. El del MEF es ZIP64: la
 * cabecera trae 0xFFFFFFFF y los tamaños reales van en el campo extra 0x0001 (sin cortar ahí, el inflado
 * recibiría el directorio central del final como basura).
 */
export function entradaZip(cuerpo: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  let previo = new Uint8Array(0);
  let restantes = -1;   // -1 = todavía leyendo la cabecera
  return cuerpo.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(trozo, c) {
      if (restantes === -1) {
        const b = new Uint8Array(previo.length + trozo.length);
        b.set(previo);
        b.set(trozo, previo.length);
        if (b.length < 30) {
          previo = b;
          return;
        }
        const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
        if (dv.getUint32(0, true) !== 0x04034b50) throw new Error("no es un ZIP");
        if (dv.getUint16(6, true) & 0x08) throw new Error("ZIP con descriptor de datos: el tamaño no viene en la cabecera");
        if (dv.getUint16(8, true) !== 8) throw new Error(`método de compresión ${dv.getUint16(8, true)} (se espera deflate)`);
        const largoNombre = dv.getUint16(26, true);
        const largoExtra = dv.getUint16(28, true);
        const inicio = 30 + largoNombre + largoExtra;
        if (b.length < inicio) {
          previo = b;
          return;
        }
        let comprimido = dv.getUint32(18, true);
        const sinComprimir = dv.getUint32(22, true);
        if (comprimido === 0xffffffff || sinComprimir === 0xffffffff) {
          // ZIP64: en el extra 0x0001 van, en orden y solo si en la cabecera son 0xFFFFFFFF, el tamaño sin comprimir y el comprimido.
          let p = 30 + largoNombre;
          let hallado = false;
          while (p + 4 <= inicio) {
            const id = dv.getUint16(p, true);
            const largo = dv.getUint16(p + 2, true);
            if (id === 0x0001) {
              let q = p + 4;
              if (sinComprimir === 0xffffffff) q += 8;
              if (comprimido === 0xffffffff) comprimido = Number(dv.getBigUint64(q, true));
              hallado = true;
              break;
            }
            p += 4 + largo;
          }
          if (!hallado) throw new Error("ZIP64 sin el campo extra 0x0001");
        }
        restantes = comprimido;
        trozo = b.subarray(inicio);
        previo = new Uint8Array(0);
      }
      if (restantes <= 0) return;
      const parte = trozo.length > restantes ? trozo.subarray(0, restantes) : trozo;
      restantes -= parte.length;
      c.enqueue(parte);
    },
    flush() {
      if (restantes > 0) throw new Error(`ZIP truncado: faltan ${restantes} bytes de la entrada`);
    },
  }));
}

/** Una copia propia del texto (no un slice que retenga el bloque del que salió). */
const copiar = (s: string): string => JSON.parse(JSON.stringify(s));

/**
 * Campo `n` de una línea "a","b",… sin partirla entera. Un nombre puede traer comillas escapadas
 * (`""SAN LUIS""`): el campo termina en la primera comilla que no está duplicada.
 */
function campo(linea: string, n: number): string {
  let i = 1;
  for (let k = 0; k < n; k++) i = linea.indexOf(SEP, i) + 3;
  let j = linea.indexOf('"', i);
  if (j < 0) return linea.slice(i);
  if (linea.charCodeAt(j + 1) !== 34) return linea.slice(i, j);
  let out = "";
  for (;;) {
    if (j < 0) return out + linea.slice(i);
    if (linea.charCodeAt(j + 1) === 34) {
      out += linea.slice(i, j + 1);
      i = j + 2;
      j = linea.indexOf('"', i);
      continue;
    }
    return out + linea.slice(i, j);
  }
}

export interface Ejecutora {
  atributos: string[];
  montos: Float64Array;
  filas: number;
}

export interface Agregado {
  anio: number;
  filas: number;
  ejecutoras: Map<string, Ejecutora>;
  /** `${dep}\t${tipo}\t${nombre}` → pia, pim, devengado */
  desglose: Map<string, Float64Array>;
}

/** Procesa línea por línea el CSV del MEF (la primera es la cabecera) sobre el agregado `a`. */
function procesador(a: Agregado): (linea: string) => void {
  let ix: Record<string, number> | null = null;
  const m = new Float64Array(N_MONTOS);
  const procesar = (linea: string) => {
    if (!ix) {
      const cab = linea.replace(/^﻿/, "").split(SEP).map((c) => c.replaceAll('"', ""));
      ix = Object.fromEntries(cab.map((c, i) => [c, i]));
      const falta = [...ATRIBUTOS, ...MONTOS, "ANO_EJE", "PROGRAMA_PPTO_NOMBRE", "GENERICA_NOMBRE"].filter((c) => !(c in ix!));
      if (falta.length) throw new Error(`el CSV del MEF cambió: faltan ${falta.join(", ")}`);
      const ultimos = cab.slice(-N_MONTOS);
      if (ultimos.join() !== MONTOS.join()) throw new Error(`el CSV del MEF cambió: las 7 últimas columnas son ${ultimos.join(", ")}`);
      return;
    }
    const x = ix;
    a.filas++;
    const sec = campo(linea, x.SEC_EJEC);
    let e = a.ejecutoras.get(sec);
    if (!e) {
      // Copias: un trozo de la línea (slice) mantiene vivo en V8 todo el bloque de texto del que salió, y
      // 2 900 ejecutoras retendrían 2 900 bloques: en Workers eso pasa los 128 MB.
      e = { atributos: ATRIBUTOS.map((k) => copiar(campo(linea, x[k]))), montos: new Float64Array(N_MONTOS), filas: 0 };
      e.atributos[4] = e.atributos[4].trim();   // PLIEGO_NOMBRE viene como " " en gobiernos locales
      a.ejecutoras.set(copiar(sec), e);
      if (!a.anio) a.anio = Number(campo(linea, x.ANO_EJE));
    }
    e.filas++;
    // Los 7 montos, de atrás para adelante (sin partir la línea).
    m.fill(0);
    let j = linea.length - 1;
    for (let k = N_MONTOS - 1; k >= 0; k--) {
      const ini = linea.lastIndexOf('"', j - 1);
      const v = linea.slice(ini + 1, j);
      if (v !== "0" && v !== "") m[k] = +v;
      j = ini - 2;
    }
    for (let k = 0; k < N_MONTOS; k++) e.montos[k] += m[k];
    const dep = e.atributos[9];
    const pliego = e.atributos[4] || e.atributos[2];   // gobiernos locales: la municipalidad
    for (const [tipo, nombre] of [["sector", e.atributos[6]], ["pliego", pliego], ["programa", campo(linea, x.PROGRAMA_PPTO_NOMBRE)],
      ["generica", campo(linea, x.GENERICA_NOMBRE)]] as const) {
      const n = nombre.trim();
      if (!n) continue;
      const clave = `${dep}\t${tipo}\t${n}`;
      let d = a.desglose.get(clave);
      if (!d) a.desglose.set(copiar(clave), (d = new Float64Array(3)));
      d[0] += m[0];
      d[1] += m[1];
      d[2] += m[5];
    }
  };
  return procesar;
}

const nuevo = (): Agregado => ({ anio: 0, filas: 0, ejecutoras: new Map(), desglose: new Map() });

/** Corta el texto en líneas (\n o \r\n) entre trozos y las pasa a `procesar`. */
class Cortador {
  private resto = "";
  private readonly procesar: (linea: string) => void;

  constructor(procesar: (linea: string) => void) {
    this.procesar = procesar;
  }

  agregar(trozo: string): void {
    const t = this.resto ? this.resto + trozo : trozo;
    let desde = 0;
    let k: number;
    while ((k = t.indexOf("\n", desde)) >= 0) {
      const fin = t.charCodeAt(k - 1) === 13 ? k - 1 : k;
      if (fin > desde) this.procesar(t.slice(desde, fin));
      desde = k + 1;
    }
    this.resto = t.slice(desde);
  }

  fin(): void {
    if (this.resto.trim()) this.procesar(this.resto.replace(/\r$/, ""));
    this.resto = "";
  }
}

/** Agrega el CSV del MEF ya como texto. */
export async function agregar(texto: ReadableStream<string>): Promise<Agregado> {
  const a = nuevo();
  const c = new Cortador(procesador(a));
  for await (const trozo of texto) c.agregar(trozo);
  c.fin();
  return a;
}

/**
 * Agrega el `<año>-Gasto-Diario.zip` directamente desde su cuerpo HTTP. El inflado es fflate, síncrono:
 * cada trozo comprimido se infla, se decodifica y se procesa antes de leer el siguiente. Con
 * DecompressionStream el inflado nativo corre por delante del procesamiento y acumula texto inflado
 * (> 1 GB medido en Node; en Workers pasa los 128 MB del isolate).
 */
export async function agregarZip(cuerpo: ReadableStream<Uint8Array>): Promise<Agregado> {
  const a = nuevo();
  const c = new Cortador(procesador(a));
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
  return a;
}

const celda = (v: unknown) => (v === null || v === undefined || v === "" ? "" : `"${String(v).replaceAll('"', '""')}"`);

/** El agregado como los CSV que cargan mef_ejecutora_anual y mef_departamento_desglose (COPY … CSV). */
export function csvAgregado(a: Agregado, corte: string | null): { ejecutoras: string; desglose: string } {
  const ejecutoras = [...a.ejecutoras.values()].map((e) =>
    [a.anio, ...e.atributos, ...Array.from(e.montos, (v) => v.toFixed(2)), e.filas, corte ?? ""].map(celda).join(",")).join("\n");
  const desglose = [...a.desglose.entries()].map(([k, d]) =>
    [a.anio, ...k.split("\t"), d[0].toFixed(2), d[1].toFixed(2), d[2].toFixed(2)].map(celda).join(",")).join("\n");
  return { ejecutoras: ejecutoras + "\n", desglose: desglose + "\n" };
}
