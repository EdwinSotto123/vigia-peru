/**
 * Dossier completo de una alerta: búsqueda + armado. Lo usan GET /alertas/:id/full y /traza
 * (routes/alertas_detalle.ts) y GET /admin/revision/:id/informe (routes/admin_revision.ts). Vive
 * acá y no en una ruta para cortar el ciclo de imports alertas → procesamientos → admin_revision.
 *
 * Búsqueda por forma (auditoría A13): un UUID va por la PK (`a.id = $1::uuid`); cualquier otra cosa
 * por código, OCID o código de convocatoria, cada rama por su índice. Antes era
 * `a.id::text = $1 OR a.codigo = $1 OR …`: el cast anulaba el índice y recorría la tabla.
 */

import { OCID_CANDIDATOS, pool } from "./db.js";
import { alertaNoDemo, esPublicada } from "./publicacion.js";

export const esUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/**
 * CTE `cand(id)` con las alertas que responden a `$1`: por uuid, o por código / OCID / código de
 * convocatoria (tres ramas indexadas). `conOcidCorto` agrega la forma corta del OCID (índice
 * alertas_ocid_corto_idx), como hacía /alertas/:id/revision.
 */
export function candidatosAlerta(id: string, opts: { ocid?: boolean; codigoConvocatoria?: boolean; ocidCorto?: boolean } = {}): string {
  if (esUuid(id)) return `cand AS (SELECT a.id FROM alertas a WHERE a.id = $1::uuid)`;
  const ramas = [`SELECT a.id FROM alertas a WHERE a.codigo = $1`];
  if (opts.ocid) ramas.push(`SELECT a.id FROM alertas a WHERE a.ocid = $1`);
  if (opts.codigoConvocatoria) ramas.push(`SELECT a.id FROM alertas a WHERE a.codigo_convocatoria = $1`);
  if (opts.ocidCorto) ramas.push(`SELECT a.id FROM alertas a WHERE a.ocid IS NOT NULL AND ocid_corto(a.ocid) = ocid_corto($1)`);
  return `cand AS (${ramas.join(" UNION ")})`;
}

/**
 * Resumen de la traza en SQL, sin mandarla: cuántos eventos, qué agentes dejaron rastro (nombre
 * crudo; el frontend lo pasa por su catálogo) y qué herramientas se llamaron. Mismas reglas que
 * `resumirTraza` de frontend/components/convocatoria/dossier.ts.
 */
const TRAZA_RESUMEN_SQL = `(SELECT json_build_object(
    'eventos', COALESCE(jsonb_array_length(t.v), 0),
    'agentes', COALESCE((SELECT json_agg(DISTINCT x.nombre) FROM jsonb_array_elements(t.v) e,
                 LATERAL (VALUES (e->>'agent'),
                                 (CASE WHEN e->>'kind' = 'tool_call' AND e->>'name' ~ '_agent$' THEN e->>'name' END),
                                 (CASE WHEN e->>'kind' = 'tool_call' AND e->>'name' ~ '^analyze_market' THEN 'market_price_agent' END),
                                 (CASE WHEN e->>'kind' = 'transfer' AND e->>'to' ~ '_agent$' THEN e->>'to' END)) x(nombre)
                WHERE x.nombre IS NOT NULL AND x.nombre <> ''), '[]'::json),
    'herramientas', COALESCE((SELECT json_agg(DISTINCT e->>'name') FROM jsonb_array_elements(t.v) e
                WHERE e->>'kind' = 'tool_call' AND COALESCE(e->>'name', '') <> ''), '[]'::json))
  FROM (SELECT CASE WHEN jsonb_typeof(a.analisis_full->'agent_trace') = 'array' THEN a.analisis_full->'agent_trace' END AS v) t)`;

/** Fila de `alertas` (+ entidad y registro OCDS) con la que se arma el dossier. */
export interface FilaDossier {
  id: string; codigo: string; ocid: string | null; score: number | null; estado: string; objeto: string | null;
  monto: number | null; region: string | null; fecha_buena_pro: string | null; analizado_en: Date | string | null;
  entidad_ruc: string | null; proveedor_ruc: string | null; analisis_full: Record<string, any> | null;
  dictamen_markdown: string | null; entidad: string | null; ocds_payload: unknown;
  /** Sólo con `sinTraza`: {eventos, agentes, herramientas}. */
  traza_resumen?: { eventos: number; agentes: string[]; herramientas: string[] } | null;
}

/**
 * Busca la alerta por uuid, código (OECE-…), OCID o código de convocatoria. Sin semillas de demo.
 * `sinTraza`: analisis_full llega sin agent_trace, llm_metrics ni self_evals (la traza es ~68 % del
 * dossier) y con `traza_resumen` calculado en la base.
 */
