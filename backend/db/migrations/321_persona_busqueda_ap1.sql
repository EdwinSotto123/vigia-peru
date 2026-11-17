-- 321_persona_busqueda_ap1.sql — El primer apellido de cada persona, para buscarla por «apellido + otra palabra».
--
-- La 320 preseleccionaba por pares de palabras del nombre entero y ordenaba por cuántas coincidían. Dos problemas, medidos
-- el mismo día en PROD:
--   · con tres palabras comunes («apellido, nombre, nombre») el par de los dos nombres trae decenas de miles de personas:
--     13 s en un caso;
--   · el orden contaba también el apellido que la API tapa: quien escribía el nombre completo con el apellido tapado
--     correcto subía a la persona en la lista, y con uno equivocado no. Eso sirve para confirmarlo.
--
-- Ahora la API pregunta, por cada par ordenado de palabras (a, b): «personas cuyo PRIMER apellido es a y que traen b», las
-- de mayor monto primero, y publica a una persona sólo si a y b están entre lo que se ve de su nombre. Que salga o no
-- depende de esas dos palabras y de nada más de lo escrito.
--
--   persona_busqueda.ap1   el primer apellido, sin las partículas del principio («DE LA CRUZ» → «CRUZ»), con su índice.

SET lock_timeout = '10s';

ALTER TABLE public.persona_busqueda ADD COLUMN IF NOT EXISTS ap1 TEXT;
CREATE INDEX IF NOT EXISTS persona_busqueda_ap1 ON public.persona_busqueda (ap1);

-- El primer apellido de un nombre en el orden del padrón (apellidos y nombres), saltando «DE», «DEL», «LA»…
CREATE OR REPLACE FUNCTION public.primer_apellido(nombre text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (regexp_match(public.mef_norm(replace(nombre, '¿', 'N')), '^(?:(?:DE|DEL|LA|LAS|LOS|DA|DI|DOS|VAN|VON|SAN|Y)\s+)*(\S+)'))[1]
$$;
COMMENT ON FUNCTION public.primer_apellido(text) IS
  'El primer apellido de un nombre escrito «apellidos y nombres», sin partículas iniciales (migración 321).';

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
  INSERT INTO persona_busqueda (ruc, nombre, palabras, ap1, ordenes, monto, entidades, entidad, procesos, monto_procesos)
  SELECT x.ruc, x.nombre,
         -- En las órdenes la «Ñ» llega a veces como «¿»: vale por «N», como en mef_norm.
         ARRAY(SELECT DISTINCT w FROM unnest(string_to_array(mef_norm(replace(x.nombre, '¿', 'N')), ' ')) w WHERE length(w) >= 2),
         primer_apellido(x.nombre),
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
