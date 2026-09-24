import { Hono } from "hono";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { motivosRevision } from "./procesamientos.js";
// Dossier completo (búsqueda + armado): compartido con GET /admin/revision/:id/informe.
import { dossierCompleto, filaDossier } from "../lib/dossier.js";
import { tokenAdminValido } from "../lib/adminlog.js";
import {
  alertaNoDemo, alertaPublica, convergenciaPublica, esAlertaDemo, esPublicada, latPublica, lonPublica, reporteIdsPublicos,
} from "../lib/publicacion.js";

export const alertasRouter = new Hono();

// ─── GET /alertas — lista con joins (entidad+proveedor) + banderas inline ──
//   ?region=&estado=&scoreMin=&conSenales=true&limit=&offset=
//   · Solo alertas PUBLICADAS (activa/confirmada) y no demo — ver lib/publicacion.ts. Las que la
//     autoevaluación bloqueó (`revision`) o una persona descartó (`descartada`) no se listan: sus
//     motivos públicos están en GET /alertas/:id/revision. `estado=descartada|en_revision` es válido
//     pero no devuelve filas.
//   · `conSenales=true`: solo contratos con ≥ 1 bandera (los analizados sin señal traen
//     `banderas = []` y score 0). `total` refleja el mismo filtro. Sin el parámetro: todas, como antes.
const ListQuery = z.object({
  region: z.string().optional(),
  estado: z.enum(["activa", "descartada", "confirmada", "en_revision"]).optional(),
  scoreMin: z.coerce.number().int().min(0).max(100).optional(),
  conSenales: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

alertasRouter.get("/", async (c) => {
  const parsed = ListQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  const { region, estado, scoreMin, conSenales, limit, offset } = parsed.data;

  // Base: publicada y no demo (antes solo `estado <> 'revision'`: se colaban las descartadas y las semillas).
  const conds: string[] = [alertaPublica("a")];
  const vals: any[] = [];
  if (region)            { vals.push(region);    conds.push(`a.region = $${vals.length}`); }
  if (estado)            { vals.push(estado);    conds.push(`a.estado = $${vals.length}`); }
  if (scoreMin != null)  { vals.push(scoreMin);  conds.push(`a.score >= $${vals.length}`); }
  if (conSenales === "true") conds.push(`EXISTS (SELECT 1 FROM banderas bx WHERE bx.alerta_id = a.id)`);
  const where = `WHERE ${conds.join(" AND ")}`;

  const totalVals = [...vals];
  vals.push(limit, offset);
  const [r, total] = await Promise.all([
    pool.query(
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
    ),
    // Mismo WHERE que arriba, sin los joins (no filtran por columnas de entidades/empresas).
    pool.query(`SELECT count(*)::int AS n FROM alertas a ${where}`, totalVals),
  ]);
  return c.json({ data: r.rows, total: total.rows[0].n, limit, offset });
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
      WHERE (a.analizado_en IS NOT NULL OR a.score > 0 OR COALESCE(bc.n_banderas, 0) > 0)
        AND ${alertaPublica("a")}
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

// ─── GET /alertas/:codigo/revision — motivos públicos de la revisión humana ─────────────
// Variante acotada de GET /admin/revision/:id: solo los motivos en lenguaje claro (sin el texto
// de los jueces ni datos sensibles). Acepta código de alerta (OECE-…), uuid u OCID.
alertasRouter.get("/:id/revision", async (c) => {
  const id = c.req.param("id");
  const r = await pool.query(
    `SELECT a.id, a.codigo, a.estado, a.analizado_en AS "analizadoEn" FROM alertas a
     WHERE (a.codigo = $1 OR a.id::text = $1 OR (a.ocid IS NOT NULL AND ocid_corto(a.ocid) = ocid_corto($1)))
       AND ${alertaNoDemo("a")}
     ORDER BY a.analizado_en DESC NULLS LAST LIMIT 1`, [id]).catch(() => ({ rows: [] as any[] }));
  const a = r.rows[0];
  if (!a) return c.json({ error: "not_found" }, 404);
  const motivos = a.estado === "revision" ? await motivosRevision(a.id).catch(() => []) : [];
  c.header("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
  return c.json({
    codigo: a.codigo, estado: a.estado, analizadoEn: a.analizadoEn, enRevision: a.estado === "revision", motivos,
    queSignifica: a.estado === "revision"
      ? "El análisis terminó, pero la autoevaluación (4 jueces independientes + 4 comprobaciones en código) no alcanzó el umbral para publicarlo. Una persona lo revisa y decide publicar o descartar. Mientras tanto no cuenta como señal hallada."
      : a.estado === "descartada" ? "Una persona revisó el análisis y decidió no publicarlo." : "Publicado.",
  });
});

// ─── GET /alertas/:id/full — dossier completo cacheado ────────────
// Reemplaza al orquestador (action=load) para la NAVEGACIÓN. Lee analisis_full
// (inmutable una vez analizado) del mismo Cloud SQL. Misma forma que
// _load_analyzed → el adaptLoadedToUi del frontend lo consume sin cambios.
alertasRouter.get("/:id/full", async (c) => {
  const id = c.req.param("id");
  const row = await filaDossier(id);
  if (!row) return c.json({ error: "not_found", query: id }, 404);
  const publicada = esPublicada(row.estado);

  // Alerta NO publicada (revision = la autoevaluación bloqueó la publicación; descartada = una
  // persona decidió no publicarla): el análisis entero queda fuera — score, señales, dictamen (que
  // puede ser justo el texto de tono acusatorio que se bloqueó), texto de los jueces y la salida de
  // cada agente (cada una trae sus propias señales: sobreprecio, sospechas de postores, prensa…).
  // Queda lo que ya es público (ficha del contrato y registro OCDS), el costo del análisis y el estado.
  // Los motivos, en lenguaje claro: GET /alertas/:id/revision.
  if (!publicada) {
    c.header("Cache-Control", "public, max-age=30, s-maxage=60");
    return c.json({
      alerta_codigo: row.codigo,
      ocid: row.ocid,
      estado: row.estado,
      publicada: false,
      enRevision: row.estado === "revision",
      score: null,
      objeto: row.objeto,
      monto: Number(row.monto ?? 0),
      region: row.region,
      fecha_buena_pro: row.fecha_buena_pro ?? null,
      analizado_en: row.analizado_en ? new Date(row.analizado_en).toISOString() : null,
      entidad_ruc: row.entidad_ruc,
      proveedor_ruc: row.proveedor_ruc,
      entidad: row.entidad,
      banderas: null,
      market_analysis: null,
      document_analysis: null,
      web_research: null,
      news_research: null,
      person_network: null,
      person_network_context: null,
      entity_personnel: null,
      normative_compliance: null,
      causal_directa_invocada: null,
      acto_resolutivo_directa: null,
      estado_real: null,
      analisis_postores: null,
      agent_trace: [],
      llm_metrics: row.analisis_full?.llm_metrics ?? null,
      self_evals: null,
      dictamen_markdown: "",
      ocds_payload: row.ocds_payload ?? null,
    });
  }

  const body = await dossierCompleto(row);
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
       -- Convergencia pública (no demo, con ≥ 1 reporte público): coordenadas redondeadas y
       -- solo los ids de reportes públicos. Antes row_to_json(c.*) sacaba el punto exacto.
       (SELECT json_build_object('id', c.id, 'reporteIds', ${reporteIdsPublicos("c")},
                                 'lat', ${latPublica("c.ubicacion_geo")}, 'lon', ${lonPublica("c.ubicacion_geo")},
                                 'resumen', c.resumen)
          FROM convergencias c
         WHERE c.alerta_id = a.id AND ${convergenciaPublica("c")}
         ORDER BY c.created_at DESC LIMIT 1) AS convergencia
     FROM alertas a
     LEFT JOIN entidades e   ON e.ruc   = a.entidad_ruc
     LEFT JOIN empresas  emp ON emp.ruc = a.proveedor_ruc
     WHERE (a.id::text = $1 OR a.codigo = $1) AND ${alertaNoDemo("a")}
     ORDER BY a.analizado_en DESC NULLS LAST, a.updated_at DESC NULLS LAST
     LIMIT 1`,
    [id],
  );
  if (r.rows.length === 0) return c.json({ error: "not_found" }, 404);
  // `moderacion` ({accion, actor, motivo, at}) es la bitácora interna del panel admin: no se publica.
  const { moderacion: _moderacion, ...row } = r.rows[0];
  if (esAlertaDemo(row.codigo)) return c.json({ error: "not_found" }, 404);
  if (esPublicada(row.estado)) return c.json({ ...row, publicada: true, enRevision: false });
  // No publicada (revision / descartada): existe, pero sin score, señales, reglas, dictamen ni
  // análisis — ver GET /alertas/:id/full y /alertas/:id/revision.
  return c.json({
    ...row,
    publicada: false,
    enRevision: row.estado === "revision",
    score: null,
    banderas: null,
    reglas_disparadas: null,
    analisis_full: null,
    dictamen_markdown: null,
    network: null,
    convergencia: null,
  });
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

// Crear una alerta publica una señal de riesgo sobre una entidad real: nunca
// puede quedar abierto. Antes no pedía nada y cualquiera podía publicar una
// alerta con banderas inventadas. Mismo candado que /admin (x-admin-token).
alertasRouter.post("/", async (c, next) => {
  if (!tokenAdminValido(c)) return c.json({ error: "forbidden" }, 403);
  await next();
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
        // Índice único (alerta_id, regla, md5(evidencia)) de la migración 27: un duplicado se omite.
        `INSERT INTO banderas (alerta_id, regla, severidad, evidencia, norma, opinion_oece, fuente_url, agente_origen)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING`,
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
