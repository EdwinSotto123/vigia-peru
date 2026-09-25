/**
 * Enmascarado de datos personales en texto plano, sin interacción (§10.6).
 *
 * Vive fuera de `components/Redact.tsx` (que es "use client") para que un Server
 * Component pueda usarlo: dentro de un enlace o de una fila clickeable no cabe el
 * vidrio revelable (un botón dentro de un <a>), así que ahí el DNI va tapado sin más.
 */

// DNI peruano = 8 dígitos. \b…\b evita matchear dentro de un RUC (11) u otros números largos.
const DNI_RE = /\b\d{8}\b/g;

/** "Juan 12345678, RUC 10123456789" → "Juan ••••••••, RUC 10•••••••••" */
export function maskDnis(text?: string | null): string {
  return (text || "").replace(/\b10\d{9}\b/g, "10•••••••••").replace(DNI_RE, "••••••••");
}
