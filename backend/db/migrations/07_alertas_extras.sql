-- Vigía Perú · Migración: campos extra en alertas ────────────────
-- Necesarios para la UI: descripción del objeto, código de convocatoria
-- (distinto del codigo de la alerta), provincia/distrito legibles,
-- flags directos como unicoPostor y edadRucDias.

ALTER TABLE alertas
  ADD COLUMN IF NOT EXISTS objeto              TEXT,
  ADD COLUMN IF NOT EXISTS codigo_convocatoria TEXT,
  ADD COLUMN IF NOT EXISTS provincia           TEXT,
  ADD COLUMN IF NOT EXISTS distrito            TEXT,
  ADD COLUMN IF NOT EXISTS unico_postor        BOOLEAN,
  ADD COLUMN IF NOT EXISTS edad_ruc_dias       INT,
  ADD COLUMN IF NOT EXISTS fuente_url          TEXT;

CREATE INDEX IF NOT EXISTS idx_alertas_codigo_conv ON alertas (codigo_convocatoria);
