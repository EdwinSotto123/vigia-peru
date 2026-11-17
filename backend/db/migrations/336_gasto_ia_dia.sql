-- 336 · Lo que mide Cloudflare del uso de Workers AI, por día y modelo: la cifra «de la factura» al lado de los libros.
--
-- Los libros de la base (transparencia_analisis, agente_masivo, golden_resultado, pieza_lectura, documento_lectura,
-- menor_lectura, informe_vigia, gobserva_consumo) no anotan todo lo que gasta Workers AI: el laboratorio de precios, la
-- lectura de bases de empleo, las pruebas sueltas y los reintentos quedan fuera. Medido el 2026-11-17 con el GraphQL de
-- Cloudflare (aiInferenceAdaptiveGroups, neuronas × US$ 0,011 por 1 000): del 10 al 17 de noviembre Workers AI midió
-- ~US$ 3 480 y los libros sumaban ~US$ 2 590 (cubren ~74 %).
--
--   gasto_ia_dia   una fila por día (UTC, como lo agrupa Cloudflare), proveedor y modelo, con las neuronas y su costo.
--                  La llena backend/scripts/gasto_workers_ai.py desde una máquina con el token de Cloudflare (la API no
--                  lo tiene); GET /transparencia/gasto la lee si existe y la muestra al lado de los libros.
--
-- Sin datos personales: sólo agregados por día y modelo.

CREATE TABLE IF NOT EXISTS gasto_ia_dia (
  dia        date        NOT NULL,
  proveedor  text        NOT NULL DEFAULT 'workers_ai',
  modelo     text        NOT NULL,
  neuronas   bigint,
  pedidos    integer,
  usd        numeric(12, 4) NOT NULL,
  medido_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dia, proveedor, modelo)
);

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.gasto_ia_dia OWNER TO vigia_jobs;
  END IF;
  -- La API pública y el panel la leen (sólo agregados); la escribe quien corre el script (vigia_jobs o el dueño).
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'dev_api', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.gasto_ia_dia TO %I', r);
    END IF;
  END LOOP;
END $$;
