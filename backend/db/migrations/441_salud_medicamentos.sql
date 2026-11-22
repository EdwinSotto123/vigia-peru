-- 441 · Gobserva Salud, medicamentos: «¿este medicamento o este lote tiene una alerta?» y su precio de referencia.
--
-- Qué se carga y de dónde (todo de la Dirección General de Medicamentos, Insumos y Drogas, DIGEMID; docs/salud/datos.md §6.1):
--   salud_medicamento   el «Indicador de precios» del Observatorio de Productos Farmacéuticos: un ZIP por mes con un Excel
--                       (Archivos/Indicadores/TendenciaCentral/FT_AAAAMM.zip). Una fila por presentación: nombre, registro
--                       sanitario, titular, fabricante, país, principio activo (IFA) y la media, mediana y moda del precio de
--                       venta al público en farmacias y boticas PRIVADAS ese mes, con cuántas lo reportaron. No es el
--                       registro sanitario completo (ese no tiene descarga): son los ~15 mil productos con precios reportados.
--   salud_alerta        las alertas DIGEMID (productos falsificados, control de calidad, seguridad, modificaciones), de la
--                       API pública de su web (wp-json, categoría 34) y el texto de cada PDF: ahí vienen el registro
--                       sanitario y el lote. `registros` son los registros sanitarios que nombra el PDF: unen la alerta con
--                       la ficha del medicamento.
--
-- Una alerta sólo dice lo que dice DIGEMID: un lote observado no quiere decir que todo el producto lo esté. La web lo dice.

CREATE TABLE IF NOT EXISTS salud_medicamento (
  codigo            int PRIMARY KEY,             -- «Código de Producto» del Observatorio (una presentación)
  nombre            text NOT NULL,               -- nombre comercial
  nombre_norm       text NOT NULL,
  concentracion     text,
  forma             text,                        -- forma farmacéutica
  presentacion      text,
  fracciones        int,
  clasificacion     text,                        -- MARCA, GENÉRICO…, tal como viene
  registro          text,                        -- registro sanitario (EE01234, N-12345, BE00552…)
  titular           text,                        -- titular del registro sanitario (empresa)
  fabricante        text,
  pais              text,
  grupo             text,                        -- grupo de producto
  ifa               text,                        -- ingrediente(s) farmacéutico(s) activo(s)
  ifa_norm          text,
  cantidad_ifas     int,
  establecimientos  int,                         -- farmacias y boticas privadas que reportaron su precio ese mes
  precio_media      numeric(12, 2),
  precio_mediana    numeric(12, 2),
  precio_moda       numeric(12, 2),
  periodo           date NOT NULL,               -- el mes del archivo (día 1)
  fuente_archivo    text,
  primera_vez       timestamptz NOT NULL DEFAULT now(),
  visto_at          timestamptz NOT NULL DEFAULT now(),
  en_catalogo       boolean NOT NULL DEFAULT true -- false: no figuró en el último archivo cargado
);
CREATE INDEX IF NOT EXISTS salud_medicamento_nombre_trgm ON salud_medicamento USING gin (nombre_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS salud_medicamento_ifa_trgm ON salud_medicamento USING gin (ifa_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS salud_medicamento_registro ON salud_medicamento (registro);
CREATE INDEX IF NOT EXISTS salud_medicamento_equivalentes ON salud_medicamento (ifa_norm, concentracion, forma);

CREATE TABLE IF NOT EXISTS salud_alerta (
  id                int PRIMARY KEY,             -- id de la entrada en la web de DIGEMID
  numero            text,                        -- «142-2026»
  fecha             date NOT NULL,
  tipo              text NOT NULL CHECK (tipo IN ('falsificado', 'calidad', 'seguridad', 'modificacion', 'internacional', 'otra')),
  titulo            text NOT NULL,               -- «ALERTA DIGEMID N° 142-2026»
  motivo            text,                        -- «RETIRO DEL MERCADO DE UN LOTE…»
  productos         text,                        -- los productos que nombra la entrada («Guantes QX Alkhofar»)
  url               text NOT NULL,
  pdf_url           text,
  texto_norm        text,                        -- el texto del PDF, normalizado: sólo para buscar (no se publica)
  registros         text[] NOT NULL DEFAULT '{}',
  modificado_at     timestamptz,
  leido_at          timestamptz NOT NULL DEFAULT now(),
  pdf_error         text
);
CREATE INDEX IF NOT EXISTS salud_alerta_fecha ON salud_alerta (fecha DESC, id DESC);
CREATE INDEX IF NOT EXISTS salud_alerta_registros ON salud_alerta USING gin (registros);
CREATE INDEX IF NOT EXISTS salud_alerta_texto_trgm ON salud_alerta USING gin (texto_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS salud_alerta_productos_trgm ON salud_alerta USING gin ((upper(coalesce(productos, '') || ' ' || coalesce(motivo, ''))) gin_trgm_ops);

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE salud_medicamento OWNER TO vigia_jobs;
    ALTER TABLE salud_alerta OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON salud_medicamento, salud_alerta TO %I', r);
    END IF;
  END LOOP;
END $$;
