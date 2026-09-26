/**
 * Alerta por id — detalle, dossier, traza, motivos de revisión y alta. Se monta bajo /alertas
 * después de las rutas fijas (alertas.ts).
 *
 *   GET  /alertas/:id               ficha: columnas explícitas (sin analisis_full ni el dictamen) + banderas
 *   GET  /alertas/:id/full          dossier completo; `?sinTraza=1` sin agent_trace/llm_metrics/self_evals
 *                                   y con traza_resumen {eventos, agentes, herramientas}
 *   GET  /alertas/:id/traza         {agent_trace, llm_metrics, self_evals} (pestaña "Cómo se hizo"), con ETag
 *   GET  /alertas/:id/revision      motivos públicos de la revisión humana
 *   POST /alertas                   alta (x-admin-token)
 *
 * `:id` = uuid (va por la PK) o código OECE-… (índice único); /full y /traza aceptan además OCID o
 * código de convocatoria, y /revision la forma corta del OCID. Sin `a.id::text = $1` (auditoría A13).
 */

import { Hono } from "hono";
import { z } from "zod";
import { pool, poolAdmin } from "../lib/db.js";
import { motivosRevision } from "./procesamientos.js";
import { candidatosAlerta, dossierCompleto, filaDossier, filaTraza } from "../lib/dossier.js";
import { tokenAdminValido } from "../lib/adminlog.js";
import { responderConEtag } from "../lib/cache.js";
import { cachePublico } from "../lib/http.js";
import {
  alertaNoDemo, convergenciaPublica, esAlertaDemo, esPublicada, latPublica, lonPublica, reporteIdsPublicos,
} from "../lib/publicacion.js";

export const alertasDetalleRouter = new Hono();

/** Caché del dossier: inmutable una vez analizado (publicada) o corta (en revisión / descartada). */
const CACHE_PUBLICADA = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
const CACHE_NO_PUBLICADA = cachePublico(60, { maxAge: 30 });

