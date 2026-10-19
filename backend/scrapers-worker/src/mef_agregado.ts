/**
 * Lo puro del MEF (sin E/S): sacar la única entrada del `<año>-Gasto-Diario.zip` y agregar su CSV por unidad
 * ejecutora y por departamento × sector/pliego/programa/genérica. Mismo resultado que `agregar_zip` de
 * backend/scrapers/mef_presupuesto/pipeline.py (lo prueba test/mef.test.ts con vectores de Python).
 *
 * Además (sólo aquí, no en el Python): en qué gasta cada unidad ejecutora (`gasto`, migración 63), por partida
 * (genérica › detalle de subgenérica: "BIENES Y SERVICIOS › ALIMENTOS Y BEBIDAS"), por función ("DEFENSA Y
 * SEGURIDAD NACIONAL") y por proyecto de inversión (TIPO_ACT_PROY = 2, con su nombre). Con el archivo de 2026 son
 * ≈ 172 000 claves y 55 000 nombres: los montos van en UN arreglo compartido (un Float64Array por clave retenía 88 MB,
 * cerca de los 128 MB del isolate) y el CSV sale como flujo directo al COPY, sin armarse entero en memoria.
 *
 * Migración 64: más miradas, para decir EN QUÉ con detalle: la específica de gasto bajo cada partida ("VIAJES" ›
 * "PASAJES Y GASTOS DE TRANSPORTE"), de dónde viene la plata (fuente › rubro: "RECURSOS DETERMINADOS" › "CANON Y
 * SOBRECANON…"), el devengado mes a mes y los programas presupuestales con sus productos. No caben con las tres
 * primeras en un paso (≈ 370 000 claves más): `agregarZip(cuerpo, miradas)` agrega sólo las pedidas, y el scraper
 * lee el ZIP en tres pasos (MIRADAS_POR_PASO).
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
/** Lo que hace falta para el desglose del gasto de cada unidad ejecutora. */
const CAMPOS_GASTO = ["MES_EJE", "PROGRAMA_PPTO", "PROGRAMA_PPTO_NOMBRE", "TIPO_ACT_PROY", "PRODUCTO_PROYECTO", "PRODUCTO_PROYECTO_NOMBRE",
  "FUNCION", "FUNCION_NOMBRE", "FUENTE_FINANCIAMIENTO_NOMBRE", "RUBRO", "RUBRO_NOMBRE", "GENERICA", "GENERICA_NOMBRE", "SUBGENERICA",
  "SUBGENERICA_DET", "SUBGENERICA_DET_NOMBRE", "ESPECIFICA", "ESPECIFICA_DET", "ESPECIFICA_DET_NOMBRE"];
/**
 * Las miradas del desglose de cada unidad ejecutora (código · nombre · grupo):
 *   partida     "3.1.1" · ALIMENTOS Y BEBIDAS · su genérica
 *   funcion     "18" · DEFENSA Y SEGURIDAD NACIONAL
 *   proyecto    CUI · nombre del proyecto de inversión (TIPO_ACT_PROY = 2)
 *   especifica  "3.1.1.1.1" · ALIMENTOS Y BEBIDAS PARA CONSUMO HUMANO · el código de su partida ("3.1.1")
 *   rubro       "18" · CANON Y SOBRECANON, REGALIAS… · su fuente de financiamiento
 *   mes         "1".."12" · (sin nombre): sólo el devengado del mes
 *   programa    "0068" · REDUCCION DE VULNERABILIDAD Y ATENCION DE EMERGENCIAS POR DESASTRES
 *   producto    "0068.3000001" · ACCIONES COMUNES · el código de su programa (un producto se repite entre programas)
 */
export type TipoGasto = "partida" | "funcion" | "proyecto" | "especifica" | "rubro" | "mes" | "programa" | "producto";
/** Qué miradas agrega cada lectura del ZIP: así ninguna pasa de ≈ 45 MB retenidos (medido con 2026). */
export const MIRADAS_POR_PASO: readonly (readonly TipoGasto[])[] = [
  ["partida", "funcion", "proyecto"],
  ["especifica"],
  ["rubro", "mes", "programa", "producto"],
];

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
 * Dónde empieza cada campo de la línea actual, hasta el último que se lee: se recorre UNA vez por línea (antes cada
 * campo volvía a contar los separadores desde el principio).
 */
