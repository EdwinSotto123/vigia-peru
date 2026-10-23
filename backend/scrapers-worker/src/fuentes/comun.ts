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
 * Antes va el precio por ítem (migración 84): rehace precio_item y el cruce `sobreprecio`, que refrescar_cruces() borra.
 * Devuelve cuántos casos cruzados quedaron.
 */
export async function refrescarCasosCruce(env: Env, step: WorkflowStep): Promise<number> {
  const uno = (nombre: string, sql: string) =>
    step.do(nombre, CARGA, () => conDb(env.HYPERDRIVE, async (db) => Number((await db.filas<{ n: number }>(sql))[0]?.n ?? 0)));
  await uno("refrescar_precio_item", "SELECT refrescar_precio_item() AS n");
  await uno("refrescar_contrato_partido", "SELECT refrescar_contrato_partido() AS n");
  await uno("refrescar_cruce_otro_postor", "SELECT refrescar_cruce_otro_postor() AS n");
  // "Ganó recién fundada" como cruce del contrato (migración 118): la brecha entre la fecha de alta en la SUNAT y la
  // buena pro de ese proceso. Va con los otros post-pasos de cruces_proveedor, antes de casos_cruce_base.
  await uno("refrescar_cruce_recien_fundada", "SELECT refrescar_cruce_recien_fundada() AS n");
  // Quita cruces duplicados que algún JOIN de refrescar_cruces multiplica (migración 120), antes de agregarlos a
  // casos_cruce: si no, el mismo "financió al partido" cuenta 3 veces e infla el riesgo y repite el bloque en el dossier.
  await uno("dedup_cruces_proveedor", "SELECT dedup_cruces_proveedor() AS n");
  await uno("refrescar_adjudicado_vigente", "SELECT refrescar_adjudicado_vigente() AS n");
  // Adjudicaciones de 20 veces su valor referencial o con un valor de S/ 1 (migración 102): la web las marca como
  // posible error de carga. ~30 s en producción.
  await uno("refrescar_contratos_dudosos", "SELECT refrescar_contratos_dudosos() AS n");
  const n = await uno("refrescar_casos_cruce_base", "SELECT refrescar_casos_cruce_base() AS n");
  // Empresas (migración 109): sus órdenes por entidad y año (~3 min en producción) y después el resumen con el puntaje de
  // antecedentes, que lee los cruces y los casos recién rehechos.
  await uno("refrescar_empresa_ordenes", "SELECT refrescar_empresa_ordenes() AS n");
  // refrescar_empresas reconstruye empresa_resumen y, al final (migración 117), vuelve a calcular las señales SUNAT de
  // estado (dada de baja, suspendida, no habida); así nunca quedan sin ellas. "Recién fundada" ya llega como cruce del
  // contrato (migración 118), por cruces_proveedor.
  await uno("refrescar_empresas", "SELECT refrescar_empresas() AS n");
  return n;
}
