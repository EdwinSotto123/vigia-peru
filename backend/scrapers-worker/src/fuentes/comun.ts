/**
 * Piezas comunes de las fuentes: configuración de pasos de Workflows y fechas en hora de Lima.
 */

import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import type { Env } from "../config.ts";
import { conDb, type Db } from "../db.ts";
import { saludLima } from "../http.ts";
import { registrar } from "../registro.ts";

/** Cuántas veces se mira, cada 30 min, si volvió el relay de Lima antes de rendirse: 24 = 12 h. */
const VUELTAS_RELAY_LIMA = 24;

/**
 * Antes de una fuente que sólo llega por el relay de Lima (la Contraloría, INFOBRAS, SERVIR): que el relay responda. La
 * salida peruana es tu PC (backend/scrapers-pc/salida_peru), que puede estar apagada a las 08:00: en vez de fallar, la
 * corrida espera y vuelve a mirar cada 30 min, hasta 12 h. Devuelve quién atendió («pc» o «aws-lima»).
 */
export async function esperarRelayLima(env: Env, step: WorkflowStep, fuente: string): Promise<string> {
  for (let i = 1; i <= VUELTAS_RELAY_LIMA; i++) {
    const quien = await step.do(`relay de Lima: ¿responde? (${i})`, { retries: { limit: 1, delay: "10 seconds" }, timeout: "1 minute" },
      async () => (await saludLima(env))?.nombre ?? null);
    if (quien) {
      if (i > 1) registrar("INFO", `   el relay de Lima volvió (${quien}) tras ${i - 1} esperas de 30 min`, { fuente });
      return quien;
    }
    registrar("WARNING", `   el relay de Lima no responde (${i}/${VUELTAS_RELAY_LIMA}): espero 30 min`, { fuente });
    if (i < VUELTAS_RELAY_LIMA) await step.sleep(`esperar al relay de Lima (${i})`, "30 minutes");
  }
  throw new Error("el relay de Lima no respondió en 12 horas: ¿la PC (backend/scrapers-pc/salida_peru) estuvo apagada todo el día?");
}

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

/**
 * Los agregados de la pestaña Visitas (migración 222) sólo de las entidades con estos nombres de registro: rehacer las ~450
 * tarda 24-30 min con las 10,8 M visitas y Hyperdrive lo corta. En una base sin la 222, los de todas, como antes.
 */
export async function refrescarVisitasDe(db: Db, nombres: string[]): Promise<number | null> {
  const [f] = await db.filas<{ porRuc: boolean; todas: boolean }>(
    `SELECT to_regprocedure('refrescar_visitas_entidad(text[])') IS NOT NULL AS "porRuc",
            to_regprocedure('refrescar_visitas_entidad()') IS NOT NULL AS todas`);
  if (f.porRuc) {
    const [{ n }] = await db.filas<{ n: number | null }>(
      "SELECT refrescar_visitas_entidad(array_agg(DISTINCT ruc)) AS n FROM visita_entidad_ruc WHERE entidad_visitada = ANY($1::text[])", [nombres]);
    return Number(n ?? 0);
  }
  return f.todas ? Number((await db.filas<{ n: number }>("SELECT refrescar_visitas_entidad() AS n"))[0]?.n ?? 0) : null;
}

/** Ids de visita por paso al atribuirlas a empresas: ~45 s en producción, lejos del corte de la conexión. */
const TRAMO_VISITAS = 1_000_000;

/** Partes (por empresa) de refrescar_visita_empresa: ~90 s cada una en producción (migración 243). */
const PARTES_VISITA_EMPRESA = 6;

/**
 * Qué empresa está detrás de cada visita (migración 241): la de su gente por el DNI o la de quien dijo venir de ella.
 * Antes lo rehacía refrescar_empresas cada día, y con los 12 M de visitas nacionales pasó de ~5 a 10-26 min: la conexión
 * lo cortaba y oece_ocds falló todos los días del 28-10 al 03-11. Ahora va después de cada carga de visitas, en un paso
 * para preparar, uno por cada tramo de ids y uno para cerrar. En una base sin la 241, no hace nada (lo sigue haciendo
 * refrescar_empresas).
 */
