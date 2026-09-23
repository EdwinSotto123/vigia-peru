"use client";

/**
 * La evidencia de una señal con los DNI tras vidrio esmerilado (revelables al clic).
 * Existe porque `redactDnis` vive en un módulo de cliente (components/Redact) y
 * ResultadoAnalisis también se renderiza desde server components, que no pueden llamarla:
 * así el server component pasa un string y la redacción ocurre de este lado.
 */

import { redactDnis } from "@/components/Redact";

export function EvidenciaRedactada({ texto }: { texto: string }) {
  return <>{redactDnis(texto)}</>;
}
