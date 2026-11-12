-- 274: tandas del análisis masivo y su lectura desde el panel (2026-11-12).
--
-- Pedido del usuario: «que salga en la plataforma cuánto hemos gastado y demás». El panel (Procesamientos → Masivo)
-- lee el libro (agente_masivo, migración 272) y estas tandas: cada job de GitLab (tarea:masivo-agentes) abre su fila al
-- empezar, con el tope, el reparto y los pendientes que vio, y la cierra al terminar con lo que hizo. Contar los
-- pendientes en vivo es caro (lecturas × convocatorias), así que el panel muestra los de la última tanda.
--
--   pendientes   {red: n} lo que el masivo va a analizar (acta y bases leídas, más el contrato o las consultas)
--   sin_info     {red: n} lo que tiene acta y bases pero ni contrato ni consultas: se salta hasta que se lean

CREATE TABLE IF NOT EXISTS public.agente_masivo_tanda (
  id          bigserial PRIMARY KEY,
  origen      text NOT NULL UNIQUE,
  inicio      timestamptz NOT NULL DEFAULT now(),
  fin         timestamptz,
  tope        numeric(10, 2) NOT NULL,
  plan        text NOT NULL,
  filtro      text NOT NULL,
  pendientes  jsonb NOT NULL DEFAULT '{}'::jsonb,
  sin_info    jsonb NOT NULL DEFAULT '{}'::jsonb,
  gastado_al_inicio numeric(10, 2),
  ok          integer,
  errores     integer,
  costo       numeric(10, 4)
);

GRANT SELECT, INSERT, UPDATE ON public.agente_masivo_tanda TO vigia_jobs;
GRANT USAGE, SELECT ON SEQUENCE public.agente_masivo_tanda_id_seq TO vigia_jobs;

-- El panel sólo lee.
GRANT SELECT ON public.agente_masivo, public.agente_masivo_tanda TO vigia_api_admin;
