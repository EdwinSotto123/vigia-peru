-- 264 · Líneas de negocio y oportunidades por afinidad (Gobserva Licitaciones, fase 1, 2026-11-07).
--
-- Una línea de negocio es lo que una empresa vende, dicho en sus palabras («útiles de oficina y tóner para impresoras»),
-- con sus regiones, tipos de contratación y palabras clave. «Para ti» (routes/gobservaCuenta.ts, lib/afinidad.ts) ordena
-- las licitaciones convocadas y los contratos menores abiertos por su parecido con cada línea: el coseno entre el
-- embedding de la línea y el de cada oportunidad (bge-m3 de Workers AI, el mismo del RAG de la 258), más un plus si
-- aparece una palabra clave. Las regiones y los tipos filtran.
--
--   gobserva_lineas       las líneas de cada cuenta (cuántas, según el plan: 1, 3 o 10).
--   oportunidad_vector    el embedding de cada oportunidad abierta: lo calcula la tarea del cron (/admin/asignar, cada
--                         10 min) con tope de tiempo; se vuelve a calcular si cambia el texto (un contrato menor recibe sus
--                         ítems después) y se borra a los 30 días de cerrada.

CREATE TABLE IF NOT EXISTS public.gobserva_lineas (
  id              bigserial PRIMARY KEY,
  firebase_uid    text NOT NULL REFERENCES gobserva_cuentas (firebase_uid),
  nombre          text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 80),
  descripcion     text NOT NULL CHECK (length(descripcion) BETWEEN 3 AND 1000),
  palabras        text[] NOT NULL DEFAULT '{}' CHECK (cardinality(palabras) <= 20),
  regiones        text[] NOT NULL DEFAULT '{}' CHECK (cardinality(regiones) <= 25),
  tipos           text[] NOT NULL DEFAULT '{}' CHECK (tipos <@ ARRAY['bienes', 'servicios', 'obras', 'consultoria']),
  monto_min       numeric CHECK (monto_min >= 0),
  monto_max       numeric CHECK (monto_max >= 0),
  embedding       halfvec(1024),
  creado_at       timestamptz NOT NULL DEFAULT now(),
  actualizado_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gobserva_lineas_cuenta ON public.gobserva_lineas (firebase_uid);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gobserva_lineas TO vigia_api;
GRANT USAGE ON SEQUENCE public.gobserva_lineas_id_seq TO vigia_api;
GRANT SELECT ON public.gobserva_lineas TO vigia_api_admin;

CREATE TABLE IF NOT EXISTS public.oportunidad_vector (
  fuente     text NOT NULL CHECK (fuente IN ('proceso', 'menor')),
  id         text NOT NULL,                -- ocid de la convocatoria | id_prod6 del contrato menor
  huella     text NOT NULL,                -- md5 del texto embebido: si cambia, se vuelve a calcular
  embedding  halfvec(1024) NOT NULL,
  creado     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fuente, id)
);
GRANT SELECT ON public.oportunidad_vector TO vigia_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.oportunidad_vector TO vigia_api_admin;
COMMENT ON TABLE public.oportunidad_vector IS
  'Embedding (bge-m3) de cada oportunidad abierta para «Para ti» de Gobserva Licitaciones (migración 264).';
