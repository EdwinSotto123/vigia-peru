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
  // Qué empresas visitaron a cada funcionario, por su nombre (migración 335): la arista «empresa → funcionario visitado»
  // de la ficha de rastro. ~140 s en producción; en una base sin la 335, nada.
  await step.do("visitas de empresas: funcionarios visitados", CARGA, () => conDb(env.HYPERDRIVE, async (db) => {
    const [{ existe }] = await db.filas<{ existe: boolean }>(
      "SELECT to_regprocedure('refrescar_funcionario_visita_empresa()') IS NOT NULL AS existe");
    return existe ? Number((await db.filas<{ n: number }>("SELECT refrescar_funcionario_visita_empresa() AS n"))[0]?.n ?? 0) : null;
  }));
  return total;
}

export function sumarDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Un refresco de la base: una sentencia que devuelve una fila con una columna (o ninguna). */
export interface Refresco {
  nombre: string;
  sql: string;
  /** Firma de una función de una migración que puede faltar en esta base (DEV va antes que PROD): sin ella, se salta. */
  requiere?: string;
}

/** Cómo terminó un refresco: `resultado` es la primera columna de la primera fila, como texto (JSON si era un objeto). */
export interface Refrescado {
  nombre: string;
  estado: "ok" | "error" | "saltado";
  resultado: string | null;
  error: string | null;
  segundos: number | null;
}

/** Cada cuánto se mira la cola y hasta cuándo: 2 min × 180 = 6 h (la cadena de órdenes, la más larga, tarda ~3 h). */
const ESPERA_COLA = "2 minutes";
const VUELTAS_COLA = 180;

function comoTexto(v: unknown): string | null {
  return v == null ? null : typeof v === "object" ? JSON.stringify(v) : String(v);
}

/**
 * Corre una lista de refrescos, en orden, y devuelve cómo terminó cada uno.
 *
 * Con la cola de la migración 260 (pg_cron), los deja en `refresco_cola` como un lote y espera a que la base los termine:
 * nadie queda esperando del otro lado de Hyperdrive, que suelta una sentencia a los 10 min sin respuesta (la base la
 * seguía, la deshacía al no poder avisar y el reintento lanzaba otra igual: así se perdieron oece_ocds del 1, 2, 3 y 6 de
 * noviembre y conosce_ordenes del 1). Los lotes de distintas fuentes no se enciman: la cola es una sola. Un refresco con
 * error no frena a los que siguen; al final, si alguno falló, la corrida termina en error y dice cuáles.
 *
 * Sin la 260 (una base que no la tiene todavía), cada refresco es un paso como antes: un error corta la corrida.
 */
