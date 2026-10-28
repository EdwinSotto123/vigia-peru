import { pool } from "./db.js";

/**
 * Hasta qué día trae visitas el registro cargado: la fecha de la última. La Plataforma Nacional de Datos Abiertos no
 * publicó el registro después de mayo de 2026, y donde se muestran visitas hay que decirlo (fase 0 del plan del
 * 2026-10-27: sin la fecha, «no visitó» parecía un dato de hoy). Se lee una vez cada 6 horas.
 */
let memo: { t: number; hasta: string | null } | null = null;

export async function visitasHasta(): Promise<string | null> {
  if (memo && Date.now() - memo.t < 6 * 3600_000) return memo.hasta;
  const r = await pool.query<{ hasta: string | null }>(`SELECT to_char(max(fecha_visita), 'YYYY-MM-DD') AS hasta FROM visitas_entidades`).catch(() => null);
  if (r) memo = { t: Date.now(), hasta: r.rows[0]?.hasta ?? null };
  return memo?.hasta ?? null;
}
