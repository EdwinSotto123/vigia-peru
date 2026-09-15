-- 19 · Procesamiento activo por tipo × etapa (configurable) y aportes institucionales.
--
-- Hoy solo está activo el análisis de BIENES en etapa cerrada (adjudicada en adelante): los
-- demás contratos se descargan y clasifican igual (sus documentos quedan "listos para
-- procesarse") pero NO entran a la cola financiable. La regla de independencia se mantiene:
-- la plataforma decide qué tipos puede analizar; nadie elige contratos concretos.

INSERT INTO ajustes (clave, valor) VALUES ('procesamiento', '{
  "tipos_activos":  ["bienes"],
  "etapas_activas": ["adjudicada", "contratada", "en_ejecucion", "finalizada"],
  "nota": "Servicios, obras y otros: documentos descargados y clasificados; análisis en preparación."
}'::jsonb) ON CONFLICT (clave) DO NOTHING;

CREATE OR REPLACE FUNCTION procesamiento_activo(p_tipo TEXT, p_etapa TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT (valor->'tipos_activos')  ? COALESCE(p_tipo, '')
        AND (valor->'etapas_activas') ? COALESCE(p_etapa, '')
     FROM ajustes WHERE clave = 'procesamiento'),
    true)
$$;

-- La cola financiable solo tiene lo que hoy se puede analizar.
CREATE OR REPLACE VIEW cola_auditoria AS
SELECT cz.ocid, cz.ubigeo, cz.fecha_convocatoria
FROM convocatoria_zona cz
JOIN convocatorias c ON c.ocid = cz.ocid
WHERE cz.ubigeo IS NOT NULL
  AND c.procesable IS DISTINCT FROM false
  AND procesamiento_activo(c.tipo_contratacion, c.etapa)
  AND NOT EXISTS (SELECT 1 FROM alertas a WHERE a.ocid = cz.ocid)
  AND NOT EXISTS (SELECT 1 FROM asignaciones s WHERE s.ocid = cz.ocid);

-- Estado "operativo" de cada contrato para la lista/mapa (además del de procesamiento):
--   en_cola            → tipo/etapa activos, sin analizar (financiable)
--   documentos_listos  → tipo/etapa NO activos pero con documentos vigentes en GCS
--   sin_documentos     → tipo/etapa NO activos y sin documentos aún
CREATE OR REPLACE FUNCTION estado_operativo(p_ocid TEXT, p_tipo TEXT, p_etapa TEXT) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN procesamiento_activo(p_tipo, p_etapa) THEN 'en_cola'
    WHEN EXISTS (SELECT 1 FROM documentos_gcs d WHERE ocid_corto(d.ocid) = ocid_corto(p_ocid)
                   AND d.borrado_at IS NULL AND d.expira_at > now()) THEN 'documentos_listos'
    ELSE 'sin_documentos' END
$$;

-- Aportes institucionales (la propia plataforma u otra organización que financia capacidad sin
-- pasar por una pasarela): misma tabla, pasarela = 'institucional', validada al crearla.
ALTER TABLE contribuciones DROP CONSTRAINT IF EXISTS contribuciones_pasarela_check;

-- estado_operativo() se evalúa por fila en la lista pública: índice por ocid corto.
CREATE INDEX IF NOT EXISTS documentos_gcs_ocid_corto_idx ON documentos_gcs (ocid_corto(ocid)) WHERE borrado_at IS NULL;