export async function refrescar(env: Env, step: WorkflowStep, lote: string, lista: Refresco[]): Promise<Record<string, Refrescado>> {
  const conCola = await step.do("cola de refrescos: ¿está?", LECTURA, () => conDb(env.HYPERDRIVE, async (db) =>
    (await db.filas<{ hay: boolean }>("SELECT to_regprocedure('correr_refrescos()') IS NOT NULL AS hay"))[0]?.hay === true));
  if (!conCola) {
    const out: Record<string, Refrescado> = {};
    for (const r of lista) {
      out[r.nombre] = await step.do(r.nombre, CARGA, () => conDb(env.HYPERDRIVE, async (db): Promise<Refrescado> => {
        if (r.requiere) {
          const [{ existe }] = await db.filas<{ existe: boolean }>("SELECT to_regprocedure($1) IS NOT NULL AS existe", [r.requiere]);
          if (!existe) {
            registrar("WARNING", `   ${r.requiere} no existe en esta base: se salta`, { fuente: "refrescos", instancia: lote });
            return { nombre: r.nombre, estado: "saltado", resultado: null, error: `${r.requiere} no existe en esta base`, segundos: null };
          }
        }
        const t0 = Date.now();
        const [fila] = await db.filas<Record<string, unknown>>(r.sql);
        return {
          nombre: r.nombre, estado: "ok", resultado: comoTexto(fila ? Object.values(fila)[0] : null), error: null,
          segundos: Math.round((Date.now() - t0) / 1000),
        };
      }));
    }
    return out;
  }

  // ON CONFLICT: si el paso se reintenta (o el Workflow se reanuda), el lote no se duplica.
  const encolados = await step.do("cola de refrescos: encolar", LECTURA, () => conDb(env.HYPERDRIVE, (db) => db.ejecutar(
    `INSERT INTO refresco_cola (lote, nombre, sql, requiere)
     SELECT $1, x.nombre, x.sql, x.requiere
       FROM jsonb_to_recordset($2::jsonb) AS x(nombre text, sql text, requiere text, orden int)
      ORDER BY x.orden
     ON CONFLICT (lote, nombre) DO NOTHING`,
    [lote, JSON.stringify(lista.map((r, orden) => ({ nombre: r.nombre, sql: r.sql, requiere: r.requiere ?? null, orden })))])));
  registrar("INFO", `   ${encolados} refrescos en la cola (lote ${lote}): los corre la base con pg_cron`, { fuente: "refrescos", instancia: lote });

  for (let i = 1; ; i++) {
    const { faltan, ahora } = await step.do(`cola de refrescos: ¿terminó? (${i})`, LECTURA, () => conDb(env.HYPERDRIVE, async (db) =>
      (await db.filas<{ faltan: number; ahora: string | null }>(
        `SELECT count(*) FILTER (WHERE estado IN ('pendiente', 'corriendo'))::int AS faltan,
                max(nombre) FILTER (WHERE estado = 'corriendo') AS ahora
           FROM refresco_cola WHERE lote = $1`, [lote]))[0]));
    if (faltan === 0) break;
    if (i >= VUELTAS_COLA) {
      throw new Error(`la cola de refrescos no terminó en 6 h: faltan ${faltan} (SELECT * FROM refresco_cola WHERE lote = '${lote}')`);
    }
    if (i % 15 === 1) {
      registrar("INFO", `   cola de refrescos: faltan ${faltan}${ahora ? `, ahora ${ahora}` : " (esperando su turno)"}`,
        { fuente: "refrescos", instancia: lote });
    }
    await step.sleep(`cola de refrescos: espera (${i})`, ESPERA_COLA);
  }

  const filas = await step.do("cola de refrescos: resultado", LECTURA, () => conDb(env.HYPERDRIVE, (db) => db.filas<Refrescado>(
    `SELECT nombre, estado, resultado, error, round(extract(epoch FROM fin - inicio))::int AS segundos
       FROM refresco_cola WHERE lote = $1 ORDER BY id`, [lote])));
  const out: Record<string, Refrescado> = Object.fromEntries(filas.map((f) => [f.nombre, f]));
  const malos = filas.filter((f) => f.estado === "error");
  registrar(malos.length ? "WARNING" : "INFO",
    `   refrescos: ${filas.filter((f) => f.estado === "ok").length} bien, ${malos.length} con error, ` +
    `${filas.filter((f) => f.estado === "saltado").length} saltados`, { fuente: "refrescos", instancia: lote });
  if (malos.length) {
    throw new Error(`refrescos con error: ${malos.map((m) => `${m.nombre} (${m.error})`).join("; ")}`.slice(0, 1500));
  }
  return out;
}

/** El número que devolvió un refresco (null si se saltó o no devolvió nada). */
export function numeroDe(r: Record<string, Refrescado>, nombre: string): number | null {
  const v = r[nombre]?.resultado;
  return v == null || v === "" ? null : Number(v);
}

/** Lo que devolvió refrescar_cruces(): cuántos cruces quedaron de cada tipo. */
export function crucesDe(r: Record<string, Refrescado>): { tipo: string; filas: number }[] {
  const v = r.refrescar_cruces?.resultado;
  return v ? (JSON.parse(v) as { tipo: string; filas: number }[]) : [];
}

/**
 * Los cruces de los ganadores (refrescar_cruces, migración 48) y todo lo que se arma sobre ellos, en orden: lo que hacía
 * `refrescar_casos_cruce()` en una sola sentencia, separado en refrescos (con la historia del OECE en la base la cadena
 * tardaba ~21 min). Antes va el precio por ítem (migración 84): rehace precio_item y el cruce `sobreprecio`, que
 * refrescar_cruces() borra. Lo usan las cargas que traen procesos, órdenes o aportes nuevos.
 */
