-- 319_funcionario_planilla.sql — El índice de personas con cargo público suma a quien está o estuvo en una planilla.
--
-- Pedido del dueño (2026-11-16), al ver la 318: «no sólo es declaración jurada. También es si contrata con el Estado, o sea
-- si está en planilla, ¿por qué no tenemos su data si está en planilla?». La teníamos y no se veía: la persona por la que
-- preguntó (el titular de un organismo) figura en la planilla de su entidad durante 18 meses seguidos, pero el último
-- archivo que la entidad publicó no la trae, así que pasó a planilla_salida («trabajó antes») y la web sólo listaba —y
-- sólo daba ficha— a quien está en el último mes de cada entidad (planilla_persona). Quien deja de aparecer un mes se
-- quedaba sin ficha.
--
-- Ahora funcionario_resumen es una fila por PERSONA con cargo público, venga de donde venga:
--   · declaraciones juradas de intereses (dji_funcionarios): 443 mil personas;
--   · la planilla de hoy (planilla_persona) y quienes ya no figuran (planilla_salida): 829 mil personas.
-- Juntas, 1,15 millones (122 mil están en las dos). La persona es su nombre completo normalizado, que en los tres registros
-- se escribe igual: mef_norm(paterno materno nombres).
--
-- El cargo y la entidad que se muestran: los de la planilla de hoy si está en ella; si no, lo más reciente entre su última
-- planilla y su última declaración (la planilla dice el cargo real donde la DJI dice «COLABORADOR»).
--
-- De paso: las fechas de la DJI se leen con fecha_dji() (migración 91, que no falla con una fecha imposible) y se retira
-- dji_fecha(), que la 318 había creado sin hacer falta.

SET lock_timeout = '10s';

ALTER TABLE public.funcionario_resumen
  ADD COLUMN IF NOT EXISTS planilla_hoy        BOOLEAN NOT NULL DEFAULT false,   -- figura en el último mes de alguna entidad
  ADD COLUMN IF NOT EXISTS planilla_entidades  INT     NOT NULL DEFAULT 0,       -- en cuántas entidades figuró (hoy o antes)
  ADD COLUMN IF NOT EXISTS planilla_desde      DATE,
  ADD COLUMN IF NOT EXISTS planilla_hasta      DATE,
  ADD COLUMN IF NOT EXISTS cargo_de            TEXT;                             -- 'planilla' o 'dji': de dónde sale `cargo`
COMMENT ON TABLE public.funcionario_resumen IS
  'Una fila por persona con cargo público: quien presentó una declaración jurada de intereses (Contraloría) o está o estuvo '
  'en una planilla del Estado (Portal de Transparencia). Su cargo y entidad más recientes, cuántas declaraciones, en cuántas '
  'planillas y las palabras visibles de su nombre para buscarla. La rehace refrescar_funcionario_resumen(). El nombre '
  'completo sólo sale de la API con el apellido materno tapado (migraciones 318 y 319).';

