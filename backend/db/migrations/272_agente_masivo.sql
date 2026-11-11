-- 272: libro del análisis masivo con las Lambdas de agentes (2026-11-11).
--
-- backend/scripts/masivo_agentes.py lanza contratos 2026 ya leídos (acta + bases) contra las Lambdas de producción
-- desde GitLab CI (tarea:masivo-agentes, rol vigia_ci). Antes el libro era un archivo en la PC; en el CI cada job es
-- nuevo, así que el libro vive aquí:
--   * cada contrato se RESERVA antes de lanzarlo (fila 'en_vuelo'; el índice único impide que dos jobs o dos hilos lancen
--     el mismo) y al terminar pasa a 'ok' o 'error' con su costo medido por el agente;
--   * el gasto acumulado = suma de `costo` (más 0,25 por cada uno en vuelo) y se compara con el tope del job;
--   * 'externo' = gasto fuera del masivo que cuenta para el tope (pruebas de oro, correcciones).
-- Una reserva sin resultado en 40 min (el job murió) se cierra como 'error' a costo estimado.

CREATE TABLE IF NOT EXISTS public.agente_masivo (
  id            bigserial PRIMARY KEY,
  ocid          text,
  red           text NOT NULL,
  estado        text NOT NULL DEFAULT 'en_vuelo' CHECK (estado IN ('en_vuelo', 'ok', 'error', 'externo')),
  costo         numeric(10, 6) NOT NULL DEFAULT 0,
  costo_medido  boolean NOT NULL DEFAULT false,
  segundos      real,
  score         integer,
  error         text,
  motivo        text,
  origen        text,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  terminado_en  timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS agente_masivo_en_vuelo_uq ON public.agente_masivo (ocid) WHERE estado = 'en_vuelo';
CREATE INDEX IF NOT EXISTS agente_masivo_ocid_idx ON public.agente_masivo (ocid);

GRANT SELECT, INSERT, UPDATE ON public.agente_masivo TO vigia_jobs;
GRANT USAGE, SELECT ON SEQUENCE public.agente_masivo_id_seq TO vigia_jobs;
-- El masivo salta lo que ya tiene alerta: vigia_jobs sólo ve el código, no el dictamen.
GRANT SELECT (codigo) ON public.alertas TO vigia_jobs;
