-- 320_persona_busqueda.sql — Buscar por nombre a una persona contratada sin recorrer sus órdenes.
--
-- La búsqueda por nombre de quien recibió órdenes o ganó procesos (lib/personasNombre.ts, del 2026-11-16) leía
-- persona_orden_anual por el primer apellido: con uno común son 50 mil filas en 22 mil páginas (8 s en frío, medido en
-- PROD), y desde que el buscador general trae personas esa espera frenaba TODA la búsqueda (contratos, entidades…).
--
--   persona_busqueda   una fila por persona natural con órdenes de servicio o procesos ganados: su nombre, las palabras
--                      de ese nombre (GIN) y sus cifras ya sumadas (órdenes, monto, entidades, procesos).
--   refrescar_persona_busqueda()   la rehace desde persona_orden_anual y persona_ganadora (unos 40 s).
--
-- Privacidad: `palabras` trae TODAS las palabras del nombre, también el apellido que la API tapa, porque cuál se tapa lo
-- decide publicar() al responder. Por eso la tabla sólo PRESELECCIONA: la API se queda con quien coincide, en dos palabras
-- o más, por lo que se ve de su nombre ya tapado (cuantasVisibles), y descarta el resto. Guarda el RUC 10 y el nombre
-- entero, como persona_entidad: sólo la API la lee.

SET lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.persona_busqueda (
  ruc             TEXT    PRIMARY KEY,
  nombre          TEXT    NOT NULL,
  palabras        TEXT[]  NOT NULL,          -- las del nombre, como mef_norm (la «Ñ» como «N»)
  ordenes         INT     NOT NULL DEFAULT 0,
  monto           NUMERIC NOT NULL DEFAULT 0,
  entidades       INT     NOT NULL DEFAULT 0,
  entidad         TEXT,                       -- la que más le pagó
  procesos        INT     NOT NULL DEFAULT 0, -- procesos de selección que ganó (migración 317)
  monto_procesos  NUMERIC NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.persona_busqueda IS
  'Una fila por persona natural con órdenes de servicio o procesos ganados, con las palabras de su nombre (GIN) y sus cifras '
  'sumadas, para buscarla por nombre sin recorrer persona_orden_anual. Sólo preselecciona: la API publica a quien coincide '
  'por lo que se ve de su nombre. La rehace refrescar_persona_busqueda() (migración 320).';
CREATE INDEX IF NOT EXISTS persona_busqueda_palabras ON public.persona_busqueda USING gin (palabras);

ALTER TABLE public.persona_busqueda OWNER TO vigia_jobs;
REVOKE ALL ON public.persona_busqueda FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON public.persona_busqueda FROM %I', r);
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.persona_busqueda TO %I', r);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.refrescar_persona_busqueda() RETURNS integer
LANGUAGE plpgsql SET work_mem = '256MB' SET statement_timeout = '900s' SET search_path = public, pg_temp AS $$
DECLARE v_filas int;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('refrescar_persona_busqueda')) THEN
    RETURN 0;                       -- ya hay otra corriendo
  END IF;

  CREATE TEMP TABLE _pb_o ON COMMIT DROP AS
  SELECT o.ruc, max(o.nombre) AS nombre, sum(o.ordenes)::int AS ordenes, COALESCE(sum(o.monto), 0) AS monto,
         count(DISTINCT o.entidad_ruc)::int AS entidades, (array_agg(o.entidad ORDER BY o.monto DESC NULLS LAST))[1] AS entidad
    FROM persona_orden_anual o
   WHERE COALESCE(btrim(o.nombre), '') <> ''
   GROUP BY o.ruc;
  ANALYZE _pb_o;

  DELETE FROM persona_busqueda;
  INSERT INTO persona_busqueda (ruc, nombre, palabras, ordenes, monto, entidades, entidad, procesos, monto_procesos)
  SELECT x.ruc, x.nombre,
         -- En las órdenes la «Ñ» llega a veces como «¿»: vale por «N», como en mef_norm.
         ARRAY(SELECT DISTINCT w FROM unnest(string_to_array(mef_norm(replace(x.nombre, '¿', 'N')), ' ')) w WHERE length(w) >= 2),
         x.ordenes, x.monto, x.entidades, x.entidad, x.procesos, x.monto_procesos
    FROM (
      SELECT COALESCE(o.ruc, g.ruc) AS ruc, COALESCE(o.nombre, g.nombre) AS nombre, COALESCE(o.ordenes, 0) AS ordenes, COALESCE(o.monto, 0) AS monto,
             COALESCE(o.entidades, 0) AS entidades, o.entidad, COALESCE(g.procesos, 0) AS procesos, COALESCE(g.monto, 0) AS monto_procesos
        FROM _pb_o o FULL JOIN persona_ganadora g ON g.ruc = o.ruc
    ) x
   WHERE COALESCE(btrim(x.nombre), '') <> '';
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  ANALYZE persona_busqueda;
  RETURN v_filas;
END $$;
ALTER FUNCTION public.refrescar_persona_busqueda() OWNER TO vigia_jobs;

SET statement_timeout = '900s';
SELECT refrescar_persona_busqueda() AS personas_para_buscar;
