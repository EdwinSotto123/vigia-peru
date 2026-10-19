-- 74 · Bitácora de corridas de vigia-scrapers: cada fuente, cada pipeline, auditable desde /admin/fuentes.
--
-- Hasta acá cada corrida (un Workflow `vigia-scrapers-correr`) sólo dejaba sus líneas en Workers Logs: para saber si
-- el OECE, CONOSCE o el MEF se cargaron había que mirar Cloudflare. El Workflow anota aquí el inicio (fuente, quién
-- la lanzó, parámetros) y el final (ok o error, duración, el resumen que devuelve la fuente). La lee GET
-- /admin/fuentes, que junta además el estado de los pipelines (documentos de los financiados, base por año,
-- derivados). Si la tabla no existe, el Workflow sigue igual (anotar nunca corta una corrida).
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/74_corridas_fuente.sql

CREATE TABLE IF NOT EXISTS corridas_fuente (
  instancia  TEXT PRIMARY KEY,                  -- id de la instancia del Workflow (oece_ocds-20261019-0510-425a)
  fuente     TEXT NOT NULL,
  origen     TEXT,                              -- 'cron <expresión>' o 'manual'
  params     JSONB NOT NULL DEFAULT '{}'::jsonb, -- desde, hasta, seco, relleno, paso…
  estado     TEXT NOT NULL DEFAULT 'corriendo' CHECK (estado IN ('corriendo', 'ok', 'error')),
  inicio     TIMESTAMPTZ NOT NULL DEFAULT now(),
  fin        TIMESTAMPTZ,
  segundos   INT,
  resumen    JSONB,                             -- lo que devolvió la fuente (recortado a ~20 KB)
  error      TEXT
);
CREATE INDEX IF NOT EXISTS corridas_fuente_fuente ON corridas_fuente (fuente, inicio DESC);
CREATE INDEX IF NOT EXISTS corridas_fuente_inicio ON corridas_fuente (inicio DESC);
ALTER TABLE corridas_fuente OWNER TO vigia_jobs;
GRANT SELECT ON corridas_fuente TO vigia_api, vigia_api_admin;
-- El panel también lee el estado de los pipelines (la API ya lee convocatorias, documentos_gcs, pedidos…).
GRANT SELECT ON procesos_historicos, lotes_ingesta, derivados_refresco TO vigia_api_admin;
