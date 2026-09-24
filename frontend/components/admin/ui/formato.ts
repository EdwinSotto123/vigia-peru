/**
 * Formatos del panel que no estaban en lib/admin.ts: números que pueden venir
 * como string (bigint de Postgres), tiempo relativo, fechas con año cuando no es
 * el año en curso y bytes. Todos devuelven `null` si no hay dato, para que la
 * página decida cómo decir "sin dato" en vez de pintar un 0 o un hueco.
 */

/** 13445 · "13445" → "13 445"; null/"" /NaN → null. */
export function fmtNum(n: number | string | null | undefined): string | null {
  if (n === null || n === undefined || n === "") return null;
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString("es-PE") : null;
}

/** "hace 3 h", "hace 5 días". Sin fecha → null. */
export function hace(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const min = (Date.now() - t) / 60_000;
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${Math.round(min)} min`;
  const h = min / 60;
  if (h < 48) return `hace ${Math.round(h)} h`;
  const d = h / 24;
  if (d < 60) return `hace ${Math.round(d)} días`;
  return `hace ${Math.round(d / 30)} meses`;
}

/** "17 sep" este año, "17 sep 2029" si es otro: una fecha sin año nunca debe parecer cercana. */
export function fmtDia(iso: string | Date | null | undefined): string | null {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const otroAnio = d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleDateString("es-PE", { day: "numeric", month: "short", ...(otroAnio ? { year: "numeric" } : {}) });
}

/** "17 sep, 01:11" (con año si no es el actual). */
export function fmtFechaHora(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const otroAnio = d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleString("es-PE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", ...(otroAnio ? { year: "numeric" } : {}) });
}

/** 139481359493 → "139,5 GB"; 47267840 → "47,3 MB". */
export function fmtBytes(b: number | string | null | undefined): string | null {
  const v = Number(b);
  if (b === null || b === undefined || !Number.isFinite(v)) return null;
  if (v >= 1e9) return `${(v / 1e9).toLocaleString("es-PE", { maximumFractionDigits: 1 })} GB`;
  if (v >= 1e6) return `${(v / 1e6).toLocaleString("es-PE", { maximumFractionDigits: 1 })} MB`;
  return `${Math.round(v / 1e3).toLocaleString("es-PE")} KB`;
}

/** "1 contrato", "3 contratos", "13 445 contratos": el número con la palabra que le toca. */
export const plural = (n: number | string, singular: string, varios: string) =>
  `${fmtNum(n) ?? "0"} ${Number(n) === 1 ? singular : varios}`;

/** Porcentaje entero de a sobre b (0 si b es 0). */
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** "sancion_vigente_osce" → "Sancion vigente osce": último recurso para un código sin etiqueta propia. */
export function humanizar(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.replace(/[_-]+/g, " ").trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
}
