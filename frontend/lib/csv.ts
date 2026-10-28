/**
 * «Descargar CSV» en el navegador (fase 6 del plan del 2026-10-27): las listas filtrables (`TablaFiltrable`) y la
 * evidencia de una señal (`TablaEvidencia`). Con BOM, para que Excel lo abra con sus tildes; comas como separador y
 * comillas sólo donde hacen falta. Se exporta lo que se ve, nunca más: los nombres ya llegan tapados de la API.
 */

/** El texto del CSV: una fila de títulos y una por registro, en el orden de `cols`. */
export function textoCsv(cols: string[], filas: Record<string, unknown>[]): string {
  const celda = (v: unknown) => {
    const t = v == null ? "" : String(v);
    return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [cols.map(celda).join(","), ...filas.map((f) => cols.map((c) => celda(f[c])).join(","))].join("\r\n");
}

/** Baja el CSV con ese nombre (sin `.csv`, se lo pone). */
export function descargarCsv(cols: string[], filas: Record<string, unknown>[], archivo: string): void {
  if (!filas.length) return;
  const url = URL.createObjectURL(new Blob(["﻿" + textoCsv(cols, filas)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = archivo.endsWith(".csv") ? archivo : `${archivo}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Un nombre de archivo a partir de un título: «Sanciones del Tribunal» → «sanciones-del-tribunal». */
export function nombreArchivo(titulo: string): string {
  return (
    titulo
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "datos"
  );
}
