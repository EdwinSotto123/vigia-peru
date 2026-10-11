/**
 * Saneado de datos personales EN EL SERVIDOR, antes de que una respuesta pública salga de la API.
 * El enmascarado de la pantalla (components/Redact.tsx) es solo visual: el dato igual viaja al
 * navegador. Esto lo corta de raíz:
 *   · claves de documento de identidad (`dni`, `numero_documento`, …): el valor se enmascara a
 *     `12****78` (mantiene la forma para que la pantalla y las comparaciones sigan funcionando);
 *   · texto libre: un número de 8 dígitos precedido de DNI / documento se enmascara igual, y los
 *     correos se reducen a `a***@dominio`.
 * El RUC (11 dígitos) no se toca: es dato público de la empresa (los RUC 10… de persona natural son
 * una decisión de producto aparte).
 */

const CLAVES_DOCUMENTO = /^(dni|dni_persona_natural|numero_documento|num_documento|nro_documento|documento_identidad|doc_identidad)$/i;
const DNI_CON_ETIQUETA = /(\b(?:d\.?\s?n\.?\s?i\.?|documento(?:\s+de\s+identidad)?|c\.?e\.?)\b[^\d\n]{0,14})(\d{8})\b/gi;
const CORREO = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;

export function enmascararDni(v: string): string {
  const d = v.replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 2)}****${d.slice(6)}` : "****";
}

export function limpiarTexto(s: string): string {
  return s.replace(DNI_CON_ETIQUETA, (_m, pre: string, dni: string) => `${pre}${enmascararDni(dni)}`)
    .replace(CORREO, (_m, ini: string, dom: string) => `${ini}***@${dom}`);
}

/** Copia profunda del JSON con los datos personales enmascarados. No muta la entrada. */
export function limpiarPersonales<T>(valor: T, profundidad = 0): T {
  if (profundidad > 40 || valor == null) return valor;
  if (typeof valor === "string") return limpiarTexto(valor) as unknown as T;
  if (Array.isArray(valor)) return valor.map((x) => limpiarPersonales(x, profundidad + 1)) as unknown as T;
  if (typeof valor === "object") {
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      salida[k] = CLAVES_DOCUMENTO.test(k) && (typeof v === "string" || typeof v === "number")
        ? enmascararDni(String(v))
        : limpiarPersonales(v, profundidad + 1);
    }
    return salida as T;
  }
  return valor;
}
