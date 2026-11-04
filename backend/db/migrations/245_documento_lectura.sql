-- 245 · Lo que Claude leyó en los documentos de cada contratación
--
-- backend/lector/leer.py lee con Claude Haiku 5.5 los PDF que ya están en el R2 (documentos_gcs), un tipo por vez
-- (`clase`): el otorgamiento de la buena pro, el contrato firmado, etc. Cada lector extrae HECHOS con un esquema fijo
-- (`salida`) y las banderas salen de reglas sobre esos hechos (backend/lector/<clase>.py → banderas_de), no las elige el
-- modelo: probado en backend/evals/actas_buena_pro (informe.md).
--
-- `salida` puede traer nombres de postores que son personas (RUC 10): la API los enmascara al publicar, como en todo el
-- sitio. No trae DNI: los lectores no los piden.

CREATE TABLE IF NOT EXISTS documento_lectura (
  ocid        text        NOT NULL,
  clase       text        NOT NULL,                 -- buena_pro | contrato | …
  version     text        NOT NULL,                 -- del lector (buena_pro v2, …)
  modelo      text        NOT NULL,                 -- el que respondió
  documentos  bigint[]    NOT NULL DEFAULT '{}',    -- documentos_gcs.id leídos
  paginas     int,
  estado      text        NOT NULL,                 -- ok | truncada | rechazo | json_invalido | sin_pdf | grande | error
  salida      jsonb,
  banderas    text[]      NOT NULL DEFAULT '{}',
  tokens_in   int,
  tokens_out  int,
  costo_usd   numeric(10, 6),
  detalle     text,                                 -- por qué no se leyó, si no
  leido_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ocid, clase, version)
);
CREATE INDEX IF NOT EXISTS documento_lectura_banderas ON documento_lectura USING gin (banderas);
CREATE INDEX IF NOT EXISTS documento_lectura_clase ON documento_lectura (clase, estado);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE documento_lectura OWNER TO vigia_jobs;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_api') THEN
    GRANT SELECT ON documento_lectura TO vigia_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_api_admin') THEN
    GRANT SELECT ON documento_lectura TO vigia_api_admin;
  END IF;
END $$;
