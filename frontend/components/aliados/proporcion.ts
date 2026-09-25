/**
 * Proporciones y colores de las partes de una lectura, compartidos por el ranking y el
 * perfil de un aliado (DESIGN_SYSTEM.md §14.1 y §14.6).
 */

/**
 * Los tres destinos de un contrato leído. "En revisión" es un estado, no una severidad:
 * va en neutro, no en ámbar (que es "Señal media").
 */
export const PARTES_LECTURA = {
  senal: "bg-rust",
  revision: "bg-mute/50",
  limpio: "bg-moss",
} as const;

/**
 * Proporción legible. Sin redondear a "0 %" lo que no es cero: bajo 1 % se muestran dos
 * decimales. Sin denominador no hay proporción: devuelve null y no se dibuja nada (nunca
 * un guion mudo).
 */
export function pctProporcion(v: number, total: number): string | null {
  if (!total) return null;
  const p = (v / total) * 100;
  const dec = p >= 10 ? 0 : p >= 1 ? 1 : 2;
  // El locale decide: es-PE usa coma de miles y punto decimal ("18,394" y "0.18 %").
  return `${p.toLocaleString("es-PE", { minimumFractionDigits: dec, maximumFractionDigits: dec })} %`;
}
