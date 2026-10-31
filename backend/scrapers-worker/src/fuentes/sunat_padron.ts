/**
 * Padrón reducido de RUC de la SUNAT → `sunat_padron` → `aplicar_padron_sunat()` y `refrescar_senales_sunat()`
 * (migración 224): el estado del contribuyente y la condición del domicilio de las empresas, cada semana, sin el
 * formulario con captcha de la Consulta Múltiple (backend/scrapers-pc/sunat_ruc/, que sigue para la fecha de alta y el
 * CIIU: el padrón reducido no los trae).
 *
 * El archivo (URL_PADRON) es público, sin captcha, y la SUNAT lo regenera a diario (Last-Modified). Visto el 2026-10-31
 * con HTTP Range, sin bajarlo entero: 394 MB con UNA entrada deflate sin descriptor de datos ni ZIP64
 * (`padron_reducido_ruc.txt`, 1 580 MB), en latin-1, separado por `|` y con otro `|` al final de cada línea, fin de línea
 * \n, y estas 15 columnas: RUC, NOMBRE O RAZÓN SOCIAL, ESTADO DEL CONTRIBUYENTE, CONDICIÓN DE DOMICILIO, UBIGEO, TIPO DE
 * VÍA, NOMBRE DE VÍA, CÓDIGO DE ZONA, TIPO DE ZONA, NÚMERO, INTERIOR, LOTE, DEPARTAMENTO, MANZANA, KILÓMETRO. Viene
 * agrupado: las primeras ~100 mil líneas son todas de personas naturales (10, 15, 17), sin dirección ('-'). El estado y la
 * condición vienen cortados a 20 caracteres («BAJA MULT.INSCR. Y O», «NO HALLADO SE MUDO D»): la migración 224 los empata
 * con el texto entero de la Consulta Múltiple.
 *
 * Privacidad: sólo RUC 20 (personas jurídicas). Las líneas de RUC 10, 15 y 17 son de personas naturales (el RUC 10 lleva
 * el DNI): se descartan por sus dos primeros bytes, sin decodificarlas, y sólo se cuentan por prefijo. No se guardan, no se
 * registran y no salen en el resumen; `sunat_padron` además tiene un CHECK '^20[0-9]{9}$'. El crudo en R2 (que sí las
 * trae, tal como lo publica la SUNAT) se borra de R2 apenas termina la carga (borrarCrudo).
 *
 * Pasos: descargar (HEAD por la fecha y `Almacen.bajar` a R2) → ya cargado (mismo sha256: termina) → cargar (UN paso:
 * BEGIN, TRUNCATE, COPY en tramos de ≤ 40 s con `copiarEnTramos`, registrarCarga, COMMIT; un corte no deja nada a medias)
 * → aplicar_padron_sunat() → refrescar_senales_sunat(). En seco el COPY va a una tabla temporal igual a la destino (con su
 * PK y su CHECK) y se descarta con ROLLBACK.
 *
 * Memoria y CPU (128 MB por isolate; la CPU de los pasos de una misma instancia se suma): el ZIP va de R2 a COPY en
 * streaming. Se infla con fflate de forma síncrona y de a 64 KB comprimidos (~256 KB de texto por vez; DecompressionStream
 * infla por delante y acumula, ver mef_agregado.ts), las líneas se cortan sobre los bytes, las que no empiezan con "20"
 * sólo se cuentan y las RUC 20 pasan directo de latin-1 a CSV UTF-8 escapado, sin armar strings. Medido en Node el
 * 2026-10-31 con un padrón sintético de la misma forma (400 MB de texto, `copiarEnTramos` con una base falsa): ~15 s de
 * CPU por GB inflado con 8 % de líneas RUC 20 y ~22 s con 30 %, o sea ~25-35 s para el archivo entero; en memoria viva,
 * ~18 MB (el bitmap de RUC vistos, 12,5 MB, más los búferes en vuelo), sin importar el tamaño del archivo.
 */

