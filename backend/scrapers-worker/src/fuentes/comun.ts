/**
 * Piezas comunes de las fuentes: configuración de pasos de Workflows y fechas en hora de Lima.
 */

import type { WorkflowStepConfig } from "cloudflare:workers";

/** Lecturas (páginas de la PNDA, zonas, comprobación de sha256): idempotentes, con reintentos. */
export const LECTURA: WorkflowStepConfig = { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "5 minutes" };
/** Descarga de un archivo a R2 (hasta ~450 MB). */
export const DESCARGA: WorkflowStepConfig = { retries: { limit: 2, delay: "1 minute", backoff: "exponential" }, timeout: "30 minutes" };
/** Escrituras en la base: cada carga es idempotente (upsert, o reemplazo por clave dentro de una transacción). */
export const CARGA: WorkflowStepConfig = { retries: { limit: 1, delay: "1 minute" }, timeout: "30 minutes" };

const LIMA_MS = -5 * 3600 * 1000;   // Perú no tiene horario de verano

/** AAAA-MM-DD de hoy en Lima (lo que da `date.today()` en un host peruano). */
export function fechaLima(ms: number = Date.now()): string {
  return new Date(ms + LIMA_MS).toISOString().slice(0, 10);
}

export function sumarDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