const inicios = new Int32Array(64);
function indexar(linea: string, hasta: number): void {
  let i = 1;
  inicios[0] = 1;
  for (let k = 1; k <= hasta; k++) {
    i = linea.indexOf(SEP, i) + 3;
    inicios[k] = i;
  }
}

/**
 * Campo `n` de la línea ya indexada (`indexar`), sin partirla entera. Un nombre puede traer comillas escapadas
 * (`""SAN LUIS""`): el campo termina en la primera comilla que no está duplicada.
 */
function campo(linea: string, n: number): string {
  let i = inicios[n];
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
  /** En qué gasta cada unidad ejecutora: `${sec_ejec}\t${tipo}\t${codigo}` (tipo: TipoGasto) → posición. */
  gasto: Map<string, number>;
  /** De a 3 por posición de `gasto`: pia, pim, devengado. Crece al doble cuando se llena. */
  gastoMontos: Float64Array;
  /** `${tipo}\t${codigo}` → [nombre, grupo]; el grupo de una partida es su genérica. */
  nombres: Map<string, [string, string]>;
}

/** Procesa línea por línea el CSV del MEF (la primera es la cabecera) sobre el agregado `a`. */
function procesador(a: Agregado, miradas: ReadonlySet<TipoGasto>): (linea: string) => void {
  let ix: Record<string, number> | null = null;
  let hasta = 0;
  const m = new Float64Array(N_MONTOS);
  /** Suma la fila en (unidad ejecutora, tipo, código); el nombre se lee sólo la primera vez que aparece el código. */
  const sumarGasto = (sec: string, tipo: TipoGasto, codigo: string, nombre: () => [string, string]) => {
    const clave = `${sec}\t${tipo}\t${codigo}`;
    let i = a.gasto.get(clave);
    if (i === undefined) {
      i = a.gasto.size * 3;
      // La clave, plana (no una cadena compuesta de trozos): pesa menos retenida.
      a.gasto.set(copiar(clave), i);
      if (i + 3 > a.gastoMontos.length) {
        const mas = new Float64Array(a.gastoMontos.length * 2);
        mas.set(a.gastoMontos);
        a.gastoMontos = mas;
      }
      const n = `${tipo}\t${codigo}`;
      if (!a.nombres.has(n)) {
        const [x, g] = nombre();
        a.nombres.set(copiar(n), [copiar(x.trim()), copiar(g.trim())]);
      }
    }
    const d = a.gastoMontos;
    d[i] += m[0];
    d[i + 1] += m[1];
    d[i + 2] += m[5];
  };
  const procesar = (linea: string) => {
    if (!ix) {
      const cab = linea.replace(/^﻿/, "").split(SEP).map((c) => c.replaceAll('"', ""));
      ix = Object.fromEntries(cab.map((c, i) => [c, i]));
      const falta = [...ATRIBUTOS, ...MONTOS, ...CAMPOS_GASTO, "ANO_EJE"].filter((c) => !(c in ix!));
      if (falta.length) throw new Error(`el CSV del MEF cambió: faltan ${falta.join(", ")}`);
      hasta = Math.max(...[...ATRIBUTOS, ...CAMPOS_GASTO, "ANO_EJE"].map((c) => ix![c]));
      const ultimos = cab.slice(-N_MONTOS);
      if (ultimos.join() !== MONTOS.join()) throw new Error(`el CSV del MEF cambió: las 7 últimas columnas son ${ultimos.join(", ")}`);
      return;
    }
    const x = ix;
    a.filas++;
    indexar(linea, hasta);
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
    // En qué gasta la unidad ejecutora: sólo filas con algún monto (las de ejecución en cero no crean claves).
    if (m[0] === 0 && m[1] === 0 && m[5] === 0) return;
    const partida = miradas.has("partida") || miradas.has("especifica")
      ? `${campo(linea, x.GENERICA)}.${campo(linea, x.SUBGENERICA)}.${campo(linea, x.SUBGENERICA_DET)}`
      : "";
    if (miradas.has("partida")) {
      sumarGasto(sec, "partida", partida, () => [campo(linea, x.SUBGENERICA_DET_NOMBRE), campo(linea, x.GENERICA_NOMBRE)]);
    }
    if (miradas.has("funcion")) sumarGasto(sec, "funcion", campo(linea, x.FUNCION), () => [campo(linea, x.FUNCION_NOMBRE), ""]);
    const tipoActividad = miradas.has("proyecto") || miradas.has("producto") ? campo(linea, x.TIPO_ACT_PROY) : "";
    if (miradas.has("proyecto") && tipoActividad === "2") {
      sumarGasto(sec, "proyecto", campo(linea, x.PRODUCTO_PROYECTO), () => [campo(linea, x.PRODUCTO_PROYECTO_NOMBRE), ""]);
    }
    if (miradas.has("especifica")) {
      sumarGasto(sec, "especifica", `${partida}.${campo(linea, x.ESPECIFICA)}.${campo(linea, x.ESPECIFICA_DET)}`,
        () => [campo(linea, x.ESPECIFICA_DET_NOMBRE), partida]);
    }
    if (miradas.has("rubro")) {
      sumarGasto(sec, "rubro", campo(linea, x.RUBRO), () => [campo(linea, x.RUBRO_NOMBRE), campo(linea, x.FUENTE_FINANCIAMIENTO_NOMBRE)]);
    }
    if (miradas.has("mes") && m[5] !== 0) {
      // El devengado por mes (las filas del mes 0 traen PIA y PIM, no ejecución).
      const mes = campo(linea, x.MES_EJE);
      if (mes !== "0") sumarGasto(sec, "mes", mes, () => ["", ""]);
    }
    const programa = miradas.has("programa") || miradas.has("producto") ? campo(linea, x.PROGRAMA_PPTO) : "";
    if (miradas.has("programa")) sumarGasto(sec, "programa", programa, () => [campo(linea, x.PROGRAMA_PPTO_NOMBRE), ""]);
    if (miradas.has("producto") && tipoActividad === "3") {
      sumarGasto(sec, "producto", `${programa}.${campo(linea, x.PRODUCTO_PROYECTO)}`, () => [campo(linea, x.PRODUCTO_PROYECTO_NOMBRE), programa]);
    }
  };
  return procesar;
}

