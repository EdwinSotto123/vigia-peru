import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";

export const entidadesRouter = new Hono();

const ListQuery = z.object({
  q: z.string().optional(),
  region: z.string().optional(),
  tipo: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ─── GET /entidades — lista con contadores agregados ────────────
entidadesRouter.get("/", async (c) => {
  const parsed = ListQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const { q, region, tipo, limit } = parsed.data;

  const conds: string[] = [];
  const vals: any[] = [];
  if (q) {
    vals.push(`%${q.toLowerCase()}%`);
    conds.push(`immutable_unaccent(lower(e.nombre)) LIKE $${vals.length}`);
  }
  if (region) { vals.push(region); conds.push(`e.region = $${vals.length}`); }
  if (tipo)   { vals.push(tipo);   conds.push(`e.tipo = $${vals.length}`); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  vals.push(limit);
  const r = await pool.query(
    `SELECT
       e.ruc, e.nombre, e.tipo, e.region, e.provincia, e.distrito,
       e.pliego_nombre_mef AS "pliegoNombreMef",
       COALESCE(a.alertas, 0)      AS alertas,
       COALESCE(a.monto, 0)::float AS monto,
       COALESCE(a.score_avg, 0)::int AS "scorePromedio",
       (e.metadata->>'reportes_mock')::int             AS reportes,
       (e.metadata->>'contratos')::int                 AS contratos,
       (e.metadata->>'contratos_vigilados')::int       AS "contratosVigilados",
       e.metadata->'serie_mock'                        AS serie
     FROM entidades e
     LEFT JOIN (
       SELECT entidad_ruc,
              COUNT(*)::int AS alertas,
              SUM(monto_adjudicado) AS monto,
              AVG(score)::int AS score_avg
       FROM alertas WHERE estado = 'activa'
       GROUP BY entidad_ruc
     ) a ON a.entidad_ruc = e.ruc
     ${where}
     ORDER BY a.alertas DESC NULLS LAST, e.nombre
     LIMIT $${vals.length}`,
    vals,
  );
  return c.json({ data: r.rows });
});

// ─── GET /entidades/summary ── KPIs globales ────────────────────
entidadesRouter.get("/summary", async (c) => {
  const r = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM entidades) AS total_entidades,
       (SELECT COUNT(*)::int FROM entidades e
          WHERE EXISTS (SELECT 1 FROM alertas WHERE entidad_ruc = e.ruc AND estado = 'activa')
       ) AS con_alertas,
       (SELECT COALESCE(SUM(monto_adjudicado), 0)::float FROM alertas WHERE estado = 'activa') AS monto`,
  );
  return c.json(r.rows[0]);
});

// ─── GET /entidades/:ruc ─────────────────────────────────────────
entidadesRouter.get("/:ruc", async (c) => {
  const ruc = c.req.param("ruc");
  const [ent, mef, alertas] = await Promise.all([
    pool.query(
      `SELECT e.*,
              COALESCE(a.alertas, 0)::int AS alertas,
              COALESCE(a.monto, 0)::float AS monto
         FROM entidades e
         LEFT JOIN (
           SELECT entidad_ruc, COUNT(*) AS alertas, SUM(monto_adjudicado) AS monto
           FROM alertas WHERE estado='activa' GROUP BY entidad_ruc
         ) a ON a.entidad_ruc = e.ruc
         WHERE e.ruc = $1`,
      [ruc],
    ),
    pool.query("SELECT * FROM mef_entity_budget WHERE entidad_ruc = $1", [ruc]),
    pool.query(
      `SELECT id, codigo, codigo_convocatoria, score, fecha_buena_pro,
              monto_adjudicado, estado, objeto, region
         FROM alertas WHERE entidad_ruc = $1
         ORDER BY score DESC LIMIT 20`,
      [ruc],
    ),
  ]);
  if (ent.rows.length === 0) return c.json({ error: "not_found" }, 404);
  return c.json({
    entidad: ent.rows[0],
    mef: mef.rows[0] ?? null,
    alertas: alertas.rows,
  });
});
