-- 42 · Banderas: versión de la regla, hechos sin puntaje y decisión del revisor
--
-- Auditoría de señales (docs/auditoria-senales/00-diagnostico-y-plan.md, Fase 0):
--   · `puntua` = false marca un hecho neutro: se guarda y se muestra, pero no suma al score.
--   · `regla_version`, `pipeline_version`, `modelo`, `identidad`: trazabilidad de cada bandera.
--   · `bandera_revision`: decisión del revisor humano por bandera (fuente del conjunto dorado).
-- Idempotente. Los permisos de la tabla nueva se dan a los roles de la migración 37.

BEGIN;

ALTER TABLE banderas
  ADD COLUMN IF NOT EXISTS puntua           BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS regla_version    TEXT,
  ADD COLUMN IF NOT EXISTS pipeline_version TEXT,
  ADD COLUMN IF NOT EXISTS modelo           TEXT,
  ADD COLUMN IF NOT EXISTS identidad        TEXT;

ALTER TABLE banderas DROP CONSTRAINT IF EXISTS banderas_identidad_check;
ALTER TABLE banderas ADD CONSTRAINT banderas_identidad_check
  CHECK (identidad IS NULL OR identidad IN ('dni_confirmada', 'solo_nombre', 'no_aplica'));

-- Copia de las banderas que se reclasifican, para poder revertir.
CREATE TABLE IF NOT EXISTS banderas_reclasificadas (
  bandera_id        BIGINT PRIMARY KEY,
  alerta_id         UUID NOT NULL,
  severidad_previa  TEXT NOT NULL,
  evidencia_previa  TEXT,
  score_previo      INT,
  motivo            TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bandera_revision (
  id          BIGSERIAL PRIMARY KEY,
  bandera_id  BIGINT NOT NULL REFERENCES banderas (id) ON DELETE CASCADE,
  alerta_id   UUID   NOT NULL REFERENCES alertas (id) ON DELETE CASCADE,
  decision    TEXT   NOT NULL CHECK (decision IN ('confirmada', 'falso_positivo', 'no_concluyente', 'mal_clasificada')),
  motivo      TEXT,
  revisor     TEXT   NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bandera_revision_bandera_idx ON bandera_revision (bandera_id);
CREATE INDEX IF NOT EXISTS bandera_revision_alerta_idx  ON bandera_revision (alerta_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_api_admin') THEN
    GRANT SELECT, INSERT ON bandera_revision TO vigia_api_admin;
    GRANT USAGE, SELECT ON SEQUENCE bandera_revision_id_seq TO vigia_api_admin;
  END IF;
END $$;

COMMIT;
