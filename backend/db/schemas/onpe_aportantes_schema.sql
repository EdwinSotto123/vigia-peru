-- ONPE Aportantes — financiamiento político (ONPE Claridad)
-- Source: https://www.datosabiertos.gob.pe/dataset/aportantes-onpe
-- Cubre aportes 2018-2026 a campañas electorales y partidos políticos.

CREATE TABLE IF NOT EXISTS onpe_aportantes (
    id                    BIGSERIAL PRIMARY KEY,
    numero_documento      TEXT,                 -- DNI del aportante (puede ser NULL si organizacion)
    nombre                TEXT      NOT NULL,   -- nombre completo del aportante (mayúsculas, sin tildes ideal)
    nombre_original       TEXT,                 -- nombre tal como vino del CSV
    partido               TEXT      NOT NULL,   -- partido / organización política receptora
    año                   INTEGER,              -- año del aporte
    fecha_aporte          DATE,                 -- fecha exacta si está disponible
    monto                 NUMERIC(14,2),        -- monto en S/.
    tipo_aporte           TEXT,                 -- dinerario | en_especie | aporte_propio | etc.
    nivel                 TEXT,                 -- presidencial | congresal | regional | municipal
    fuente                TEXT      DEFAULT 'ONPE_Claridad',
    fuente_url            TEXT,                 -- link a Claridad si está disponible
    cargado_en            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onpe_apt_documento ON onpe_aportantes (numero_documento);
CREATE INDEX IF NOT EXISTS idx_onpe_apt_nombre_upper ON onpe_aportantes (UPPER(nombre));
CREATE INDEX IF NOT EXISTS idx_onpe_apt_partido ON onpe_aportantes (partido);
CREATE INDEX IF NOT EXISTS idx_onpe_apt_año ON onpe_aportantes (año DESC);
