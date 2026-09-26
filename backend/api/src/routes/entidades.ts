import { Hono } from "hono";
import { z } from "zod";
import { escaparLike, pool } from "../lib/db.js";
import { cachePublico, parametros } from "../lib/http.js";
import { hayModelosLectura } from "../lib/esquema.js";
import { alertaNoDemo, alertaPublica, convocatoriaNoDemo, ENTIDAD_METADATA_MOCK } from "../lib/publicacion.js";

export const entidadesRouter = new Hono();

// Agregados de alertas: solo `activa` (como siempre) y NUNCA las semillas de demo `ALT-…`. Tampoco
// se leen las claves `*_mock` que seed_db.py dejó en entidades.metadata (reportes_mock, serie_mock,
// contratos, contratos_vigilados…): eran cifras inventadas. Ver lib/publicacion.ts §1.
const ALERTAS_ACTIVAS = `a.estado = 'activa' AND ${alertaNoDemo("a")}`;

const ListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  region: z.string().max(80).optional(),
  tipo: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── GET /entidades — lista con contadores agregados (paginada) ─
// Fase 2 (auditoría C9): desde la vista materializada `entidad_stats` (migración 35), una fila por
// entidad con sus conteos ya hechos; antes cada pedido agrupaba TODAS las convocatorias. Mismas
// filas y mismo orden (alertas activas DESC, nombre, ruc). Va hasta un refresco detrás.
entidadesRouter.get("/", async (c) => {
  const parsed = ListQuery.safeParse(parametros(c));
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const { q, region, tipo, limit, offset } = parsed.data;
  const modelos = await hayModelosLectura();

  const conds: string[] = [];
  const vals: any[] = [];
  if (q) {
    vals.push(`%${escaparLike(q.toLowerCase())}%`);
    conds.push(modelos ? `es.nombre_norm LIKE immutable_unaccent($${vals.length})` : `immutable_unaccent(lower(e.nombre)) LIKE immutable_unaccent($${vals.length})`);
  }
  if (region) { vals.push(region); conds.push(`${modelos ? "es" : "e"}.region = $${vals.length}`); }
  if (tipo)   { vals.push(tipo);   conds.push(`${modelos ? "es" : "e"}.tipo = $${vals.length}`); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const totalVals = [...vals];
  vals.push(limit, offset);
  const [r, total] = await Promise.all([
    pool.query(modelos
      ? `SELECT es.ruc, es.nombre, es.tipo, es.region, es.provincia, es.distrito,
                es.pliego_nombre_mef AS "pliegoNombreMef",
                es.alertas_activas AS alertas,
                es.monto_alertas_activas::float AS monto,
                COALESCE(es.score_prom_activas, 0)::int AS "scorePromedio",
                NULL::int AS reportes,
                es.contratos,
                es.alertas_activas AS "contratosVigilados",
                NULL::jsonb AS serie
           FROM entidad_stats es
           ${where}
           ORDER BY es.alertas_activas DESC, es.nombre, es.ruc
           LIMIT $${vals.length - 1} OFFSET $${vals.length}`
      : `SELECT
           e.ruc, e.nombre, e.tipo, e.region, e.provincia, e.distrito,
           e.pliego_nombre_mef AS "pliegoNombreMef",
           COALESCE(a.alertas, 0)      AS alertas,
           COALESCE(a.monto, 0)::float AS monto,
           COALESCE(a.score_avg, 0)::int AS "scorePromedio",
           NULL::int                   AS reportes,   -- antes metadata.reportes_mock (inventado)
           COALESCE(cv.contratos, 0)::int AS contratos,
           COALESCE(a.alertas, 0)::int AS "contratosVigilados",
           NULL::jsonb                 AS serie       -- antes metadata.serie_mock (inventado)
         FROM entidades e
         LEFT JOIN (
           SELECT c.entidad_ruc, COUNT(*)::int AS contratos FROM convocatorias c WHERE ${convocatoriaNoDemo("c")} GROUP BY c.entidad_ruc
         ) cv ON cv.entidad_ruc = e.ruc
         LEFT JOIN (
           SELECT a.entidad_ruc, COUNT(*)::int AS alertas, SUM(a.monto_adjudicado) AS monto, AVG(a.score)::int AS score_avg
           FROM alertas a WHERE ${ALERTAS_ACTIVAS}
           GROUP BY a.entidad_ruc
         ) a ON a.entidad_ruc = e.ruc
         ${where}
         ORDER BY a.alertas DESC NULLS LAST, e.nombre, e.ruc
         LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals,
    ),
    pool.query(`SELECT count(*)::int AS n FROM ${modelos ? "entidad_stats es" : "entidades e"} ${where}`, totalVals),
  ]);
  c.header("Cache-Control", cachePublico(120, { maxAge: 60, swr: 60 }));
  return c.json({ data: r.rows, total: total.rows[0].n, limit, offset });
});

// ─── GET /entidades/summary ── KPIs globales ────────────────────
entidadesRouter.get("/summary", async (c) => {
  const r = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM entidades) AS total_entidades,
       (SELECT COUNT(*)::int FROM entidades e
          WHERE EXISTS (SELECT 1 FROM alertas a WHERE a.entidad_ruc = e.ruc AND ${ALERTAS_ACTIVAS})
       ) AS con_alertas,
       (SELECT COALESCE(SUM(a.monto_adjudicado), 0)::float FROM alertas a WHERE ${ALERTAS_ACTIVAS}) AS monto`,
  );
  c.header("Cache-Control", cachePublico(120, { maxAge: 60, swr: 60 }));
  return c.json(r.rows[0]);
});

// ─── GET /entidades/:ruc ─────────────────────────────────────────
entidadesRouter.get("/:ruc", async (c) => {
  const ruc = c.req.param("ruc");
  if (!/^\d{11}$/.test(ruc)) return c.json({ error: "not_found" }, 404);
  const modelos = await hayModelosLectura();
  const [ent, mef, alertas] = await Promise.all([
    pool.query(modelos
      // alertas, monto y contratos desde entidad_stats; la cola, en vivo (1,5 ms con la migración 32).
      ? `SELECT e.*,
                COALESCE(es.alertas_activas, 0)::int AS alertas,
                COALESCE(es.monto_alertas_activas, 0)::float AS monto,
                COALESCE(es.contratos, 0)::int AS contratos,
                (SELECT count(*) FROM cola_auditoria q JOIN convocatorias c ON c.ocid = q.ocid WHERE c.entidad_ruc = e.ruc)::int AS "contratosEnCola",
                (SELECT z.nombre FROM zonas z WHERE z.ubigeo = e.ubigeo) AS "zonaNombre"
           FROM entidades e
           LEFT JOIN entidad_stats es ON es.ruc = e.ruc
          WHERE e.ruc = $1`
      : `SELECT e.*,
                COALESCE(a.alertas, 0)::int AS alertas,
                COALESCE(a.monto, 0)::float AS monto,
                (SELECT count(*) FROM convocatorias c WHERE c.entidad_ruc = e.ruc AND ${convocatoriaNoDemo("c")})::int AS contratos,
                (SELECT count(*) FROM cola_auditoria q JOIN convocatorias c ON c.ocid = q.ocid WHERE c.entidad_ruc = e.ruc)::int AS "contratosEnCola",
                (SELECT z.nombre FROM zonas z WHERE z.ubigeo = e.ubigeo) AS "zonaNombre"
           FROM entidades e
           LEFT JOIN (
             SELECT a.entidad_ruc, COUNT(*) AS alertas, SUM(a.monto_adjudicado) AS monto
             FROM alertas a WHERE ${ALERTAS_ACTIVAS} GROUP BY a.entidad_ruc
           ) a ON a.entidad_ruc = e.ruc
          WHERE e.ruc = $1`,
      [ruc],
    ),
    pool.query("SELECT * FROM mef_entity_budget WHERE entidad_ruc = $1", [ruc]),
    // Solo alertas PUBLICADAS y no demo: antes salían también las que están en revisión humana o
    // descartadas, con su score (no publicado).
    pool.query(
      `SELECT a.id, a.codigo, a.codigo_convocatoria, a.score, a.fecha_buena_pro,
              a.monto_adjudicado, a.estado, a.objeto, a.region
         FROM alertas a WHERE a.entidad_ruc = $1 AND ${alertaPublica("a")}
         ORDER BY a.score DESC, a.id LIMIT 20`,
      [ruc],
    ),
  ]);
  if (ent.rows.length === 0) return c.json({ error: "not_found" }, 404);
  // metadata sin las claves `*_mock` de seed_db.py (cifras inventadas).
  const entidad = ent.rows[0];
  if (entidad.metadata && typeof entidad.metadata === "object") {
    const limpia: Record<string, unknown> = { ...entidad.metadata };
    for (const k of ENTIDAD_METADATA_MOCK) delete limpia[k];
    entidad.metadata = limpia;
  }
  c.header("Cache-Control", cachePublico(120, { maxAge: 60, swr: 60 }));
  return c.json({
    entidad,
    mef: mef.rows[0] ?? null,
    alertas: alertas.rows,
  });
});
