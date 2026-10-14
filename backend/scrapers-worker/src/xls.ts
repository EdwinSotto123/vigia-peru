/**
 * Lector mínimo de XLS (BIFF8 dentro de un contenedor OLE2/CFB) con la semántica de xlrd que usa
 * jne_infogob: `open_workbook(...).sheet_by_index(0).row_values(i)` y `datemode`.
 *
 * Por qué propio: SheetJS ocupa ~150 MB de memoria con el XLS del JNE (4,7 MB, 13 mil filas) y un
 * Worker tiene 128 MB; acá solo se guardan los valores (~10 MB).
 *
 * Valores como en xlrd (con `formatting_info=False`): texto → string; número, fecha o RK → float (un
 * `number`, que se imprime como float de Python); booleano y error → int (`{ entero }`); celda vacía →
 * "". Las filas salen rellenas con "" hasta el ancho de la hoja (xlrd sin `ragged_rows`).
 */

export interface Entero {
  entero: number;
}
export type Celda = string | number | Entero;

export interface Hoja {
  /** 0 = época 1900, 1 = época 1904 (registro DATEMODE). */
  datemode: number;
  filas: Celda[][];
}

const FIN_CADENA = 0xfffffffe;

// ── OLE2 / Compound File Binary ─────────────────────────────────────────────
function flujoWorkbook(b: Uint8Array): Uint8Array {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const firma = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (!firma.every((x, i) => b[i] === x)) throw new Error("no es un XLS (falta la firma OLE2)");
  const tamSector = 1 << dv.getUint16(0x1e, true);
  const tamMini = 1 << dv.getUint16(0x20, true);
  const inicioDir = dv.getUint32(0x30, true);
  const corteMini = dv.getUint32(0x38, true);
  const inicioMiniFat = dv.getUint32(0x3c, true);
  const inicioDifat = dv.getUint32(0x44, true);
  const nDifat = dv.getUint32(0x48, true);
  const porSector = tamSector / 4;
  const u32 = (o: number) => (o + 4 <= b.length ? dv.getUint32(o, true) : FIN_CADENA);
  const desplazamiento = (s: number) => (s + 1) * tamSector;

  const sectoresFat: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = u32(0x4c + 4 * i);
    if (s < 0xfffffffa) sectoresFat.push(s);
  }
  for (let d = inicioDifat, k = 0; k < nDifat && d < 0xfffffffa; k++) {
    const o = desplazamiento(d);
    for (let i = 0; i < porSector - 1; i++) {
      const s = u32(o + 4 * i);
      if (s < 0xfffffffa) sectoresFat.push(s);
    }
    d = u32(o + 4 * (porSector - 1));
  }
  const fat = new Uint32Array(sectoresFat.length * porSector);
  sectoresFat.forEach((s, i) => {
    for (let j = 0; j < porSector; j++) fat[i * porSector + j] = u32(desplazamiento(s) + 4 * j);
  });

  const cadena = (tabla: Uint32Array, inicio: number): number[] => {
    const out: number[] = [];
    for (let s = inicio; s < 0xfffffffa && s < tabla.length && out.length <= tabla.length; s = tabla[s]) out.push(s);
    return out;
  };
  const leer = (inicio: number, tam: number | null): Uint8Array => {
    const sectores = cadena(fat, inicio);
    const out = new Uint8Array(sectores.length * tamSector);
    sectores.forEach((s, i) => out.set(b.subarray(desplazamiento(s), desplazamiento(s) + tamSector), i * tamSector));
    return tam === null ? out : out.subarray(0, tam);
  };

  const dir = leer(inicioDir, null);
  const dvDir = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  let raiz: { inicio: number; tam: number } | null = null;
  const entradas: { nombre: string; tipo: number; inicio: number; tam: number }[] = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const largoNombre = dvDir.getUint16(o + 0x40, true);
    const tipo = dir[o + 0x42];
    if (!tipo) continue;
    const nombre = new TextDecoder("utf-16le").decode(dir.subarray(o, o + Math.max(0, largoNombre - 2)));
    const e = { nombre, tipo, inicio: dvDir.getUint32(o + 0x74, true), tam: dvDir.getUint32(o + 0x78, true) };
    if (tipo === 5) raiz = e;
    entradas.push(e);
  }
  const libro = entradas.find((e) => e.tipo === 2 && e.nombre.toLowerCase() === "workbook")
    ?? entradas.find((e) => e.tipo === 2 && e.nombre.toLowerCase() === "book");
  if (!libro) throw new Error("el XLS no tiene flujo Workbook");
  if (libro.tam >= corteMini || !raiz) return leer(libro.inicio, libro.tam);

  // Flujo chico: vive en el mini flujo (el de la raíz), con su propia FAT de sectores de 64 bytes.
  const mini = leer(raiz.inicio, raiz.tam);
  const miniFatBytes = leer(inicioMiniFat, null);
  const miniFat = new Uint32Array(miniFatBytes.buffer.slice(miniFatBytes.byteOffset, miniFatBytes.byteOffset + miniFatBytes.byteLength));
  const sectores = cadena(miniFat, libro.inicio);
  const out = new Uint8Array(sectores.length * tamMini);
  sectores.forEach((s, i) => out.set(mini.subarray(s * tamMini, (s + 1) * tamMini), i * tamMini));
  return out.subarray(0, libro.tam);
}

