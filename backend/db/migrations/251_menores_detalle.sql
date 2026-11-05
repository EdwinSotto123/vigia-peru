-- 251 · Contratos menores (≤8 UIT): la ventana de cotización con su hora, el detalle del proceso y sus ítems (prod6), lo
-- que Claude leyó en sus PDF y la tabla de sus señales.
--
-- Hasta aquí las fechas de prod6 nunca se guardaron: el buscador las manda como «06/11/2026 10:20:00» y el cargador sólo
-- entendía «2026-11-06», así que la ventana de cotización quedó vacía en los 11 mil contratos (el subtítulo de la vista
-- la prometía). Ahora van con su hora: una ventana de cotización se mide en horas.
--
-- El detalle de cada proceso (`listar-completo?id_contrato=` de prod6) trae lo que el listado no: el área usuaria, el
-- tipo de invitación, las etapas (consultas y cotización, con sus fechas) y los ÍTEMS con su código CUBSO, cantidad,
-- unidad y el precio adjudicado. Trae también el DNI y el nombre de quien aprobó cada etapa: NO se guardan.

SET lock_timeout = '5s';

-- Las fechas de prod6, con hora (estaban todas en NULL: el cambio de tipo no reescribe datos).
ALTER TABLE seace_menores ALTER COLUMN fec_publica TYPE timestamp USING fec_publica::timestamp;
ALTER TABLE seace_menores ALTER COLUMN fec_ini_cotizacion TYPE timestamp USING fec_ini_cotizacion::timestamp;
ALTER TABLE seace_menores ALTER COLUMN fec_fin_cotizacion TYPE timestamp USING fec_fin_cotizacion::timestamp;

ALTER TABLE seace_menores
  ADD COLUMN IF NOT EXISTS area_usuaria       text,        -- nomAreaUsuaria: la oficina que pidió la compra
  ADD COLUMN IF NOT EXISTS tipo_invitacion    text,        -- INVITACIÓN ABIERTA | …
  ADD COLUMN IF NOT EXISTS justif_invitacion  text,        -- por qué no fue abierta, si no lo fue
  ADD COLUMN IF NOT EXISTS ccmn               text,        -- nroCcmn: el código del catálogo de lo que se compra
  ADD COLUMN IF NOT EXISTS ccmn_nombre        text,
  ADD COLUMN IF NOT EXISTS consultas_desde    timestamp,   -- la etapa de consultas
  ADD COLUMN IF NOT EXISTS consultas_hasta    timestamp,
  ADD COLUMN IF NOT EXISTS detalle_at         timestamptz; -- cuándo se trajo el detalle (NULL: falta)

-- Los ítems de cada contrato menor: qué se compró, cuánto y a qué precio (el adjudicado al ganador).
CREATE TABLE IF NOT EXISTS seace_menor_item (
  id_contrato      integer NOT NULL REFERENCES seace_menores (id_contrato) ON DELETE CASCADE,
  n                smallint NOT NULL,           -- orden del ítem en el proceso
  cubso            text,                        -- código CUBSO de 16 dígitos (el de precio_referencia)
  cubso_nombre     text,
  descripcion      text,
  unidad           text,
  cantidad         numeric,
  precio_total     numeric(18, 2),
  precio_unitario  numeric(18, 4),              -- precio_total / cantidad
  ganador_ruc      text,                        -- el RUC del que ganó el ítem (un RUC 10 nunca va en un enlace)
  estado_cotiza    text,                        -- ADJUDICADO | DESIERTO | …
  distrito         text,                        -- dónde se entrega
  PRIMARY KEY (id_contrato, n)
);
CREATE INDEX IF NOT EXISTS seace_menor_item_cubso ON seace_menor_item (cubso) WHERE cubso IS NOT NULL;
COMMENT ON TABLE seace_menor_item IS 'Ítems de cada contrato menor (prod6 listar-completo): CUBSO, cantidad, unidad y precio adjudicado. Migración 251.';

-- Lo que Claude leyó en el requerimiento (TDR o especificaciones) y en el contrato u orden de cada contrato menor: la
-- misma forma que documento_lectura (245), con la llave de los menores. Las banderas salen de reglas sobre los hechos
-- (backend/lector/menor_*.py → banderas_de). `huella`: el SHA-1 del texto del PDF normalizado (sólo si tiene texto), para
-- reconocer el mismo requerimiento en varios contratos.
CREATE TABLE IF NOT EXISTS menor_lectura (
  id_contrato  integer     NOT NULL REFERENCES seace_menores (id_contrato) ON DELETE CASCADE,
  clase        text        NOT NULL,                 -- menor_tdr | menor_contrato
  version      text        NOT NULL,
  modelo       text        NOT NULL,
  paginas      int,
  estado       text        NOT NULL,                 -- ok | truncada | rechazo | json_invalido | sin_pdf | grande | error
  salida       jsonb,
  banderas     text[]      NOT NULL DEFAULT '{}',
  huella       text,
  tokens_in    int,
  tokens_out   int,
  costo_usd    numeric(10, 6),
  detalle      text,
  leido_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id_contrato, clase, version)
);
CREATE INDEX IF NOT EXISTS menor_lectura_banderas ON menor_lectura USING gin (banderas);
CREATE INDEX IF NOT EXISTS menor_lectura_huella ON menor_lectura (huella) WHERE huella IS NOT NULL;
COMMENT ON TABLE menor_lectura IS 'Lo que Claude leyó en el requerimiento y el contrato de cada contrato menor (backend/lector/menores.py). Migración 251.';

-- Las señales de cada contrato menor (la bandera va atada al contrato, con su evidencia). La llena
-- refrescar_menor_senales() (migración 252). `grupo`: los contratos que forman la señal (los del mismo día o del mismo año
-- con ese proveedor), cada uno con su id, código, fecha y monto.
CREATE TABLE IF NOT EXISTS menor_senal (
  id_contrato  integer NOT NULL REFERENCES seace_menores (id_contrato) ON DELETE CASCADE,
  tipo         text    NOT NULL,
  severidad    text    NOT NULL CHECK (severidad IN ('alta', 'media', 'baja')),
  monto        numeric(18, 2),                 -- lo que suma el grupo, o la diferencia que la señal mide
  grupo        jsonb,
  detalle      jsonb   NOT NULL DEFAULT '{}',
  PRIMARY KEY (id_contrato, tipo)
);
CREATE INDEX IF NOT EXISTS menor_senal_tipo ON menor_senal (tipo, severidad);
COMMENT ON TABLE menor_senal IS 'Señales de cada contrato menor, con su evidencia (refrescar_menor_senales, migración 252). Migración 251.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE seace_menor_item OWNER TO vigia_jobs;
    ALTER TABLE menor_lectura OWNER TO vigia_jobs;
    ALTER TABLE menor_senal OWNER TO vigia_jobs;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_api') THEN
    GRANT SELECT ON seace_menor_item, menor_lectura, menor_senal TO vigia_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_api_admin') THEN
    GRANT SELECT ON seace_menor_item, menor_lectura, menor_senal TO vigia_api_admin;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_mcp') THEN
    GRANT SELECT ON seace_menor_item, menor_senal TO vigia_mcp;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_ab') THEN
    GRANT SELECT ON seace_menor_item, menor_lectura, menor_senal TO vigia_ab;
  END IF;
END $$;
