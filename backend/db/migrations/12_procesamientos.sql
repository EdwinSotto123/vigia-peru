-- ─────────────────────────────────────────────────────────────────────────────
-- 12 · Estado de procesamiento EN VIVO de contratos asignados a contribuciones.
--
-- Lo escribe el dispatcher (backend/dispatcher, Cloud Run Job cada 5 min);
-- lo lee el público vía GET /financiamiento/procesamientos (vista
-- procesamientos_publico, sin email ni worker).
--
-- Ciclo: encolado (asignado, sin empezar) → procesando (un worker lo reclamó;
-- fase_actual avanza) → procesado (alerta persistida) · error (agotó 3 intentos).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS procesamientos (
  ocid             TEXT PRIMARY KEY REFERENCES convocatorias (ocid),
  contribucion_id  BIGINT NOT NULL REFERENCES contribuciones (id),
  estado           TEXT NOT NULL DEFAULT 'encolado' CHECK (estado IN ('encolado','procesando','procesado','error')),
  fase_actual      TEXT,
  fase_index       INT,
  worker           TEXT,
  intentos         INT NOT NULL DEFAULT 0,
  error            TEXT,
  eventos          JSONB NOT NULL DEFAULT '[]'::jsonb,      -- [{ts, kind, name, msg}] solo phase/warn/error/final
  encolado_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  iniciado_at      TIMESTAMPTZ,
  latido_at        TIMESTAMPTZ,                              -- heartbeat; si pasa >20 min sin latido, se re-encola
  finalizado_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS procesamientos_estado_idx ON procesamientos (estado, encolado_at);
CREATE INDEX IF NOT EXISTS procesamientos_contrib_idx ON procesamientos (contribucion_id);

-- Toda asignación nueva entra encolada (trigger), y las existentes se sincronizan una vez.
CREATE OR REPLACE FUNCTION encolar_procesamiento() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO procesamientos (ocid, contribucion_id) VALUES (NEW.ocid, NEW.contribucion_id) ON CONFLICT (ocid) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_asignaciones_encolar ON asignaciones;
CREATE TRIGGER trg_asignaciones_encolar AFTER INSERT ON asignaciones FOR EACH ROW EXECUTE FUNCTION encolar_procesamiento();
INSERT INTO procesamientos (ocid, contribucion_id)
SELECT s.ocid, s.contribucion_id FROM asignaciones s WHERE s.procesada_at IS NULL ON CONFLICT DO NOTHING;
UPDATE procesamientos p SET estado = 'procesado', finalizado_at = COALESCE(p.finalizado_at, s.procesada_at)
FROM asignaciones s WHERE s.ocid = p.ocid AND s.procesada_at IS NOT NULL AND p.estado <> 'procesado';

-- Reclamo atómico para N workers en paralelo (SKIP LOCKED). Re-encola los colgados (>20 min sin latido).
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
         iniciado_at = now(), latido_at = now(), fase_actual = 'started', fase_index = 0, error = NULL
    FROM c WHERE p.ocid = c.ocid RETURNING p.ocid;
END $$;

-- El orquestador persiste alertas (y convocatorias) con el OCID CORTO ('1216608', '2026-10404-12'),
-- mientras la cola OCDS usa el completo ('ocds-dgv273-seacev3-1216608'). Se comparan por forma corta.
CREATE OR REPLACE FUNCTION ocid_corto(p TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE WHEN p LIKE 'ocds-dgv273-seacev3-%' THEN substr(p, 21) ELSE p END
$$;
CREATE INDEX IF NOT EXISTS alertas_ocid_corto_idx ON alertas (ocid_corto(ocid));
CREATE INDEX IF NOT EXISTS procesamientos_ocid_corto_idx ON procesamientos (ocid_corto(ocid));

-- Cuando el pipeline persiste la alerta cerramos el procesamiento; y también la asignación (el trigger
-- de 09 compara el ocid literal y no matchea la forma corta), para que zona_estado/ranking cuenten.
CREATE OR REPLACE FUNCTION cerrar_procesamiento_por_alerta() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE procesamientos SET estado = 'procesado', finalizado_at = now(), fase_actual = 'final', fase_index = 10, error = NULL
   WHERE ocid_corto(ocid) = ocid_corto(NEW.ocid) AND estado <> 'procesado';
  UPDATE asignaciones SET procesada_at = COALESCE(procesada_at, now()), alerta_id = COALESCE(alerta_id, NEW.id)
   WHERE ocid_corto(ocid) = ocid_corto(NEW.ocid);
  UPDATE contribuciones c SET estado = 'procesada'
   WHERE c.estado = 'en_proceso'
     AND (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = c.id AND s.procesada_at IS NOT NULL) >= c.contratos;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_alertas_cerrar_procesamiento ON alertas;
CREATE TRIGGER trg_alertas_cerrar_procesamiento AFTER INSERT ON alertas FOR EACH ROW EXECUTE FUNCTION cerrar_procesamiento_por_alerta();

-- Vista pública (sin email ni worker).
CREATE OR REPLACE VIEW procesamientos_publico AS
SELECT p.ocid, p.estado, p.fase_actual, p.fase_index, p.intentos, p.encolado_at, p.iniciado_at, p.finalizado_at,
       co.codigo AS contribucion_codigo, co.ubigeo, z.nombre AS zona,
       CASE WHEN f.visible THEN COALESCE(f.nombre_publico, 'Anónimo') ELSE 'Aliado no visible' END AS financiador,
       f.visible AS financiador_visible,
       cv.objeto AS titulo, e.nombre AS entidad, cv.cuantia_referencial AS monto_pen,
       a.codigo AS alerta_codigo, a.score,
       (SELECT count(*) FROM banderas b WHERE b.alerta_id = a.id) AS banderas
FROM procesamientos p
JOIN contribuciones co ON co.id = p.contribucion_id
JOIN financiadores f ON f.id = co.financiador_id
JOIN zonas z ON z.ubigeo = co.ubigeo
JOIN convocatorias cv ON cv.ocid = p.ocid
LEFT JOIN entidades e ON e.ruc = cv.entidad_ruc
LEFT JOIN alertas a ON ocid_corto(a.ocid) = ocid_corto(p.ocid);
