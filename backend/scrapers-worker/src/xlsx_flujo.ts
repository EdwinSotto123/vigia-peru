/**
 * XLSX grandes como CSV, en streaming y sin cargarlos enteros. `leerXlsx` (SheetJS) arma el libro en memoria:
 * con la hoja de postores de CONOSCE (29 MB de XML en 2026, 78 MB en 2024) o las adjudicaciones de 2024
 * (119 MB) pasa los 128 MB del isolate.
 *
 * El XLSX ya está en R2 y se lee por rangos: el directorio central del ZIP (también ZIP64), los textos
 * compartidos (`xl/sharedStrings.xml`, si los hay; los de CONOSCE de años anteriores van en la celda,
 * `inlineStr`) y la hoja, que se infla con fflate de forma síncrona trozo a trozo (como `mef_agregado.ts`:
 * DecompressionStream infla por delante y acumula). El CSV sale con la cabecera (la primera fila) y todas las
 * filas con el mismo número de columnas que ella, listo para COPY. Las fechas con formato de fecha quedan como
 * el número de serie de Excel: quien carga lo convierte (`conosce_fecha` en SQL).
 *
 * Desde el 2026-10-23 las órdenes de CONOSCE traen todo el texto en los textos compartidos (agosto de 2026: 722 mil
 * textos, 53 MB de XML, ~2 veces eso en los meses de diciembre). En un `string[]` no entraban en el isolate: van
 * comprimidos en memoria (`TextosCompartidos`).
 */

import { deflateRawSync, inflateRawSync } from "node:zlib";
import { Inflate } from "fflate";

/** Bytes [offset, offset + largo) del archivo. */
export type LeerRango = (offset: number, largo: number) => Promise<ReadableStream<Uint8Array>>;

export interface EntradaZip {
  nombre: string;
  metodo: number;
  comprimido: number;
  tam: number;
  offset: number;
}

const todo = async (s: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(s).arrayBuffer());

/** El directorio central del ZIP: nombre → dónde está cada entrada. */
export async function directorioZip(leer: LeerRango, tam: number): Promise<Map<string, EntradaZip>> {
  const cola = Math.min(tam, 65_536 + 22);
  const fin = await todo(await leer(tam - cola, cola));
  const dv = new DataView(fin.buffer, fin.byteOffset, fin.byteLength);
  let i = fin.length - 22;
  while (i >= 0 && dv.getUint32(i, true) !== 0x06054b50) i--;
  if (i < 0) throw new Error("XLSX sin fin de directorio central");
  let n = dv.getUint16(i + 10, true);
  let largoCd = dv.getUint32(i + 12, true);
  let offCd = dv.getUint32(i + 16, true);
  if (offCd === 0xffffffff || largoCd === 0xffffffff || n === 0xffff) {
    const l = i - 20;
    if (l < 0 || dv.getUint32(l, true) !== 0x07064b50) throw new Error("ZIP64 sin localizador");
    const r64 = await todo(await leer(Number(dv.getBigUint64(l + 8, true)), 56));
    const d64 = new DataView(r64.buffer, r64.byteOffset, r64.byteLength);
    n = Number(d64.getBigUint64(32, true));
    largoCd = Number(d64.getBigUint64(40, true));
    offCd = Number(d64.getBigUint64(48, true));
  }
  const cd = await todo(await leer(offCd, largoCd));
  const c = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const dec = new TextDecoder();
  const out = new Map<string, EntradaZip>();
  let p = 0;
  for (let k = 0; k < n && p + 46 <= cd.length && c.getUint32(p, true) === 0x02014b50; k++) {
    const metodo = c.getUint16(p + 10, true);
    let comprimido = c.getUint32(p + 20, true);
    let tamU = c.getUint32(p + 24, true);
    const ln = c.getUint16(p + 28, true);
    const le = c.getUint16(p + 30, true);
    const lc = c.getUint16(p + 32, true);
    let offset = c.getUint32(p + 42, true);
    const nombre = dec.decode(cd.subarray(p + 46, p + 46 + ln));
    // Extra ZIP64 (0x0001): sólo los campos que están en 0xffffffff, en este orden.
    for (let e = p + 46 + ln; e + 4 <= p + 46 + ln + le;) {
      const id = c.getUint16(e, true);
      const l = c.getUint16(e + 2, true);
      if (id === 1) {
        let q = e + 4;
        if (tamU === 0xffffffff) { tamU = Number(c.getBigUint64(q, true)); q += 8; }
        if (comprimido === 0xffffffff) { comprimido = Number(c.getBigUint64(q, true)); q += 8; }
        if (offset === 0xffffffff) offset = Number(c.getBigUint64(q, true));
      }
      e += 4 + l;
    }
    out.set(nombre, { nombre, metodo, comprimido, tam: tamU, offset });
    p += 46 + ln + le + lc;
  }
  return out;
}

