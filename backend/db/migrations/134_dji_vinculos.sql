-- Vínculos familiares declarados en la DJI (Ley 31227), extraídos del PDF individual del portal público DJIC.
--
-- A diferencia de `dji_parentesco` (agregado, solo grados, del dato abierto masivo), aquí SÍ está la identidad del
-- pariente (DNI + nombre), que el PDF individual publica y el volcado masivo tacha. Con esto se puede cruzar un
-- pariente concreto contra los proveedores RUC-10 y la planilla de SU entidad = nepotismo/conflicto, nivel "grave".
--
-- PRIVACIDAD (crítico): `pariente_doc` y `pariente_nombre` son datos de un tercero. Se guardan SOLO para el cruce
-- interno, como el RUC completo de un proveedor: la API NUNCA los expone. La ficha solo publica el HECHO agregado
-- ("un pariente declarado de un funcionario de esta entidad figura como proveedor"), nunca el nombre ni el DNI.
-- Por eso NO se da SELECT a vigia_api sobre las columnas de identidad; el cruce lo materializa un job.

CREATE TABLE IF NOT EXISTS dji_vinculos (
  id               bigserial PRIMARY KEY,
  codigo_ddjj      bigint,                 -- declaración de la que sale (empata con dji_funcionarios)
  declarante_norm  text,                   -- nombre normalizado del declarante (funcionario)
  entidad_ruc      text,                   -- RUC de la entidad del declarante
  entidad          text,
  pariente_doc     text NOT NULL,          -- DNI/CE del pariente (interno; nunca se expone)
  pariente_norm    text,                   -- nombre normalizado del pariente (interno)
  parentesco       text,
  grado            text,                   -- hermano | hijo | padre | conyuge | otro
  ocupacion        text,
  capturado        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (codigo_ddjj, pariente_doc)
);

CREATE INDEX IF NOT EXISTS idx_dji_vinculos_pariente ON dji_vinculos (pariente_doc);
CREATE INDEX IF NOT EXISTS idx_dji_vinculos_entidad  ON dji_vinculos (entidad_ruc);
CREATE INDEX IF NOT EXISTS idx_dji_vinculos_declarante ON dji_vinculos (declarante_norm);

COMMENT ON TABLE dji_vinculos IS
  'Parientes declarados en la DJI con identidad (del PDF del portal DJIC), para cruce interno de nepotismo. Identidad NUNCA expuesta por la API. Migración 134.';

-- Solo los jobs escriben/leen la identidad; el cruce agregado lo materializa un refresco aparte.
GRANT SELECT, INSERT, UPDATE, DELETE ON dji_vinculos TO vigia_jobs;
GRANT USAGE, SELECT ON SEQUENCE dji_vinculos_id_seq TO vigia_jobs;
