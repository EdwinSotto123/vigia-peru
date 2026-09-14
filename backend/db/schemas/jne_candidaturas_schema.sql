-- JNE Candidaturas — candidatos a elecciones (presidencial, congresal, regional, municipal)
-- Source: PNDA-JNE via CKAN o https://plataformaelectoral.jne.gob.pe/Candidato

CREATE TABLE IF NOT EXISTS jne_candidaturas (
    id                BIGSERIAL PRIMARY KEY,
    numero_documento  TEXT,
    nombre            TEXT      NOT NULL,
    nombre_original   TEXT,
    partido           TEXT,
    año               INTEGER,
    cargo             TEXT,      -- Presidente | Congresista | Gobernador | Alcalde | Regidor | etc.
    resultado         TEXT,      -- electo | no_electo | retirado | desistido
    region            TEXT,
    provincia         TEXT,
    distrito          TEXT,
    numero_lista      INTEGER,
    fuente            TEXT      DEFAULT 'JNE_PlataformaElectoral',
    fuente_url        TEXT,
    cargado_en        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jne_documento ON jne_candidaturas (numero_documento);
CREATE INDEX IF NOT EXISTS idx_jne_nombre_upper ON jne_candidaturas (UPPER(nombre));
CREATE INDEX IF NOT EXISTS idx_jne_partido ON jne_candidaturas (partido);
CREATE INDEX IF NOT EXISTS idx_jne_año ON jne_candidaturas (año DESC);
CREATE INDEX IF NOT EXISTS idx_jne_region ON jne_candidaturas (region);
