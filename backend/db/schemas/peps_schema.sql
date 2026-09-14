-- PEPs — Personas Expuestas Políticamente (UIF SBS)
-- Source: SBS — Resolución SBS N° 1492-2022 lista PEPs

CREATE TABLE IF NOT EXISTS peps (
    id                BIGSERIAL PRIMARY KEY,
    numero_documento  TEXT,
    nombre            TEXT      NOT NULL,
    nombre_original   TEXT,
    cargo             TEXT      NOT NULL,
    entidad           TEXT      NOT NULL,
    año_desde         INTEGER,
    año_hasta         INTEGER,             -- NULL si está activo
    tipo_pep          TEXT,                -- nacional | extranjero | familiar | asociado
    fuente            TEXT      DEFAULT 'UIF_SBS',
    fuente_url        TEXT,
    cargado_en        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_peps_documento ON peps (numero_documento);
CREATE INDEX IF NOT EXISTS idx_peps_nombre_upper ON peps (UPPER(nombre));
CREATE INDEX IF NOT EXISTS idx_peps_entidad ON peps (entidad);
CREATE INDEX IF NOT EXISTS idx_peps_año_desde ON peps (año_desde DESC);
