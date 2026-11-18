-- 357 · El cargo que la persona de verdad tuvo: el rector que salía como «Colaborador» con S/ 296 de sueldo.
--
-- Reporte del usuario (2026-11-17), ficha de un ex rector de una universidad nacional: «Colaborador» en una empresa de la
-- universidad, «Profesor principal» con S/ 296 al mes y nada de su rectorado. Los datos sí lo decían:
--
--   · La planilla lo trae cuatro meses como RECTOR con S/ 25 000 y un quinto mes, el de su salida, como profesor con S/ 296
--     de remuneración y S/ 21 667 de otros conceptos (la liquidación). planilla_salida se quedaba con el ÚLTIMO mes. Medido
--     en PROD: de 212 461 personas que salieron de una planilla, 9 742 tuvieron otro cargo más tiempo, 15 339 muestran menos
--     de la mitad de su sueldo habitual y 19 315 salen sin sueldo.
--   · Sus 11 declaraciones juradas dicen «COLABORADOR» porque el formulario de la Contraloría ofrece pocas categorías
--     («COLABORADOR» y «OTRO CARGO FUNCION O LABOR» son 1,63 de 1,83 millones de declaraciones). El puesto real («RECTOR DE
--     LA UNI») está en la sección de empleos de la misma declaración (dji_empleos, 2,7 millones de filas; 848 mil
--     declaraciones la traen), que ni la ficha ni el índice de personas leían.
--
-- 1. planilla_salida_cargo_principal(): el cargo de quien salió es el que tuvo MÁS meses (si empatan, el último) y su
--    sueldo, la mediana de esos meses sin los montos dudosos. Corre después de refrescar_planilla() (que sigue dejando el
--    último mes) y antes del índice de personas.
-- 2. refrescar_funcionario_resumen(): quien declaró con una categoría genérica lleva el puesto de la sección de empleos de
--    su última declaración: el de la misma entidad; si no lo hay, su empleo sin cese más reciente en una entidad pública
--    (y entonces esa es la entidad que se muestra).
--
-- La ficha (GET /personas/cargo/:codigo) lee en vivo, con sus índices, los empleos declarados (dji_empleos por
-- codigo_ddjj) y los cargos de la planilla mes a mes (planilla_pte por nombre_norm): no hace falta tabla nueva.

CREATE OR REPLACE FUNCTION public.planilla_salida_cargo_principal() RETURNS integer
LANGUAGE plpgsql SET work_mem = '256MB' SET statement_timeout = '1500s' SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  CREATE TEMP TABLE _psc ON COMMIT DROP AS
  WITH c AS (
    SELECT p.entidad_ruc, p.nombre_norm, NULLIF(btrim(p.cargo), '') AS cargo,
           count(DISTINCT p.anio * 100 + p.mes) AS meses, max(p.anio * 100 + p.mes) AS ultimo,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY
             CASE WHEN motivo_planilla_dudosa(p.remuneraciones, p.honorarios, p.incentivo, p.gratificacion, p.otros, p.total) IS NOT NULL THEN NULL
                  WHEN COALESCE(p.remuneraciones, 0) + COALESCE(p.honorarios, 0) > 0 THEN COALESCE(p.remuneraciones, 0) + COALESCE(p.honorarios, 0)
                  WHEN COALESCE(p.otros, 0) + COALESCE(p.gratificacion, 0) + COALESCE(p.incentivo, 0) = 0 THEN p.total END) AS base,
           (array_agg(p.dependencia ORDER BY p.anio DESC, p.mes DESC))[1] AS dependencia,
           (array_agg(p.regimen ORDER BY p.anio DESC, p.mes DESC))[1] AS regimen
      FROM planilla_salida s
      JOIN planilla_pte p ON p.nombre_norm = s.nombre_norm AND p.entidad_ruc = s.entidad_ruc
     GROUP BY 1, 2, 3
  )
  SELECT DISTINCT ON (c.entidad_ruc, c.nombre_norm) c.* FROM c WHERE c.cargo IS NOT NULL
   ORDER BY c.entidad_ruc, c.nombre_norm, c.meses DESC, c.ultimo DESC;
  CREATE INDEX ON _psc (entidad_ruc, nombre_norm); ANALYZE _psc;

  UPDATE planilla_salida s
     SET cargo = m.cargo, dependencia = COALESCE(m.dependencia, s.dependencia), regimen = COALESCE(m.regimen, s.regimen),
         base = COALESCE(m.base::numeric, s.base)
    FROM _psc m
   WHERE m.entidad_ruc = s.entidad_ruc AND m.nombre_norm = s.nombre_norm
     AND (s.cargo IS DISTINCT FROM m.cargo OR s.base IS DISTINCT FROM COALESCE(m.base::numeric, s.base));
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE planilla_salida;
  RETURN n;
END $$;
ALTER FUNCTION public.planilla_salida_cargo_principal() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION public.planilla_salida_cargo_principal() FROM PUBLIC;

