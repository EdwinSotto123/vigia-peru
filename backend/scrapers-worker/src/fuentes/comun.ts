/**
 * Piezas comunes de las fuentes: configuración de pasos de Workflows y fechas en hora de Lima.
 */

import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import type { Env } from "../config.ts";
import { conDb } from "../db.ts";
import { registrar } from "../registro.ts";

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
  // Un cruce de una migración que puede no estar aplicada todavía en esta base (DEV va antes que PROD): sin su función se
  // salta con un aviso en vez de cortar la cadena entera (casos_cruce, empresas y poder van después).
  const siExiste = (nombre: string) =>
    step.do(nombre, CARGA, () => conDb(env.HYPERDRIVE, async (db) => {
      const [{ existe }] = await db.filas<{ existe: boolean }>("SELECT to_regprocedure($1) IS NOT NULL AS existe", [`${nombre}()`]);
      if (!existe) {
        registrar("WARNING", `   ${nombre}() no existe en esta base: se salta`, { fuente: "cruces" });
        return 0;
      }
      return Number((await db.filas<{ n: number }>(`SELECT ${nombre}() AS n`))[0]?.n ?? 0);
    }));
  await uno("refrescar_precio_item", "SELECT refrescar_precio_item() AS n");
  await uno("refrescar_contrato_partido", "SELECT refrescar_contrato_partido() AS n");
  await uno("refrescar_cruce_otro_postor", "SELECT refrescar_cruce_otro_postor() AS n");
  // "Ganó recién fundada" como cruce del contrato (migración 118): la brecha entre la fecha de alta en la SUNAT y la
  // buena pro de ese proceso. Va con los otros post-pasos de cruces_proveedor, antes de casos_cruce_base.
  await uno("refrescar_cruce_recien_fundada", "SELECT refrescar_cruce_recien_fundada() AS n");
  // Dos cruces del contrato de la migración 122: "único postor" (el proceso tuvo un solo postor, OCDS) y "socio del
  // proveedor contratado por la entidad" (puerta giratoria, RNP × persona_entidad). Van con los otros post-pasos.
  await uno("refrescar_cruce_unico_postor", "SELECT refrescar_cruce_unico_postor() AS n");
  await uno("refrescar_cruce_socio_en_entidad", "SELECT refrescar_cruce_socio_en_entidad() AS n");
  // Dos cruces más de la migración 123: mismo domicilio fiscal que otro postor, y proveedor cautivo de una entidad.
  await uno("refrescar_cruce_domicilio_compartido", "SELECT refrescar_cruce_domicilio_compartido() AS n");
  await uno("refrescar_cruce_proveedor_cautivo", "SELECT refrescar_cruce_proveedor_cautivo() AS n");
  // Un funcionario declaró en su DJI acciones, un poder, un directorio o un empleo en la empresa que le ganó a su entidad
  // (migración 170; las secciones 1 a 6 las carga backend/scripts/procesar_dji_intereses.py desde la PC).
  await siExiste("refrescar_cruce_interes_dji");
  // La empresa que ganó mientras su empresa hermana (comparten socio o representante) estaba inhabilitada, y cada proceso
  // de CONOSCE ya juntado para la pestaña «Postulaciones» de las empresas (migración 184).
  await siExiste("refrescar_cruce_empresa_espejo");
  await siExiste("refrescar_proceso_resumen");
  // La obra de INFOBRAS que ejecuta o supervisa cada contrato y la inversión de su CUI (migración 160): sus banderas
  // (paralizada, atrasada, adicionales, sobrecosto…) como cruces del contrato. Antes lee el CUI de los procesos nuevos.
  // Las obras y las inversiones las carga backend/scripts/cargar_obras.py desde la PC (la Contraloría no responde afuera).
  await siExiste("refrescar_cruce_obras");
  // «Visitó la entidad antes de ganar» reconociendo a la entidad por todos sus nombres (migración 174): rehace el tipo que
  // refrescar_cruces() deja con la regla vieja (el nombre letra por letra: 46 cruces en todo el país).
  await siExiste("refrescar_cruce_visita_previa");
  // Redes y conflictos (migración 189): el familiar declarado de un funcionario, socio del ganador; y los postores
  // vinculados (una persona o el domicilio) que compiten juntos y se reparten las buenas pro.
  await siExiste("refrescar_cruce_pariente_funcionario");
  await siExiste("refrescar_cruce_turno_postores");
  // Quita cruces duplicados que algún JOIN de refrescar_cruces multiplica (migración 120), antes de agregarlos a
  // casos_cruce: si no, el mismo "financió al partido" cuenta 3 veces e infla el riesgo y repite el bloque en el dossier.
  await uno("dedup_cruces_proveedor", "SELECT dedup_cruces_proveedor() AS n");
  await uno("refrescar_adjudicado_vigente", "SELECT refrescar_adjudicado_vigente() AS n");
  // Adjudicaciones de 20 veces su valor referencial o con un valor de S/ 1 (migración 102): la web las marca como
  // posible error de carga. ~30 s en producción.
  await uno("refrescar_contratos_dudosos", "SELECT refrescar_contratos_dudosos() AS n");
  const n = await uno("refrescar_casos_cruce_base", "SELECT refrescar_casos_cruce_base() AS n");
  // Cuántos contratos con antecedentes tiene cada entidad, para su lista (migración 175): sale de casos_cruce recién hecho.
  await siExiste("refrescar_entidad_antecedentes");
  // Empresas (migración 109): sus órdenes por entidad y año (~3 min en producción) y después el resumen con el puntaje de
  // antecedentes, que lee los cruces y los casos recién rehechos.
  await uno("refrescar_empresa_ordenes", "SELECT refrescar_empresa_ordenes() AS n");
  // Las empresas con la mitad o más de las órdenes de una entidad al borde del tope (migración 207): la franja de montos
  // por su índice parcial y el denominador de empresa_orden_anual, recién rehecha. ~2 min en producción.
  await siExiste("refrescar_borde_empresas");
  // refrescar_empresas reconstruye empresa_resumen y, al final (migración 117), vuelve a calcular las señales SUNAT de
  // estado (dada de baja, suspendida, no habida); así nunca quedan sin ellas. "Recién fundada" ya llega como cruce del
  // contrato (migración 118), por cruces_proveedor.
  await uno("refrescar_empresas", "SELECT refrescar_empresas() AS n");
  // Las empresas cuya gente (socio, representante, directivo o quien dijo venir de ella) visitó cada entidad y lo que la
  // entidad les dio después (migración 203): lee las visitas que refrescar_empresas acaba de atribuir y las órdenes y
  // contratos del día. ~4 min en producción.
  await siExiste("refrescar_visita_empresa");
  // Mapa de poder (migración 125): captura por partido/entidad. Lee casos_cruce + entidad_gobierno_amplia + jne, ya listos.
  await uno("refrescar_poder", "SELECT refrescar_poder() AS n");
  return n;
}
