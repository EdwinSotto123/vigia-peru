/**
 * Piezas comunes de las fuentes: configuración de pasos de Workflows y fechas en hora de Lima.
 */

import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import type { Env } from "../config.ts";
import { conDb } from "../db.ts";

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

/**
 * Lo que hacía `refrescar_casos_cruce()` en una sola sentencia, en cuatro pasos: con la historia del OECE en la base
 * la cadena tardaba ~21 min y Hyperdrive corta una sentencia a los ~10. Cada paso es su propia sentencia (contrato ↔
 * partido ~3,5 min, otro postor ~40 s con la migración 77, adjudicado vigente ~1,5 min, casos cruzados ~2,5 min).
 * Devuelve cuántos casos cruzados quedaron.
 */
export async function refrescarCasosCruce(env: Env, step: WorkflowStep): Promise<number> {
  const uno = (nombre: string, sql: string) =>
    step.do(nombre, CARGA, () => conDb(env.HYPERDRIVE, async (db) => Number((await db.filas<{ n: number }>(sql))[0]?.n ?? 0)));
  await uno("refrescar_contrato_partido", "SELECT refrescar_contrato_partido() AS n");
  await uno("refrescar_cruce_otro_postor", "SELECT refrescar_cruce_otro_postor() AS n");
  await uno("refrescar_adjudicado_vigente", "SELECT refrescar_adjudicado_vigente() AS n");
  return uno("refrescar_casos_cruce_base", "SELECT refrescar_casos_cruce_base() AS n");
}
