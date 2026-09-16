-- 25 · onpe_candidatos: candidatos con DNI publicados por ONPE Claridad (módulo "Consulta de
-- aportantes → Apellido de Candidato"). Es la única fuente abierta que trae el DNI de cada candidato
-- por proceso y organización; sirve para completar `jne_autoridades.dni` (el reporte del JNE no lo
-- publica) y para cruzar postores/socios (RNP) con candidaturas por documento, no solo por nombre.
CREATE TABLE IF NOT EXISTS onpe_candidatos (
    id              BIGSERIAL PRIMARY KEY,
    dni             TEXT,
    apellidos       TEXT,
    nombres         TEXT,
    nombre_norm     TEXT GENERATED ALWAYS AS (upper(immutable_unaccent(coalesce(apellidos,'') || ' ' || coalesce(nombres,'')))) STORED,
    organizacion    TEXT,
    departamento    TEXT,
    proceso         TEXT,          -- ERM2018 | ECE2020 | EG2021 | ERM2022 | ERM2026 | EG2026 …
    total_ingresos  NUMERIC(14,2),
    fuente          TEXT NOT NULL DEFAULT 'onpe_claridad',
    fuente_url      TEXT,
    sha256          TEXT,
    descargado_at   TIMESTAMPTZ,
    cargado_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS onpe_cand_uq ON onpe_candidatos (COALESCE(dni,''), nombre_norm, COALESCE(organizacion,''), COALESCE(proceso,''));
CREATE INDEX IF NOT EXISTS onpe_cand_dni_idx     ON onpe_candidatos (dni);
CREATE INDEX IF NOT EXISTS onpe_cand_nombre_trgm ON onpe_candidatos USING gin (nombre_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS onpe_cand_proceso_idx ON onpe_candidatos (proceso);
