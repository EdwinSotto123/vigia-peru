-- ─────────────────────────────────────────────────────────────────────────────
-- 14 · Lotes de ingesta nocturna (backend/batch) y caché de documentos en GCS.
--
-- La laptop/VPS (IP peruana) baja releases/records/documentos del SEACE, los sube a
-- gs://vigia-peru-batch/batch/… y escribe un manifiesto por lote. El Cloud Run Job
-- `vigia-ingest` (backend/batch/ingestar.py) lee el manifiesto y hace el upsert en
-- convocatorias/entidades; acá queda la trazabilidad de qué lote/ítem entró y cuándo.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lotes_ingesta (
  id            TEXT PRIMARY KEY,                       -- 'records-20260915-003347' (lo genera estado.py)
  tipo          TEXT NOT NULL CHECK (tipo IN ('releases','records','documentos')),
  manifest_uri  TEXT NOT NULL,                          -- gs://…/batch/lotes/<id>/manifest.jsonl
  estado        TEXT NOT NULL DEFAULT 'pending' CHECK (estado IN ('pending','procesando','ok','error')),
  total         INT  NOT NULL DEFAULT 0,
  ok            INT  NOT NULL DEFAULT 0,
  fallidos      INT  NOT NULL DEFAULT 0,
  iniciado_at   TIMESTAMPTZ,
  finalizado_at TIMESTAMPTZ,
  error         TEXT,
  creado_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lotes_ingesta_estado_idx ON lotes_ingesta (estado, creado_at DESC);

CREATE TABLE IF NOT EXISTS lotes_items (
  lote_id       TEXT NOT NULL REFERENCES lotes_ingesta (id) ON DELETE CASCADE,
  clave         TEXT NOT NULL,                          -- ventana | ocid corto | ocid/docId
  estado        TEXT NOT NULL DEFAULT 'pending' CHECK (estado IN ('pending','ok','error')),
  error         TEXT,
  procesado_at  TIMESTAMPTZ,
  PRIMARY KEY (lote_id, clave)
);
CREATE INDEX IF NOT EXISTS lotes_items_estado_idx ON lotes_items (lote_id, estado);

-- Documentos del SEACE cacheados en GCS por el batch. Es una tabla APARTE de `documentos` (06):
-- aquella la reescribe el orquestador por ocid (DELETE + INSERT con tipos propios) y borraría
-- estas filas. `ocid` en formato corto (como convocatorias). Sin FK: un documento puede llegar
-- antes que su convocatoria (o de un record sin RUC de comprador).
CREATE TABLE IF NOT EXISTS documentos_gcs (
  id            BIGSERIAL PRIMARY KEY,
  ocid          TEXT NOT NULL,
  tipo          TEXT,                                   -- documentType OCDS (biddingDocuments, awardNotice, contractSigned, …)
  titulo        TEXT,
  seccion       TEXT,                                   -- tender | award | contract
  url_gcs       TEXT NOT NULL,
  sha256        TEXT NOT NULL,
  bytes         BIGINT,
  url_origen    TEXT,
  formato       TEXT,                                   -- pdf | zip | docx | …
  publicado_at  TIMESTAMPTZ,
  lote_id       TEXT REFERENCES lotes_ingesta (id) ON DELETE SET NULL,
  creado_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ocid, sha256)
);
CREATE INDEX IF NOT EXISTS documentos_gcs_ocid_idx ON documentos_gcs (ocid);
CREATE INDEX IF NOT EXISTS documentos_gcs_tipo_idx ON documentos_gcs (tipo);