// ── BIFF8 ───────────────────────────────────────────────────────────────────
const latin1 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
};
const utf16 = new TextDecoder("utf-16le");

interface Registro {
  tipo: number;
  datos: Uint8Array;
}

function* registros(w: Uint8Array, desde: number): Generator<Registro & { pos: number }> {
  const dv = new DataView(w.buffer, w.byteOffset, w.byteLength);
  for (let p = desde; p + 4 <= w.length;) {
    const tipo = dv.getUint16(p, true);
    const largo = dv.getUint16(p + 2, true);
    yield { tipo, datos: w.subarray(p + 4, p + 4 + largo), pos: p };
    p += 4 + largo;
  }
}

/** `unpack_SST_table` de xlrd: las cadenas pueden seguir en registros CONTINUE (con un byte de opciones nuevo). */
function tablaSst(partes: Uint8Array[], n: number): string[] {
  const out: string[] = [];
  let k = 0;
  let datos = partes[0];
  let pos = 8;
  const u16 = (d: Uint8Array, p: number) => d[p] | (d[p + 1] << 8);
  const i32 = (d: Uint8Array, p: number) => d[p] | (d[p + 1] << 8) | (d[p + 2] << 16) | (d[p + 3] << 24);
  for (let i = 0; i < n; i++) {
    const nchars = u16(datos, pos);
    pos += 2;
    let opciones = datos[pos];
    pos += 1;
    let runs = 0;
    let fonetico = 0;
    if (opciones & 0x08) {
      runs = u16(datos, pos);
      pos += 2;
    }
    if (opciones & 0x04) {
      fonetico = i32(datos, pos);
      pos += 4;
    }
    let s = "";
    let tengo = 0;
    for (;;) {
      const faltan = nchars - tengo;
      let hay: number;
      if (opciones & 0x01) {
        hay = Math.min((datos.length - pos) >> 1, faltan);
        s += utf16.decode(datos.subarray(pos, pos + 2 * hay));
        pos += 2 * hay;
      } else {
        hay = Math.min(datos.length - pos, faltan);
        s += latin1(datos.subarray(pos, pos + hay));
        pos += hay;
      }
      tengo += hay;
      if (tengo === nchars) break;
      datos = partes[++k];
      opciones = datos[0];
      pos = 1;
    }
    for (let r = 0; r < runs; r++) {
      if (pos === datos.length) {
        pos = 0;
        datos = partes[++k];
      }
      pos += 4;
    }
    pos += fonetico;
    if (pos >= datos.length) {
      pos -= datos.length;
      k++;
      if (k < partes.length) datos = partes[k];
    }
    out.push(s);
  }
  return out;
}