export async function refrescarVisitasEmpresas(env: Env, step: WorkflowStep): Promise<number | null> {
  const plan = await step.do("visitas de empresas: preparar", CARGA, () => conDb(env.HYPERDRIVE, async (db) => {
    const [{ existe }] = await db.filas<{ existe: boolean }>(
      "SELECT to_regprocedure('refrescar_empresa_visitas_preparar()') IS NOT NULL AS existe");
    if (!existe) return null;
    const [{ r }] = await db.filas<{ r: { desde: number; hasta: number } }>("SELECT refrescar_empresa_visitas_preparar() AS r");
    return { desde: Number(r.desde), hasta: Number(r.hasta) };
  }));
  if (!plan) return null;
  let total = 0;
  for (let desde = plan.desde, i = 1; desde < plan.hasta; desde += TRAMO_VISITAS, i++) {
    const hasta = Math.min(desde + TRAMO_VISITAS, plan.hasta);
    total += await step.do(`visitas de empresas: tramo ${i}`, CARGA, () => conDb(env.HYPERDRIVE, async (db) =>
      Number((await db.filas<{ n: number }>("SELECT refrescar_empresa_visitas_tramo($1, $2) AS n", [desde, hasta]))[0]?.n ?? 0)));
  }
  await step.do("visitas de empresas: cerrar", CARGA, () => conDb(env.HYPERDRIVE, async (db) =>
    Number((await db.filas<{ n: number }>("SELECT refrescar_empresa_visitas_cerrar($1, $2) AS n", [plan.desde, plan.hasta]))[0]?.n ?? 0)));
  registrar("INFO", `   visitas de empresas: ${total} atribuidas`, { fuente: "visitas" });
  return total;
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
  // Lo que dicen el acta de buena pro y el pliego de consultas, leídos con Claude (migraciones 245-246): sólo las
  // banderas que salen de reglas sobre los hechos extraídos. Lee documento_lectura (backend/lector/leer.py, desde la PC).
  await siExiste("refrescar_cruce_acta");
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
  // contrato (migración 118), por cruces_proveedor. Las visitas ya no las atribuye aquí (migración 241: se rehacen tras
  // cada carga de visitas, refrescarVisitasEmpresas); sólo las cuenta. ~3 min (antes 10-26 y la conexión lo cortaba).
  await uno("refrescar_empresas", "SELECT refrescar_empresas() AS n");
  // Las empresas cuya gente (socio, representante, directivo o quien dijo venir de ella) visitó cada entidad y lo que la
  // entidad les dio después (migración 203): lee las visitas ya atribuidas (empresa_visita) y las órdenes y contratos
  // del día. Con las visitas nacionales, todo junto tarda ~9 min: va en partes por empresa (migración 243), una por paso.
  for (let parte = 0; parte < PARTES_VISITA_EMPRESA; parte++) {
    await step.do(`refrescar_visita_empresa ${parte + 1}/${PARTES_VISITA_EMPRESA}`, CARGA, () => conDb(env.HYPERDRIVE, async (db) => {
      const [f] = await db.filas<{ partes: boolean; todo: boolean }>(
        `SELECT to_regprocedure('refrescar_visita_empresa_parte(integer,integer)') IS NOT NULL AS partes,
                to_regprocedure('refrescar_visita_empresa()') IS NOT NULL AS todo`);
      if (f.partes) {
        return Number((await db.filas<{ n: number }>("SELECT refrescar_visita_empresa_parte($1, $2) AS n",
          [parte, PARTES_VISITA_EMPRESA]))[0]?.n ?? 0);
      }
      // Sin la 243: la función entera, una sola vez.
      return parte === 0 && f.todo ? Number((await db.filas<{ n: number }>("SELECT refrescar_visita_empresa() AS n"))[0]?.n ?? 0) : 0;
    }));
  }
  // Mapa de poder (migración 125): captura por partido/entidad. Lee casos_cruce + entidad_gobierno_amplia + jne, ya listos.
  await uno("refrescar_poder", "SELECT refrescar_poder() AS n");
  return n;
}