/** Los bytes comprimidos de una entrada (salta la cabecera local, de largo variable). */
async function datosEntrada(leer: LeerRango, e: EntradaZip): Promise<ReadableStream<Uint8Array>> {
  const lh = await todo(await leer(e.offset, 30));
  const d = new DataView(lh.buffer, lh.byteOffset, lh.byteLength);
  if (d.getUint32(0, true) !== 0x04034b50) throw new Error(`${e.nombre}: cabecera local inválida`);
  return leer(e.offset + 30 + d.getUint16(26, true) + d.getUint16(28, true), e.comprimido);
}

/** Bytes comprimidos que se inflan por vez: la hoja infla ~8 veces, así cada `alTexto` recibe ~0,5 MB y no lo que traiga R2. */
const ENTRADA_POR_VEZ = 64 << 10;

/** Inflador síncrono de una entrada: `empujar` procesa un trozo (llamando a `alTexto`) antes de leer el siguiente. */
async function abrirTexto(leer: LeerRango, e: EntradaZip, alTexto: (t: string) => void) {
  if (e.metodo !== 0 && e.metodo !== 8) throw new Error(`${e.nombre}: compresión ${e.metodo} no soportada`);
  const lector = (await datosEntrada(leer, e)).getReader();
  const dec = new TextDecoder("utf-8");
  const inflador = e.metodo === 8 ? new Inflate((datos, final) => alTexto(dec.decode(datos, { stream: !final }))) : null;
  let resto: Uint8Array = new Uint8Array(0);
  return {
    /** false cuando la entrada terminó. */
    async empujar(): Promise<boolean> {
      if (!resto.length) {
        const { value, done } = await lector.read();
        if (done) {
          if (inflador) inflador.push(new Uint8Array(0), true);
          else alTexto(dec.decode());
          return false;
        }
        resto = value;
      }
      const trozo = resto.subarray(0, ENTRADA_POR_VEZ);
      resto = resto.subarray(trozo.length);
      if (inflador) inflador.push(trozo);
      else alTexto(dec.decode(trozo, { stream: true }));
      return true;
    },
  };
}

const ENTIDAD: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Texto XML → texto: entidades (&amp; &#233; &#xE9;) y los `_x000D_` con que Excel escribe caracteres de control. */
export function desescapar(s: string): string {
  if (s.indexOf("&") !== -1) {
    s = s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTIDAD[e]);
  }
  if (s.indexOf("_x") !== -1) s = s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  return s;
}

/** El texto de un `<si>` o `<is>`: todos sus `<t>` (texto enriquecido), sin la guía fonética (`<rPh>`). */
export function textoRico(xml: string): string {
  const limpio = xml.indexOf("<rPh") !== -1 ? xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "") : xml;
  let out = "";
  for (const m of limpio.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return desescapar(out);
}

/** "AB" → 27 (base 0). */
function columna(letras: string): number {
  let n = 0;
  for (let i = 0; i < letras.length; i++) n = n * 26 + (letras.charCodeAt(i) - 64);
  return n - 1;
}

/** Las celdas de una fila (`<row>` sin las etiquetas de afuera). */
export function celdasFila(xml: string, compartidos: TextosCompartidos): (string | null)[] {
  const out: (string | null)[] = [];
  let siguiente = 0;
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1];
    const ref = /\br="([A-Z]+)\d*"/.exec(attrs);
    const col = ref ? columna(ref[1]) : siguiente;
    siguiente = col + 1;
    const tipo = /\bt="(\w+)"/.exec(attrs)?.[1] ?? "n";
    const dentro = m[2] ?? "";
    let v: string | null = null;
    if (tipo === "inlineStr") v = textoRico(dentro);
    else {
      const crudo = /<v>([\s\S]*?)<\/v>/.exec(dentro)?.[1];
      if (crudo != null) v = tipo === "s" ? compartidos.texto(Number(crudo)) : tipo === "b" ? (crudo === "1" ? "TRUE" : "FALSE") : desescapar(crudo);
    }
    while (out.length < col) out.push(null);
    out[col] = v;
  }
  return out;
}

