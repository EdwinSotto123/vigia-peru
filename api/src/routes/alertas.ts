import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";

export const alertasRouter = new Hono();

// ─── GET /alertas — lista con joins (entidad+proveedor) + banderas inline ──
const ListQuery = z.object({
  region: z.string().optional(),
  estado: z.enum(["activa", "descartada", "confirmada", "en_revision"]).optional(),
  scoreMin: z.coerce.number().int().min(0).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

alertasRouter.get("/", async (c) => {
  const parsed = ListQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const { region, estado, scoreMin, limit, offset } = parsed.data;

  const conds: string[] = [];
  const vals: any[] = [];
  if (region)            { vals.push(region);    conds.push(`a.region = $${vals.length}`); }
  if (estado)            { vals.push(estado);    conds.push(`a.estado = $${vals.length}`); }
  if (scoreMin != null)  { vals.push(scoreMin);  conds.push(`a.score >= $${vals.length}`); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  vals.push(limit, offset);
  const r = await pool.query(
    `SELECT
       a.id, a.codigo, a.codigo_convocatoria AS codigoconvocatoria,
       a.objeto, a.score, a.estado,
       a.entidad_ruc      AS "rucEntidad",
       COALESCE(e.nombre, '—')        AS entidad,
       a.proveedor_ruc    AS "rucProveedor",
       COALESCE(emp.razon_social, '—') AS proveedor,
       a.monto_adjudicado::float AS "montoSoles",
       to_char(a.fecha_buena_pro, 'YYYY-MM-DD') AS "fechaBuenaPro",
       a.region, a.provincia, a.distrito,
       a.unico_postor     AS "unicoPostor",
       a.edad_ruc_dias    AS "edadRucDias",
       a.fuente_url       AS "fuenteUrl",
       ST_Y(a.ubicacion_geo::geometry) AS lat,
       ST_X(a.ubicacion_geo::geometry) AS lon,
       COALESCE(
         (SELECT json_agg(
            json_build_object(
              'regla', b.regla,
              'severidad', b.severidad,
              'evidencia', b.evidencia,
              'norma', b.norma,
              'opinionOece', b.opinion_oece,
              'fuenteUrl', b.fuente_url
            ) ORDER BY
              CASE b.severidad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END
          )
          FROM banderas b WHERE b.alerta_id = a.id),
         '[]'::json
       ) AS banderas
     FROM alertas a
     LEFT JOIN entidades e   ON e.ruc   = a.entidad_ruc
     LEFT JOIN empresas  emp ON emp.ruc = a.proveedor_ruc
     ${where}
     ORDER BY a.score DESC, a.created_at DESC
     LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
    vals,
  );
  return c.json({ data: r.rows, limit, offset });
});

// ─── GET /alertas/analizadas — lista de análisis cacheados ────────
// Reemplaza al orquestador (action=list). Misma forma que _list_analyzed:
// { count, items: [...] }. Alimenta el autocomplete y "Análisis previos".
alertasRouter.get("/analizadas", async (c) => {
  const limit = Math.min(Number(new URL(c.req.url).searchParams.get("limit") ?? "20") || 20, 100);
  const r = await pool.query(
    `SELECT a.codigo, a.ocid, a.score,
            a.objeto, a.monto_adjudicado::float AS monto, a.region,
            to_char(a.fecha_buena_pro, 'YYYY-MM-DD') AS fecha_buena_pro,
            a.analizado_en,
            e.nombre AS entidad,
            a.entidad_ruc, a.proveedor_ruc,
            LENGTH(a.dictamen_markdown) AS dictamen_chars,
            COALESCE(bc.n_banderas, 0) AS n_banderas,
            COALESCE(bc.n_alta, 0)     AS n_alta,
            COALESCE(bc.n_media, 0)    AS n_media,
            COALESCE(bc.n_baja, 0)     AS n_baja
       FROM alertas a
       LEFT JOIN entidades e ON e.ruc = a.entidad_ruc
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS n_banderas,
                COUNT(*) FILTER (WHERE severidad='alta')  AS n_alta,
                COUNT(*) FILTER (WHERE severidad='media') AS n_media,
                COUNT(*) FILTER (WHERE severidad='baja')  AS n_baja
           FROM banderas WHERE alerta_id = a.id
       ) bc ON TRUE
      WHERE a.analizado_en IS NOT NULL OR a.score > 0 OR COALESCE(bc.n_banderas, 0) > 0
      ORDER BY COALESCE(a.analizado_en, a.created_at, a.updated_at) DESC NULLS LAST
      LIMIT $1`,
    [limit],
  );
  const items = r.rows.map((row) => ({
    codigo: row.codigo,
    ocid: row.ocid,
    codigo_convocatoria: (row.ocid ?? "").split("-").pop() ?? "",
    score: Number(row.score ?? 0),
    objeto: (row.objeto ?? "").slice(0, 200),
    monto: Number(row.monto ?? 0),
    region: row.region,
    fecha_buena_pro: row.fecha_buena_pro ?? null,
    analizado_en: row.analizado_en ? new Date(row.analizado_en).toISOString() : null,
    entidad: row.entidad,
    entidad_ruc: row.entidad_ruc,
    proveedor_ruc: row.proveedor_ruc,
    dictamen_chars: Number(row.dictamen_chars ?? 0),
    n_banderas: Number(row.n_banderas ?? 0),
    n_alta: Number(row.n_alta ?? 0),
    n_media: Number(row.n_media ?? 0),
    n_baja: Number(row.n_baja ?? 0),
  }));
  c.header("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
  return c.json({ count: items.length, items });
});

// ─── GET /alertas/:id/full — dossier completo cacheado ────────────
// Reemplaza al orquestador (action=load) para la NAVEGACIÓN. Lee analisis_full
// (inmutable una vez analizado) del mismo Cloud SQL. Misma forma que
// _load_analyzed → el adaptLoadedToUi del frontend lo consume sin cambios.
alertasRouter.get("/:id/full", async (c) => {
  const id = c.req.param("id");
  const r = await pool.query(
    `SELECT a.id, a.codigo, a.ocid, a.score, a.objeto,
            a.monto_adjudicado::float AS monto, a.region,
            to_char(a.fecha_buena_pro, 'YYYY-MM-DD') AS fecha_buena_pro,
            a.analizado_en, a.entidad_ruc, a.proveedor_ruc,
            a.analisis_full, a.dictamen_markdown,
            e.nombre AS entidad,
            cv.ocds_payload
       FROM alertas a
       LEFT JOIN entidades e    ON e.ruc   = a.entidad_ruc
       LEFT JOIN convocatorias cv ON cv.ocid = a.ocid
      WHERE a.id::text = $1 OR a.codigo = $1 OR a.ocid = $1 OR a.codigo_convocatoria = $1
      LIMIT 1`,
    [id],
  );
  if (r.rows.length === 0) return c.json({ error: "not_found", query: id }, 404);
  const row = r.rows[0];

  const b = await pool.query(
    `SELECT regla, severidad, evidencia, norma, fuente_url
       FROM banderas WHERE alerta_id = $1
      ORDER BY CASE severidad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END`,
    [row.id],
  );

  const an = row.analisis_full ?? {};
  const body = {
    alerta_codigo: row.codigo,
    ocid: row.ocid,
    score: Number(row.score ?? 0),
    objeto: row.objeto,
    monto: Number(row.monto ?? 0),
    region: row.region,
    fecha_buena_pro: row.fecha_buena_pro ?? null,
    analizado_en: row.analizado_en ? new Date(row.analizado_en).toISOString() : null,
    entidad_ruc: row.entidad_ruc,
    proveedor_ruc: row.proveedor_ruc,
    entidad: row.entidad,
    banderas: b.rows,
    market_analysis: an.market_analysis ?? null,
    document_analysis: an.document_analysis ?? null,
    web_research: an.web_research ?? null,
    news_research: an.news_research ?? null,
    person_network: an.person_network ?? null,
    person_network_context: an.person_network_context ?? null,
    entity_personnel: an.entity_personnel ?? null,
    normative_compliance: an.normative_compliance ?? null,
    causal_directa_invocada: an.causal_directa_invocada ?? null,
    acto_resolutivo_directa: an.acto_resolutivo_directa ?? null,
    estado_real: an.estado_real ?? null,
    analisis_postores: an.analisis_postores ?? null,
    agent_trace: an.agent_trace ?? [],
    llm_metrics: an.llm_metrics ?? null,
    self_evals: an.self_evals ?? null,
    dictamen_markdown: row.dictamen_markdown ?? "",
    ocds_payload: row.ocds_payload ?? null,
  };
  // Inmutable una vez analizado → cache agresivo en el edge y el browser.
  c.header("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  return c.json(body);
});

// ─── GET /alertas/:id — detalle ───────────────────────────────────
alertasRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const r = await pool.query(
    `SELECT
       a.*,
       e.nombre AS entidad_nombre,
       emp.razon_social AS proveedor_nombre,
       ST_Y(a.ubicacion_geo::geometry) AS lat,
       ST_X(a.ubicacion_geo::geometry) AS lon,
       COALESCE(
         (SELECT json_agg(b.* ORDER BY
            CASE b.severidad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END)
          FROM banderas b WHERE b.alerta_id = a.id),
         '[]'::json
       ) AS banderas,
       (SELECT payload FROM network_expansions
        WHERE alerta_id = a.id ORDER BY created_at DESC LIMIT 1) AS network,
       (SELECT row_to_json(c.*) FROM convergencias c
        WHERE c.alerta_id = a.id LIMIT 1) AS convergencia
     FROM alertas a
     LEFT JOIN entidades e   ON e.ruc   = a.entidad_ruc
     LEFT JOIN empresas  emp ON emp.ruc = a.proveedor_ruc
     WHERE a.id::text = $1 OR a.codigo = $1`,
    [id],
  );
  if (r.rows.length === 0) return c.json({ error: "not_found" }, 404);
  return c.json(r.rows[0]);
});

// ─── POST /alertas — crear ────────────────────────────────────────
const CreateBody = z.object({
  codigo: z.string(),
  ocid: z.string().optional(),
  entidad_ruc: z.string().length(11),
  proveedor_ruc: z.string().length(11).optional(),
  monto_adjudicado: z.number().nonnegative().optional(),
  fecha_buena_pro: z.string().optional(),
  region: z.string().optional(),
  score: z.number().int().min(0).max(100),
  reglas_disparadas: z.array(z.string()).default([]),
  banderas: z.array(z.object({
    regla: z.string(),
    severidad: z.enum(["alta", "media", "baja"]),
    evidencia: z.string().optional(),
    norma: z.string().optional(),
    opinion_oece: z.string().optional(),
    fuente_url: z.string().optional(),
    agente_origen: z.string().optional(),
  })).default([]),
});

alertasRouter.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const a = await client.query(
      `INSERT INTO alertas (codigo, ocid, entidad_ruc, proveedor_ruc, monto_adjudicado,
                            fecha_buena_pro, region, score, reglas_disparadas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [d.codigo, d.ocid, d.entidad_ruc, d.proveedor_ruc, d.monto_adjudicado,
       d.fecha_buena_pro, d.region, d.score, d.reglas_disparadas],
    );
    const alertaId = a.rows[0].id;
    for (const b of d.banderas) {
      await client.query(
        `INSERT INTO banderas (alerta_id, regla, severidad, evidencia, norma, opinion_oece, fuente_url, agente_origen)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [alertaId, b.regla, b.severidad, b.evidencia, b.norma, b.opinion_oece, b.fuente_url, b.agente_origen],
      );
    }
    await client.query("COMMIT");
    return c.json({ id: alertaId }, 201);
  } catch (e) {
    await client.query("ROLLBACK");
    return c.json({ error: "create_failed", detail: (e as Error).message }, 500);
  } finally {
    client.release();
  }
});