-- El índice de personas con cargo público (migración 319), con el puesto real de quien declaró una categoría genérica.
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
    SELECT DISTINCT ON (d.nombre_norm) d.nombre_norm, d.apellido_paterno AS paterno, d.apellido_materno AS materno, d.nombres, d.cargo, d.entidad,
           d.codigo_ddjj
      FROM d ORDER BY d.nombre_norm, d.presentada DESC NULLS LAST, d.codigo_ddjj DESC
  ), cta AS (
    SELECT d.nombre_norm, count(DISTINCT d.codigo_ddjj)::int AS declaraciones, count(DISTINCT d.entidad)::int AS entidades,
           min(d.presentada) AS primera, max(d.presentada) AS ultima
      FROM d GROUP BY d.nombre_norm
  )
  SELECT u.nombre_norm, u.paterno, u.materno, u.nombres, u.cargo, u.entidad, u.codigo_ddjj,
         (SELECT r.ruc FROM dji_entidad_ruc r WHERE r.entidad = u.entidad) AS entidad_ruc,
         a.declaraciones, a.entidades, a.primera, a.ultima
    FROM ult u JOIN cta a USING (nombre_norm);
  ANALYZE _fr_dji;

  -- 1b. El puesto real de quien declaró con una categoría genérica: el de la sección de empleos de esa misma declaración.
  --     Primero el de la entidad en que declaró; si no figura, su empleo sin cese más reciente en una entidad pública.
  --     La fecha de inicio (DD/MM/AAAA) se ordena como texto AAAAMMDD: sin convertirla, que una fecha imposible no detenga nada.
  CREATE TEMP TABLE _fr_emp ON COMMIT DROP AS
  SELECT DISTINCT ON (u.nombre_norm) u.nombre_norm, upper(btrim(e.cargo)) AS cargo, e.ruc_entidad AS ruc,
         COALESCE(e.ruc_entidad = u.entidad_ruc, false) AS misma_entidad
    FROM _fr_dji u
    JOIN dji_empleos e ON e.codigo_ddjj = u.codigo_ddjj
   WHERE upper(btrim(u.cargo)) IN ('COLABORADOR', 'OTRO CARGO FUNCION O LABOR')
     AND length(btrim(COALESCE(e.cargo, ''))) >= 3
     AND upper(btrim(e.cargo)) NOT IN ('COLABORADOR', 'OTRO CARGO FUNCION O LABOR', 'OTRO', 'OTROS', 'NINGUNO', 'NINGUNA', 'NO APLICA')
     AND (e.ruc_entidad = u.entidad_ruc OR EXISTS (SELECT 1 FROM entidad_stats s WHERE s.ruc = e.ruc_entidad))
   ORDER BY u.nombre_norm, COALESCE(e.ruc_entidad = u.entidad_ruc, false) DESC, (COALESCE(btrim(e.fecha_cese), '') = '') DESC,
            (substr(e.fecha_inicio, 7, 4) || substr(e.fecha_inicio, 4, 2) || substr(e.fecha_inicio, 1, 2)) DESC NULLS LAST, upper(btrim(e.cargo));
  CREATE UNIQUE INDEX ON _fr_emp (nombre_norm); ANALYZE _fr_emp;

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

  -- El nombre de cada entidad que se muestra por su RUC (planilla_salida y dji_empleos no guardan el nombre canónico).
  CREATE TEMP TABLE _fr_ent ON COMMIT DROP AS
  SELECT x.entidad_ruc, COALESCE((SELECT es.nombre FROM entidad_stats es WHERE es.ruc = x.entidad_ruc),
                                 (SELECT max(pp.entidad) FROM planilla_persona pp WHERE pp.entidad_ruc = x.entidad_ruc)) AS nombre
    FROM (SELECT DISTINCT entidad_ruc FROM _fr_pla UNION SELECT DISTINCT ruc FROM _fr_emp WHERE NOT misma_entidad) x;
  CREATE UNIQUE INDEX ON _fr_ent (entidad_ruc); ANALYZE _fr_ent;

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
             -- El puesto de la sección de empleos donde la declaración sólo dice la categoría; con su entidad si es otra.
             COALESCE(m.cargo, NULLIF(btrim(d.cargo), '')) AS d_cargo,
             CASE WHEN m.nombre_norm IS NOT NULL AND NOT m.misma_entidad AND em.nombre IS NOT NULL THEN em.nombre ELSE NULLIF(btrim(d.entidad), '') END AS d_entidad,
             CASE WHEN m.nombre_norm IS NOT NULL AND NOT m.misma_entidad AND em.nombre IS NOT NULL THEN m.ruc ELSE d.entidad_ruc END AS d_ruc,
             -- De la planilla si está en la de hoy, si no declaró, o si su última planilla es tan reciente como su última declaración.
             (p.nombre_norm IS NOT NULL AND (p.hoy OR d.nombre_norm IS NULL OR d.ultima IS NULL OR p.hasta >= date_trunc('month', d.ultima)::date)) AS de_planilla
        FROM _fr_pla p
        FULL JOIN _fr_dji d ON d.nombre_norm = p.nombre_norm
        LEFT JOIN _fr_ent e ON e.entidad_ruc = p.entidad_ruc
        LEFT JOIN _fr_emp m ON m.nombre_norm = d.nombre_norm
        LEFT JOIN _fr_ent em ON em.entidad_ruc = m.ruc AND NOT m.misma_entidad
    ) x
    JOIN funcionario_codigo c ON c.nombre_norm = x.nombre_norm
   WHERE x.paterno <> '' AND x.nombres <> '';
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  ANALYZE funcionario_resumen;
  RETURN v_filas;
END $$;
ALTER FUNCTION public.refrescar_funcionario_resumen() OWNER TO vigia_jobs;