// ─── GET /alertas/:codigo/revision — motivos públicos de la revisión humana ─────────────
// Variante acotada de GET /admin/revision/:id: solo los motivos en lenguaje claro (sin el texto
// de los jueces ni datos sensibles). Acepta código de alerta (OECE-…), uuid u OCID.
alertasDetalleRouter.get("/:id/revision", async (c) => {
  const id = c.req.param("id");
  if (id.length > 80) return c.json({ error: "not_found" }, 404);
  const r = await pool.query(
    `WITH ${candidatosAlerta(id, { ocidCorto: true })}
     SELECT a.id, a.codigo, a.estado, a.analizado_en AS "analizadoEn" FROM cand JOIN alertas a ON a.id = cand.id
     WHERE ${alertaNoDemo("a")}
     ORDER BY a.analizado_en DESC NULLS LAST, a.id LIMIT 1`, [id]);
  const a = r.rows[0];
  if (!a) return c.json({ error: "not_found" }, 404);
  const motivos = a.estado === "revision" ? await motivosRevision(a.id).catch(() => []) : [];
  c.header("Cache-Control", cachePublico(30, { swr: 60 }));
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
// `?sinTraza=1` (frontend nuevo): sin las claves agent_trace, llm_metrics y self_evals (la traza es
// ~68 % del dossier y sólo la usa la pestaña "Cómo se hizo", que la pide a /traza) y con
// `traza_resumen`. Sin el parámetro, igual que siempre (el frontend de prod la sigue usando).
alertasDetalleRouter.get("/:id/full", async (c) => {
  const id = c.req.param("id");
  if (id.length > 80) return c.json({ error: "not_found", query: id.slice(0, 80) }, 404);
  const sinTraza = ["1", "true"].includes(c.req.query("sinTraza") ?? "");
  const row = await filaDossier(id, { sinTraza });
  if (!row) return c.json({ error: "not_found", query: id }, 404);
  const publicada = esPublicada(row.estado);

  // Alerta NO publicada (revision = la autoevaluación bloqueó la publicación; descartada = una
  // persona decidió no publicarla): el análisis entero queda fuera — score, señales, dictamen (que
  // puede ser justo el texto de tono acusatorio que se bloqueó), texto de los jueces y la salida de
  // cada agente (cada una trae sus propias señales: sobreprecio, sospechas de postores, prensa…).
  // Queda lo que ya es público (ficha del contrato y registro OCDS), el costo del análisis y el estado.
  // Los motivos, en lenguaje claro: GET /alertas/:id/revision.
  if (!publicada) {
    return responderConEtag(c, {
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
      ...(sinTraza
        ? { traza_resumen: { eventos: 0, agentes: [], herramientas: [] } }
        : { agent_trace: [], llm_metrics: row.analisis_full?.llm_metrics ?? null, self_evals: null }),
      dictamen_markdown: "",
      ocds_payload: row.ocds_payload ?? null,
    }, CACHE_NO_PUBLICADA);
  }

  // Inmutable una vez analizado → cache agresivo en el edge y el browser (con ETag).
  return responderConEtag(c, await dossierCompleto(row, { sinTraza }), CACHE_PUBLICADA);
});

// ─── GET /alertas/:id/traza — lo de la pestaña "Cómo se hizo" ──────
// {codigo, agent_trace, llm_metrics, self_evals}: lo que /full?sinTraza=1 deja afuera. Alerta no
// publicada: traza vacía y sin autoevaluación, sí el costo (lo mismo que /full muestra de ella).
alertasDetalleRouter.get("/:id/traza", async (c) => {
  const id = c.req.param("id");
  if (id.length > 80) return c.json({ error: "not_found" }, 404);
  const t = await filaTraza(id);
  if (!t) return c.json({ error: "not_found", query: id }, 404);
  if (!esPublicada(t.estado)) {
    return responderConEtag(c, { codigo: t.codigo, agent_trace: [], llm_metrics: t.llm_metrics ?? null, self_evals: null }, CACHE_NO_PUBLICADA);
  }
  return responderConEtag(c, { codigo: t.codigo, agent_trace: t.agent_trace ?? [], llm_metrics: t.llm_metrics ?? null, self_evals: t.self_evals ?? null }, CACHE_PUBLICADA);
});

// ─── GET /alertas/:id — ficha ─────────────────────────────────────
// Columnas explícitas (auditoría A13): sin analisis_full (~100 KB por alerta) ni el dictamen
// completo, que están en /full. Quien lee esta ficha (frontend: denuncias/[id]) usa
// codigo_convocatoria, objeto, score y monto_adjudicado.
const COLS_FICHA = `a.id, a.codigo, a.ocid, a.entidad_ruc, a.proveedor_ruc, a.monto_adjudicado, a.fecha_buena_pro, a.region,
  a.score, a.estado, a.reglas_disparadas, a.created_at, a.updated_at, a.objeto, a.codigo_convocatoria, a.provincia,
  a.distrito, a.unico_postor, a.edad_ruc_dias, a.fuente_url, a.analizado_en, a.monto_referencial,
  length(a.dictamen_markdown) AS dictamen_chars`;

alertasDetalleRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (id.length > 80) return c.json({ error: "not_found" }, 404);
  const r = await pool.query(
    `WITH ${candidatosAlerta(id)}
     SELECT
       ${COLS_FICHA},
       e.nombre AS entidad_nombre,
       emp.razon_social AS proveedor_nombre,
       ST_Y(a.ubicacion_geo::geometry) AS lat,
       ST_X(a.ubicacion_geo::geometry) AS lon,
       COALESCE(
         (SELECT json_agg(b.* ORDER BY
            CASE b.severidad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, b.id)
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
     FROM cand
     JOIN alertas a ON a.id = cand.id
     LEFT JOIN entidades e   ON e.ruc   = a.entidad_ruc
     LEFT JOIN empresas  emp ON emp.ruc = a.proveedor_ruc
     WHERE ${alertaNoDemo("a")}
     ORDER BY a.analizado_en DESC NULLS LAST, a.updated_at DESC NULLS LAST
     LIMIT 1`,
    [id],
  );
  if (r.rows.length === 0) return c.json({ error: "not_found" }, 404);
  const row = r.rows[0];
  if (esAlertaDemo(row.codigo)) return c.json({ error: "not_found" }, 404);
  if (esPublicada(row.estado)) {
    c.header("Cache-Control", cachePublico(60, { maxAge: 30 }));
    return c.json({ ...row, publicada: true, enRevision: false });
  }
  // No publicada (revision / descartada): existe, pero sin score, señales, reglas, dictamen ni
  // análisis — ver GET /alertas/:id/full y /alertas/:id/revision.
  c.header("Cache-Control", CACHE_NO_PUBLICADA);
  return c.json({
    ...row,
    publicada: false,
    enRevision: row.estado === "revision",
    score: null,
    banderas: null,
    reglas_disparadas: null,
    dictamen_chars: null,
    network: null,
    convergencia: null,
  });
});

// ─── POST /alertas — crear ────────────────────────────────────────
const CreateBody = z.object({
  codigo: z.string().max(80),
  ocid: z.string().max(120).optional(),
  entidad_ruc: z.string().length(11),
  proveedor_ruc: z.string().length(11).optional(),
  monto_adjudicado: z.number().nonnegative().optional(),
  fecha_buena_pro: z.string().max(10).optional(),
  region: z.string().max(80).optional(),
  score: z.number().int().min(0).max(100),
  reglas_disparadas: z.array(z.string().max(120)).max(200).default([]),
  banderas: z.array(z.object({
    regla: z.string().max(120),
    severidad: z.enum(["alta", "media", "baja"]),
    evidencia: z.string().optional(),
    norma: z.string().optional(),
    opinion_oece: z.string().optional(),
    fuente_url: z.string().optional(),
    agente_origen: z.string().optional(),
  })).max(200).default([]),
});

// Crear una alerta publica una señal de riesgo sobre una entidad real: nunca
// puede quedar abierto. Antes no pedía nada y cualquiera podía publicar una
// alerta con banderas inventadas. Mismo candado que /admin (x-admin-token).
alertasDetalleRouter.post("/", async (c, next) => {
  if (!tokenAdminValido(c)) return c.json({ error: "forbidden" }, 403);
  await next();
});

alertasDetalleRouter.post("/", async (c) => {
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;

  // Escritura del lado admin/agentes: pool del panel (con roles, el rol público no escribe alertas).
  const client = await poolAdmin.connect();
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
    c.header("Cache-Control", "private, no-store");
    return c.json({ id: alertaId }, 201);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    // 23505: ya existe una alerta con ese código. Lo demás lo registra index.ts sin mandar el mensaje.
    if ((e as { code?: string })?.code === "23505") return c.json({ error: "create_failed", detail: "codigo_duplicado" }, 409);
    throw e;
  } finally {
    client.release();
  }
});
