-- Vigía Perú · Motor de alertas + red de personas ─────────────────
-- Corazón del producto: cada alerta tiene N banderas, y cada bandera
-- puede tocar entidad, empresa, o persona específica.

-- ─── Alertas ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alertas (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo                TEXT UNIQUE NOT NULL,
  ocid                  TEXT REFERENCES convocatorias (ocid),
  entidad_ruc           CHAR(11) REFERENCES entidades (ruc),
  proveedor_ruc         CHAR(11) REFERENCES empresas (ruc),
  monto_adjudicado      NUMERIC,
  fecha_buena_pro       DATE,
  region                TEXT,
  score                 INT CHECK (score BETWEEN 0 AND 100),
  estado                TEXT NOT NULL DEFAULT 'activa'
                          CHECK (estado IN ('activa', 'descartada', 'confirmada', 'en_revision')),
  ubicacion_geo         GEOGRAPHY(POINT, 4326),
  reglas_disparadas     TEXT[],
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alertas_score    ON alertas (score DESC);
CREATE INDEX IF NOT EXISTS idx_alertas_region   ON alertas (region);
CREATE INDEX IF NOT EXISTS idx_alertas_estado   ON alertas (estado);
CREATE INDEX IF NOT EXISTS idx_alertas_geo      ON alertas USING GIST (ubicacion_geo);
CREATE INDEX IF NOT EXISTS idx_alertas_entidad  ON alertas (entidad_ruc);


-- ─── Banderas individuales por alerta ─────────────────────────────
CREATE TABLE IF NOT EXISTS banderas (
  id                    BIGSERIAL PRIMARY KEY,
  alerta_id             UUID NOT NULL REFERENCES alertas (id) ON DELETE CASCADE,
  regla                 TEXT NOT NULL,
  severidad             TEXT NOT NULL CHECK (severidad IN ('alta', 'media', 'baja')),
  evidencia             TEXT,
  norma                 TEXT,
  opinion_oece          TEXT,
  fuente_url            TEXT,
  agente_origen         TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_banderas_alerta     ON banderas (alerta_id);
CREATE INDEX IF NOT EXISTS idx_banderas_severidad  ON banderas (severidad);
CREATE INDEX IF NOT EXISTS idx_banderas_regla      ON banderas (regla);


-- ─── Network expansions (red de personas por alerta) ──────────────
CREATE TABLE IF NOT EXISTS network_expansions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alerta_id             UUID NOT NULL REFERENCES alertas (id) ON DELETE CASCADE,
  empresa_ruc           CHAR(11) NOT NULL,
  agente_version        TEXT,
  payload               JSONB NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_netexp_alerta ON network_expansions (alerta_id);


-- ─── Flags a nivel persona ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS persona_flags (
  id                    BIGSERIAL PRIMARY KEY,
  persona_dni           CHAR(8) REFERENCES personas (dni),
  empresa_ruc           CHAR(11) REFERENCES empresas (ruc),
  alerta_id             UUID REFERENCES alertas (id) ON DELETE CASCADE,
  tipo                  TEXT NOT NULL,
  severidad             TEXT CHECK (severidad IN ('alta', 'media', 'baja')),
  detalle               TEXT,
  fuente_url            TEXT,
  fuente_fecha          DATE,
  agente_origen         TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pflags_persona ON persona_flags (persona_dni);
CREATE INDEX IF NOT EXISTS idx_pflags_alerta  ON persona_flags (alerta_id);
