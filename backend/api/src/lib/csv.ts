/**
 * Filas de una lista (las mismas que ve la web, ya pasadas por publicar()) en CSV para descargar: con BOM (Excel lo abre
 * con tildes), una columna por dato y los objetos anidados aplanados («empresa_nombre», «empresa_ruc»); las listas, unidas
 * con «; ». Una celda que empieza con = + - @ (o tabulador) se antepone con un apóstrofo: así una hoja de cálculo no la
 * ejecuta como fórmula (un motivo de visita o un nombre vienen de registros que escribe cualquiera).
 */

type Valor = string | number | boolean | null | undefined;

/** Una celda segura: sin fórmula y entre comillas si lleva coma, comilla o salto. */
export function celdaCsv(v: Valor): string {
  if (v == null) return "";
  let s = typeof v === "boolean" ? (v ? "sí" : "no") : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Una fila aplanada: {empresa: {ruc, nombre}} → {empresa_ruc, empresa_nombre}; arreglos de textos o números, unidos. */
export function aplanar(fila: Record<string, unknown>, prefijo = ""): Record<string, Valor> {
  const out: Record<string, Valor> = {};
  for (const [k, v] of Object.entries(fila)) {
    const clave = prefijo ? `${prefijo}_${k}` : k;
    if (v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[clave] = v as Valor;
    else if (Array.isArray(v)) out[clave] = v.map((x) => (x != null && typeof x === "object" ? JSON.stringify(x) : String(x))).join("; ");
    else if (typeof v === "object") Object.assign(out, aplanar(v as Record<string, unknown>, clave));
  }
  return out;
}

/** El CSV de unas filas; las columnas, en el orden en que aparecen, sin las que se listan en `sin`. */
export function filasACsv(filas: Record<string, unknown>[], sin: string[] = []): string {
  const planas = filas.map((f) => aplanar(f));
  const columnas: string[] = [];
  for (const f of planas) for (const k of Object.keys(f)) if (!columnas.includes(k) && !sin.includes(k)) columnas.push(k);
  const lineas = [columnas.map(celdaCsv).join(","), ...planas.map((f) => columnas.map((k) => celdaCsv(f[k])).join(","))];
  return `﻿${lineas.join("\r\n")}\r\n`;
}