/** `unpack_unicode(data, pos, lenlen=2)` de xlrd (cadena de LABEL y STRING en BIFF8). */
function cadenaUnicode(d: Uint8Array, pos: number): string {
  const n = d[pos] | (d[pos + 1] << 8);
  pos += 2;
  const opciones = d[pos];
  pos += 1;
  if (opciones & 0x08) pos += 2;
  if (opciones & 0x04) pos += 4;
  return opciones & 0x01 ? utf16.decode(d.subarray(pos, pos + 2 * n)) : latin1(d.subarray(pos, pos + n));
}

const f64 = (d: Uint8Array, p: number) => new DataView(d.buffer, d.byteOffset + p, 8).getFloat64(0, true);

/** `unpack_RK` de xlrd: entero de 30 bits con signo o los 30 bits altos de un double; ÷100 si el bit 0. */
function rk(d: Uint8Array, p: number): number {
  const v = d[p] | (d[p + 1] << 8) | (d[p + 2] << 16) | (d[p + 3] << 24);
  let x: number;
  if (v & 2) x = v >> 2;
  else {
    const b = new Uint8Array(8);
    b[4] = d[p] & 0xfc;
    b.set(d.subarray(p + 1, p + 4), 5);
    x = new DataView(b.buffer).getFloat64(0, true);
  }
  return v & 1 ? x / 100 : x;
}

/** La primera hoja de cálculo del XLS (`sheet_by_index(0)`). */
export function leerXls(archivo: Uint8Array): Hoja {
  const w = flujoWorkbook(archivo);
  const dv = new DataView(w.buffer, w.byteOffset, w.byteLength);
  if (dv.getUint16(0, true) !== 0x0809) throw new Error("el flujo Workbook no empieza con BOF");
  if (dv.getUint16(4, true) !== 0x0600) throw new Error(`versión BIFF no soportada (0x${dv.getUint16(4, true).toString(16)}); solo BIFF8`);

  let datemode = 0;
  let sst: string[] = [];
  let hoja: number | null = null;
  const it = registros(w, 0);
  let r = it.next();
  while (!r.done) {
    const { tipo, datos } = r.value;
    if (tipo === 0x000a) break;                                        // EOF del globals
    if (tipo === 0x0022) datemode = datos[0] | (datos[1] << 8);       // DATEMODE
    if (tipo === 0x0085 && hoja === null && datos[5] === 0) {          // BOUNDSHEET de hoja de cálculo
      hoja = (datos[0] | (datos[1] << 8) | (datos[2] << 16)) + datos[3] * 0x1000000;
    }
    if (tipo === 0x00fc) {                                             // SST + CONTINUE
      const partes = [datos];
      let sig = it.next();
      while (!sig.done && sig.value.tipo === 0x003c) {
        partes.push(sig.value.datos);
        sig = it.next();
      }
      const unicas = (datos[4] | (datos[5] << 8) | (datos[6] << 16)) + datos[7] * 0x1000000;
      sst = tablaSst(partes, unicas);
      r = sig;
      continue;
    }
    r = it.next();
  }
  if (hoja === null) throw new Error("el XLS no tiene hojas de cálculo");

  const celdas = new Map<number, Map<number, Celda>>();
  let nfilas = 0;
  let ncols = 0;
  const poner = (fila: number, col: number, v: Celda) => {
    let f = celdas.get(fila);
    if (!f) celdas.set(fila, (f = new Map()));
    f.set(col, v);
    nfilas = Math.max(nfilas, fila + 1);
    ncols = Math.max(ncols, col + 1);
  };
  const u16 = (d: Uint8Array, p: number) => d[p] | (d[p + 1] << 8);
  const ih = registros(w, hoja);
  let primero = true;
  for (let x = ih.next(); !x.done; x = ih.next()) {
    const { tipo, datos: d } = x.value;
    if (primero) {
      primero = false;
      if (tipo !== 0x0809) throw new Error("la hoja no empieza con BOF");
      continue;
    }
    if (tipo === 0x000a) break;
    switch (tipo) {
      case 0x00fd:                                                     // LABELSST
        poner(u16(d, 0), u16(d, 2), sst[(d[6] | (d[7] << 8) | (d[8] << 16) | (d[9] << 24))] ?? "");
        break;
      case 0x0204:                                                     // LABEL
      case 0x00d6:                                                     // RSTRING
        poner(u16(d, 0), u16(d, 2), cadenaUnicode(d, 6));
        break;
      case 0x0203:                                                     // NUMBER
        poner(u16(d, 0), u16(d, 2), f64(d, 6));
        break;
      case 0x027e:                                                     // RK
        poner(u16(d, 0), u16(d, 2), rk(d, 6));
        break;
      case 0x00bd: {                                                   // MULRK
        const fila = u16(d, 0);
        const ultima = u16(d, d.length - 2);
        for (let c = u16(d, 2), p = 4; c <= ultima; c++, p += 6) poner(fila, c, rk(d, p + 2));
        break;
      }
      case 0x0205:                                                     // BOOLERR (bool o error: int)
        poner(u16(d, 0), u16(d, 2), { entero: d[6] });
        break;
      case 0x0006: {                                                   // FORMULA: el resultado guardado
        const fila = u16(d, 0);
        const col = u16(d, 2);
        if (d[12] === 0xff && d[13] === 0xff) {
          if (d[6] === 0) {
            // Texto: viene en el registro STRING siguiente (saltando SHRFMLA / ARRAY / TABLEOP).
            let s = ih.next();
            while (!s.done && [0x04bc, 0x0221, 0x0236].includes(s.value.tipo)) s = ih.next();
            if (s.done || s.value.tipo !== 0x0207) throw new Error("FORMULA de texto sin registro STRING");
            // `string_record_contents` de xlrd: el texto puede seguir en CONTINUE, cada uno con su byte de opciones.
            const total = cadenaUnicodeLargo(s.value.datos);
            let texto = cadenaUnicodeParcial(s.value.datos, 2);
            while (texto.length < total) {
              const c = ih.next();
              if (c.done || c.value.tipo !== 0x003c) throw new Error("STRING sin CONTINUE");
              texto += cadenaUnicodeParcial(c.value.datos, 0);
            }
            poner(fila, col, texto);
          } else if (d[6] === 1 || d[6] === 2) poner(fila, col, { entero: d[8] });
          else if (d[6] === 3) poner(fila, col, "");
          else throw new Error(`FORMULA con resultado especial 0x${d[6].toString(16)}`);
        } else poner(fila, col, f64(d, 6));
        break;
      }
    }
  }
  const filas: Celda[][] = [];
  for (let i = 0; i < nfilas; i++) {
    const f = celdas.get(i);
    const fila: Celda[] = new Array(ncols).fill("");
    if (f) for (const [c, v] of f) fila[c] = v;
    filas.push(fila);
  }
  return { datemode, filas };
}