import type { WorkflowStep } from "cloudflare:workers";
import { Inflate } from "fflate";
import { Almacen, nombreArchivo, uri } from "../almacen.ts";
import type { Entrada } from "../almacen.ts";
import { registrarCarga, yaCargado } from "../cargas.ts";
import type { Env, ParamsCorrida } from "../config.ts";
import { decodificarCp1252 } from "../csv.ts";
import { conDb } from "../db.ts";
import { ErrorHttp, UA } from "../http.ts";
import { entradaZip } from "../mef_agregado.ts";
import { registrar } from "../registro.ts";
import { CARGA, DESCARGA, LECTURA, fechaLima } from "./comun.ts";
import { copiarEnTramos } from "./pnda_dji.ts";

const FUENTE = "sunat_padron";
/** Clave en `datasets_cargas` y carpeta del crudo en R2 (raw/sunat_padron/padron_reducido/…): una sola copia. */
const CLAVE = "padron_reducido";
const TABLA = "sunat_padron";
export const URL_PADRON = "https://www2.sunat.gob.pe/padron_reducido_ruc.zip";
const ARCHIVO = "padron_reducido_ruc.zip";
/** Paso de carga: hasta 30 min, un reintento (TRUNCATE + COPY en una transacción: un corte no deja nada a medias). */
const CARGA_GRANDE = { retries: { limit: 1, delay: "2 minutes" }, timeout: "30 minutes" } as const;
/** Menos RUC 20 que esto es un padrón roto: sólo en `empresas` hay ~248 mil (las que le venden al Estado). */
const MINIMO_RUC20 = 300_000;
/** Ni una caída de más del 10 % frente a la carga anterior: las bajas siguen en el padrón, así que casi sólo crece. */
const CAIDA_MAXIMA = 0.1;

/** Las 15 columnas del padrón, sin tildes (la cabecera viene en latin-1 y con tildes). */
export const CABECERA_PADRON = ["RUC", "NOMBRE O RAZON SOCIAL", "ESTADO DEL CONTRIBUYENTE", "CONDICION DE DOMICILIO", "UBIGEO",
  "TIPO DE VIA", "NOMBRE DE VIA", "CODIGO DE ZONA", "TIPO DE ZONA", "NUMERO", "INTERIOR", "LOTE", "DEPARTAMENTO", "MANZANA",
  "KILOMETRO"] as const;
/** Columnas de `sunat_padron` que llena el COPY, en el orden del CSV (cargado_at va por defecto). */
export const COLUMNAS_PADRON = ["ruc", "razon_social", "estado", "condicion", "ubigeo", "domicilio"];

const LF = 0x0a;
const ESPACIO = 0x20;
const COMILLA = 0x22;
const COMA = 0x2c;
const GUION = 0x2d;
const CERO = 0x30;
const DOS = 0x32;
const NUEVE = 0x39;
const SEP = 0x7c;
/** Una línea del padrón tiene ~80-200 bytes: algo sin fin de línea más largo que esto no es el padrón. */
const MAX_LINEA = 64 << 10;
/** Bytes comprimidos por cada `push` a fflate: el padrón infla ~4 veces (394 → 1 580 MB), unos 256 KB de texto por vez. */
const ENTRADA_POR_VEZ = 64 << 10;

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const VACIO = new Uint8Array(0);
const CABECERA_CSV = ascii(`${COLUMNAS_PADRON.join(",")}\n`);

/**
 * Los bytes 0x80-0xFF ya en UTF-8. Latin-1: cada byte es su punto de código ("Ñ" 0xD1 → U+00D1). Salvo 0x80-0x9F, que en
 * latin-1 son caracteres de control: van como en cp1252, con la tabla de `decodificarCp1252` (el guion largo 0x96 → "–";
 * los cinco que cp1252 no define → U+FFFD), y no con el TextDecoder de windows-1252, que en Workers los deja como
 * controles. En la muestra del 2026-10-31 no apareció ninguno: `bytesC1` dice si alguna vez aparecen.
 */
const ALTOS: Uint8Array[] = Array.from({ length: 128 }, (_, k) => new TextEncoder().encode(decodificarCp1252(Uint8Array.of(0x80 + k))));

/**
 * Las partes del domicilio entre la vía y la zona, en el orden en que la SUNAT lo escribe en la ficha RUC
 * ("AV. JAVIER PRADO ESTE NRO. 1234 INT. 501 URB. CORPAC"): [prefijo, columna del padrón].
 */
