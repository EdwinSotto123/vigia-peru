-- 200 · La pestaña Visitas sin reescribir las visitas.
--
-- refrescar_visitas_entidad (188) marcaba primero «quién decide» en cada visita sin marca con un UPDATE de toda la tabla.
-- Con las 10,8 M visitas de la plataforma nacional, ese UPDATE reescribía visitas_entidades (13 GB y 12 índices) en una
-- sola transacción: más de 80 minutos y 3 GB de filas muertas sin terminar. La marca es sólo un atajo (la API y los cruces
-- ya usan COALESCE(decisor, visita_decisor(cargo, área))): ahora los agregados la calculan al vuelo para las visitas que no
-- la traen, y las cargas nuevas la guardan al insertar (cargar_visitas_nacional.py).
--
-- Es la de la 188 sin ese UPDATE. Cómo aplicarla: después de la 188; luego SELECT refrescar_visitas_entidad();

CREATE OR REPLACE FUNCTION refrescar_visitas_entidad() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_visitas_entidad'));
  SET LOCAL work_mem = '256MB';
  -- Quién decide, de la marca de la visita o, si no la tiene (las de la plataforma nacional), calculado aquí: marcar las
  -- 10 M visitas con un UPDATE reescribía la tabla entera con sus 12 índices (más de una hora, 3 GB de filas muertas).

  CREATE TEMP TABLE _ve ON COMMIT DROP AS
    SELECT r.ruc AS entidad_ruc, v.id, v.fecha_visita, v.tipo_entidad_visitante, v.numero_documento,
           COALESCE(v.decisor, visita_decisor(v.funcionario_cargo, v.funcionario_area)) AS decisor, v.duracion_min,
           v.fuente, v.funcionario_area, v.funcionario_cargo, v.entidad_visitante,
           (v.hora_ingreso < TIME '07:00' OR v.hora_ingreso >= TIME '19:00' OR extract(isodow FROM v.fecha_visita) IN (6, 7)) AS fuera
      FROM visitas_entidades v JOIN visita_entidad_ruc r ON r.entidad_visitada = v.entidad_visitada;

  DELETE FROM entidad_visita_resumen;
  INSERT INTO entidad_visita_resumen
  SELECT entidad_ruc, count(*), min(fecha_visita), max(fecha_visita),
         count(*) FILTER (WHERE tipo_entidad_visitante = 'privada'), count(*) FILTER (WHERE tipo_entidad_visitante = 'publica'),
         count(*) FILTER (WHERE tipo_entidad_visitante = 'persona_natural'), count(DISTINCT numero_documento),
         count(*) FILTER (WHERE decisor), count(*) FILTER (WHERE fuera), count(*) FILTER (WHERE duracion_min >= 240),
         array_agg(DISTINCT fuente)
    FROM _ve GROUP BY 1;
  GET DIAGNOSTICS n = ROW_COUNT;

  DELETE FROM entidad_visita_org;
  INSERT INTO entidad_visita_org
  SELECT x.entidad_ruc, x.org, max(x.tipo_entidad_visitante), count(*), count(DISTINCT x.numero_documento), min(x.fecha_visita),
         max(x.fecha_visita), count(*) FILTER (WHERE x.decisor), mode() WITHIN GROUP (ORDER BY ev.ruc)
    FROM (SELECT _ve.*, upper(btrim(entidad_visitante)) AS org FROM _ve
           WHERE entidad_visitante IS NOT NULL AND btrim(entidad_visitante) <> '' AND tipo_entidad_visitante <> 'persona_natural') x
    LEFT JOIN empresa_visita ev ON ev.visita_id = x.id AND ev.ruc ~ '^20\d{9}$'
   GROUP BY 1, 2;

  DELETE FROM entidad_visita_area;
  INSERT INTO entidad_visita_area
  SELECT entidad_ruc, COALESCE(NULLIF(btrim(funcionario_area), ''), 'Sin área en el registro'), COALESCE(btrim(funcionario_cargo), ''),
         count(*), count(*) FILTER (WHERE tipo_entidad_visitante = 'privada'), bool_or(COALESCE(decisor, false))
    FROM _ve GROUP BY 1, 2, 3;

  ANALYZE entidad_visita_resumen;
  ANALYZE entidad_visita_org;
  ANALYZE entidad_visita_area;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_visitas_entidad() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_visitas_entidad() FROM PUBLIC;
