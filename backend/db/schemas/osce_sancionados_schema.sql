-- OSCE Sancionados — Registro Nacional de Proveedores Inhabilitados / Multados
-- Source: dataset/SANCIONADOS/reporte_sancionados.xlsx (3 hojas: multa, definitivo, temporal)
-- Norma: TUO de la Ley N° 30225 — D.S. N° 082-2019-EF
-- Cruce crítico: si RUC con sanción VIGENTE aparece como ganador/postor/socio en RNP → bandera CRÍTICA (Art. 50).

CREATE TABLE IF NOT EXISTS osce_sancionados (
    id                      BIGSERIAL PRIMARY KEY,
    tipo                    TEXT      NOT NULL,    -- 'multa' | 'definitivo' | 'temporal'
    razon_social            TEXT      NOT NULL,    -- razón social o nombre completo persona natural
    razon_social_norm       TEXT      NOT NULL,    -- UPPER sin tildes para joins
    ruc                     TEXT      NOT NULL,    -- 11 dígitos (10... persona natural, 20... empresa)
    es_persona_natural      BOOLEAN,               -- TRUE si ruc empieza con 10
    resolucion              TEXT,                  -- ej "3555-2026-TCP-S3"
    fecha_resolucion        DATE,                  -- solo presente en hoja 'multa'
    monto_multa_soles       NUMERIC(14,2),         -- solo en 'multa'
    verificacion_pago       TEXT,                  -- solo en 'multa'
    periodo                 TEXT,                  -- "3 MESES", "24 MESES", "DEFINITIVO"
    fecha_desde             DATE,
    fecha_hasta             DATE,                  -- NULL si es DEFINITIVO
    infraccion              TEXT,                  -- código + texto. Puede traer múltiples concatenadas.
    norma                   TEXT,
    estado                  TEXT,                  -- 'VIGENTE' típicamente
    cargado_en              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sanc_ruc                ON osce_sancionados (ruc);
CREATE INDEX IF NOT EXISTS idx_sanc_estado_vigente     ON osce_sancionados (estado, fecha_hasta);
CREATE INDEX IF NOT EXISTS idx_sanc_razon_norm         ON osce_sancionados (razon_social_norm);
CREATE INDEX IF NOT EXISTS idx_sanc_tipo               ON osce_sancionados (tipo);
CREATE INDEX IF NOT EXISTS idx_sanc_persona_natural    ON osce_sancionados (es_persona_natural);

-- Vista de utilidad: sanciones realmente operativas a fecha de hoy.
CREATE OR REPLACE VIEW osce_sancionados_vigentes AS
SELECT *
FROM osce_sancionados
WHERE UPPER(COALESCE(estado, '')) = 'VIGENTE'
  AND (
        tipo = 'definitivo'                                                 -- inhabilitación de por vida
     OR (tipo = 'temporal'  AND fecha_hasta IS NOT NULL AND fecha_hasta >= CURRENT_DATE)
     OR (tipo = 'multa'     AND (fecha_hasta IS NULL OR fecha_hasta >= CURRENT_DATE))
  );
