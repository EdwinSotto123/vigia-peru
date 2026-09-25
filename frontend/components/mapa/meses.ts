/**
 * Meses de convocatoria, en hora de Lima. Módulo puro (sin "use client"): lo usan
 * el filtro de mes del mapa (cliente) y la barra de filtros de /app/contratos, que
 * arma sus opciones en el servidor.
 */

export interface RangoMes { desde: string; hasta: string; etiqueta: string }

const NOMBRES_MES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre",
];

/**
 * Año y mes de `fecha` EN LIMA. Los contratos se fechan en hora peruana, y el filtro
 * del mapa se renderiza dos veces: en el servidor (UTC) y en el navegador. Con
 * `getMonth()` a secas, entre las 19:00 y la medianoche del último día del mes el
 * servidor ya estaba en el mes siguiente y el navegador no: dos listas distintas y
 * un error de hidratación. Con la zona fija, las dos coinciden.
 */
function anioMesEnLima(fecha: Date): { y: number; m: number } {
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: "America/Lima", year: "numeric", month: "numeric" }).formatToParts(fecha);
  const y = Number(partes.find((p) => p.type === "year")?.value);
  const m = Number(partes.find((p) => p.type === "month")?.value) - 1;
  return Number.isFinite(y) && Number.isFinite(m) ? { y, m } : { y: fecha.getUTCFullYear(), m: fecha.getUTCMonth() };
}

/** "2026-08" → "agosto 2026". Lo que no es un mes se devuelve tal cual. */
export function etiquetaMes(mes: string): string {
  const m = mes.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  return m ? `${NOMBRES_MES[Number(m[2]) - 1]} ${m[1]}` : mes;
}

/** Últimos `n` meses (el actual primero, en hora de Lima), como rango [primer día, último día]. */
export function ultimosMeses(n = 12, hoy = new Date()): RangoMes[] {
  const { y: y0, m: m0 } = anioMesEnLima(hoy);
  const out: RangoMes[] = [];
  const pad = (x: number) => String(x).padStart(2, "0");
  for (let i = 0; i < n; i++) {
    const total = y0 * 12 + m0 - i;
    const y = Math.floor(total / 12);
    const m = total % 12;
    // Día 0 del mes siguiente = último día de este. En UTC, para no depender de la zona del proceso.
    const ultimoDia = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    out.push({
      desde: `${y}-${pad(m + 1)}-01`,
      hasta: `${y}-${pad(m + 1)}-${pad(ultimoDia)}`,
      etiqueta: `${NOMBRES_MES[m]} ${y}`,
    });
  }
  return out;
}
