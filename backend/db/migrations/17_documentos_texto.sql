-- Vigía Perú · Migración 17: texto OCR persistido por sha256 + catálogo `documentos` sin borrado ──
-- (WS D del plan 2026-09-15 · §1.4 pts 1-3, §5.2 pts 1, 3, 4 y 8 de la auditoría)
--
--  · documentos_texto: el texto OCR de cada documento (Document AI o PyMuPDF/Gemini) se guarda
--    UNA sola vez por sha256 (la misma clave que documentos_gcs) con sus páginas y marcadores
--    ⟦p.N⟧. Sobrevive a la expiración del blob en GCS (90 días) y a las reescrituras de
--    `documentos` por corrida. `extraccion` guarda la extracción estructurada por bloque del
--    perfil ({"base@v1@modelo": {...}, "servicio@v1@modelo": {...}}) para no volver a pagar
--    OCR ni extracción entre corridas del mismo documento.
--  · documentos: deja de borrarse en cada register_convocatoria_in_db. Se hace upsert por
--    (ocid, blob_url) y se registran también los documentos de awards[]/contracts[] con su
--    `seccion` (tender | award | contract) y el id OCDS del documento.

CREATE TABLE IF NOT EXISTS documentos_texto (
  sha256          TEXT PRIMARY KEY,                 -- = documentos_gcs.sha256 (o calculado sobre los bytes)
  ocid            TEXT,                             -- formato corto; informativo (el texto es por hash)
  url_gcs         TEXT,
  formato         TEXT,                             -- pdf | zip | rar | docx | xlsx | …
  n_paginas       INT,
  motor           TEXT,                             -- docai | pymupdf | pymupdf+gemini_vision | docx | xlsx | mixto
  version_parser  TEXT,                             -- versión del extractor de texto (invalida la caché al cambiar)
  texto           TEXT,                             -- texto completo con marcadores ⟦p.N⟧ (y ⟦archivo: …⟧ en contenedores)
  paginas         JSONB,                            -- [{n, texto, chars, archivo}]
  truncado        BOOLEAN NOT NULL DEFAULT false,   -- alguna página/chunk no pudo leerse (ver `recortes`)
  recortes        JSONB,                            -- [{donde, limite, omitido}] registrados al extraer el texto
  extraccion      JSONB,                            -- {"<bloque>@<schema>@<modelo>": {...extracción estructurada...}}
  creado_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS documentos_texto_ocid_idx ON documentos_texto (ocid);

COMMENT ON TABLE documentos_texto IS
  'Texto OCR por sha256 (una sola vez por documento) con páginas ⟦p.N⟧ y extracción estructurada por bloque del perfil.';

-- ── documentos (06): catálogo estable, upsert por (ocid, blob_url) ───────────────────────────
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS seccion     TEXT;   -- tender | award | contract
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS ocds_doc_id TEXT;   -- documents[].id del record
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS sha256      TEXT;   -- si el blob está en documentos_gcs

-- Deduplicar antes del índice único (el DELETE+INSERT histórico no dejaba duplicados por ocid,
-- pero un record con la misma URL repetida sí podía insertarla dos veces).
DELETE FROM documentos d
 USING documentos d2
 WHERE d.ocid = d2.ocid AND d.blob_url = d2.blob_url AND d.created_at > d2.created_at;
CREATE UNIQUE INDEX IF NOT EXISTS documentos_ocid_blob_url_idx ON documentos (ocid, blob_url);

-- ofertas.ganadora existe desde 03 (BOOLEAN DEFAULT FALSE); idempotente por si faltara.
ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS ganadora BOOLEAN DEFAULT FALSE;
