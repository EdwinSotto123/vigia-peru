/**
 * ¿Qué migraciones ya están en la base? La API puede desplegarse antes que una migración: en vez de
 * un 500, cada ruta responde como antes (o avisa en palabras) hasta que se aplique.
 * Presentes, no se vuelve a preguntar; ausentes, se re-chequea cada minuto.
 *
 *   · hayModelosLectura()       35 (+ ubigeo_zona de la 32): contrato_estado, contratos_agregado,
 *                               entidad_stats, senales_publicas.
 *   · perfilAliadoDisponible()  30: columnas del perfil público en `financiadores`.
 *   · hayAporteEntidad()        39: contribuciones.entidad_ruc y zona_de_entidad().
 *
 * La API nueva se despliega DESPUÉS de las migraciones 28 y 31–36 (API_LISTO.md). Si aun así llegara
 * antes, /contratos, /contratos/resumen, /contratos/geo, /entidades y /buscar responden con la SQL
 * anterior (sin modelos de lectura) y /senales responde 404, que el frontend trata como "API vieja".
 */

import { pool } from "./db.js";

let estado: { ok: boolean; at: number } | null = null;

const SQL = `SELECT to_regclass('public.contrato_estado') IS NOT NULL
                AND to_regclass('public.contratos_agregado') IS NOT NULL
                AND to_regclass('public.entidad_stats') IS NOT NULL
                AND to_regclass('public.senales_publicas') IS NOT NULL
                AND EXISTS (SELECT 1 FROM information_schema.columns
                             WHERE table_schema = 'public' AND table_name = 'convocatorias' AND column_name = 'ubigeo_zona') AS ok`;

export async function hayModelosLectura(): Promise<boolean> {
  if (estado && (estado.ok || Date.now() - estado.at < 60_000)) return estado.ok;
  try {
    const r = await pool.query<{ ok: boolean }>(SQL);
    estado = { ok: !!r.rows[0]?.ok, at: Date.now() };
    if (!estado.ok) console.warn(JSON.stringify({ severity: "WARNING", message: "[esquema] faltan los modelos de lectura (migraciones 32/35): se usa la SQL anterior" }));
  } catch (e) {
    console.warn(JSON.stringify({ severity: "WARNING", message: `[esquema] no se pudo verificar: ${(e as Error).message}` }));
    return false;
  }
  return estado.ok;
}

// ─── Perfil público del aliado (migración 30) ────────────────────────────────
// descripción, web, correo de contacto, redes y portada. Sin las columnas, el perfil sale sin esos
// datos y quien lo edita recibe un aviso en palabras (503 `sin_migracion`), en vez de un 500.
const COLS_PERFIL = ["descripcion", "sitio_web", "email_publico", "redes", "portada_url"];
let perfilCols: { ok: boolean; at: number } | null = null;

/** ¿Tiene `financiadores` las columnas de la 30? */
export async function perfilAliadoDisponible(): Promise<boolean> {
  if (perfilCols && (perfilCols.ok || Date.now() - perfilCols.at < 60_000)) return perfilCols.ok;
  try {
    const r = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'financiadores' AND column_name = ANY($1::text[])`, [COLS_PERFIL]);
    perfilCols = { ok: r.rows[0]?.n === COLS_PERFIL.length, at: Date.now() };
  } catch (e) {
    // Sin guardar: el próximo pedido vuelve a preguntar.
    console.warn(`[esquema] no pude leer information_schema: ${(e as Error).message}`);
    return false;
  }
  return perfilCols.ok;
}

/** 42703 (undefined_column) con la detección en "sí": la columna ya no está. Olvida la detección. */
export function columnaAusente(e: unknown): boolean {
  if ((e as { code?: string })?.code !== "42703") return false;
  perfilCols = null;
  return true;
}

/** Corre `consulta` con las columnas del perfil si existen; si una falta (42703), la repite sin ellas. */
export async function conPerfilAliado<T>(consulta: (perfil: boolean) => Promise<T>): Promise<{ valor: T; perfil: boolean }> {
  if (!(await perfilAliadoDisponible())) return { valor: await consulta(false), perfil: false };
  try {
    return { valor: await consulta(true), perfil: true };
  } catch (e) {
    if (!columnaAusente(e)) throw e;
    return { valor: await consulta(false), perfil: false };
  }
}

/**
 * ¿Puede el rol de la API pública ESCRIBIR el perfil (UPDATE por columna: lo otorga la migración 39)?
 * Sin eso, /cuentas/me no ofrece el perfil público (no salen sus claves) en vez de aceptar un formulario
 * que la base rechazaría. Implica perfilAliadoDisponible(): sin las columnas, la función falla → false.
 */
let perfilEditable: { ok: boolean; at: number } | null = null;

export async function perfilEditableDesdeCuenta(): Promise<boolean> {
  if (perfilEditable && (perfilEditable.ok || Date.now() - perfilEditable.at < 60_000)) return perfilEditable.ok;
  try {
    const r = await pool.query<{ ok: boolean }>(
      `SELECT bool_and(has_column_privilege('public.financiadores', c, 'UPDATE')) AS ok FROM unnest($1::text[]) c`, [COLS_PERFIL]);
    perfilEditable = { ok: !!r.rows[0]?.ok, at: Date.now() };
  } catch {
    // 42703: faltan las columnas (30). Se vuelve a preguntar en un minuto.
    perfilEditable = { ok: false, at: Date.now() };
  }
  return perfilEditable.ok;
}

// ─── Aporte por entidad (migración 39) ───────────────────────────────────────
// Sin la 39, las lecturas de aportes salen con `entidad: null` y financiar una entidad responde 503
// `sin_migracion` (financiar una zona sigue igual).
let aporteEntidad: { ok: boolean; at: number } | null = null;

export async function hayAporteEntidad(): Promise<boolean> {
  if (aporteEntidad && (aporteEntidad.ok || Date.now() - aporteEntidad.at < 60_000)) return aporteEntidad.ok;
  try {
    const r = await pool.query<{ ok: boolean }>(
      `SELECT to_regprocedure('public.zona_de_entidad(text)') IS NOT NULL
              AND EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema = 'public' AND table_name = 'contribuciones' AND column_name = 'entidad_ruc') AS ok`);
    aporteEntidad = { ok: !!r.rows[0]?.ok, at: Date.now() };
  } catch (e) {
    console.warn(`[esquema] no se pudo verificar la migración 39: ${(e as Error).message}`);
    return false;
  }
  return aporteEntidad.ok;
}
