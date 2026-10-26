-- Ledger de descargas de DJI del portal DJIC: estado por target (RUC entidad × apellidos), reintentos y éxito.
--
-- Autoritativo y local (los nodos de CI son sin estado: leen un archivo de pendientes y devuelven PDFs+logs como
-- artefactos; aquí se actualiza el estado desde esos logs). Permite reanudar, reintentar los que fallan y saber
-- qué PDFs ya tenemos en R2. `parse_estado` separa el éxito de DESCARGA del de LECTURA (parser vs GLM de respaldo).

CREATE TABLE IF NOT EXISTS dji_descargas (
  ruc          text NOT NULL,                 -- RUC de la entidad (clave del portal)
  apellidos    text NOT NULL,                 -- apellidos buscados
  estado       text NOT NULL DEFAULT 'pendiente',  -- pendiente | ok | error | sin_resultados
  intentos     int  NOT NULL DEFAULT 0,
  error        text,
  pdf_r2       text,                           -- clave del PDF en R2 (vigia-peru-batch)
  codigos_ddjj text,                           -- codigo_ddjj hallados (coma-separados), si se extraen
  parse_estado text NOT NULL DEFAULT 'pendiente',   -- pendiente | ok | parser_fallo | glm
  n_familiares int,
  descargado   timestamptz,
  actualizado  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ruc, apellidos)
);

CREATE INDEX IF NOT EXISTS idx_dji_descargas_estado ON dji_descargas (estado);
CREATE INDEX IF NOT EXISTS idx_dji_descargas_parse  ON dji_descargas (parse_estado);

COMMENT ON TABLE dji_descargas IS
  'Estado de descarga/lectura de cada DJI del portal DJIC (reintentos, éxito, PDF en R2). Migración 135.';

GRANT SELECT, INSERT, UPDATE, DELETE ON dji_descargas TO vigia_jobs;
