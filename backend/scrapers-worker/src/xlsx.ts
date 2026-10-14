/**
 * XLSX con los valores que da openpyxl (`load_workbook(read_only=True, data_only=True)`, hoja activa,
 * `iter_rows(values_only=True)`), leído con SheetJS (con los XLSX de visitas ocupa ~10 MB).
 *
 * Valores: texto → string; número → number (entero si no tiene parte decimal); booleano → boolean;
 * error → su texto ("#N/A"); número con formato de fecha → `FechaHora` (o `Hora` si es < 1, o `Duracion`
 * con formato [h]:mm), como `from_excel` de openpyxl.
 */

import * as XLSX from "xlsx";

export interface FechaHora {
  fechaHora: string;   // AAAA-MM-DD HH:MM:SS[.ffffff], el str() de un datetime
}
export interface Hora {
  hora: string;        // HH:MM:SS[.ffffff], el str() de un time
}
export interface Duracion {
  duracion: string;    // el str() de un timedelta
}
export type ValorXlsx = null | string | number | boolean | FechaHora | Hora | Duracion;

const ERRORES: Record<number, string> = {
  0x00: "#NULL!", 0x07: "#DIV/0!", 0x0f: "#VALUE!", 0x17: "#REF!", 0x1d: "#NAME?", 0x24: "#NUM!", 0x2a: "#N/A", 0x2b: "#GETTING_DATA",
};

// openpyxl/styles/numbers.py: solo la primera sección; sin corchetes que no sean de tiempo, comillas,
// escapes ni rellenos; queda fecha si aparece d, m, h, y o s.
const QUITAR = /\[(?!hh?\]|mm?\]|ss?\])[^\]]*\]|"[^"]*"|\\.|_.|\*./g;
const RE_DURACION = /^(?:\[hh?\](?::mm(?::ss(?:\.0*)?)?)?|\[mm?\](?::ss(?:\.0*)?)?|\[ss?\](?:\.0*)?)/i;

export function esFormatoFecha(fmt: string | undefined): boolean {
  if (!fmt) return false;
  return /[dmhysDMHYS]/.test(fmt.split(";")[0].replace(QUITAR, ""));
}

const dos = (n: number) => String(n).padStart(2, "0");

function horaTexto(ms: number): string {
  const s = Math.floor(ms / 1000);
  const micro = (ms % 1000) * 1000;
  return `${dos(Math.floor(s / 3600))}:${dos(Math.floor(s / 60) % 60)}:${dos(s % 60)}${micro ? `.${String(micro).padStart(6, "0")}` : ""}`;
}

/** `from_excel(valor, epoch)` de openpyxl. */
export function desdeExcel(v: number, fecha1904: boolean, fmt: string): FechaHora | Hora | Duracion {
  if (RE_DURACION.test(fmt.split(";")[0])) {
    const ms = Math.round(v * 86_400_000);
    const dias = Math.floor(ms / 86_400_000);
    const resto = ms - dias * 86_400_000;
    const s = Math.floor(resto / 1000);
    const hms = `${Math.floor(s / 3600)}:${dos(Math.floor(s / 60) % 60)}:${dos(s % 60)}${resto % 1000 ? `.${String((resto % 1000) * 1000).padStart(6, "0")}` : ""}`;
    return { duracion: dias ? `${dias} day${Math.abs(dias) === 1 ? "" : "s"}, ${hms}` : hms };
  }
  const dia = Math.floor(v);
  const fraccion = Math.round((v - dia) * 86_400_000);
  if (v >= 0 && v < 1 && fraccion < 86_400_000) return { hora: horaTexto(fraccion) };
  const epoca = fecha1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(epoca + (dia + (!fecha1904 && v > 0 && v < 60 ? 1 : 0)) * 86_400_000 + fraccion);
  return { fechaHora: `${d.toISOString().slice(0, 10)} ${horaTexto(fraccion % 86_400_000)}` };
}

/** Filas de la hoja activa como en openpyxl (las filas que faltan salen vacías). */
export function leerXlsx(archivo: Uint8Array): ValorXlsx[][] {
  const wb = XLSX.read(archivo, {
    type: "array", dense: true, cellDates: false, cellNF: true, cellText: false, cellStyles: false, cellHTML: false, sheetStubs: false, bookVBA: false,
  });
  // `wb.active` de openpyxl: el activeTab del primer workbookView (SheetJS lo deja en Workbook.WBView).
  const vista = (wb.Workbook as { WBView?: { activeTab?: number | string }[] } | undefined)?.WBView?.[0];
  const nombre = wb.SheetNames[Number(vista?.activeTab ?? 0)] ?? wb.SheetNames[0];
  const hoja = wb.Sheets[nombre] as XLSX.WorkSheet & { "!data"?: (XLSX.CellObject | undefined)[][] };
  const fecha1904 = !!wb.Workbook?.WBProps?.date1904;
  const ref = hoja["!ref"];
  if (!ref) return [];
  const rango = XLSX.utils.decode_range(ref);
  const datos = hoja["!data"] ?? [];
  const out: ValorXlsx[][] = [];
  for (let r = 0; r <= rango.e.r; r++) {
    const fila = datos[r] ?? [];
    const valores: ValorXlsx[] = [];
    for (let c = 0; c < fila.length; c++) valores.push(valor(fila[c], fecha1904));
    while (valores.length && valores[valores.length - 1] === null) valores.pop();
    out.push(valores);
  }
  return out;
}

function valor(celda: XLSX.CellObject | undefined, fecha1904: boolean): ValorXlsx {
  if (!celda || celda.v === undefined || celda.v === null) return null;
  switch (celda.t) {
    case "s":
      return String(celda.v);
    case "b":
      return Boolean(celda.v);
    case "e":
      return ERRORES[celda.v as number] ?? String(celda.w ?? "#ERROR");
    case "n": {
      const v = celda.v as number;
      const fmt = typeof celda.z === "string" ? celda.z : undefined;
      return fmt && esFormatoFecha(fmt) ? desdeExcel(v, fecha1904, fmt) : v;
    }
    case "d":
      return { fechaHora: new Date(celda.v as Date).toISOString().replace("T", " ").slice(0, 19) };
    default:
      return String(celda.v);
  }
}
