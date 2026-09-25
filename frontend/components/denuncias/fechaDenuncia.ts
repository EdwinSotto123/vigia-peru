import { fecha, fechaCorta, hoyLima } from "@/lib/formato";

/**
 * Cuándo se reportó una denuncia. La columna es DATE y el backend la serializa
 * como medianoche UTC ("2026-04-12T00:00:00.000Z"), que en Lima cae el día
 * ANTERIOR: se toma sólo la fecha (AAAA-MM-DD) y se lee como día de Lima.
 *
 * Lo usaban a mano la grilla y la ficha, cada una con su propia cuenta de días.
 */

/** "2026-04-12" o null si no hay una fecha legible. */
export function diaDeDenuncia(v: string | null | undefined): string | null {
  const ymd = String(v ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

/** Días enteros entre el día de la denuncia y hoy en Lima (nunca negativo). */
function diasDesde(ymd: string): number {
  const ms = Date.parse(`${hoyLima()}T12:00:00-05:00`) - Date.parse(`${ymd}T12:00:00-05:00`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/**
 * Relativo sólo para lo reciente (DESIGN_SYSTEM.md §10.3): "hoy", "ayer",
 * "hace 3 días"; desde la semana, la fecha corta ("12 abr.").
 */
export function haceCuantoSeReporto(v: string | null | undefined): string | null {
  const ymd = diaDeDenuncia(v);
  if (!ymd) return null;
  const dias = diasDesde(ymd);
  if (dias === 0) return "hoy";
  if (dias === 1) return "ayer";
  if (dias < 7) return `hace ${dias} días`;
  return fechaCorta(ymd);
}

/** "12 de abril de 2026", o null sin fecha. */
export function fechaDeDenuncia(v: string | null | undefined): string | null {
  const ymd = diaDeDenuncia(v);
  return ymd ? fecha(ymd) : null;
}
