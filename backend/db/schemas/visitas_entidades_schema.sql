-- Visitas a Entidades Públicas — Registro Único de Visitas (Ley 28024)
-- Source: dataset/VISITANTES_ENTIDADES/visita_a_entidades.xlsx
-- Norma: Ley 28024 (Gestión de Intereses) + Ley 27444 (Procedimientos Administrativos)
-- Valor anti-corrupción:
--   · Detectar lobby informal: visitante = representante legal de empresa Y → Y gana contrato
--   · Detectar conflicto de interés: visitante de entidad privada visita funcionario que firma adjudicaciones
--   · Frecuencia anormal: mismo visitante × mismo funcionario × N visitas en corto período

CREATE TABLE IF NOT EXISTS visitas_entidades (
    id                       BIGSERIAL PRIMARY KEY,
    fecha_registro           DATE,
    fecha_visita             DATE,
    entidad_visitada         TEXT      NOT NULL,
    entidad_visitada_norm    TEXT      NOT NULL,        -- UPPER sin tildes
    visitante                TEXT      NOT NULL,
    visitante_norm           TEXT      NOT NULL,
    tipo_documento           TEXT,                       -- DNI | CE | PASAPORTE | RUC
    numero_documento         TEXT,                       -- limpio sin prefijo
    tipo_entidad_visitante   TEXT,                       -- 'publica' | 'privada' | 'persona_natural'
    entidad_visitante        TEXT,                       -- razón social / nombre completo si pública/privada
    funcionario_visitado     TEXT,                       -- raw (APELLIDOS - AREA - CARGO)
    funcionario_nombre       TEXT,                       -- parseado
    funcionario_area         TEXT,
    funcionario_cargo        TEXT,
    hora_ingreso             TIME,
    hora_salida              TIME,
    duracion_min             INTEGER,                    -- diff en minutos
    motivo                   TEXT,
    lugar_especifico         TEXT,
    observacion              TEXT,
    cargado_en               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visitas_doc            ON visitas_entidades (numero_documento);
CREATE INDEX IF NOT EXISTS idx_visitas_visitante_norm ON visitas_entidades (visitante_norm);
CREATE INDEX IF NOT EXISTS idx_visitas_entidad_norm   ON visitas_entidades (entidad_visitada_norm);
CREATE INDEX IF NOT EXISTS idx_visitas_funcionario    ON visitas_entidades (funcionario_nombre);
CREATE INDEX IF NOT EXISTS idx_visitas_fecha          ON visitas_entidades (fecha_visita DESC);
CREATE INDEX IF NOT EXISTS idx_visitas_tipo_ent_priv  ON visitas_entidades (tipo_entidad_visitante)
    WHERE tipo_entidad_visitante = 'privada';

-- Vista de frecuencias anormales: par (visitante × funcionario) con ≥5 visitas
CREATE OR REPLACE VIEW visitas_frecuencia_anormal AS
SELECT numero_documento, visitante, funcionario_nombre, entidad_visitada,
       COUNT(*) AS n_visitas,
       MIN(fecha_visita) AS primera,
       MAX(fecha_visita) AS ultima,
       SUM(COALESCE(duracion_min, 0)) AS minutos_totales
FROM visitas_entidades
WHERE numero_documento IS NOT NULL AND funcionario_nombre IS NOT NULL
GROUP BY numero_documento, visitante, funcionario_nombre, entidad_visitada
HAVING COUNT(*) >= 5;
