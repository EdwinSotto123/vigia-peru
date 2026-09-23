"use client";

/**
 * Datos personales dentro de una señal, en vidrio esmerilado.
 *
 * La evidencia y las citas las escribe un agente leyendo el expediente, y ahí
 * aparecen personas privadas: el proveedor cuando es persona natural ("el
 * adjudicatario ABEL CARPIO COBOS"), socios con su DNI al lado. La lista y el
 * panel de /app/hallazgos son server components y no pueden llamar a
 * `redactDnis` (vive en un módulo "use client": llamada desde el servidor,
 * revienta en producción), así que el texto cruza hasta acá como dato plano y
 * se redacta de este lado.
 *
 * `setRedactNames` es un registro global del módulo Redact, pensado para el
 * dossier. Se fija y se usa en el mismo render, sin nada asíncrono en medio, así
 * que cada bloque redacta con SUS nombres aunque haya veinte filas en la página.
 */

import { PersonName, redactDnis, setRedactNames } from "@/components/Redact";
import type { PersonaPrivada } from "@/lib/revision";

export function TextoProtegido({ texto, nombres }: { texto: string; nombres: PersonaPrivada[] }) {
  setRedactNames(nombres);
  return <>{redactDnis(texto)}</>;
}

/** El proveedor: una empresa se nombra tal cual; una persona natural, con el apellido materno tapado. */
export function ProveedorProtegido({ nombre, ruc }: { nombre: string; ruc: string | null }) {
  const personaNatural = !!ruc && /^10\d{9}$/.test(ruc.trim());
  if (!personaNatural) return <>{nombre}</>;
  return <PersonName name={nombre} orden="sunat" />;
}
