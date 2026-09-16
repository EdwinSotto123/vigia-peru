-- ─────────────────────────────────────────────────────────────────────────────
-- 20 · Estado por agente del procesamiento en vivo (DAG paralelo).
--
-- El pipeline corre como DAG (backend/agent/deterministic.py::_correr_dag): tres
-- ramas a la vez, fases que llegan desordenadas. `fase_actual`/`fase_index` no
-- alcanzan para pintar "qué corre ahora": el dispatcher (backend/dispatcher/events.py)
-- reduce el stream a un mapa por agente que se persiste entero en cada cambio:
--
--   fases JSONB = { "<fase>": { "estado": corriendo|hecho|omitido|error,
--                               "desde": ts, "hasta": ts|null,
--                               "motivo": "…" (omitido/error), "msg": "…" } }
--
-- Fases: las 10 canónicas (compliance, document_parser, document_legal_analyst,
-- market, web_research, news_research, entity_personnel, person_network,
-- compliance_extended, report_writer) + auxiliares rastreadas (ocds, proveedor,
-- persist_checkpoint, safety_net, persist, self_eval).
--
-- Además: el trigger que cierra el procesamiento al insertarse la alerta ya no lo
-- hace mientras un worker esté vivo (latido < 2 min): la alerta se inserta en el
-- checkpoint, ANTES del dictamen y la autoevaluación, y el tablero pasaba a
-- "procesado" con el dictamen aún escribiéndose. Lo cierra el dispatcher al `final`.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE procesamientos ADD COLUMN IF NOT EXISTS fases JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN procesamientos.fases IS
  'Estado por agente {fase: {estado: corriendo|hecho|omitido|error, desde, hasta, motivo, msg}} (dispatcher, DAG paralelo).';

-- Cada reclamo arranca con el mapa vacío (reintentos incluidos).
CREATE OR REPLACE FUNCTION reclamar_procesamientos(n INT, p_worker TEXT) RETURNS SETOF TEXT LANGUAGE plpgsql AS $$
BEGIN
  UPDATE procesamientos SET estado = 'encolado', worker = NULL, error = 'timeout sin latido'
   WHERE estado = 'procesando' AND latido_at < now() - interval '20 minutes';
  RETURN QUERY
  WITH c AS (
    SELECT ocid FROM procesamientos
     WHERE estado = 'encolado' AND intentos < 3
     ORDER BY encolado_at, ocid LIMIT n FOR UPDATE SKIP LOCKED)
  UPDATE procesamientos p SET estado = 'procesando', worker = p_worker, intentos = p.intentos + 1,
         iniciado_at = now(), latido_at = now(), fase_actual = 'started', fase_index = 0, error = NULL,
         fases = '{}'::jsonb, eventos = '[]'::jsonb
    FROM c WHERE p.ocid = c.ocid RETURNING p.ocid;
END $$;

-- La alerta se persiste en el checkpoint (antes del dictamen): con worker vivo el cierre lo hace el
-- dispatcher al recibir `final`. Sin worker vivo (stream cortado, job muerto) se cierra como antes.
CREATE OR REPLACE FUNCTION cerrar_procesamiento_por_alerta() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE procesamientos SET estado = 'procesado', finalizado_at = now(), fase_actual = 'final', fase_index = 10, error = NULL
   WHERE ocid_corto(ocid) = ocid_corto(NEW.ocid) AND estado <> 'procesado'
     AND NOT (estado = 'procesando' AND worker IS NOT NULL AND latido_at >= now() - interval '2 minutes');
  UPDATE asignaciones SET procesada_at = COALESCE(procesada_at, now()), alerta_id = COALESCE(alerta_id, NEW.id)
   WHERE ocid_corto(ocid) = ocid_corto(NEW.ocid);
  UPDATE contribuciones c SET estado = 'procesada'
   WHERE c.estado = 'en_proceso'
     AND (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = c.id AND s.procesada_at IS NOT NULL) >= c.contratos;
  RETURN NEW;
END $$;

-- Vista pública: se añaden `fases` y el estado de la alerta (revision = bloqueada por la
-- autoevaluación, no publicada) al FINAL (CREATE OR REPLACE VIEW solo permite anexar columnas).
CREATE OR REPLACE VIEW procesamientos_publico AS
SELECT p.ocid, p.estado, p.fase_actual, p.fase_index, p.intentos, p.encolado_at, p.iniciado_at, p.finalizado_at,
       co.codigo AS contribucion_codigo, co.ubigeo, z.nombre AS zona,
       CASE WHEN f.visible THEN COALESCE(f.nombre_publico, 'Anónimo') ELSE 'Aliado no visible' END AS financiador,
       f.visible AS financiador_visible,
       cv.objeto AS titulo, e.nombre AS entidad, cv.cuantia_referencial AS monto_pen,
       a.codigo AS alerta_codigo, a.score,
       (SELECT count(*) FROM banderas b WHERE b.alerta_id = a.id) AS banderas,
       p.fases,
       a.estado AS alerta_estado,
       a.id AS alerta_id
FROM procesamientos p
JOIN contribuciones co ON co.id = p.contribucion_id
JOIN financiadores f ON f.id = co.financiador_id
JOIN zonas z ON z.ubigeo = co.ubigeo
JOIN convocatorias cv ON cv.ocid = p.ocid
LEFT JOIN entidades e ON e.ruc = cv.entidad_ruc
LEFT JOIN alertas a ON ocid_corto(a.ocid) = ocid_corto(p.ocid);
