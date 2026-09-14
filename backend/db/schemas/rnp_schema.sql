-- RNP — Conformación Jurídica
-- Carga inicial: 1.443.032 filas (snapshot 2026-05-04 OECE).
-- Identidad de persona = (numero_documento) — el nombre puede variar (mayúsculas,
-- tildes, orden) entre filas pero el documento es el ancla.

CREATE TABLE IF NOT EXISTS rnp_conformacion_juridica (
    id                    BIGSERIAL PRIMARY KEY,
    fecha_corte           DATE      NOT NULL,
    tipo_documento        TEXT      NOT NULL,
    numero_documento      TEXT      NOT NULL,
    nombre                TEXT      NOT NULL,
    nombre_original       TEXT,
    ruc_empresa           CHAR(11)  NOT NULL,
    tipo_rol              TEXT      NOT NULL,
    fecha_inicio_vigencia DATE,
    id_forma_societaria   TEXT,
    forma_societaria      TEXT
);
