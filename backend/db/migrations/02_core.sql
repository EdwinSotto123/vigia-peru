-- Vigía Perú · Tablas core ─────────────────────────────────────────
-- Entidades del Estado, empresas proveedoras, personas naturales.
-- Llave maestra: RUC (11 dígitos) para empresas, DNI (8) para personas.

-- ─── Entidades del Estado (vienen de OECE/SUNAT) ──────────────────
CREATE TABLE IF NOT EXISTS entidades (
  ruc                 CHAR(11) PRIMARY KEY,
  nombre              TEXT NOT NULL,
  tipo                TEXT NOT NULL CHECK (tipo IN (
                        'municipal_distrital', 'municipal_provincial',
                        'gobierno_regional', 'ministerio',
                        'empresa_publica', 'organismo_autonomo'
                      )),
  region              TEXT,
  provincia           TEXT,
  distrito            TEXT,
  ubigeo              CHAR(6),
  pliego_nombre_mef   TEXT,
  pliego_id_mef       INT,
  ubicacion_geo       GEOGRAPHY(POINT, 4326),
  fecha_alta          DATE,
  estado_sunat        TEXT,
  metadata            JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entidades_region  ON entidades (region);
CREATE INDEX IF NOT EXISTS idx_entidades_pliego  ON entidades (pliego_nombre_mef);
CREATE INDEX IF NOT EXISTS idx_entidades_geo     ON entidades USING GIST (ubicacion_geo);
CREATE INDEX IF NOT EXISTS idx_entidades_nombre_trgm
  ON entidades USING GIN (immutable_unaccent(lower(nombre)) gin_trgm_ops);


-- ─── Empresas proveedoras (vienen de SUNAT + RNP + SUNARP) ────────
CREATE TABLE IF NOT EXISTS empresas (
  ruc                 CHAR(11) PRIMARY KEY,
  razon_social        TEXT NOT NULL,
  fecha_alta_ruc      DATE,
  estado_sunat        TEXT,
  domicilio_fiscal    TEXT,
  capital_social      NUMERIC,
  actividad_economica TEXT,
  ubicacion_geo       GEOGRAPHY(POINT, 4326),
  rnp_vigente         BOOLEAN,
  rnp_categorias      TEXT[],
  metadata            JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_empresas_alta    ON empresas (fecha_alta_ruc);
CREATE INDEX IF NOT EXISTS idx_empresas_estado  ON empresas (estado_sunat);


-- ─── Personas naturales (socios, representantes, funcionarios) ────
CREATE TABLE IF NOT EXISTS personas (
  dni                 CHAR(8) PRIMARY KEY,
  nombre              TEXT NOT NULL,
  apellidos           TEXT,
  fecha_nacimiento    DATE,
  metadata            JSONB
);


-- ─── Empresa ↔ persona (socio, representante, director) ───────────
CREATE TABLE IF NOT EXISTS empresa_personas (
  id                  BIGSERIAL PRIMARY KEY,
  empresa_ruc         CHAR(11) NOT NULL REFERENCES empresas (ruc) ON DELETE CASCADE,
  persona_dni         CHAR(8) NOT NULL REFERENCES personas (dni) ON DELETE CASCADE,
  rol                 TEXT NOT NULL,
  porcentaje          NUMERIC(5,2),
  fecha_desde         DATE,
  fecha_hasta         DATE,
  fuente              TEXT,
  UNIQUE (empresa_ruc, persona_dni, rol, fecha_desde)
);

CREATE INDEX IF NOT EXISTS idx_emppers_empresa ON empresa_personas (empresa_ruc);
CREATE INDEX IF NOT EXISTS idx_emppers_persona ON empresa_personas (persona_dni);
