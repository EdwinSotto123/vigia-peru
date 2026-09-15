-- 15 · Retención de documentos (90 días) y pedidos de descarga bajo demanda.
--
-- Política: la metadata de cada contrato (convocatorias, ocds_payload) se conserva siempre —
-- pesa ~14 KB. Los documentos (bases, actas, contratos: ~20 MB por contrato) viven en GCS
-- como máximo RETENCION_DIAS (90) y el lifecycle del bucket los borra. Si después alguien
-- financia un contrato cuyos documentos ya no están (o nunca se bajaron), el dispatcher no
-- lo procesa: abre un `pedido_descarga`, deja el procesamiento `esperando_documentos`, el
-- batch nocturno de la laptop (IP peruana) baja record + documentos y los sube a GCS, la
-- ingesta marca el pedido `listo` y re-encola el procesamiento → se procesa al día siguiente.

-- 1) Vigencia de los documentos en GCS ------------------------------------------------------
ALTER TABLE documentos_gcs ADD COLUMN IF NOT EXISTS expira_at  TIMESTAMPTZ;
ALTER TABLE documentos_gcs ADD COLUMN IF NOT EXISTS borrado_at TIMESTAMPTZ;
UPDATE documentos_gcs SET expira_at = creado_at + interval '90 days' WHERE expira_at IS NULL;
ALTER TABLE documentos_gcs ALTER COLUMN expira_at SET DEFAULT now() + interval '90 days';
CREATE INDEX IF NOT EXISTS documentos_gcs_vigentes_idx ON documentos_gcs (ocid, expira_at) WHERE borrado_at IS NULL;

-- Documentos que todavía se pueden leer desde GCS para un contrato.
CREATE OR REPLACE FUNCTION documentos_vigentes(p_ocid TEXT)
RETURNS TABLE (url_origen TEXT, url_gcs TEXT, tipo TEXT, expira_at TIMESTAMPTZ) LANGUAGE sql STABLE AS $$
  SELECT d.url_origen, d.url_gcs, d.tipo, d.expira_at
  FROM documentos_gcs d
  WHERE ocid_corto(d.ocid) = ocid_corto(p_ocid) AND d.borrado_at IS NULL AND d.expira_at > now()
$$;

-- 2) Pedidos de descarga -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pedidos_descarga (
  id            BIGSERIAL PRIMARY KEY,
  ocid          TEXT NOT NULL,
  motivo        TEXT NOT NULL DEFAULT 'financiado',       -- financiado | admin | reintento
  estado        TEXT NOT NULL DEFAULT 'pendiente'
                CHECK (estado IN ('pendiente','descargando','listo','fallido')),
  solicitado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tomado_at     TIMESTAMPTZ,                              -- cuándo lo tomó el batch
  atendido_at   TIMESTAMPTZ,                              -- cuándo la ingesta lo dio por listo
  intentos      INT NOT NULL DEFAULT 0,                   -- noches en que se intentó
  lote_id       TEXT,                                     -- lote de records/documentos que lo atendió
  error         TEXT
);
-- Un solo pedido abierto por contrato.
CREATE UNIQUE INDEX IF NOT EXISTS pedidos_descarga_abierto_idx
  ON pedidos_descarga (ocid_corto(ocid)) WHERE estado IN ('pendiente','descargando');
CREATE INDEX IF NOT EXISTS pedidos_descarga_estado_idx ON pedidos_descarga (estado, solicitado_at);

-- Abre (o reutiliza) el pedido abierto del contrato. Devuelve el id.
CREATE OR REPLACE FUNCTION pedir_descarga(p_ocid TEXT, p_motivo TEXT DEFAULT 'financiado')
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_id BIGINT;
BEGIN
  SELECT id INTO v_id FROM pedidos_descarga
   WHERE ocid_corto(ocid) = ocid_corto(p_ocid) AND estado IN ('pendiente','descargando') LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO pedidos_descarga (ocid, motivo) VALUES (p_ocid, p_motivo) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 3) procesamientos: nuevo estado 'esperando_documentos' ---------------------------------------
ALTER TABLE procesamientos DROP CONSTRAINT IF EXISTS procesamientos_estado_check;
ALTER TABLE procesamientos ADD CONSTRAINT procesamientos_estado_check
  CHECK (estado IN ('encolado','procesando','procesado','error','pendiente_de_procesamiento','esperando_documentos'));

-- El dispatcher lo llama cuando reclama un contrato sin documentos vigentes en GCS:
-- devuelve el intento, abre el pedido y deja el procesamiento esperando.
CREATE OR REPLACE FUNCTION esperar_documentos(p_ocid TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_id BIGINT;
BEGIN
  v_id := pedir_descarga(p_ocid, 'financiado');
  UPDATE procesamientos SET estado = 'esperando_documentos', intentos = greatest(intentos - 1, 0),
         worker = NULL, fase_actual = NULL, fase_index = NULL,
         error = 'esperando documentos: se descargan en el lote nocturno'
   WHERE ocid = p_ocid;
  RETURN v_id;
END $$;

-- La ingesta lo llama al cerrar cada corrida: los pedidos `descargando` cuyo contrato ya tiene
-- record reingerido o documentos vigentes posteriores al pedido pasan a `listo` y sus
-- procesamientos vuelven a la cola. Devuelve cuántos procesamientos re-encoló.
CREATE OR REPLACE FUNCTION cerrar_pedidos_atendidos() RETURNS INT LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  WITH listos AS (
    UPDATE pedidos_descarga p SET estado = 'listo', atendido_at = now()
     WHERE p.estado = 'descargando'
       AND (EXISTS (SELECT 1 FROM documentos_gcs d
                     WHERE ocid_corto(d.ocid) = ocid_corto(p.ocid) AND d.borrado_at IS NULL
                       AND d.creado_at >= p.tomado_at)
            OR EXISTS (SELECT 1 FROM convocatorias c
                        WHERE ocid_corto(c.ocid) = ocid_corto(p.ocid) AND c.updated_at >= p.tomado_at
                          AND jsonb_array_length(COALESCE(c.ocds_payload->'tender'->'documents', '[]'::jsonb)) = 0))
     RETURNING p.ocid)
  UPDATE procesamientos pr SET estado = 'encolado', error = NULL, encolado_at = now()
    FROM listos l WHERE ocid_corto(pr.ocid) = ocid_corto(l.ocid) AND pr.estado = 'esperando_documentos';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- 4) Vista pública: incluye el estado nuevo sin cambios (selecciona p.estado tal cual).
