/**
 * ¿Están en la base los modelos de lectura de la migración 35 (contrato_estado, contratos_agregado,
 * entidad_stats, senales_publicas) y la columna convocatorias.ubigeo_zona de la 32?
 *
 * La API nueva se despliega DESPUÉS de las migraciones 28 y 31–36 (API_LISTO.md). Si aun así llegara
 * antes, /contratos, /contratos/resumen, /contratos/geo, /entidades y /buscar responden con la SQL
 * anterior (sin modelos de lectura) y /senales responde 404, que el frontend trata como "API vieja".
 * Presentes, no se vuelve a preguntar; ausentes, se re-chequea cada minuto.
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
