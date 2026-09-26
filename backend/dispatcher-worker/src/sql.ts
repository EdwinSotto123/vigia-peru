/**
 * Las sentencias de backend/dispatcher/main.py, con el mismo SQL (placeholders `$n` en vez de `%s`).
 * Cada función recibe un `Consultor` (src/db.ts sobre Hyperdrive, o uno falso en las pruebas que
 * captura el SQL como test_persistencia.py). Filas como arreglos, igual que las tuplas de psycopg2.
 */

import { cortar, o, repr, str, verdad } from "./py.ts";
import type { Estado } from "./eventos.ts";
import { MAX_INTENTOS } from "./config.ts";
import { registrar } from "./registro.ts";

export interface OpcionesConsulta {
  /** jsonb/json como texto, sin parsear (para reenviar el OCDS tal cual lo guarda Postgres). */
  jsonCrudo?: boolean;
}

export interface Consultor {
  query(sql: string, params: unknown[], opciones?: OpcionesConsulta): Promise<unknown[][]>;
}

export const OK = "ok";
export const FAIL = "fail";
export const ABORT = "abort";
export const PENDIENTE = "pendiente";
export const ESPERA = "espera";
export type Resultado = typeof OK | typeof FAIL | typeof ABORT | typeof PENDIENTE | typeof ESPERA;

/** SQLSTATE de una excepción de Postgres (undefined si no vino de la base). */
const sqlstate = (e: unknown) => (e as { code?: unknown })?.code;
const primeraLinea = (e: unknown) => cortar(String((e as Error)?.message ?? e).split("\n")[0], 120);

export async function reclamar(db: Consultor, n: number, worker: string): Promise<string[]> {
  if (n <= 0) return [];
  return (await db.query("SELECT reclamar_procesamientos($1, $2)", [n, worker])).map((r) => r[0] as string);
}

/** Heartbeat de los contratos en curso (una fase larga, p. ej. OCR, puede callar >20 min). */
export async function latir(db: Consultor, ocids: string[], worker: string): Promise<void> {
  if (ocids.length) {
    await db.query(
      "UPDATE procesamientos SET latido_at = now() WHERE ocid = ANY($1) AND estado = 'procesando' AND worker = $2",
      [ocids, worker],
    );
  }
}

/**
 * Persiste los cambios de estado + latido; opcionalmente anexa un evento visible. `fases` se guarda
 * entero (el reductor devuelve el mapa completo cada vez que cambia). Con el tope de eventos
 * alcanzado se descarta el más viejo antes de anexar.
 */
export async function actualizar(db: Consultor, ocid: string, cambios: Estado, evento: Record<string, unknown> | null,
                                 maxEventos: number): Promise<void> {
  const sets = ["latido_at = now()"];
  const vals: unknown[] = [];
  const p = () => `$${vals.length}`;
  for (const k of ["fase_actual", "fase_index", "error"] as const) {
    if (Object.hasOwn(cambios, k)) {
      vals.push(cambios[k]);
      sets.push(`${k} = ${p()}`);
    }
  }
  const fases = cambios.fases;
  if (fases !== null && typeof fases === "object" && !Array.isArray(fases)) {
    vals.push(JSON.stringify(fases));
    sets.push(`fases = ${p()}::jsonb`);
  }
  if (evento !== null) {
    vals.push(maxEventos);
    const tope = p();
    vals.push(JSON.stringify([evento]));
    sets.push(`eventos = (CASE WHEN jsonb_array_length(eventos) >= ${tope} THEN eventos - 0 ELSE eventos END) || ${p()}::jsonb`);
  }
  vals.push(ocid);
  await db.query(`UPDATE procesamientos SET ${sets.join(", ")} WHERE ocid = ${p()}`, vals);
}

/**
 * ¿Hay alerta para el contrato (analizada desde `desde`, si se indica)? El orquestador guarda la
 * alerta con el OCID corto; ocid_corto() iguala ambas formas sin recorrer la tabla.
 */
