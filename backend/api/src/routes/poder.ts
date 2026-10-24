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

/** El GRAFO de captura de un PARTIDO: las entidades que gobierna (las más capturadas) y las empresas «puente» —las que
 * ganaron contratos con indicio en DOS O MÁS de esas entidades—, con las entidades que conecta cada una. Es el patrón
 * que más señala: una misma empresa ligada al partido que se repite por varios de sus municipios. Indicios, no acusación. */
poderRouter.get("/partido/:partido/grafo", async (c) => {
  const partido = c.req.param("partido");
  if (!partido || partido.length > 120) return c.json({ error: "not_found" }, 404);
  // Las entidades del partido con más captura (tope 14), ordenadas de forma determinista para que las dos consultas
  // trabajen sobre EL MISMO conjunto (la de empresas referencia estos entidad_ruc).
  const entsCte = `SELECT entidad_ruc FROM poder_entidad
     WHERE partido = $1 AND n_captura > 0
     ORDER BY n_captura DESC, monto_captura DESC NULLS LAST, entidad_ruc LIMIT 14`;
  const [cab, ent, emp] = await Promise.all([
    pool.query(`SELECT ${COLS_PARTIDO} FROM poder_partido WHERE partido = $1`, [partido]),
    pool.query(
      `SELECT entidad_ruc AS ruc, entidad AS nombre, nivel, departamento,
              n_captura::int, monto_captura::float
         FROM poder_entidad
        WHERE partido = $1 AND n_captura > 0
        ORDER BY n_captura DESC, monto_captura DESC NULLS LAST, entidad_ruc LIMIT 14`, [partido]),
    pool.query(
      `WITH ents AS (${entsCte})
       SELECT cp.ruc_empresa AS ruc, max(e.razon_social) AS nombre,
              array_agg(DISTINCT c.entidad_ruc) AS entidades,
              array_agg(DISTINCT cp.tipo) AS lazos,
              count(DISTINCT cp.ocid)::int AS contratos,
              count(DISTINCT c.entidad_ruc)::int AS n_entidades,
              COALESCE(sum(cp.monto), 0)::float AS monto
         FROM convocatorias c
         JOIN ents ON ents.entidad_ruc = c.entidad_ruc
         JOIN cruces_proveedor cp ON cp.ocid = c.ocid
         LEFT JOIN empresas e ON e.ruc = cp.ruc_empresa
        WHERE cp.tipo IN ('partido_gobernante', 'vendio_gobernante', 'socio_en_entidad')
          AND cp.ruc_empresa ~ '^20[0-9]{9}$'
        GROUP BY cp.ruc_empresa
       HAVING count(DISTINCT c.entidad_ruc) >= 2
        ORDER BY count(DISTINCT c.entidad_ruc) DESC, count(DISTINCT cp.ocid) DESC LIMIT 14`, [partido]),
  ]);
  if (!cab.rows[0]) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", CACHE);
  return c.json(publicar({ partido: cab.rows[0], entidades: ent.rows, empresas: emp.rows }));
});

/** El GRAFO de captura de una entidad: el partido que la gobierna y las empresas (RUC 20) ligadas a ese partido que
 * ganaron sus contratos, con el tipo de lazo. Para dibujar la red de captura. Indicios para revisión, no acusación. */
poderRouter.get("/entidad/:ruc/grafo", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "not_found" }, 404);
  const cab = await pool.query(
    `SELECT entidad, partido, cargo_gob, autoridad FROM poder_entidad WHERE entidad_ruc = $1`, [ruc]);
  if (!cab.rows[0]) return c.json({ error: "not_found" }, 404);
  const emp = await pool.query(
    `SELECT cp.ruc_empresa AS ruc, max(e.razon_social) AS nombre,
            array_agg(DISTINCT cp.tipo) AS lazos,
            count(DISTINCT cp.ocid)::int AS contratos,
            COALESCE(sum(cp.monto), 0)::float AS monto
       FROM cruces_proveedor cp
       JOIN convocatorias c ON c.ocid = cp.ocid AND c.entidad_ruc = $1
       LEFT JOIN empresas e ON e.ruc = cp.ruc_empresa
      WHERE cp.tipo IN ('partido_gobernante', 'vendio_gobernante', 'socio_en_entidad')
        AND cp.ruc_empresa ~ '^20[0-9]{9}$'
      GROUP BY cp.ruc_empresa
      ORDER BY count(DISTINCT cp.ocid) DESC, 5 DESC LIMIT 18`, [ruc]);
  c.header("Cache-Control", CACHE);
  return c.json(publicar({ entidad: { ruc, nombre: cab.rows[0].entidad }, partido: cab.rows[0].partido,
    cargoGob: cab.rows[0].cargo_gob, autoridad: cab.rows[0].autoridad, empresas: emp.rows }));
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
