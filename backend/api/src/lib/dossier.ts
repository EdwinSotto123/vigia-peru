/**
 * Dossier completo de una alerta: búsqueda + armado. Lo usan GET /alertas/:id/full (routes/alertas.ts)
 * y GET /admin/revision/:id/informe (routes/admin_revision.ts). Vive acá y no en alertas.ts para
 * cortar el ciclo de imports alertas → procesamientos → admin_revision → alertas.
 */

import { OCID_CANDIDATOS, pool } from "./db.js";
import { alertaNoDemo, esPublicada } from "./publicacion.js";

/** Fila de `alertas` (+ entidad y registro OCDS) con la que se arma el dossier. */
export interface FilaDossier {
  id: string; codigo: string; ocid: string | null; score: number | null; estado: string; objeto: string | null;
  monto: number | null; region: string | null; fecha_buena_pro: string | null; analizado_en: Date | string | null;
  entidad_ruc: string | null; proveedor_ruc: string | null; analisis_full: Record<string, any> | null;
  dictamen_markdown: string | null; entidad: string | null; ocds_payload: unknown;
}

/** Busca la alerta por uuid, código (OECE-…), OCID o código de convocatoria. Sin semillas de demo. */
export async function filaDossier(id: string): Promise<FilaDossier | null> {
  // La convocatoria (registro OCDS) se une por OCID corto o largo: la alerta y la convocatoria pueden
  // guardar formas distintas y antes `cv.ocid = a.ocid` sólo unía la idéntica (el dossier salía sin
  // OCDS). Por PK con OCID_CANDIDATOS (lib/db.ts), sin recorrer convocatorias.
  const r = await pool.query(
    `SELECT a.id, a.codigo, a.ocid, a.score, a.estado, a.objeto,
            a.monto_adjudicado::float AS monto, a.region,
            to_char(a.fecha_buena_pro, 'YYYY-MM-DD') AS fecha_buena_pro,
            a.analizado_en, a.entidad_ruc, a.proveedor_ruc,
            a.analisis_full, a.dictamen_markdown,
            e.nombre AS entidad,
            cv.ocds_payload
       FROM alertas a
       LEFT JOIN entidades e    ON e.ruc   = a.entidad_ruc
       LEFT JOIN convocatorias cv ON cv.ocid = ANY(${OCID_CANDIDATOS("a.ocid")}) AND ocid_corto(cv.ocid) = ocid_corto(a.ocid)
      WHERE (a.id::text = $1 OR a.codigo = $1 OR a.ocid = $1 OR a.codigo_convocatoria = $1)
        AND ${alertaNoDemo("a")}
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

/**
 * El dossier ENTERO de una alerta: señales, salida de cada agente, traza, autoevaluación y dictamen.
 * Es lo que ve el público cuando la alerta está publicada. No mira el estado: la ruta pública solo lo
 * llama para alertas publicadas; el panel admin lo usa para previsualizar una alerta en revisión tal
 * como se verá al publicarla. `publicada` / `enRevision` dicen la verdad en ambos casos.
 */
export async function dossierCompleto(row: FilaDossier) {
  const b = await pool.query(
    `SELECT regla, severidad, evidencia, norma, fuente_url
       FROM banderas WHERE alerta_id = $1
      ORDER BY CASE severidad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END`,
    [row.id],
  );

  const an = row.analisis_full ?? {};
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
}
