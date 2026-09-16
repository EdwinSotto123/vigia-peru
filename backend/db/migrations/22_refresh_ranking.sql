-- ─────────────────────────────────────────────────────────────────────────────
-- 22 · Las cifras dicen la verdad (plan 2026-09-16, iteraciones U1 + U4).
--
--  · "Señal hallada" = contrato con alerta PUBLICADA (activa/confirmada) y ≥ 1 bandera.
--    Las alertas en `revision` (bloqueadas por la autoevaluación) cuentan como
--    "procesadas" pero NO como señales; se exponen aparte como `en_revision`.
--  · zona_estado se reescribe con CTEs materializados: la versión de 09 volvía a
--    evaluar la vista cola_auditoria por cada una de las ~2 000 zonas (85 s por
--    refresh). Ahora se calcula una vez y se agrega por prefijo de ubigeo.
--    Suma `documentos_listos`: contratos de tipos/etapas aún NO activos con
--    documentos vigentes en GCS (análisis en preparación) — lo que el mapa muestra
--    aparte de la cola financiable.
--  · ranking_impacto: mismas dos correcciones (senales_halladas, en_revision).
--  · El dispatcher refresca ranking_impacto al cerrar cada contrato (0.3 s) y
--    zona_estado al final de cada corrida; los endpoints de aliado/comprobante ya
--    calculan en vivo desde `asignaciones`.
--  · ajustes.self_eval: umbrales de la autoevaluación, editables desde /admin/revision.
--    El pipeline los lee de variables de entorno (EVAL_MIN_*); la API los usa para
--    explicar el motivo del bloqueo cuando la bitácora del procesamiento no lo trae.
--  · alertas.moderacion: quién publicó/descartó una alerta en revisión y por qué.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION alerta_publicada(p_estado TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$ SELECT p_estado IN ('activa', 'confirmada') $$;

ALTER TABLE alertas ADD COLUMN IF NOT EXISTS moderacion JSONB;
COMMENT ON COLUMN alertas.moderacion IS
  'Resolución humana de una alerta en revision: {accion: publicar|descartar, actor, motivo, at}. Lo escribe PUT /admin/alertas/:id/estado.';

CREATE INDEX IF NOT EXISTS admin_log_objeto_idx ON admin_log (objeto);

INSERT INTO ajustes (clave, valor) VALUES ('self_eval', '{
  "min_respaldo": 0.6,
  "min_cita": 0.8,
  "min_precio": 0.5,
  "bloquea_tono": true,
  "bloquea_coherencia": true,
  "nota": "El pipeline aplica estos umbrales desde las variables EVAL_MIN_RESPALDO / EVAL_MIN_CITA / EVAL_MIN_PRECIO / EVAL_BLOQUEA_TONO / EVAL_BLOQUEA_COHERENCIA de los servicios de agentes; cambiarlos aquí ajusta la explicación del panel y debe replicarse en el deploy."
}'::jsonb) ON CONFLICT (clave) DO NOTHING;

-- ── Estado por zona ──────────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS zona_estado;
CREATE MATERIALIZED VIEW zona_estado AS
WITH cola AS MATERIALIZED (
  SELECT ubigeo::text AS ubigeo FROM cola_auditoria
),
docs AS MATERIALIZED (
  -- Tipos/etapas fuera del alcance activo, con documentos vigentes en GCS, sin analizar.
  SELECT cz.ubigeo::text AS ubigeo
  FROM convocatoria_zona cz
  JOIN convocatorias c ON c.ocid = cz.ocid
  WHERE cz.ubigeo IS NOT NULL
    AND NOT procesamiento_activo(c.tipo_contratacion, c.etapa)
    AND EXISTS (SELECT 1 FROM documentos_gcs d
                 WHERE ocid_corto(d.ocid) = ocid_corto(c.ocid) AND d.borrado_at IS NULL AND d.expira_at > now())
    AND NOT EXISTS (SELECT 1 FROM alertas a WHERE ocid_corto(a.ocid) = ocid_corto(c.ocid))
),
aportes AS MATERIALIZED (
  SELECT c.ubigeo, c.contratos FROM contribuciones c WHERE c.estado IN ('pagada','en_proceso','procesada')
),
asig AS MATERIALIZED (
  SELECT c.ubigeo,
         (s.procesada_at IS NOT NULL)                                            AS procesada,
         (a.id IS NOT NULL AND alerta_publicada(a.estado)
            AND EXISTS (SELECT 1 FROM banderas b WHERE b.alerta_id = a.id))       AS con_senal,
         (a.estado = 'revision')                                                 AS en_revision
  FROM asignaciones s
  JOIN contribuciones c ON c.id = s.contribucion_id
  LEFT JOIN alertas a ON a.id = s.alerta_id
),
tarifa AS (SELECT precio_pen, precio_usd FROM tarifas ORDER BY vigente_desde DESC LIMIT 1)
SELECT z.ubigeo, z.nivel, z.nombre, z.padre_ubigeo, z.lat, z.lon,
       t.precio_pen, t.precio_usd,
       q.pendientes,
       f.financiados,
       f.contribuciones,
       p.asignados,
       p.procesados,
       p.senales,
       (q.pendientes + p.asignados)                       AS total_cola,   -- en cola + ya asignados (procesados o no)
       CASE
         WHEN q.pendientes + p.asignados = 0               THEN 'sin_datos'
         WHEN p.procesados >= q.pendientes + p.asignados   THEN 'procesada'
         WHEN f.financiados >= q.pendientes + p.asignados  THEN 'financiada'
         WHEN f.financiados > 0                            THEN 'parcial'
         ELSE 'pendiente'
       END AS estado,
       p.en_revision,
       d.documentos_listos
FROM zonas z
CROSS JOIN tarifa t
CROSS JOIN LATERAL (SELECT count(*)::int AS pendientes FROM cola q WHERE q.ubigeo LIKE z.ubigeo || '%') q
CROSS JOIN LATERAL (SELECT count(*)::int AS documentos_listos FROM docs x WHERE x.ubigeo LIKE z.ubigeo || '%') d
CROSS JOIN LATERAL (
  SELECT COALESCE(sum(contratos), 0)::int AS financiados, count(*)::int AS contribuciones
  FROM aportes c WHERE c.ubigeo LIKE z.ubigeo || '%'
) f
CROSS JOIN LATERAL (
  SELECT count(*)::int                              AS asignados,
         count(*) FILTER (WHERE procesada)::int     AS procesados,
         count(*) FILTER (WHERE con_senal)::int     AS senales,
         count(*) FILTER (WHERE en_revision)::int   AS en_revision
  FROM asig s WHERE s.ubigeo LIKE z.ubigeo || '%'
) p;
CREATE UNIQUE INDEX IF NOT EXISTS zona_estado_ubigeo_idx ON zona_estado (ubigeo);

-- ── Ranking de impacto ───────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS ranking_impacto;
CREATE MATERIALIZED VIEW ranking_impacto AS
SELECT f.id AS financiador_id, f.tipo,
       COALESCE(f.nombre_publico, 'Anónimo') AS nombre, f.slug, f.logo_url,
       sum(c.contratos)::int                                            AS contratos_financiados,
       count(DISTINCT c.ubigeo)::int                                     AS zonas,
       (SELECT count(*) FROM asignaciones s
          JOIN contribuciones c2 ON c2.id = s.contribucion_id
          JOIN alertas a ON a.id = s.alerta_id
         WHERE c2.financiador_id = f.id AND alerta_publicada(a.estado)
           AND EXISTS (SELECT 1 FROM banderas b WHERE b.alerta_id = a.id))::int AS senales_halladas,
       (SELECT count(s.procesada_at) FROM asignaciones s JOIN contribuciones c2 ON c2.id = s.contribucion_id
         WHERE c2.financiador_id = f.id)::int                            AS contratos_procesados,
       min(c.pagada_at)                                                  AS desde,
       max(c.pagada_at)                                                  AS ultimo_aporte,
       (SELECT count(*) FROM asignaciones s
          JOIN contribuciones c2 ON c2.id = s.contribucion_id
          JOIN alertas a ON a.id = s.alerta_id
         WHERE c2.financiador_id = f.id AND a.estado = 'revision')::int  AS en_revision
FROM financiadores f
JOIN contribuciones c ON c.financiador_id = f.id AND c.estado IN ('pagada','en_proceso','procesada')
WHERE f.visible
GROUP BY f.id;
CREATE UNIQUE INDEX IF NOT EXISTS ranking_impacto_id_idx ON ranking_impacto (financiador_id);

-- Refresh separado (el dispatcher llama al del ranking tras cada contrato y al de zonas al final).
CREATE OR REPLACE FUNCTION refresh_ranking() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY ranking_impacto;
END $$;

CREATE OR REPLACE FUNCTION refresh_financiamiento() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY zona_estado;
  REFRESH MATERIALIZED VIEW CONCURRENTLY ranking_impacto;
END $$;