export async function alertaPersistida(db: Consultor, ocid: string, desde: string | null = null): Promise<boolean> {
  return (await db.query(
    "SELECT 1 FROM alertas WHERE ocid = ANY(ARRAY[$1, ocid_corto($2)]) " +
      "AND ($3::timestamptz IS NULL OR COALESCE(analizado_en, updated_at, created_at) >= $4::timestamptz) LIMIT 1",
    [ocid, ocid, desde, desde],
  )).length > 0;
}

/**
 * Refresca las vistas materializadas de financiamiento para que el muro de aliados, el ranking y el
 * mapa muestren el contrato recién cerrado. `ranking_impacto` tras cada contrato; `zona_estado`
 * solo al final (y solo si algo cambió, migración 32). Nunca tumba el procesamiento.
 */
export async function refrescarVistas(db: Consultor, zonas = false): Promise<boolean> {
  try {
    if (zonas) {
      try {
        await db.query("SELECT refresh_financiamiento_si_hace_falta()", []);
      } catch (e) {
        if (sqlstate(e) !== "42883") throw e; // undefined_function: sin la migración 32
        await db.query("SELECT refresh_financiamiento()", []);
      }
    } else {
      await db.query("SELECT refresh_ranking()", []);
    }
    return true;
  } catch (e) {
    registrar("WARNING", `refresh de ${zonas ? "zona_estado + ranking_impacto" : "ranking_impacto"} falló: ${primeraLinea(e)}`);
    return false;
  }
}

export async function terminar(db: Consultor, ocid: string, resultado: Resultado, error: string | null): Promise<void> {
  if (resultado === OK) {
    // El trigger trg_alertas_cerrar_procesamiento no cierra un procesamiento con worker vivo: lo cierra
    // el dispatcher al recibir `final`, con la hora real de término (si ya estaba cerrado, se respeta).
    await db.query(
      "UPDATE procesamientos SET finalizado_at = CASE WHEN estado = 'procesando' THEN now() ELSE COALESCE(finalizado_at, now()) END, " +
        "estado = 'procesado', fase_actual = 'final', fase_index = 10, error = NULL, worker = NULL WHERE ocid = $1",
      [ocid],
    );
    await refrescarVistas(db, false);
  } else if (resultado === ABORT) {
    // El orquestador no pudo analizar (fuente caída): vuelve a la cola SIN consumir el intento.
    await db.query(
      "UPDATE procesamientos SET estado = 'encolado', intentos = greatest(intentos - 1, 0), " +
        "error = $1, worker = NULL WHERE ocid = $2",
      [error, ocid],
    );
  } else {
    await db.query(
      "UPDATE procesamientos SET estado = CASE WHEN intentos >= $1 THEN 'error' ELSE 'encolado' END, " +
        "error = $2, worker = NULL WHERE ocid = $3",
      [MAX_INTENTOS, error, ocid],
    );
  }
}

export interface Clasificacion {
  tipo: string;
  etapa: string | null;
  procesable: boolean;
  motivo_no_procesable: string | null;
  agentes: unknown[];
  validaciones_pendientes: unknown[];
}

/**
 * Clasificación persistida en `convocatorias` (migración 13). null si no está clasificada o si la
 * consulta falla (p. ej. columnas inexistentes): en ambos casos se procesa como siempre.
 */
