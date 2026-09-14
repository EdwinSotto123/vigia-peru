-- Vigía Perú · Documentos del expediente + opiniones normativas ──
-- Los PDFs viven en GCS bucket. Acá guardamos el blob_url + texto extraído
-- + resumen del agente para búsqueda y trazabilidad.

CREATE TABLE IF NOT EXISTS documentos (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ocid                  TEXT REFERENCES convocatorias (ocid) ON DELETE CASCADE,
  alerta_id             UUID REFERENCES alertas (id) ON DELETE SET NULL,
  tipo                  TEXT NOT NULL CHECK (tipo IN (
                          'bases', 'expediente_tecnico',
                          'acta_buena_pro', 'reporte_buena_pro',
                          'informe_dec', 'contrato',
                          'adenda', 'propuesta_postor', 'otro'
                        )),
  nombre                TEXT NOT NULL,
  blob_url              TEXT NOT NULL,            -- gs://vigia-peru-documentos/...
  fecha                 DATE,
  paginas               INT,
  tamano_bytes          BIGINT,
  texto_extraido        TEXT,                     -- OCR + parser
  resumen_agente        TEXT,                     -- output del document_parser_agent
  agente_version        TEXT,
  metadata              JSONB,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_docs_ocid    ON documentos (ocid);
CREATE INDEX IF NOT EXISTS idx_docs_alerta  ON documentos (alerta_id);
CREATE INDEX IF NOT EXISTS idx_docs_tipo    ON documentos (tipo);


-- ─── Opiniones normativas OECE (con embeddings para RAG futuro) ──
CREATE TABLE IF NOT EXISTS opiniones_oece (
  numero                TEXT PRIMARY KEY,         -- 'D008-2025'
  fecha                 DATE,
  titulo                TEXT,
  texto                 TEXT,
  texto_busqueda        TSVECTOR
                          GENERATED ALWAYS AS (
                            to_tsvector('spanish',
                              coalesce(titulo,'') || ' ' || coalesce(texto,'')
                            )
                          ) STORED,
  embedding             VECTOR(768),              -- text-embedding-004 (Vertex AI)
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opiniones_fts ON opiniones_oece USING GIN (texto_busqueda);
CREATE INDEX IF NOT EXISTS idx_opiniones_emb ON opiniones_oece USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);


-- ─── Audit log de cambios manuales ────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id                    BIGSERIAL PRIMARY KEY,
  user_id               TEXT,
  action                TEXT NOT NULL,
  entity_type           TEXT NOT NULL,
  entity_id             TEXT,
  before                JSONB,
  after                 JSONB,
  ip_address            INET,
  user_agent            TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_date   ON audit_log (created_at DESC);
