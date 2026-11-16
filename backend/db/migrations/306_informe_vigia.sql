-- 306 · Informe de indicios en formato de control (2026-11-16).
--
-- El redactor de la API (backend/api/src/lib/informeControl.ts, GET /contratos/:ocid/informe-control) convierte las
-- señales de un contrato y su evidencia en un documento con la forma de un informe de control de la Contraloría
-- (información general, alcance, observaciones con condición, criterio, efecto, causa, evidencia y precedentes,
-- conclusión y recomendaciones). NO es un informe de la Contraloría ni atribuye responsabilidades: son indicios.
--
-- Cada fila es una versión del documento de un contrato. Se reutiliza mientras no cambien sus entradas: `huella` es el
-- SHA-256 de las señales, su evidencia y los datos del proceso que se le pasaron al modelo, más la versión del redactor.
-- Si cambian, la siguiente visita escribe una versión nueva (la anterior queda, para comparar).
--
--   estado      'generando' mientras se redacta (sirve de candado: (ocid, version) es única, así dos pedidos a la vez no
--               redactan dos veces el mismo documento), 'listo' o 'error' (sin contenido; el motivo en `error`).
--   contenido   el documento entero (JSON: lo pinta la web y lo lee el MCP); markdown, el mismo en texto.
--   modelo      el modelo abierto que redactó (Workers AI por vigia-llm: GLM 5.3 o GLM 5.3 flash); NULL si el texto se
--               armó sólo con los datos (el modelo no respondió).
--   tokens_*    y costo_usd: lo que costó redactarlo (tarifa de Workers AI del modelo que contestó).
--   pedido_por  'web', 'mcp' o 'admin' (el POST que regenera).
--
-- Sin datos personales: el contenido ya pasó por publicar() (un apellido tapado, sin DNI ni RUC 10) y no nombra a quien
-- firmó nada.

CREATE TABLE IF NOT EXISTS public.informe_vigia (
  id              bigserial PRIMARY KEY,
  ocid            text NOT NULL CHECK (length(ocid) BETWEEN 1 AND 80),
  version         integer NOT NULL CHECK (version >= 1),
  redactor        text NOT NULL CHECK (length(redactor) BETWEEN 1 AND 40),
  huella          text NOT NULL CHECK (huella ~ '^[0-9a-f]{64}$'),
  estado          text NOT NULL DEFAULT 'generando' CHECK (estado IN ('generando', 'listo', 'error')),
  contenido       jsonb CHECK (contenido IS NULL OR jsonb_typeof(contenido) = 'object'),
  markdown        text,
  modelo          text,
  tokens_entrada  integer NOT NULL DEFAULT 0 CHECK (tokens_entrada >= 0),
  tokens_salida   integer NOT NULL DEFAULT 0 CHECK (tokens_salida >= 0),
  costo_usd       numeric(12, 6) NOT NULL DEFAULT 0 CHECK (costo_usd >= 0),
  ms              integer CHECK (ms IS NULL OR ms >= 0),
  pedido_por      text NOT NULL DEFAULT 'web' CHECK (pedido_por IN ('web', 'mcp', 'admin')),
  error           text,
  generado_at     timestamptz NOT NULL DEFAULT now(),
  terminado_at    timestamptz,
  UNIQUE (ocid, version),
  CHECK (estado <> 'listo' OR (contenido IS NOT NULL AND markdown IS NOT NULL))
);
COMMENT ON TABLE public.informe_vigia IS
  'Informe de indicios en formato de control de un contrato (redactor de la API, migración 306). No es un informe de la '
  'Contraloría: reúne indicios de datos públicos sin atribuir responsabilidades. Una fila por versión; la vigente es la '
  'última «listo» cuya huella coincide con las entradas de hoy.';

-- La versión vigente de un contrato y lo que se está redactando.
CREATE INDEX IF NOT EXISTS informe_vigia_ocid ON public.informe_vigia (ocid, version DESC);
-- Los topes (cuántos se redactan a la vez, cuántos y cuánto costaron en el día): por fecha.
CREATE INDEX IF NOT EXISTS informe_vigia_fecha ON public.informe_vigia (generado_at DESC);

-- La API pública redacta y guarda (vigia_api); el panel también puede (vigia_api_admin). Nadie borra.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.informe_vigia TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.informe_vigia_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;
