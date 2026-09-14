-- Vigía Perú · Tabla penalidades ─────────────────────────────────
-- Histórico de penalidades aplicadas a contratistas por entidades.
-- Source: dataset/datos_complementarios/sanciones/penalidades.csv (OECE)
-- Usada por la regla C6 del motor de compliance.

CREATE TABLE IF NOT EXISTS penalidades (
  id                  BIGSERIAL PRIMARY KEY,
  contrato_id         TEXT,
  empresa_ruc         CHAR(11) REFERENCES empresas (ruc),
  tipo_penalidad      TEXT,
  objeto_contrato     TEXT,
  entidad_contratante TEXT,
  fecha               DATE,
  descripcion         TEXT,
  monto               NUMERIC,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_penalidades_empresa ON penalidades (empresa_ruc);
CREATE INDEX IF NOT EXISTS idx_penalidades_fecha   ON penalidades (fecha DESC);