const PARTES: readonly [Uint8Array, number][] = [
  [ascii("NRO. "), 9], [ascii("KM. "), 14], [ascii("MZA. "), 13], [ascii("LOTE. "), 11], [ascii("DPTO. "), 12], [ascii("INT. "), 10],
];

/** Lo que se contó al leer el padrón. */
export interface CuentaPadron {
  /** Líneas de datos leídas (sin la cabecera). */
  lineas: number;
  /** RUC 20 que salieron al CSV. */
  copiados: number;
  /** Líneas que no son RUC 20, por sus dos primeros caracteres ("10", "15", "17"…; "otro" si no son dígitos). */
  descartados: Record<string, number>;
  /** Líneas RUC 20 con un RUC que no es de 11 dígitos o con otro número de columnas: no se cargan. */
  malformadas: number;
  /** RUC 20 repetidos: queda la primera línea. */
  duplicados: number;
  /** Líneas en blanco. */
  vacias: number;
  /** Bytes inflados del TXT, con la cabecera. */
  bytesInflados: number;
  /** Bytes 0x80-0x9F en las columnas de las líneas RUC 20 (ver ALTOS). */
  bytesC1: number;
}

export const cuentaPadron = (): CuentaPadron => ({
  lineas: 0, copiados: 0, descartados: {}, malformadas: 0, duplicados: 0, vacias: 0, bytesInflados: 0, bytesC1: 0,
});