const nuevo = (): Agregado => ({
  anio: 0, filas: 0, ejecutoras: new Map(), desglose: new Map(), gasto: new Map(), gastoMontos: new Float64Array(3 * 65_536), nombres: new Map(),
});

/** Los montos (pia, pim, devengado) de una clave de `gasto`, o `null` si no está. */
export function montosGasto(a: Agregado, clave: string): [number, number, number] | null {
  const i = a.gasto.get(clave);
  return i === undefined ? null : [a.gastoMontos[i], a.gastoMontos[i + 1], a.gastoMontos[i + 2]];
}

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

/** Agrega el CSV del MEF ya como texto (con las miradas del primer paso, salvo que se pidan otras). */
export async function agregar(texto: ReadableStream<string>, miradas: readonly TipoGasto[] = MIRADAS_POR_PASO[0]): Promise<Agregado> {
  const a = nuevo();
  const c = new Cortador(procesador(a, new Set(miradas)));
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
export async function agregarZip(cuerpo: ReadableStream<Uint8Array>, miradas: readonly TipoGasto[] = MIRADAS_POR_PASO[0]): Promise<Agregado> {
  const a = nuevo();
  const c = new Cortador(procesador(a, new Set(miradas)));
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

/**
 * El gasto por unidad ejecutora como CSV para `COPY mef_ejecutora_gasto (anio, sec_ejec, tipo, codigo, nombre, grupo, pia,
 * pim, devengado)`, en un flujo de a `lote` filas: con 2026 son ≈ 28 MB de texto que no hace falta tener enteros.
 */
export function flujoGasto(a: Agregado, lote = 2_000): ReadableStream<Uint8Array> {
  const cod = new TextEncoder();
  const claves = a.gasto.entries();
  return new ReadableStream<Uint8Array>({
    pull(c) {
      let texto = "";
      for (let k = 0; k < lote; k++) {
        const sig = claves.next();
        if (sig.done) {
          if (texto) c.enqueue(cod.encode(texto));
          c.close();
          return;
        }
        const [clave, i] = sig.value;
        const [sec, tipo, codigo] = clave.split("\t");
        const [nombre, grupo] = a.nombres.get(`${tipo}\t${codigo}`) ?? ["", ""];
        const d = a.gastoMontos;
        texto += [a.anio, sec, tipo, codigo, nombre, grupo, d[i].toFixed(2), d[i + 1].toFixed(2), d[i + 2].toFixed(2)].map(celda).join(",") + "\n";
      }
      c.enqueue(cod.encode(texto));
    },
  });
}