/** Corta el XML de la hoja en filas a medida que llega. */
export class CortadorFilas {
  private buf = "";
  private readonly alFila: (xmlFila: string) => void;

  constructor(alFila: (xmlFila: string) => void) {
    this.alFila = alFila;
  }

  agregar(t: string): void {
    this.buf += t;
    const b = this.buf;
    let desde = 0;
    for (;;) {
      let s = b.indexOf("<row", desde);
      // "<rowBreaks>" no es una fila.
      while (s !== -1 && s + 4 < b.length && !" >/\n\t\r".includes(b[s + 4])) s = b.indexOf("<row", s + 4);
      if (s === -1 || s + 4 >= b.length) {
        // Se guarda la cola por si "<row" quedó partido.
        desde = s === -1 ? Math.max(desde, b.length - 4) : s;
        break;
      }
      const gt = b.indexOf(">", s);
      if (gt === -1) { desde = s; break; }
      if (b[gt - 1] === "/") { this.alFila(""); desde = gt + 1; continue; }
      const e = b.indexOf("</row>", gt);
      if (e === -1) { desde = s; break; }
      this.alFila(b.slice(gt + 1, e));
      desde = e + 6;
    }
    this.buf = b.slice(desde);
  }
}

const campoCsv = (v: string | null) => (v == null || v === "" ? "" : /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Textos unidos en un string y dónde empieza cada uno (en UTF-16; el último corte es el fin). */
interface Bloque {
  texto: string;
  cortes: Uint32Array;
  /** Bit de uso del desalojo de reloj (los únicos inflados): se apaga al pasar la aguja, se prende al pedir un texto. */
  usado: boolean;
}

export interface OpcionesTextos {
  /** Textos por bloque. */
  porBloque?: number;
  /** Caracteres de bloques inflados que se guardan a la vez. */
  cache?: number;
  /** Tope de lo guardado, en bytes (cota de arriba, `bytes`). */
  maximo?: number;
  /** Desde cuántos bytes de XML se cuentan los usos y se comprimen los que se usan una vez (menos: todos tal cual). */
  comprimirDesde?: number;
}

/** En `posicion`: el texto está entre los repetidos (si no, entre los únicos). */
const REPETIDO = 0x8000_0000;

const crecer = (a: Uint32Array) => {
  const b = new Uint32Array(a.length * 2);
  b.set(a);
  return b;
};

/** Los textos unidos en un string nuevo (join copia: ya no retienen el XML del que salieron), con sus cortes. */
function unir(textos: string[]): Bloque {
  const cortes = new Uint32Array(textos.length + 1);
  for (let k = 0; k < textos.length; k++) cortes[k + 1] = cortes[k] + textos[k].length;
  return { texto: textos.join(""), cortes, usado: true };
}

/**
 * Los textos compartidos del libro, compactos. Un `string[]` con los 722 mil textos de las órdenes de agosto de 2026
 * pasaba los 90 MB de heap (una cabecera por string, y cada texto cortado con slice retiene el trozo de XML del que
 * salió). Acá van en dos almacenes según cuántas veces los usa la hoja (`usos`, contados antes con `contarUsos`):
 *
 * - los repetidos (en esas órdenes, el 9 % del texto: entidades, estados, fechas, proveedores frecuentes), tal cual,
 *   de a `porBloque` unidos en un solo string;
 * - los que se usan una vez (descripciones, números de orden: el 91 %), comprimidos con deflate (node:zlib, síncrono:
 *   ~1/3) de a `porBloque`: el largo de cada uno (varint) y después los textos en UTF-8. Pedir uno infla su bloque, que
 *   queda en una caché chica con desalojo de reloj (segunda oportunidad): se piden en el orden de la hoja (cada
 *   columna avanza por su tramo de índices), así que cada bloque se infla ~una vez.
 *
 * Sin `usos` (libros chicos) van todos tal cual. `usos` sólo decide dónde va cada texto: si una cuenta sale mal el texto
 * igual está, y sólo cuesta inflar más veces.
 */
export class TextosCompartidos {
  private readonly porBloque: number;
  private readonly cacheMax: number;
  private readonly maximo: number;
  private readonly usos: Uint8Array | null;
  /** Por texto, su lugar en su almacén (+ REPETIDO si es de los repetidos). */
  private posicion = new Uint32Array(1024);
  private n = 0;
  private readonly repetidos: Bloque[] = [];
  private pendientesRep: string[] = [];
  private nRep = 0;
  private caracteresRep = 0;
  private readonly comprimidos: Uint8Array[] = [];
  private pendientesUni: string[] = [];
  private nUni = 0;
  private bytesComprimidos = 0;
  private readonly inflados: (Bloque | undefined)[] = [];
  /** Los bloques inflados (en cualquier orden) y la aguja del reloj. */
  private readonly anillo: number[] = [];
  private aguja = 0;
  private enCache = 0;
  /** Veces que se infló un bloque (para medir). */
  vecesInflado = 0;
  private readonly enc = new TextEncoder();
  private readonly dec = new TextDecoder();

  constructor(usos: Uint8Array | null = null, op: OpcionesTextos = {}) {
    this.usos = usos;
    this.porBloque = op.porBloque ?? 256;
    this.cacheMax = op.cache ?? 4 << 20;
    this.maximo = op.maximo ?? 64 << 20;
  }

  get cantidad(): number {
    return this.n;
  }

  /** Lo guardado, por arriba: los repetidos a 2 bytes por carácter (y sus cortes), los únicos comprimidos y `posicion`. */
  get bytes(): number {
    return this.caracteresRep * 2 + this.nRep * 4 + this.bytesComprimidos + this.n * 4;
  }

  agregar(s: string): void {
    if (this.n === this.posicion.length) this.posicion = crecer(this.posicion);
    if (!this.usos || (this.usos[this.n] ?? 0) >= 2) {
      this.posicion[this.n++] = REPETIDO + this.nRep++;
      this.pendientesRep.push(s);
      if (this.pendientesRep.length === this.porBloque) this.cerrarRepetidos();
    } else {
      this.posicion[this.n++] = this.nUni++;
      this.pendientesUni.push(s);
      if (this.pendientesUni.length === this.porBloque) this.cerrarUnicos();
    }
  }

  /** Cierra los últimos bloques (se llama al terminar de leer los textos). */
  terminar(): void {
    if (this.pendientesRep.length) this.cerrarRepetidos();
    if (this.pendientesUni.length) this.cerrarUnicos();
    this.posicion = this.posicion.slice(0, this.n);
  }

  private cerrarRepetidos(): void {
    const b = unir(this.pendientesRep);
    this.repetidos.push(b);
    this.caracteresRep += b.texto.length;
    this.pendientesRep = [];
    this.revisarTope();
  }

  private cerrarUnicos(): void {
    const largos: number[] = [];
    for (const t of this.pendientesUni) {
      let l = t.length;
      for (; l >= 0x80; l = Math.floor(l / 0x80)) largos.push((l % 0x80) | 0x80);
      largos.push(l);
    }
    const utf8 = this.enc.encode(this.pendientesUni.join(""));
    const datos = new Uint8Array(largos.length + utf8.length);
    datos.set(largos);
    datos.set(utf8, largos.length);
    // Copia del tamaño justo: el Buffer de node:zlib puede ser una vista de su búfer de salida (16 KB en Node).
    const c = new Uint8Array(deflateRawSync(datos));
    this.comprimidos.push(c);
    this.bytesComprimidos += c.length;
    this.pendientesUni = [];
    this.revisarTope();
  }

  private revisarTope(): void {
    if (this.bytes > this.maximo) {
      throw new Error(`textos compartidos: más de ${this.maximo >> 20} MB en memoria aun compactos (${this.n} textos)`);
    }
  }

  /** El texto `i` (null si no existe, como `compartidos[i]` de un arreglo). */
  texto(i: number): string | null {
    if (!Number.isInteger(i) || i < 0 || i >= this.n) return null;
    const p = this.posicion[i];
    if (p >= REPETIDO) {
      const k = p - REPETIDO;
      const b = Math.floor(k / this.porBloque);
      const j = k - b * this.porBloque;
      const x = this.repetidos[b];
      return x ? x.texto.slice(x.cortes[j], x.cortes[j + 1]) : (this.pendientesRep[j] ?? null);   // sin x: antes de terminar()
    }
    const b = Math.floor(p / this.porBloque);
    const j = p - b * this.porBloque;
    if (b >= this.comprimidos.length) return this.pendientesUni[j] ?? null;
    const x = this.inflados[b] ?? this.inflar(b);
    x.usado = true;
    return x.texto.slice(x.cortes[j], x.cortes[j + 1]);
  }

  private inflar(b: number): Bloque {
    const datos = inflateRawSync(this.comprimidos[b]);
    const cuantos = Math.min(this.porBloque, this.nUni - b * this.porBloque);
    const cortes = new Uint32Array(cuantos + 1);
    let p = 0;
    for (let k = 0; k < cuantos; k++) {
      let l = 0;
      for (let f = 1, x = 0x80; x & 0x80; f *= 0x80) {
        x = datos[p++];
        l += (x & 0x7f) * f;
      }
      cortes[k + 1] = cortes[k] + l;
    }
    const x: Bloque = { texto: this.dec.decode(datos.subarray(p)), cortes, usado: true };
    this.vecesInflado++;
    // Reloj: la aguja recorre los inflados; uno usado desde la última pasada se salva (y se apaga), otro sale.
    while (this.enCache + x.texto.length > this.cacheMax && this.anillo.length) {
      if (this.aguja >= this.anillo.length) this.aguja = 0;
      const v = this.anillo[this.aguja];
      const y = this.inflados[v]!;
      if (y.usado) {
        y.usado = false;
        this.aguja++;
        continue;
      }
      this.anillo[this.aguja] = this.anillo[this.anillo.length - 1];
      this.anillo.pop();
      this.inflados[v] = undefined;
      this.enCache -= y.texto.length;
    }
    this.inflados[b] = x;
    this.anillo.push(b);
    this.enCache += x.texto.length;
    return x;
  }
}

/** Un índice de texto compartido más grande no se cuenta (un número anómalo no debe pedir un arreglo enorme). */
const MAX_INDICE = 1 << 26;

/**
 * Cuántas veces usa la hoja cada texto compartido (0, 1, o 2 = "dos o más"): una pasada rápida por la hoja, sin armar
 * filas. Busca cada `t="s"` y el número del `<v>` de esa celda.
 */
export async function contarUsos(leer: LeerRango, e: EntradaZip): Promise<Uint8Array> {
  let usos = new Uint8Array(1 << 16);
  let resto = "";
  const t = await abrirTexto(leer, e, (x) => {
    const s = resto + x;
    // Hasta el último fin de celda: lo que sigue puede ser una celda partida entre trozos.
    const hasta = s.lastIndexOf("</c>");
    if (hasta === -1) {
      const k = s.lastIndexOf("<c");
      resto = k === -1 ? s.slice(-8) : s.slice(k);
      return;
    }
    let p = 0;
    for (;;) {
      const q = s.indexOf('t="s"', p);
      if (q === -1 || q >= hasta) break;
      const gt = s.indexOf(">", q);
      p = gt + 1;
      if (s.charCodeAt(gt - 1) === 0x2f) continue;   // <c … t="s"/>: vacía
      const v = s.indexOf("<", gt);
      if (v === -1 || !s.startsWith("<v>", v)) continue;
      let i = 0;
      let d = v + 3;
      for (let c = s.charCodeAt(d); c >= 48 && c <= 57; c = s.charCodeAt(++d)) i = i * 10 + (c - 48);
      if (d > v + 3 && i < MAX_INDICE) {
        if (i >= usos.length) {
          const u = new Uint8Array(Math.max(usos.length * 2, i + 1));
          u.set(usos);
          usos = u;
        }
        if (usos[i] < 2) usos[i]++;
      }
      p = d;
    }
    resto = s.slice(hasta);
  });
  while (await t.empujar());
  return usos;
}

/** Tope del XML de los textos compartidos: una cota temprana; la de verdad es la de `TextosCompartidos` (64 MB). */
const MAX_XML_COMPARTIDOS = 192 << 20;

/** Los textos compartidos del libro (vacío si no tiene). Con tope: uno anómalo no debe tumbar el isolate. */
export async function textosCompartidos(leer: LeerRango, dir: Map<string, EntradaZip>, maximo = MAX_XML_COMPARTIDOS,
                                        op?: OpcionesTextos): Promise<TextosCompartidos> {
  const e = dir.get("xl/sharedStrings.xml");
  if (!e) return new TextosCompartidos(null, op);
  if (e.tam > maximo) throw new Error(`sharedStrings de ${e.tam} bytes: demasiado para leerlo en memoria`);
  // Con poco XML (los libros chicos) van todos tal cual: ni se cuentan los usos ni se comprime.
  const out = new TextosCompartidos(e.tam > (op?.comprimirDesde ?? 8 << 20) ? await contarUsos(leer, hoja(dir)) : null, op);
  let buf = "";
  const t = await abrirTexto(leer, e, (x) => {
    buf += x;
    let desde = 0;
    for (;;) {
      // Cada <si>…</si> (o <si/>, vacío) es un texto, en orden: el índice de la celda es su posición.
      const ini = buf.indexOf("<si", desde);
      if (ini === -1) {
        desde = Math.max(desde, buf.length - 2);   // por si "<si" quedó partido
        break;
      }
      const gt = buf.indexOf(">", ini);
      if (gt === -1) {
        desde = ini;
        break;
      }
      if (buf[gt - 1] === "/") {
        out.agregar("");
        desde = gt + 1;
        continue;
      }
      const fin = buf.indexOf("</si>", gt);
      if (fin === -1) {
        desde = ini;
        break;
      }
      out.agregar(textoRico(buf.slice(gt + 1, fin)));
      desde = fin + 5;
    }
    buf = buf.slice(desde);
  });
  while (await t.empujar());
  out.terminar();
  return out;
}

/** La primera hoja del libro (la de CONOSCE es una sola). */
function hoja(dir: Map<string, EntradaZip>): EntradaZip {
  const e = dir.get("xl/worksheets/sheet1.xml") ?? [...dir.values()].find((x) => /^xl\/worksheets\/[^/]+\.xml$/.test(x.nombre));
  if (!e) throw new Error("XLSX sin hojas");
  return e;
}

/** Lo que se contó al convertir un XLSX (se completa al terminar). */
export interface CuentaXlsx {
  /** Filas de datos (sin la cabecera ni las vacías). */
  filas: number;
  /** Filas con texto en columnas más allá de la cabecera (sale cortado al ancho de la cabecera). */
  recortadas: number;
  /** Textos compartidos, lo que ocuparon (comprimidos) y cuántas veces se infló un bloque. */
  textos: number;
  bytesTextos: number;
  inflados: number;
}

export const cuentaXlsx = (): CuentaXlsx => ({ filas: 0, recortadas: 0, textos: 0, bytesTextos: 0, inflados: 0 });

/** El XLSX (en R2, leído por rangos) como CSV UTF-8 con cabecera. */
export function xlsxComoCsv(leer: LeerRango, tam: number, trozoSalida = 1 << 20, cuenta?: CuentaXlsx,
                            op?: OpcionesTextos): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let salida = "";
  let ancho = -1;
  let inflado: Awaited<ReturnType<typeof abrirTexto>> | null = null;
  let compartidos: TextosCompartidos | null = null;
  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      if (!inflado) {
        const dir = await directorioZip(leer, tam);
        const textos = (compartidos = await textosCompartidos(leer, dir, undefined, op));
        const cortador = new CortadorFilas((xml) => {
          const celdas = celdasFila(xml, textos);
          const esCabecera = ancho === -1;
          if (esCabecera) {
            while (celdas.length && (celdas[celdas.length - 1] ?? "") === "") celdas.pop();
            if (!celdas.length) return; // filas vacías antes de la cabecera
            ancho = celdas.length;
          } else if (celdas.every((v) => v == null || v === "")) {
            return;
          }
          if (cuenta && !esCabecera) {
            cuenta.filas++;
            // Las filas cortas se completan (Excel no escribe las celdas vacías del final); texto más allá de la
            // cabecera se pierde: se cuenta.
            if (celdas.length > ancho && celdas.some((v, k) => k >= ancho && v != null && v !== "")) cuenta.recortadas++;
          }
          celdas.length = ancho;
          salida += Array.from(celdas, (v) => campoCsv(v ?? null)).join(",") + "\n";
        });
        inflado = await abrirTexto(leer, hoja(dir), (t) => cortador.agregar(t));
      }
      while (salida.length < trozoSalida) {
        if (!(await inflado.empujar())) {
          if (salida) ctl.enqueue(enc.encode(salida));
          salida = "";
          if (cuenta && compartidos) {
            cuenta.textos = compartidos.cantidad;
            cuenta.bytesTextos = compartidos.bytes;
            cuenta.inflados = compartidos.vecesInflado;
          }
          ctl.close();
          return;
        }
      }
      ctl.enqueue(enc.encode(salida));
      salida = "";
    },
  });
}