export async function filaDossier(id: string, opts: { sinTraza?: boolean } = {}): Promise<FilaDossier | null> {
  // La convocatoria (registro OCDS) se une por OCID corto o largo: la alerta y la convocatoria pueden
  // guardar formas distintas y antes `cv.ocid = a.ocid` sólo unía la idéntica (el dossier salía sin
  // OCDS). Por PK con OCID_CANDIDATOS (lib/db.ts), sin recorrer convocatorias.
  const analisis = opts.sinTraza
    ? `a.analisis_full - 'agent_trace' - 'llm_metrics' - 'self_evals' AS analisis_full, ${TRAZA_RESUMEN_SQL} AS traza_resumen`
    : `a.analisis_full`;
  const r = await pool.query(
    `WITH ${candidatosAlerta(id, { ocid: true, codigoConvocatoria: true })}
     SELECT a.id, a.codigo, a.ocid, a.score, a.estado, a.objeto,
            a.monto_adjudicado::float AS monto, a.region,
            to_char(a.fecha_buena_pro, 'YYYY-MM-DD') AS fecha_buena_pro,
            a.analizado_en, a.entidad_ruc, a.proveedor_ruc,
            ${analisis}, a.dictamen_markdown,
            e.nombre AS entidad,
            cv.ocds_payload
       FROM cand
       JOIN alertas a ON a.id = cand.id
       LEFT JOIN entidades e    ON e.ruc   = a.entidad_ruc
       LEFT JOIN convocatorias cv ON cv.ocid = ANY(${OCID_CANDIDATOS("a.ocid")}) AND ocid_corto(cv.ocid) = ocid_corto(a.ocid)
      WHERE ${alertaNoDemo("a")}
      -- Determinismo: si varias filas matchean (p.ej. mismo codigo_convocatoria
      -- por reprocesos), devolver SIEMPRE el análisis MÁS RECIENTE. Sin ORDER BY,
      -- LIMIT 1 es no-determinista y la data mostrada "cambia" entre cargas.
      -- Si la convocatoria está con las dos formas del OCID, gana la idéntica y luego la menor.
      ORDER BY a.analizado_en DESC NULLS LAST, a.updated_at DESC NULLS LAST,
               (cv.ocid = a.ocid) DESC NULLS LAST, cv.ocid
      LIMIT 1`,
    [id],
  );
  return r.rows[0] ?? null;
}

/** Lo que usa la pestaña "Cómo se hizo": traza, métricas y autoevaluación de UNA alerta. */
export async function filaTraza(id: string): Promise<{ codigo: string; estado: string; agent_trace: unknown; llm_metrics: unknown; self_evals: unknown } | null> {
  const r = await pool.query(
    `WITH ${candidatosAlerta(id, { ocid: true, codigoConvocatoria: true })}
     SELECT a.codigo, a.estado,
            COALESCE(a.analisis_full->'agent_trace', '[]'::jsonb) AS agent_trace,
            a.analisis_full->'llm_metrics' AS llm_metrics,
            a.analisis_full->'self_evals' AS self_evals
       FROM cand JOIN alertas a ON a.id = cand.id
      WHERE ${alertaNoDemo("a")}
      ORDER BY a.analizado_en DESC NULLS LAST, a.updated_at DESC NULLS LAST
      LIMIT 1`,
    [id],
  );
  return r.rows[0] ?? null;
}

/**
 * El dossier ENTERO de una alerta: señales, salida de cada agente, traza, autoevaluación y dictamen.
 * Es lo que ve el público cuando la alerta está publicada. No mira el estado: la ruta pública solo lo
 * llama para alertas publicadas; el panel admin lo usa para previsualizar una alerta en revisión tal
 * como se verá al publicarla. `publicada` / `enRevision` dicen la verdad en ambos casos.
 * `sinTraza`: sin las claves agent_trace, llm_metrics ni self_evals (ni siquiera vacías) y con
 * `traza_resumen`.
 */
export async function dossierCompleto(row: FilaDossier, opts: { sinTraza?: boolean } = {}) {
  const b = await pool.query(
    `SELECT regla, severidad, evidencia, norma, fuente_url
       FROM banderas WHERE alerta_id = $1
      ORDER BY CASE severidad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, id`,
    [row.id],
  );

  const an = row.analisis_full ?? {};
  const traza = opts.sinTraza
    ? { traza_resumen: row.traza_resumen ?? { eventos: 0, agentes: [], herramientas: [] } }
    : { agent_trace: an.agent_trace ?? [], llm_metrics: an.llm_metrics ?? null, self_evals: an.self_evals ?? null };
  return {
    alerta_codigo: row.codigo,
    ocid: row.ocid,
    estado: row.estado,
    publicada: esPublicada(row.estado),
    enRevision: row.estado === "revision",
    score: Number(row.score ?? 0),
    objeto: row.objeto,
    monto: Number(row.monto ?? 0),
    region: row.region,
    fecha_buena_pro: row.fecha_buena_pro ?? null,
    analizado_en: row.analizado_en ? new Date(row.analizado_en).toISOString() : null,
    entidad_ruc: row.entidad_ruc,
    proveedor_ruc: row.proveedor_ruc,
    entidad: row.entidad,
    perfil: typeof an.perfil === "string" ? an.perfil : null,
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
    ...traza,
    dictamen_markdown: row.dictamen_markdown ?? "",
    ocds_payload: row.ocds_payload ?? null,
  };
}