/** Caracteres que declara un registro STRING. */
function cadenaUnicodeLargo(d: Uint8Array): number {
  return d[0] | (d[1] << 8);
}

/** Desde `pos`: un byte de opciones (bit 0 = UTF-16) y el resto del registro como caracteres. */
function cadenaUnicodeParcial(d: Uint8Array, pos: number): string {
  const opciones = d[pos];
  const resto = d.subarray(pos + 1);
  return opciones & 0x01 ? utf16.decode(resto) : latin1(resto);
}

/** `str(v)` de Python para un valor de xlrd: los números son float ("5.0"); booleanos y errores, int. */
export function textoCelda(v: Celda | undefined, reprFloat: (x: number) => string): string {
  if (v === undefined || v === "") return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return reprFloat(v);
  return String(v.entero);
}

/** `bool(v)` de Python para un valor de xlrd. */
export function verdadCelda(v: Celda | undefined): boolean {
  if (v === undefined || v === "") return false;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return true;
  return v.entero !== 0;
}

/**
 * `xlrd.xldate_as_datetime(v, datemode).date()` → AAAA-MM-DD. Época 1904, o 1899-12-31 antes del día 60
 * y 1899-12-30 después (el error del año bisiesto 1900 de Excel).
 */
export function fechaExcel(v: number, datemode: number): string {
  const epoca = datemode ? Date.UTC(1904, 0, 1) : v < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const dias = Math.trunc(v);
  const ms = Math.round((v - dias) * 86_400_000);
  return new Date(epoca + dias * 86_400_000 + Math.floor(ms / 1000) * 1000).toISOString().slice(0, 10);
}
