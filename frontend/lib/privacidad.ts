/**
 * Datos personales: lo que manda la API y cómo leerlo (docs/PRIVACIDAD.md).
 *
 * Desde 2026-10-13 la API pública tapa los datos personales ANTES de mandarlos
 * (backend/api/src/lib/privacidad.ts). Lo tapado llega así:
 *   · DNI en un campo        → `ref·7K2Q9A`  (referencia opaca: la misma persona, la misma ref
 *                                            en todo Vigía; no se puede volver al DNI)
 *   · RUC 10 en un campo     → `10·ref·7K2Q9A` (la ref de su DNI)
 *   · DNI suelto en un texto → `••••••••`
 *   · un apellido            → `•••`  ("JOSE MANUEL SARA •••", "CARPIO ••• ABEL")
 *   · un celular             → `9••••••••`
 * El panel admin recibe los datos completos y la pantalla los muestra en vidrio, revelables al clic
 * (components/Redact.tsx). Este módulo no es "use client": lo usan también los Server Components.
 */

// DNI peruano = 8 dígitos. \b…\b evita matchear dentro de un RUC (11) u otros números largos.
const DNI_RE = /\b\d{8}\b/g;

/** Las marcas que pone la API. */
export const TAPA_NOMBRE = "•••";
export const TAPA_DNI = "••••••••";
export const TAPA_RUC10 = "10•••••••••";

/** `ref·XXXXXX` o `10·ref·XXXXXX`: una referencia opaca que puso la API. */
export const REF_RE = /(?:10·)?ref·[0-9A-Z]{6}/;
export const esRef = (v: unknown): boolean => typeof v === "string" && /^(?:10·)?ref·[0-9A-Z]{6}$/.test(v.trim());

/** ¿Lleva algo tapado por la API? (una ref, bullets de DNI o de apellido). */
export const estaTapado = (v: unknown): boolean => typeof v === "string" && (v.includes("•") || REF_RE.test(v));

/**
 * Un RUC que empieza con 10 es de una persona natural con negocio: sus dígitos 3 a 10 son su DNI.
 * Llega en claro al panel admin y como `10·ref·…` al público.
 */
export const esRucPersonaNatural = (ruc?: string | number | null): boolean =>
  ruc != null && /^10(?:\d{9}|·ref·[0-9A-Z]{6})$/.test(String(ruc).trim());

/** Un RUC que se puede usar para buscar o enlazar (11 dígitos en claro): no uno tapado. */
export const esRucEnClaro = (ruc?: string | number | null): boolean => ruc != null && /^\d{11}$/.test(String(ruc).trim());

/** Para mostrar un RUC: el de persona natural tapado (el de una empresa, tal cual). */
export function rucVisible(ruc?: string | number | null): string {
  const v = ruc == null ? "" : String(ruc).trim();
  if (!v) return "";
  return esRucPersonaNatural(v) ? TAPA_RUC10 : v;
}

/**
 * Enmascarado de datos personales en texto plano, sin interacción (§10.6): etiquetas del grafo
 * (canvas), textos para copiar, server components. Dentro de un enlace o de una fila clickeable no
 * cabe el vidrio revelable (un botón dentro de un <a>), así que ahí el DNI va tapado sin más.
 *
 *   "Juan 12345678, RUC 10123456789"   → "Juan ••••••••, RUC 10•••••••••"
 *   "DNI ref·7K2Q9A, RUC 10·ref·7K2Q9A" → "DNI ••••••••, RUC 10•••••••••"
 */
export function maskDnis(text?: string | null): string {
  return (text || "")
    .replace(/\b10\d{9}\b/g, TAPA_RUC10)
    .replace(/10·ref·[0-9A-Z]{6}/g, TAPA_RUC10)
    .replace(/ref·[0-9A-Z]{6}/g, TAPA_DNI)
    .replace(DNI_RE, TAPA_DNI);
}