function unir(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** La cabecera del TXT (latin-1) tiene que ser la de siempre: si la SUNAT cambia columnas o codificación, no se carga. */
export function revisarCabecera(b: Uint8Array): void {
  let texto = "";
  for (const x of b) texto += String.fromCharCode(x);
  const cols = texto.split("|");
  if (cols.length && !cols[cols.length - 1].trim()) cols.pop();
  const sinTildes = cols.map((c) => c.normalize("NFD").replace(/\p{M}/gu, "").trim().toUpperCase());
  if (sinTildes.join("|") !== CABECERA_PADRON.join("|")) {
    throw new Error(`el padrón cambió de formato (columnas o codificación): ${texto.slice(0, 400)}`);
  }
}

/**
 * El TXT del padrón, ya inflado y en trozos cualesquiera (una línea puede venir partida entre dos), como CSV para
 * `COPY sunat_padron (COLUMNAS_PADRON) … HEADER`: primero la cabecera y después una fila por RUC 20. Todo sobre bytes:
 * las demás líneas sólo se cuentan por sus dos primeros bytes, y las RUC 20 se escriben sin pasar por strings.
 */
export class PadronCsv {
  readonly cuenta: CuentaPadron;
  /** Líneas descartadas por sus dos primeros bytes (b0 << 8 | b1). */
  private readonly prefijos = new Int32Array(1 << 16);
  /** Un bit por RUC 20 ya visto: los 8 dígitos que siguen al 20 (el 11.º es el verificador, sale de los demás). 12,5 MB. */
  private readonly vistos = new Uint8Array(12_500_000);
  /** Dónde están los `|` de la línea en curso y dónde empieza y termina (sin espacios) cada columna. */
  private readonly seps = new Int32Array(16);
  private readonly ini = new Int32Array(15);
  private readonly fin = new Int32Array(15);
  private cabecera = false;
  /** La línea que quedó partida al final del trozo anterior. */
  private resto: Uint8Array = VACIO;
  private sal = new Uint8Array(1 << 21);
  private n = 0;
  /** En el domicilio: si ya se escribió alguna parte (las siguientes van separadas por un espacio). */
  private abierto = false;

  constructor(cuenta: CuentaPadron = cuentaPadron()) {
    this.cuenta = cuenta;
    this.sal.set(CABECERA_CSV);
    this.n = CABECERA_CSV.length;
  }

  /** Bytes de CSV listos para salir. */
  get pendientes(): number {
    return this.n;
  }

  /** Un trozo del TXT inflado. */
  agregar(d: Uint8Array): void {
    this.cuenta.bytesInflados += d.length;
    let i = 0;
    if (this.resto.length) {
      const k = d.indexOf(LF);
      if (k < 0) {
        this.resto = unir(this.resto, d);
        if (this.resto.length > MAX_LINEA) throw new Error(`una línea de más de ${MAX_LINEA >> 10} KB: no es el padrón`);
        return;
      }
      const linea = unir(this.resto, d.subarray(0, k));
      this.resto = VACIO;
      this.linea(linea, 0, linea.length);
      i = k + 1;
    }
    for (let k = d.indexOf(LF, i); k >= 0; k = d.indexOf(LF, i)) {
      this.linea(d, i, k);
      i = k + 1;
    }
    if (i < d.length) {
      if (d.length - i > MAX_LINEA) throw new Error(`una línea de más de ${MAX_LINEA >> 10} KB: no es el padrón`);
      this.resto = d.slice(i);
    }
  }

  /** Fin del TXT: la última línea (si no termina en \n) y los descartados por prefijo. */
  terminar(): void {
    if (this.resto.length) {
      const r = this.resto;
      this.resto = VACIO;
      this.linea(r, 0, r.length);
    }
    if (!this.cabecera) throw new Error("el padrón vino vacío");
    const descartados: Record<string, number> = {};
    for (let k = 0; k < this.prefijos.length; k++) {
      const v = this.prefijos[k];
      if (!v) continue;
      const a = k >> 8;
      const b = k & 0xff;
      const clave = a >= CERO && a <= NUEVE && b >= CERO && b <= NUEVE ? String.fromCharCode(a, b) : "otro";
      descartados[clave] = (descartados[clave] ?? 0) + v;
    }
    this.cuenta.descartados = descartados;
  }

  /** El CSV acumulado (y se vacía), o null si no hay nada. */
  sacar(): Uint8Array | null {
    if (!this.n) return null;
    const out = this.sal.slice(0, this.n);
    this.n = 0;
    return out;
  }

  /** La línea d[i, k) (sin el \n). */
  private linea(d: Uint8Array, i: number, k: number): void {
    let e = k;
    while (e > i && d[e - 1] <= ESPACIO) e--;   // el \r de un \r\n y espacios al final
    if (!this.cabecera) {
      revisarCabecera(d.subarray(i, e));
      this.cabecera = true;
      return;
    }
    this.cuenta.lineas++;
    if (e === i) {
      this.cuenta.vacias++;
      return;
    }
    const a = d[i];
    const b = e - i > 1 ? d[i + 1] : 0;
    // Personas naturales (10, 15, 17) y lo demás: sólo se cuenta el prefijo, sin leer el resto de la línea.
    if (a !== DOS || b !== CERO) {
      this.prefijos[(a << 8) | b]++;
      return;
    }
    this.ruc20(d, i, e);
  }

  private ruc20(d: Uint8Array, i: number, e: number): void {
    const c = this.cuenta;
    // El RUC: 11 dígitos y un `|`. `num` son los 8 dígitos que siguen al 20, para el bitmap de vistos.
    if (e - i < 12 || d[i + 11] !== SEP) {
      c.malformadas++;
      return;
    }
    let num = 0;
    for (let j = i + 2; j < i + 11; j++) {
      const x = d[j];
      if (x < CERO || x > NUEVE) {
        c.malformadas++;
        return;
      }
      if (j < i + 10) num = num * 10 + (x - CERO);
    }
    // 15 columnas: 14 `|` entre ellas, más el del final si lo trae. Un `|` de más (dentro de un nombre) corre todas las
    // columnas: la línea no se carga y se cuenta.
    const seps = this.seps;
    let m = 0;
    for (let q = d.indexOf(SEP, i + 11); q >= 0 && q < e; q = d.indexOf(SEP, q + 1)) {
      if (m === seps.length) break;
      seps[m++] = q;
    }
    if (d[e - 1] === SEP ? m !== 15 : m !== 14) {
      c.malformadas++;
      return;
    }
    const vistos = this.vistos;
    const bit = 1 << (num & 7);
    if (vistos[num >>> 3] & bit) {
      c.duplicados++;
      return;
    }
    vistos[num >>> 3] |= bit;
    for (let k = 0; k < 15; k++) {
      let a = k === 0 ? i : seps[k - 1] + 1;
      let b = k < m ? seps[k] : e;
      while (a < b && d[a] <= ESPACIO) a++;
      while (b > a && d[b - 1] <= ESPACIO) b--;
      this.ini[k] = a;
      this.fin[k] = b;
    }
    // Lo más que puede crecer: 3 bytes por byte (0x80-0x9F en UTF-8) más prefijos, comillas y comas.
    this.reservar(3 * (e - i) + 96);
    const s = this.sal;
    s.set(d.subarray(i, i + 11), this.n);
    this.n += 11;
    s[this.n++] = COMA;
    this.columna(d, 1);   // razón social
    s[this.n++] = COMA;
    this.columna(d, 2);   // estado
    s[this.n++] = COMA;
    this.columna(d, 3);   // condición
    s[this.n++] = COMA;
    this.columna(d, 4);   // ubigeo
    s[this.n++] = COMA;
    this.domicilio(d);
    s[this.n++] = LF;
    c.copiados++;
  }

  /** '' o '-' (lo que pone el padrón cuando no hay dato): NULL. */
  private vacia(d: Uint8Array, k: number): boolean {
    const a = this.ini[k];
    const b = this.fin[k];
    return a === b || (b - a === 1 && d[a] === GUION);
  }

  /** Una columna entre comillas, o nada (NULL: COPY … NULL ''). */
  private columna(d: Uint8Array, k: number): void {
    if (this.vacia(d, k)) return;
    this.sal[this.n++] = COMILLA;
    this.texto(d, this.ini[k], this.fin[k]);
    this.sal[this.n++] = COMILLA;
  }

  /**
   * El domicilio armado como lo escribe la SUNAT: la vía (tipo y nombre), número, kilómetro, manzana, lote, departamento e
   * interior, y la zona (código y nombre: «URB. SANTA ROSA»). El tipo de vía y el código de zona sólo acompañan a su nombre.
   */
  private domicilio(d: Uint8Array): void {
    this.abierto = false;
    if (!this.vacia(d, 6)) {
      this.parte();
      if (!this.vacia(d, 5)) {
        this.texto(d, this.ini[5], this.fin[5]);
        this.sal[this.n++] = ESPACIO;
      }
      this.texto(d, this.ini[6], this.fin[6]);
    }
    for (const [prefijo, k] of PARTES) {
      if (this.vacia(d, k)) continue;
      this.parte();
      this.sal.set(prefijo, this.n);
      this.n += prefijo.length;
      this.texto(d, this.ini[k], this.fin[k]);
    }
    if (!this.vacia(d, 8)) {
      this.parte();
      if (!this.vacia(d, 7)) {
        this.texto(d, this.ini[7], this.fin[7]);
        this.sal[this.n++] = ESPACIO;
      }
      this.texto(d, this.ini[8], this.fin[8]);
    }
    if (this.abierto) this.sal[this.n++] = COMILLA;
  }

  private parte(): void {
    this.sal[this.n++] = this.abierto ? ESPACIO : COMILLA;
    this.abierto = true;
  }

  /** d[a, b) de latin-1 a UTF-8, con las comillas dobladas y los caracteres de control como espacios. */
  private texto(d: Uint8Array, a: number, b: number): void {
    const s = this.sal;
    let n = this.n;
    for (let j = a; j < b; j++) {
      const x = d[j];
      if (x < 0x80) {
        if (x === COMILLA) {
          s[n++] = COMILLA;
          s[n++] = COMILLA;
        } else {
          s[n++] = x < ESPACIO ? ESPACIO : x;
        }
      } else {
        if (x < 0xa0) this.cuenta.bytesC1++;
        const u = ALTOS[x - 0x80];
        for (let t = 0; t < u.length; t++) s[n++] = u[t];
      }
    }
    this.n = n;
  }

  private reservar(bytes: number): void {
    if (this.n + bytes <= this.sal.length) return;
    const s = new Uint8Array(Math.max(this.sal.length * 2, this.n + bytes));
    s.set(this.sal.subarray(0, this.n));
    this.sal = s;
  }
}

/**
 * El ZIP del padrón (su cuerpo, de R2) como el CSV de `PadronCsv`, en trozos de ~`trozoSalida` bytes. Lee la cabecera
 * local de la primera entrada (`entradaZip`: corta en su tamaño comprimido, también ZIP64) y la infla con fflate de forma
 * síncrona, ENTRADA_POR_VEZ bytes por vez: cada trozo se procesa antes de leer el siguiente, así la memoria no crece con
 * el archivo. Falla si el deflate termina incompleto. `cuenta` queda completa cuando el flujo termina.
 */
export function padronComoCsv(zip: ReadableStream<Uint8Array>, cuenta: CuentaPadron = cuentaPadron(), trozoSalida = 1 << 20): ReadableStream<Uint8Array> {
  const lector = entradaZip(zip).getReader();
  const csv = new PadronCsv(cuenta);
  const inflador = new Inflate((datos) => csv.agregar(datos));
  let entrada: Uint8Array = VACIO;
  let terminado = false;
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      while (!terminado && csv.pendientes < trozoSalida) {
        if (!entrada.length) {
          const { value, done } = await lector.read();
          if (done) {
            inflador.push(VACIO, true);   // con el deflate incompleto, fflate tira "unexpected EOF"
            csv.terminar();
            terminado = true;
          } else {
            entrada = value;
          }
          continue;
        }
        const t = entrada.subarray(0, ENTRADA_POR_VEZ);
        entrada = entrada.subarray(t.length);
        inflador.push(t);
      }
      const s = csv.sacar();
      if (s) c.enqueue(s);
      if (terminado) c.close();
    },
    cancel(motivo) {
      return lector.cancel(motivo);
    },
  });
}

