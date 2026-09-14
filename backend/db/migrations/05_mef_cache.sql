-- Vigía Perú · Cache de MEF Datos Abiertos ────────────────────────
-- Reemplaza public/mef-budget.json y public/mef-entities.json.
-- Refrescable por cron (Cloud Scheduler → Cloud Run job).

CREATE TABLE IF NOT EXISTS mef_region_budget (
  departamento          TEXT PRIMARY KEY,
  total_rows            BIGINT,
  by_year               JSONB,
  top_sectores          JSONB,
  top_pliegos           JSONB,
  top_programas         JSONB,
  top_genericas         JSONB,
  last_refreshed        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mef_entity_budget (
  entidad_ruc           CHAR(11) PRIMARY KEY REFERENCES entidades (ruc) ON DELETE CASCADE,
  keyword               TEXT,
  total_rows            BIGINT,
  by_year               JSONB,
  matched_pliegos       TEXT[],
  kind                  TEXT CHECK (kind IN ('ok', 'partial', 'empty', 'failed')),
  last_refreshed        TIMESTAMPTZ DEFAULT NOW()
);


-- ─── Reportes ciudadanos (proyección desde Firestore) ─────────────
-- Source-of-truth para writes hot: Firestore. Esta tabla es read-projection
-- para queries analíticas. Una Cloud Function on-create de Firestore mete
-- INSERT acá.
CREATE TABLE IF NOT EXISTS reportes_indexados (
  id                    TEXT PRIMARY KEY,
  categoria             TEXT NOT NULL,
  descripcion           TEXT,
  foto_url              TEXT,
  ubicacion_geo         GEOGRAPHY(POINT, 4326) NOT NULL,
  region                TEXT,
  fecha                 DATE NOT NULL,
  confirmado            BOOLEAN DEFAULT FALSE,
  confirmaciones        INT DEFAULT 1,
  convergencia_id       TEXT,
  user_id               TEXT,
  anonimo               BOOLEAN DEFAULT TRUE,
  moderacion_estado     TEXT DEFAULT 'pendiente'
                          CHECK (moderacion_estado IN ('pendiente', 'aprobado', 'rechazado')),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reportes_geo      ON reportes_indexados USING GIST (ubicacion_geo);
CREATE INDEX IF NOT EXISTS idx_reportes_region   ON reportes_indexados (region);
CREATE INDEX IF NOT EXISTS idx_reportes_fecha    ON reportes_indexados (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_reportes_categ    ON reportes_indexados (categoria);


-- ─── Convergencias (reporte ciudadano × alerta automática) ────────
CREATE TABLE IF NOT EXISTS convergencias (
  id                    TEXT PRIMARY KEY,
  alerta_id             UUID NOT NULL REFERENCES alertas (id) ON DELETE CASCADE,
  reporte_ids           TEXT[] NOT NULL,
  ubicacion_geo         GEOGRAPHY(POINT, 4326),
  resumen               TEXT,
  radio_match_m         INT,
  delta_dias            INT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_converg_alerta ON convergencias (alerta_id);
CREATE INDEX IF NOT EXISTS idx_converg_geo    ON convergencias USING GIST (ubicacion_geo);