export function cadenaCruces(): Refresco[] {
  const f = (nombre: string, opcional = false): Refresco =>
    ({ nombre, sql: `SELECT ${nombre}()`, ...(opcional ? { requiere: `${nombre}()` } : {}) });
  return [
    { nombre: "refrescar_cruces", sql: "SELECT jsonb_agg(c) FROM refrescar_cruces() c" },
    f("refrescar_precio_item"),
    // Sobreprecio sobre un ítem que agrupa varios productos con el CUBSO de uno («insumos para el programa del Vaso de
    // Leche»): dato dudoso, severidad baja y su nota (migración 340).
    f("marcar_sobreprecio_paquete", true),
    f("refrescar_contrato_partido"),
    f("refrescar_cruce_otro_postor"),
    // «Ganó recién fundada» (migración 118): la brecha entre el alta en la SUNAT y la buena pro de ese proceso.
    f("refrescar_cruce_recien_fundada"),
    // «Único postor» y «socio del proveedor contratado por la entidad» (migración 122).
    f("refrescar_cruce_unico_postor"),
    f("refrescar_cruce_socio_en_entidad"),
    // Mismo domicilio fiscal que otro postor y proveedor cautivo (migración 123).
    f("refrescar_cruce_domicilio_compartido"),
    f("refrescar_cruce_proveedor_cautivo"),
    // Un funcionario declaró en su DJI un interés en la empresa que le ganó a su entidad (migración 170).
    f("refrescar_cruce_interes_dji", true),
    // Un funcionario de la entidad declaró en la DJI de datos abiertos un empleo en la empresa que ganó mientras él
    // ocupaba el cargo (migración 330): después de interes_dji, para no repetir lo que ya marca empleo_declarado.
    f("refrescar_cruce_empleo_dji", true),
    // La empresa espejo de una inhabilitada y las postulaciones de cada empresa (migración 184).
    f("refrescar_cruce_empresa_espejo", true),
    f("refrescar_proceso_resumen", true),
    // La obra de INFOBRAS de cada contrato y sus banderas (migración 160).
    f("refrescar_cruce_obras", true),
    // «Visitó la entidad antes de ganar» con todos los nombres de la entidad (migración 174).
    f("refrescar_cruce_visita_previa", true),
    // Familiar de un funcionario socio del ganador, y postores que se turnan (migración 189).
    f("refrescar_cruce_pariente_funcionario", true),
    f("refrescar_cruce_turno_postores", true),
    // Postor de relleno y patrones en lo que leyeron los agentes (migración 276).
    f("refrescar_cruce_postor_relleno", true),
    f("refrescar_patron_agentes", true),
    // Socios de consorcio que compiten y puerta giratoria (migración 278).
    f("refrescar_cruce_consorcio_rival", true),
    f("refrescar_cruce_puerta_giratoria", true),
    // Costo mensual de cada servicio, para el agente de servicios (migración 280).
    f("refrescar_servicio_costo_mensual", true),
    // Renovaciones de un servicio que salieron más caras (migración 283): después del costo mensual.
    f("refrescar_cruce_renovacion_cara", true),
    // Garantía por retención de pagos sobre el tope, con un contratista que no parece MYPE (migración 291).
    f("refrescar_cruce_retencion_sobre_tope", true),
    // El mismo dueño gana en la misma entidad con otra empresa un objeto parecido (migración 292).
    f("refrescar_cruce_mismo_dueno", true),
    f("refrescar_mismo_dueno_grupo", true),
    // El socio de una empresa inhabilitada gana con otra durante la sanción (migración 297).
    f("refrescar_cruce_socio_de_inhabilitada", true),
    // Un socio o representante del ganador figura en un informe de control anterior a la buena pro (migración 303).
    f("refrescar_cruce_socio_con_informe_control", true),
    // Una observación de un informe de control nombra el proceso o la obra del contrato (migración 313).
    f("refrescar_cruce_observado_por_contraloria", true),
    // La entidad le adjudica después de un informe que observó otro proceso suyo (migración 315): lee la bandera anterior.
    f("refrescar_cruce_gano_tras_observacion", true),
    // Cada observación leída con su tema y su perjuicio, para sumar por entidad, región y tema (migración 314).
    f("refrescar_informe_control_observacion", true),
    // El contrato se firmó por más de lo adjudicado según las dos fuentes oficiales (migración 294).
    f("refrescar_cruce_contrato_sobre_adjudicado", true),
    // Lo que dicen el acta de buena pro y las consultas leídas con Claude (migraciones 245-246).
    f("refrescar_cruce_acta", true),
    // La competencia de cada proceso según los reportes que genera el SEACE, leídos sin modelo (migración 326): quién
    // presentó oferta, a quién se admitió y calificó, y lo adjudicado por ítem. Va antes de los hechos, que la leen.
    f("refrescar_proceso_postor", true),
    // El ganador y otro postor comparten una persona y registraron sus ofertas casi a la vez (migración 329): lee la tabla
    // anterior. Es un indicador en observación: se muestra y no puntúa (senal_en_observacion).
    f("refrescar_cruce_ofertas_a_la_vez", true),
    // Contrato firmado cuando los otros postores todavía podían apelar la buena pro (migración 334, en observación).
    f("refrescar_cruce_firma_apelacion", true),
    // Los indicadores en observación que se rehacían sólo en tarea:refrescar-piezas del CI: como refrescar_cruces() vacía
    // la tabla, cada corrida de esta cadena los borraba hasta la próxima tarea (2026-11-19: «sólo admitieron al ganador»
    // en 0 habiendo 194). Sólo admitido lee proceso_postor (arriba); el comité, la vista de la 408 (agentes + lector) y la
    // señal del evaluador que restringe la competencia (415) lee las de competencia de arriba y la de admisión.
    f("refrescar_cruce_solo_admitido", true),
    f("refrescar_comite_integrante", true),
    f("refrescar_cruce_comite_mismo_ganador", true),
    f("refrescar_cruce_comite_socio_proveedor", true),
    f("refrescar_cruce_comite_competencia_restringida", true),
    // Las partes de las apelaciones leídas del Tribunal (424): a quién le quitó la buena pro, contra quién ordenó un
    // sancionador y lo que esa empresa ganó después con el sancionador abierto.
    f("refrescar_cruce_tribunal", true),
    // El integrante del comité cuyos procesos el Tribunal corrige más que el resto de su entidad (427).
    f("refrescar_cruce_comite_corregido_tribunal", true),
    // Los datos de los documentos leídos, como hechos con tipo y con su comprobación contra el registro (migraciones 323
    // y 327: también los leídos sin modelo, de los reportes del SEACE y de las secciones de las bases).
    f("refrescar_hecho_documento", true),
    // Las sanciones según la ficha del proveedor en el OECE (migración 337): quita «sanción vigente» y «socio de
    // inhabilitada» cuando el Tribunal la sustituyó o levantó (ya no figura) y la buena pro es desde la Ley 32069.
    f("ajustar_sanciones_con_ficha", true),
    // Quita los cruces que algún JOIN multiplica (migración 120), antes de juntarlos en casos_cruce.
    f("dedup_cruces_proveedor"),
    f("refrescar_adjudicado_vigente"),
    // Adjudicaciones de 20 veces su valor referencial o de S/ 1: posible error de carga (migración 102).
    f("refrescar_contratos_dudosos"),
    f("refrescar_casos_cruce_base"),
    // En cuántos procesos aparece cada tipo de señal y sobre cuántos se puede medir (migración 329).
    f("refrescar_senal_tasa_base", true),
    // Cuántos contratos con antecedentes tiene cada entidad (migración 175), de casos_cruce recién hecho.
    f("refrescar_entidad_antecedentes", true),
    // Las personas naturales que ganaron procesos de selección (migración 317): su resumen y su código de ficha.
    f("refrescar_persona_ganadora", true),
    // El índice para buscar por nombre a quien recibió órdenes o ganó procesos (migración 320): lee la tabla anterior.
    f("refrescar_persona_busqueda", true),
    // Las órdenes de cada empresa por entidad y año (migración 109) y las que están al borde del tope (207).
    f("refrescar_empresa_ordenes"),
    f("refrescar_borde_empresas", true),
    // empresa_resumen con sus antecedentes y las señales SUNAT de estado (migraciones 109 y 117).
    f("refrescar_empresas"),
    // «Inhabilitada hoy» según la ficha del OECE, si se consultó en los últimos 45 días (migración 337).
    f("ajustar_empresas_con_ficha", true),
    // Los candidatos y aportantes de cada partido con sus cruces (migración 299), su DJI, lo que obtuvieron sus familiares y
    // sus informes de control (301): lee empresa_resumen, recién hecho.
    f("refrescar_partido_politicos", true),
    // Las empresas cuya gente visitó cada entidad y lo que la entidad les dio después (migraciones 203 y 243), por partes.
    ...Array.from({ length: PARTES_VISITA_EMPRESA }, (_, parte): Refresco => ({
      nombre: `refrescar_visita_empresa ${parte + 1}/${PARTES_VISITA_EMPRESA}`,
      sql: `SELECT refrescar_visita_empresa_parte(${parte}, ${PARTES_VISITA_EMPRESA})`,
      requiere: "refrescar_visita_empresa_parte(integer,integer)",
    })),
    // Mapa de poder (migración 125): lee casos_cruce y los gobiernos, ya listos.
    f("refrescar_poder"),
  ];
}
