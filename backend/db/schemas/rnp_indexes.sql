-- Índices del RNP — se crean DESPUÉS del COPY masivo para evitar
-- el costo de reindexado durante 1.44M de INSERTs.

CREATE INDEX IF NOT EXISTS idx_rnp_numdoc ON rnp_conformacion_juridica (numero_documento);
CREATE INDEX IF NOT EXISTS idx_rnp_ruc    ON rnp_conformacion_juridica (ruc_empresa);
CREATE INDEX IF NOT EXISTS idx_rnp_nombre ON rnp_conformacion_juridica (nombre);
CREATE INDEX IF NOT EXISTS idx_rnp_pe     ON rnp_conformacion_juridica (numero_documento, ruc_empresa);

ANALYZE rnp_conformacion_juridica;
