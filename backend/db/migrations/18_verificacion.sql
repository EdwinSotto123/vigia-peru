-- Vigía Perú · Migración 18: verificación determinista de banderas ────────────
-- (WS V del plan 2026-09-15 · hallazgos #1, #2, §6.2-5 y §6.2-8 de la auditoría)
--
--  · banderas.verificacion JSONB → resultado de verify.verificar_bandera():
--      {"ok": bool, "motivos": [...], "n_checks": int}. Las banderas con ok=false
--      NO se persisten (van a state['descartes']); las persistidas quedan con la
--      traza de qué identificadores/montos/URLs se cotejaron contra OCDS/SUNAT/RNP/
--      texto de documentos/grounding.
--  · alertas.estado admite 'revision': self_eval.debe_bloquear() la marca cuando
--      el respaldo de banderas es bajo, el tono es acusatorio o los ítems son
--      incoherentes con el objeto. Las alertas en 'revision' no se publican.
--  · ofertas.ganadora ya existe desde 03_contrataciones.sql (BOOLEAN DEFAULT FALSE);
--      se repite idempotente por si una instancia vieja no la tuviera. El WS D la
--      rellena con todos los tenderers (ganadora=false) para que C2 cuente postores.

ALTER TABLE banderas
  ADD COLUMN IF NOT EXISTS verificacion JSONB;

ALTER TABLE ofertas
  ADD COLUMN IF NOT EXISTS ganadora BOOLEAN DEFAULT FALSE;

-- Recrear el CHECK de estado incluyendo 'revision' (idempotente: DROP IF EXISTS + ADD).
ALTER TABLE alertas DROP CONSTRAINT IF EXISTS alertas_estado_check;
ALTER TABLE alertas
  ADD CONSTRAINT alertas_estado_check
  CHECK (estado IN ('activa', 'descartada', 'confirmada', 'en_revision', 'revision'));

-- Índice parcial para listar rápido lo que espera revisión humana.
CREATE INDEX IF NOT EXISTS idx_alertas_estado_revision ON alertas (analizado_en DESC)
  WHERE estado = 'revision';

COMMENT ON COLUMN banderas.verificacion IS
  'Resultado de tools/verify.verificar_bandera: {ok, motivos[], n_checks}. Solo se persisten banderas con ok=true.';