interface Bajado {
  entrada: Entrada;
  /** Last-Modified del ZIP (ISO), si la SUNAT lo manda. */
  modificado: string | null;
}

/**
 * El ZIP crudo trae nombres de personas naturales y su DNI (dentro del RUC 10): apenas se cargó (o se vio que ya estaba), se
 * borra de R2. La próxima corrida lo vuelve a bajar (Almacen.estaAlDia mira que el objeto exista).
 */
const borrarCrudo = (env: Env, step: WorkflowStep, b: Bajado) =>
  step.do("borrar crudo", LECTURA, async () => {
    await env.CRUDOS.delete(`raw/${b.entrada.file}`);
    return true;
  });

export async function correrSunatPadron(env: Env, p: ParamsCorrida, step: WorkflowStep, id: string): Promise<unknown> {
  const b = await step.do("descargar", DESCARGA, async (): Promise<Bajado> => {
    // La fecha del padrón: si es la de la copia que ya está en R2, no se vuelve a bajar.
    const r = await fetch(URL_PADRON, { method: "HEAD", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new ErrorHttp(r.status, URL_PADRON);
    const ms = Date.parse(r.headers.get("last-modified") ?? "");
    const modificado = Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    // Sin fecha, `bajar` daría por buena la copia vieja: se baja igual (el sha256 dice después si cambió).
    const entrada = await new Almacen(env, FUENTE).bajar(URL_PADRON, { archivo: ARCHIVO, modificado, forzar: p.forzar || !modificado, subdir: CLAVE });
    return { entrada, modificado };
  });
  // El día del padrón en Lima (a las 02:36 del 31-oct lo regeneró ese día): lo que aplicar_padron_sunat anota.
  const padron = fechaLima(Date.parse(b.modificado ?? b.entrada.downloaded_at));
  const sha256 = b.entrada.sha256;

  if (!p.seco && !p.forzar) {
    const ya = await step.do("ya cargado", LECTURA, () => conDb(env.HYPERDRIVE, (db) => yaCargado(db, FUENTE, CLAVE, sha256)));
    if (ya) {
      registrar("INFO", `   padrón del ${padron}: ya cargado con el mismo sha256, se salta`, { fuente: FUENTE, instancia: id });
      await borrarCrudo(env, step, b);
      return { ya_cargado: true, padron, sha256 };
    }
  }

  const carga = await step.do("cargar", CARGA_GRANDE, () => conDb(env.HYPERDRIVE, async (db) => {
    const t0 = Date.now();
    const cuenta = cuentaPadron();
    await db.ejecutar("BEGIN");
    try {
      let destino = TABLA;
      if (p.seco) {
        // Igual a la destino, con su PK y su CHECK: el seco también prueba que no queden RUC repetidos ni ajenos.
        destino = `seco_${TABLA}`;
        await db.ejecutar(`CREATE TEMP TABLE ${destino} (LIKE ${TABLA} INCLUDING ALL) ON COMMIT DROP`);
      } else {
        await db.ejecutar(`TRUNCATE ${TABLA}`);   // foto completa: el padrón de hoy reemplaza al anterior
      }
      const crudo = await new Almacen(env, FUENTE).abrir(b.entrada);
      const { filas, sentencias } = await copiarEnTramos(db, destino, COLUMNAS_PADRON, padronComoCsv(crudo.body, cuenta));
      const resumen = {
        lineas: cuenta.lineas, copiados: filas, descartados: cuenta.descartados, malformadas: cuenta.malformadas,
        duplicados: cuenta.duplicados, vacias: cuenta.vacias, bytes_c1: cuenta.bytesC1, mb_inflados: Math.round(cuenta.bytesInflados / 1e6),
        sentencias, segundos: Math.round((Date.now() - t0) / 1000),
      };
      registrar("INFO", `   ${nombreArchivo(b.entrada)} del ${padron} → ${destino}: ${filas} RUC 20 de ${cuenta.lineas} líneas ` +
        `(descartadas ${JSON.stringify(cuenta.descartados)}, ${cuenta.malformadas} malformadas, ${cuenta.duplicados} repetidas; ` +
        `${resumen.mb_inflados} MB inflados en ${resumen.segundos}s)`, { fuente: FUENTE, instancia: id });
      if (filas !== cuenta.copiados) throw new Error(`COPY cargó ${filas} filas y el padrón trajo ${cuenta.copiados} RUC 20`);
      // Muchas líneas RUC 20 que no se pudieron leer: la SUNAT cambió algo. Mejor no cargar (como NormalizadorCsv).
      if (cuenta.malformadas > Math.max(50, 0.005 * (filas + cuenta.malformadas))) {
        throw new Error(`${cuenta.malformadas} líneas RUC 20 malformadas de ${filas + cuenta.malformadas}: no se carga`);
      }
      if (p.seco) {
        await db.ejecutar("ROLLBACK");
        return { ...resumen, seco: true };
      }
      // Un padrón que vino a medias no reemplaza al bueno (con `forzar` sí).
      const [previa] = await db.filas<{ filas: string | number | null }>(
        "SELECT filas FROM datasets_cargas WHERE fuente = $1 AND clave = $2 AND estado = 'ok'", [FUENTE, CLAVE]);
      const antes = Number(previa?.filas ?? 0);
      if (!p.forzar && (filas < MINIMO_RUC20 || (antes && filas < antes * (1 - CAIDA_MAXIMA)))) {
        throw new Error(`el padrón trae ${filas} RUC 20 (la carga anterior, ${antes}): parece incompleto; con forzar se carga igual`);
      }
      await db.ejecutar(`ANALYZE ${TABLA}`);
      // descargado_at = la fecha del padrón (su Last-Modified), como el corte del MEF: aplicar_padron_sunat la lee de acá.
      await registrarCarga(db, {
        fuente: FUENTE, clave: CLAVE, tabla: TABLA, archivo: nombreArchivo(b.entrada), gcs_uri: uri(b.entrada), sha256,
        bytes: b.entrada.bytes, filas, fuente_url: URL_PADRON, descargado_at: b.modificado ?? b.entrada.downloaded_at,
      });
      await db.ejecutar("COMMIT");
      return resumen;
    } catch (e) {
      await db.ejecutar("ROLLBACK").catch(() => undefined);
      throw e;
    }
  }));
  await borrarCrudo(env, step, b);
  if (p.seco) return { padron, sha256, ...carga };

  // Sólo las empresas que ya están en `empresas` y cambiaron (migración 224), y después sus señales (116 y 118).
  const empresas = await step.do("aplicar_padron_sunat", CARGA, () => conDb(env.HYPERDRIVE, async (db) => {
    const [r] = await db.filas<Record<string, number>>("SELECT * FROM aplicar_padron_sunat($1::date)", [padron]);
    registrar("INFO", `   empresas: ${JSON.stringify(r)}`, { fuente: FUENTE, instancia: id });
    return r;
  }));
  const senales = await step.do("refrescar_senales_sunat", CARGA, () => conDb(env.HYPERDRIVE, async (db) =>
    Number((await db.filas<{ n: number }>("SELECT refrescar_senales_sunat() AS n"))[0]?.n ?? 0)));
  return { padron, sha256, carga, empresas, senales };
}
