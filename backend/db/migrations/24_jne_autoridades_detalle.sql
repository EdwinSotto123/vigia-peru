-- 24 · jne_autoridades: campos del reporte oficial del JNE ("Autoridades Vigentes / Electas",
-- PNDA) que no estaban en la tabla de la migración 23: ubigeo del JNE (codificación RENIEC:
-- Cusco=07, Puno=20, Callao=24 — distinta al INEI que usa `zonas`), posición en la lista,
-- ámbito, resolución de proclamación y si la fila es un reemplazo (vacancia/suspensión).
ALTER TABLE jne_autoridades
    ADD COLUMN IF NOT EXISTS ubigeo_jne       TEXT,      -- 6 dígitos tal como los publica el JNE
    ADD COLUMN IF NOT EXISTS posicion         INTEGER,   -- posición en la lista ingresante
    ADD COLUMN IF NOT EXISTS ambito           TEXT,      -- NACIONAL | REGIONAL | PROVINCIAL | DISTRITAL
    ADD COLUMN IF NOT EXISTS pronunciamiento  TEXT,      -- acta / resolución de proclamación
    ADD COLUMN IF NOT EXISTS es_reemplazo     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS periodo_texto    TEXT,      -- 'PERIODO 2023 - 2026'
    ADD COLUMN IF NOT EXISTS genero           TEXT,
    ADD COLUMN IF NOT EXISTS vigente          BOOLEAN NOT NULL DEFAULT TRUE;  -- reporte "vigentes" vs "electas" (aún no juraron)
CREATE INDEX IF NOT EXISTS jne_aut_ubigeo_jne_idx ON jne_autoridades (ubigeo_jne);

-- Autoridades vigentes hoy por distrito INEI: lo que necesita `query_autoridades_entidad`
-- para saber quién gobierna la entidad contratante en la fecha de la convocatoria.
CREATE OR REPLACE VIEW jne_autoridades_vigentes AS
SELECT *
FROM jne_autoridades
WHERE vigente
  AND (periodo_inicio IS NULL OR periodo_inicio <= current_date)
  AND (periodo_fin IS NULL OR periodo_fin >= current_date);
