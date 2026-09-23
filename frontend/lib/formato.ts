/**
 * Formatos que usa toda la interfaz. Vivían en `lib/mock-data.ts`, así que media
 * app importaba del archivo de datos inventados sólo para formatear un monto: el
 * día que alguien borrara los mocks, se rompía el formateo de montos reales.
 */

/** S/ 1.54 mil M, S/ 5.12 M, S/ 840 K, S/ 320. "mil M" y no "B": en español, un billón es un millón de millones. */
export function formatSoles(n: number): string {
  if (n >= 1_000_000_000) return `S/ ${(n / 1_000_000_000).toFixed(2)} mil M`;
  if (n >= 1_000_000) return `S/ ${(n / 1_000_000).toFixed(2)} M`;
  if (n >= 1_000) return `S/ ${(n / 1_000).toFixed(0)} K`;
  return `S/ ${n}`;
}

/** Píldora de severidad. Con los tokens de TEXTO: los tonos base no llegan a 4.5:1 como texto. */
export function severidadColor(s: "alta" | "media" | "baja"): string {
  if (s === "alta") return "text-crimsonTexto bg-crimson-soft border-crimson/20";
  if (s === "media") return "text-amberTexto bg-amber-soft border-amber/20";
  return "text-inkSoft bg-line border-mute/20";
}