-- Sin paralelismo: fecha_dji() atrapa las fechas imposibles con un bloque EXCEPTION (una subtransacción), y Postgres no
-- deja abrir subtransacciones dentro de una consulta en paralelo («cannot start subtransactions during a parallel
-- operation», visto en DEV al aplicar esta migración).
CREATE OR REPLACE FUNCTION public.refrescar_funcionario_resumen() RETURNS integer
LANGUAGE plpgsql SET work_mem = '256MB' SET statement_timeout = '1500s' SET max_parallel_workers_per_gather = 0
SET search_path = public, pg_temp AS $$
DECLARE v_filas int;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('refrescar_funcionario_resumen')) THEN
    RETURN 0;                       -- ya hay otra corriendo
  END IF;

  -- 1. Quien declaró: su declaración más reciente da el cargo y la entidad.
  CREATE TEMP TABLE _fr_dji ON COMMIT DROP AS
  WITH d AS (
    SELECT x.nombre_norm, x.apellido_paterno, x.apellido_materno, x.nombres, x.cargo, x.entidad, x.codigo_ddjj,
           fecha_dji(x.fecha_presentacion) AS presentada
      FROM dji_funcionarios x
     WHERE x.nombre_norm <> '' AND COALESCE(x.apellido_paterno, '') <> '' AND COALESCE(x.nombres, '') <> ''
  ), ult AS (
    SELECT DISTINCT ON (d.nombre_norm) d.nombre_norm, d.apellido_paterno AS paterno, d.apellido_materno AS materno, d.nombres, d.cargo, d.entidad
      FROM d ORDER BY d.nombre_norm, d.presentada DESC NULLS LAST, d.codigo_ddjj DESC
  ), cta AS (
    SELECT d.nombre_norm, count(DISTINCT d.codigo_ddjj)::int AS declaraciones, count(DISTINCT d.entidad)::int AS entidades,
           min(d.presentada) AS primera, max(d.presentada) AS ultima
      FROM d GROUP BY d.nombre_norm
  )
  SELECT u.nombre_norm, u.paterno, u.materno, u.nombres, u.cargo, u.entidad,
         (SELECT r.ruc FROM dji_entidad_ruc r WHERE r.entidad = u.entidad) AS entidad_ruc,
         a.declaraciones, a.entidades, a.primera, a.ultima
    FROM ult u JOIN cta a USING (nombre_norm);
  ANALYZE _fr_dji;

  -- 2. Quien está o estuvo en una planilla: la de hoy primero; si no, la última en que figuró.
  CREATE TEMP TABLE _fr_pla ON COMMIT DROP AS
  WITH p AS (
    SELECT nombre_norm, paterno, materno, nombres, entidad_ruc, cargo, primer_mes, ultimo_mes, true AS hoy FROM planilla_persona
    UNION ALL
    SELECT nombre_norm, paterno, materno, nombres, entidad_ruc, cargo, primer_mes, ultimo_mes, false FROM planilla_salida
  ), v AS (
    SELECT * FROM p WHERE p.nombre_norm <> '' AND COALESCE(p.paterno, '') <> '' AND COALESCE(p.nombres, '') <> ''
  ), ult AS (
    SELECT DISTINCT ON (v.nombre_norm) v.nombre_norm, v.paterno, v.materno, v.nombres, v.entidad_ruc, v.cargo
      FROM v ORDER BY v.nombre_norm, v.hoy DESC, v.ultimo_mes DESC NULLS LAST, v.entidad_ruc
  ), cta AS (
    SELECT v.nombre_norm, bool_or(v.hoy) AS hoy, count(DISTINCT v.entidad_ruc)::int AS entidades,
           min(v.primer_mes) AS desde, max(v.ultimo_mes) AS hasta
      FROM v GROUP BY v.nombre_norm
  )
  SELECT u.nombre_norm, u.paterno, u.materno, u.nombres, u.entidad_ruc, u.cargo, a.hoy, a.entidades, a.desde, a.hasta
    FROM ult u JOIN cta a USING (nombre_norm);
  ANALYZE _fr_pla;

  -- El nombre de cada entidad de la planilla (planilla_salida no lo guarda).
  CREATE TEMP TABLE _fr_ent ON COMMIT DROP AS
  SELECT x.entidad_ruc, COALESCE((SELECT es.nombre FROM entidad_stats es WHERE es.ruc = x.entidad_ruc),
                                 (SELECT max(pp.entidad) FROM planilla_persona pp WHERE pp.entidad_ruc = x.entidad_ruc)) AS nombre
    FROM (SELECT DISTINCT entidad_ruc FROM _fr_pla) x;
  ANALYZE _fr_ent;

  -- El código de quien todavía no lo tiene (el de los demás no cambia: los enlaces a su ficha siguen valiendo).
  INSERT INTO funcionario_codigo (nombre_norm)
  SELECT nombre_norm FROM _fr_dji UNION SELECT nombre_norm FROM _fr_pla
  ON CONFLICT (nombre_norm) DO NOTHING;

  DELETE FROM funcionario_resumen;
  INSERT INTO funcionario_resumen
    (codigo, nombre_norm, paterno, materno, nombres, palabras, declaraciones, entidades, cargo, entidad, entidad_ruc, primera, ultima,
     planilla_hoy, planilla_entidades, planilla_desde, planilla_hasta, cargo_de)
  SELECT c.codigo, x.nombre_norm, x.paterno, x.materno, x.nombres,
         ARRAY(SELECT DISTINCT w FROM unnest(string_to_array(x.paterno || ' ' || x.nombres, ' ')) w WHERE length(w) >= 2),
         x.declaraciones, x.entidades,
         CASE WHEN x.de_planilla THEN x.p_cargo ELSE x.d_cargo END,
         CASE WHEN x.de_planilla THEN x.p_entidad ELSE x.d_entidad END,
         CASE WHEN x.de_planilla THEN x.p_ruc ELSE x.d_ruc END,
         x.primera, x.ultima, x.planilla_hoy, x.planilla_entidades, x.planilla_desde, x.planilla_hasta,
         CASE WHEN x.de_planilla THEN 'planilla' ELSE 'dji' END
    FROM (
      SELECT COALESCE(p.nombre_norm, d.nombre_norm) AS nombre_norm,
             mef_norm(COALESCE(p.paterno, d.paterno)) AS paterno,
             NULLIF(mef_norm(COALESCE(p.materno, d.materno)), '') AS materno,
             mef_norm(COALESCE(p.nombres, d.nombres)) AS nombres,
             COALESCE(d.declaraciones, 0) AS declaraciones, COALESCE(d.entidades, 0) AS entidades, d.primera, d.ultima,
             COALESCE(p.hoy, false) AS planilla_hoy, COALESCE(p.entidades, 0) AS planilla_entidades, p.desde AS planilla_desde, p.hasta AS planilla_hasta,
             NULLIF(btrim(p.cargo), '') AS p_cargo, e.nombre AS p_entidad, p.entidad_ruc AS p_ruc,
             NULLIF(btrim(d.cargo), '') AS d_cargo, NULLIF(btrim(d.entidad), '') AS d_entidad, d.entidad_ruc AS d_ruc,
             -- De la planilla si está en la de hoy, si no declaró, o si su última planilla es tan reciente como su última declaración.
             (p.nombre_norm IS NOT NULL AND (p.hoy OR d.nombre_norm IS NULL OR d.ultima IS NULL OR p.hasta >= date_trunc('month', d.ultima)::date)) AS de_planilla
        FROM _fr_pla p
        FULL JOIN _fr_dji d ON d.nombre_norm = p.nombre_norm
        LEFT JOIN _fr_ent e ON e.entidad_ruc = p.entidad_ruc
    ) x
    JOIN funcionario_codigo c ON c.nombre_norm = x.nombre_norm
   WHERE x.paterno <> '' AND x.nombres <> '';
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  ANALYZE funcionario_resumen;
  RETURN v_filas;
END $$;
ALTER FUNCTION public.refrescar_funcionario_resumen() OWNER TO vigia_jobs;

DROP FUNCTION IF EXISTS public.dji_fecha(text);

SET statement_timeout = '1500s';
SELECT refrescar_funcionario_resumen() AS personas_con_cargo_publico;