export async function clasificacionDe(db: Consultor, ocid: string): Promise<Clasificacion | null> {
  let rows: unknown[][];
  try {
    rows = await db.query(
      "SELECT tipo_contratacion, etapa, procesable, motivo_no_procesable, agentes_aplicables, " +
        "validaciones_pendientes FROM convocatorias WHERE ocid = $1",
      [ocid],
    );
  } catch (e) {
    registrar("WARNING", `clasificación de ${ocid} no disponible: ${primeraLinea(e)}`);
    return null;
  }
  if (!rows.length || rows[0][0] === null || rows[0][0] === undefined) return null;
  const [tipo, etapa, procesable, motivo, agentes, validaciones] = rows[0];
  return {
    tipo: tipo as string,
    etapa: (etapa ?? null) as string | null,
    procesable: procesable !== false,
    motivo_no_procesable: (motivo ?? null) as string | null,
    agentes: [...((o(agentes, []) as unknown[]))],
    validaciones_pendientes: [...((o(validaciones, []) as unknown[]))],
  };
}

/** No procesable: queda `pendiente_de_procesamiento` sin consumir intento ni orquestador. */
export async function dejarPendiente(db: Consultor, ocid: string, motivo: string | null): Promise<void> {
  await db.query(
    "UPDATE procesamientos SET estado = 'pendiente_de_procesamiento', intentos = greatest(intentos - 1, 0), " +
      "error = $1, worker = NULL, fase_actual = NULL, fase_index = NULL WHERE ocid = $2",
    [cortar(`pendiente de procesamiento: ${o(motivo, "no procesable")}`, 500), ocid],
  );
}

/** {url_origen: gs://…} de los documentos vigentes (migración 15). null si la consulta falla. */
export async function documentosEnGcs(db: Consultor, ocid: string): Promise<Record<string, string> | null> {
  let rows: unknown[][];
  try {
    rows = await db.query("SELECT url_origen, url_gcs FROM documentos_vigentes($1)", [ocid]);
  } catch (e) {
    registrar("WARNING", `documentos_vigentes no disponible: ${primeraLinea(e)}`);
    return null;
  }
  const docs: Record<string, string> = {};
  for (const [u, g] of rows) if (verdad(u) && verdad(g)) docs[u as string] = g as string;
  return docs;
}

export interface Ocds {
  /** El compiledRelease tal como lo guarda Postgres (se reenvía sin re-serializar). */
  texto: string;
  titulo: string;
}

/**
 * compiledRelease completo guardado por la ingesta de records (tiene `parties`); el release recortado
 * de /releasesAfter no sirve para el orquestador.
 */
export async function recordEnDb(db: Consultor, ocid: string): Promise<Ocds | null> {
  let rows: unknown[][];
  try {
    rows = await db.query("SELECT ocds_payload FROM convocatorias WHERE ocid = $1", [ocid], { jsonCrudo: true });
  } catch {
    return null;
  }
  const texto = rows.length ? rows[0][0] : null;
  return typeof texto === "string" ? ocdsValido(texto) : null;
}

/** El texto si es un objeto con `parties` y `ocid` (verdaderos en Python); si no, null. */
export function ocdsValido(texto: string): Ocds | null {
  let cr: unknown;
  try {
    cr = JSON.parse(texto);
  } catch {
    return null;
  }
  if (cr === null || typeof cr !== "object" || Array.isArray(cr)) return null;
  const d = cr as Record<string, unknown>;
  if (!verdad(d.parties) || !verdad(d.ocid)) return null;
  return { texto, titulo: tituloDe(d) };
}

/** `str((ocds.get("tender") or {}).get("title") or "")[:60]` del registro de main.py. */
export function tituloDe(cr: Record<string, unknown>): string {
  const tender = o(cr.tender, {});
  const titulo = tender !== null && typeof tender === "object" && !Array.isArray(tender) ? (tender as Record<string, unknown>).title : null;
  return cortar(str(o(titulo ?? null, "")), 60);
}

/** Sin documentos en GCS: pedido de descarga + procesamiento en `esperando_documentos`. */
export async function esperarDocumentos(db: Consultor, ocid: string): Promise<void> {
  await db.query("SELECT esperar_documentos($1)", [ocid]);
}

/** `f"… {tipo!r}"` de los motivos de main.py. */
export const reprTipo = (tipo: unknown) => repr(tipo ?? null);
