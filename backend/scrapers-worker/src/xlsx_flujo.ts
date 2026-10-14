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
 */

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

/** Inflador síncrono de una entrada: `empujar` procesa un trozo (llamando a `alTexto`) antes de leer el siguiente. */
async function abrirTexto(leer: LeerRango, e: EntradaZip, alTexto: (t: string) => void) {
  if (e.metodo !== 0 && e.metodo !== 8) throw new Error(`${e.nombre}: compresión ${e.metodo} no soportada`);
  const lector = (await datosEntrada(leer, e)).getReader();
  const dec = new TextDecoder("utf-8");
  const inflador = e.metodo === 8 ? new Inflate((datos, final) => alTexto(dec.decode(datos, { stream: !final }))) : null;
  return {
    /** false cuando la entrada terminó. */
    async empujar(): Promise<boolean> {
      const { value, done } = await lector.read();
      if (done) {
        if (inflador) inflador.push(new Uint8Array(0), true);
        else alTexto(dec.decode());
        return false;
      }
      if (inflador) inflador.push(value);
      else alTexto(dec.decode(value, { stream: true }));
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
export function celdasFila(xml: string, compartidos: string[]): (string | null)[] {
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
      if (crudo != null) v = tipo === "s" ? (compartidos[Number(crudo)] ?? null) : tipo === "b" ? (crudo === "1" ? "TRUE" : "FALSE") : desescapar(crudo);
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

/** Los textos compartidos del libro (vacío si no tiene). Con tope: uno anómalo no debe tumbar el isolate. */
async function textosCompartidos(leer: LeerRango, dir: Map<string, EntradaZip>, maximo = 48 << 20): Promise<string[]> {
  const e = dir.get("xl/sharedStrings.xml");
  if (!e) return [];
  if (e.tam > maximo) throw new Error(`sharedStrings de ${e.tam} bytes: demasiado para leerlo en memoria`);
  const out: string[] = [];
  let buf = "";
  const t = await abrirTexto(leer, e, (x) => {
    buf += x;
    let desde = 0;
    for (;;) {
      const fin = buf.indexOf("</si>", desde);
      if (fin === -1) break;
      const ini = buf.slice(desde, fin).search(/<si[\s>]/);
      out.push(ini === -1 ? "" : textoRico(buf.slice(desde + ini, fin)));
      desde = fin + 5;
    }
    buf = buf.slice(desde);
  });
  while (await t.empujar());
  return out;
}

/** La primera hoja del libro (la de CONOSCE es una sola). */
function hoja(dir: Map<string, EntradaZip>): EntradaZip {
  const e = dir.get("xl/worksheets/sheet1.xml") ?? [...dir.values()].find((x) => /^xl\/worksheets\/[^/]+\.xml$/.test(x.nombre));
  if (!e) throw new Error("XLSX sin hojas");
  return e;
}

/** El XLSX (en R2, leído por rangos) como CSV UTF-8 con cabecera. */
export function xlsxComoCsv(leer: LeerRango, tam: number, trozoSalida = 1 << 20): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let salida = "";
  let ancho = -1;
  let inflado: Awaited<ReturnType<typeof abrirTexto>> | null = null;
  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      if (!inflado) {
        const dir = await directorioZip(leer, tam);
        const compartidos = await textosCompartidos(leer, dir);
        const cortador = new CortadorFilas((xml) => {
          const celdas = celdasFila(xml, compartidos);
          if (ancho === -1) {
            while (celdas.length && (celdas[celdas.length - 1] ?? "") === "") celdas.pop();
            if (!celdas.length) return; // filas vacías antes de la cabecera
            ancho = celdas.length;
          } else if (celdas.every((v) => v == null || v === "")) {
            return;
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
          ctl.close();
          return;
        }
      }
      ctl.enqueue(enc.encode(salida));
      salida = "";
    },
  });
}
