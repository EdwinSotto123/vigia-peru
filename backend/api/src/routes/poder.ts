/**
 * Mapa de poder (migración 125): captura por partido y por entidad. Para cada entidad electa con gobierno vigente, qué
 * partido la gobierna y cuántos de sus contratos ganaron empresas ligadas a ese partido (financió / vendió a su campaña)
 * o con un socio contratado por la misma entidad. Son INDICIOS agregados para revisión humana, no acusaciones.
 *
 *   GET /poder/partidos          ranking de partidos por captura (lo que lee la página /app/poder)
 *   GET /poder/partido/:partido  un partido: sus totales y las entidades que gobierna, con su captura
 *   GET /poder/entidad/:ruc      una entidad: el partido que la gobierna y su captura
 */
import { Hono } from "hono";
import { pool } from "../lib/db.js";
import { publicar } from "../lib/privacidad.js";
import { cachePublico } from "../lib/http.js";

export const poderRouter = new Hono();

const CACHE = cachePublico(3600, { maxAge: 600 });

const COLS_PARTIDO = `partido, n_entidades::int, n_departamentos::int, n_entidades_con_captura::int,
  n_captura::int, monto_captura::float, n_financiaron::int, n_vendieron::int, n_socio::int, n_empresas::int`;
const COLS_ENTIDAD = `entidad_ruc, entidad, nivel, departamento, provincia, distrito, partido, cargo_gob, autoridad,
  to_char(periodo_inicio, 'YYYY-MM-DD') AS "periodoInicio", to_char(periodo_fin, 'YYYY-MM-DD') AS "periodoFin",
  n_captura::int, monto_captura::float, n_financiaron::int, n_vendieron::int, n_socio::int, n_empresas::int`;

/** Ranking de partidos por captura (los más concentrados primero). */
poderRouter.get("/partidos", async (c) => {
  const r = await pool.query(`SELECT ${COLS_PARTIDO} FROM poder_partido ORDER BY n_captura DESC, n_entidades DESC`);
  c.header("Cache-Control", CACHE);
  return c.json(publicar({ data: r.rows }));
});

/** Ranking de ENTIDADES por captura (las más capturadas primero): para bajar del partido al municipio concreto. */
poderRouter.get("/entidades", async (c) => {
  const nivel = c.req.query("nivel");
  const dep = (c.req.query("departamento") ?? "").trim();
  const q = (c.req.query("q") ?? "").trim();
  const conds = ["n_captura > 0"];
  const vals: unknown[] = [];
  if (nivel && ["distrital", "provincial", "regional"].includes(nivel)) { vals.push(nivel); conds.push(`nivel = $${vals.length}`); }
  if (dep.length >= 2) { vals.push(dep); conds.push(`departamento ILIKE $${vals.length}`); }
  if (q.length >= 3) { vals.push(`%${q}%`); conds.push(`(entidad ILIKE $${vals.length} OR partido ILIKE $${vals.length} OR autoridad ILIKE $${vals.length})`); }
  const r = await pool.query(
    `SELECT ${COLS_ENTIDAD} FROM poder_entidad WHERE ${conds.join(" AND ")} ORDER BY n_captura DESC, monto_captura DESC NULLS LAST LIMIT 300`,
    vals);
  c.header("Cache-Control", CACHE);
  return c.json(publicar({ data: r.rows }));
});

/** Un partido: sus totales y las entidades que gobierna, con su captura (las más capturadas primero). */
poderRouter.get("/partido/:partido", async (c) => {
  const partido = c.req.param("partido");
  if (!partido || partido.length > 120) return c.json({ error: "not_found" }, 404);
  const [cab, ent] = await Promise.all([
    pool.query(`SELECT ${COLS_PARTIDO} FROM poder_partido WHERE partido = $1`, [partido]),
    pool.query(`SELECT ${COLS_ENTIDAD} FROM poder_entidad WHERE partido = $1 ORDER BY n_captura DESC, entidad LIMIT 1000`, [partido]),
  ]);
  if (!cab.rows[0]) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(publicar({ partido: cab.rows[0], entidades: ent.rows }));
});

/** Una entidad: el partido que la gobierna y su captura (lo usa la ficha de la entidad). */
poderRouter.get("/entidad/:ruc", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "not_found" }, 404);
  const r = await pool.query(`SELECT ${COLS_ENTIDAD} FROM poder_entidad WHERE entidad_ruc = $1`, [ruc]);
  if (!r.rows[0]) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(publicar(r.rows[0]));
});
