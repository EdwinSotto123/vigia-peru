-- 16 · Cobertura: qué tiene Vigía de cada contrato, a ciencia cierta.
--
-- Por contrato: ¿tenemos el record completo (con parties/awards/contracts) o solo el release
-- recortado de /releasesAfter? ¿cuántos documentos lista el SEACE y cuántos tenemos vigentes en
-- GCS? ¿está clasificado? ¿analizado? Sirve al panel /admin/cobertura y a cualquier consulta
-- "¿ya bajamos X?". Todo sale de tablas que el pipeline ya escribe (convocatorias, documentos_gcs,
-- alertas, procesamientos); no hay una tabla aparte que pueda quedar desincronizada.

CREATE OR REPLACE VIEW cobertura_contratos AS
SELECT c.ocid,
       c.fecha_convocatoria::date                                   AS fecha,
       date_trunc('month', c.fecha_convocatoria)::date              AS mes,
       c.tipo_contratacion                                          AS tipo,
       c.etapa,
       c.procesable,
       (c.ocds_payload ? 'parties')                                 AS record_completo,
       c.updated_at                                                 AS record_actualizado_at,
       COALESCE(jsonb_array_length(c.ocds_payload->'tender'->'documents'), 0)
         + COALESCE((SELECT sum(jsonb_array_length(COALESCE(a->'documents','[]'::jsonb)))::int
                     FROM jsonb_array_elements(COALESCE(c.ocds_payload->'awards','[]'::jsonb)) a), 0)
         + COALESCE((SELECT sum(jsonb_array_length(COALESCE(k->'documents','[]'::jsonb)))::int
                     FROM jsonb_array_elements(COALESCE(c.ocds_payload->'contracts','[]'::jsonb)) k), 0)
                                                                    AS docs_publicados,
       (SELECT count(*)::int FROM documentos_gcs d
         WHERE ocid_corto(d.ocid) = ocid_corto(c.ocid) AND d.borrado_at IS NULL AND d.expira_at > now())
                                                                    AS docs_vigentes,
       (SELECT max(d.expira_at) FROM documentos_gcs d
         WHERE ocid_corto(d.ocid) = ocid_corto(c.ocid) AND d.borrado_at IS NULL AND d.expira_at > now())
                                                                    AS docs_expiran_at,
       EXISTS (SELECT 1 FROM alertas a WHERE ocid_corto(a.ocid) = ocid_corto(c.ocid))  AS analizado,
       (SELECT p.estado FROM procesamientos p WHERE ocid_corto(p.ocid) = ocid_corto(c.ocid) LIMIT 1)
                                                                    AS procesamiento
FROM convocatorias c;

-- Resumen agregado (una fila por mes de convocatoria): lo que consulta /admin/cobertura.
CREATE OR REPLACE FUNCTION cobertura_resumen()
RETURNS TABLE (mes DATE, contratos INT, con_record INT, con_docs INT, docs_publicados BIGINT, docs_vigentes BIGINT,
               clasificados INT, analizados INT, en_cola INT) LANGUAGE sql STABLE AS $$
  SELECT mes,
         count(*)::int,
         count(*) FILTER (WHERE record_completo)::int,
         count(*) FILTER (WHERE docs_vigentes > 0)::int,
         sum(docs_publicados)::bigint,
         sum(docs_vigentes)::bigint,
         count(*) FILTER (WHERE tipo IS NOT NULL)::int,
         count(*) FILTER (WHERE analizado)::int,
         count(*) FILTER (WHERE procesamiento IN ('encolado','procesando','esperando_documentos'))::int
  FROM cobertura_contratos
  GROUP BY mes ORDER BY mes DESC
$$;
