/**
 * Presupuesto del MEF: tipos y utilidades. El dato lo carga el scraper `mef_presupuesto` desde el archivo
 * oficial `<año>-Gasto-Diario.zip` (dataset presupuesto-y-ejecucion-de-gasto, semanal) y lo sirve la API de
 * Vigía: región en GET /mef/region/:dept, entidad en GET /entidades/:ruc (`mef`). Ver lib/mef-cache.ts.
 *
 * Antes este archivo consultaba al portal del MEF en vivo (`datastore_search_sql` sobre el recurso
 * comparativo_gastos_2022_2026). En octubre de 2026 el MEF quitó ese endpoint y vació el recurso.
 */

export interface MefBudgetRow {
  year: number;
  pia: number;
  pim: number;
  certificado: number;
  comprometido: number;
  devengado: number;
  girado: number;
}

export interface MefBudgetSummary {
  query: string;
  /** Las unidades ejecutoras del MEF que se cruzaron con la entidad. */
  matchedPliegos: string[];
  totalRows: number;
  byYear: MefBudgetRow[];
  /** Fecha del archivo del MEF (ISO). `null` si no se registró. */
  fechaDescarga?: string | null;
}

export type MefBudgetResult =
  | { kind: "ok"; data: MefBudgetSummary }
  | { kind: "empty"; query: string }   // la entidad no cruzó con ninguna unidad ejecutora del MEF
  | { kind: "error"; query: string; message: string };

export interface BreakdownRow {
  nombre: string;
  pim: number;
  devengado: number;
  pia: number;
  ejecPct: number;
}

export interface RegionBudgetSummary {
  department: string;
  totalRows: number;
  byYear: MefBudgetRow[];
  topSectores: BreakdownRow[];
  topPliegos: BreakdownRow[];
  topProgramas: BreakdownRow[];
  topGenericas?: BreakdownRow[];
  /** Fecha del archivo del MEF (ISO). `null` si no se registró. */
  fechaDescarga?: string | null;
}

/**
 * % de ejecución del año = Devengado / PIM × 100.
 * Si PIM=0 devuelve 0.
 */
export function ejecucionPct(row: MefBudgetRow): number {
  if (row.pim === 0) return 0;
  return (row.devengado / row.pim) * 100;
}

/**
 * Formatea soles compactos (S/ 4.25 M, S/ 6.89 mil M). "mil M" y no "B": en
 * español un billón es un millón de millones, así que "S/ 6.89 B" leía mil
 * veces más de lo que es.
 */
export function formatPEN(v: number): string {
  if (!v) return "S/ 0";
  if (v >= 1_000_000_000) return `S/ ${(v / 1_000_000_000).toFixed(2)} mil M`;
  if (v >= 1_000_000) return `S/ ${(v / 1_000_000).toFixed(2)} M`;
  if (v >= 1_000) return `S/ ${(v / 1_000).toFixed(0)} mil`;
  return `S/ ${v.toLocaleString("es-PE")}`;
}

/**
 * Detecta el año que el MEF todavía no publica y la copia rellenó con el
 * anterior: PIA, PIM, devengado y girado idénticos al centavo al año previo.
 *
 * Medido el 2026-09-23 en `public/mef-budget.json` y `public/mef-entities.json`:
 * en los 25 departamentos y las 25 entidades, 2026 repite 2025. Mostrado tal
 * cual, el panel decía "EJERCICIO 2026 EN CURSO… Devengado 96% contra 73% del
 * año", que era el cierre de 2025 presentado como el año en curso. Con el dato
 * nuevo de la API no pasa, pero el JSON estático de respaldo sigue así.
 *
 * Devuelve los años sin el repetido y cuál se quitó (o `null`).
 */
export function sinAnioRepetido(byYear: MefBudgetRow[]): { years: MefBudgetRow[]; repetido: number | null } {
  if (byYear.length < 2) return { years: byYear, repetido: null };
  const ult = byYear[byYear.length - 1];
  const ant = byYear[byYear.length - 2];
  const igual =
    ult.pim > 0 && ult.pia === ant.pia && ult.pim === ant.pim && ult.devengado === ant.devengado && ult.girado === ant.girado;
  return igual ? { years: byYear.slice(0, -1), repetido: ult.year } : { years: byYear, repetido: null };
}

/** "16 may. 2026" en hora de Lima, o `null` si no hay fecha válida. */
export function fechaCorta(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Lima" });
}
