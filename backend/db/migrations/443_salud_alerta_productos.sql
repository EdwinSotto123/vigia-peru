-- 443 · Gobserva Salud, lo que dice cada alerta de DIGEMID, ordenado (2026-11-22, el usuario: «un pipeline de
-- procesamiento para mostrar lote, código, medicamento, presentación, marca»).
--
-- Cada PDF de alerta trae una tabla: el producto, su presentación, el lote (o varios), el registro sanitario, el
-- fabricante, el país, el titular y el resultado o la observación. Hasta hoy sólo se guardaba su texto normalizado para
-- buscar. Ahora:
--   salud_alerta.texto            el texto del PDF tal como sale (con sus guiones, barras y fechas), para extraer.
--   salud_alerta_producto         una fila por producto y lote observados, extraída por un modelo abierto (vigia-llm) y
--                                 VALIDADA contra el texto: un valor que no aparece literal en el PDF no se guarda. Se une
--                                 con el catálogo (salud_medicamento) por el registro sanitario.
--   salud_alerta.extraido_*       cuándo, con qué modelo y si falló (la extracción se rehace si cambia el texto).

ALTER TABLE salud_alerta ADD COLUMN IF NOT EXISTS texto text;
ALTER TABLE salud_alerta ADD COLUMN IF NOT EXISTS extraido_at timestamptz;
ALTER TABLE salud_alerta ADD COLUMN IF NOT EXISTS extraido_modelo text;
ALTER TABLE salud_alerta ADD COLUMN IF NOT EXISTS extraido_huella text;   -- md5 del texto con que se extrajo
ALTER TABLE salud_alerta ADD COLUMN IF NOT EXISTS extraido_error text;

CREATE TABLE IF NOT EXISTS salud_alerta_producto (
  id                  bigserial PRIMARY KEY,
  alerta_id           int NOT NULL REFERENCES salud_alerta (id) ON DELETE CASCADE,
  orden               int NOT NULL,                -- el orden en la tabla del PDF
  producto            text NOT NULL,               -- como lo escribe la alerta («PANADOL 500 MG TABLETA»)
  producto_norm       text NOT NULL,
  presentacion        text,                        -- «Caja x 100 tabletas», «Frasco x 120 mL»
  lote                text,                        -- un lote por fila (una alerta con tres lotes da tres filas)
  lote_norm           text,                        -- sin espacios ni signos, en mayúsculas: para buscar el de la caja
  registro            text,                        -- registro sanitario normalizado (EE01234)
  vencimiento         text,                        -- como lo escribe la alerta («05/2027», «30/05/2027»)
  fabricante          text,
  pais                text,
  titular             text,                        -- titular del registro sanitario (la marca/empresa que lo vende)
  detalle             text,                        -- el resultado o la observación («No conforme: ensayo de…»)
  medicamento_codigo  int,                         -- el producto del catálogo con ese registro (el más reportado)
  creado_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS salud_alerta_producto_alerta ON salud_alerta_producto (alerta_id, orden);
CREATE INDEX IF NOT EXISTS salud_alerta_producto_lote ON salud_alerta_producto (lote_norm) WHERE lote_norm IS NOT NULL;
CREATE INDEX IF NOT EXISTS salud_alerta_producto_registro ON salud_alerta_producto (registro) WHERE registro IS NOT NULL;
CREATE INDEX IF NOT EXISTS salud_alerta_producto_nombre_trgm ON salud_alerta_producto USING gin (producto_norm gin_trgm_ops);

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE salud_alerta_producto OWNER TO vigia_jobs;
    ALTER SEQUENCE salud_alerta_producto_id_seq OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON salud_alerta_producto TO %I', r);
    END IF;
  END LOOP;
END $$;
