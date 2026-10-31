-- 222 · Los agregados de la pestaña Visitas, sólo de las entidades que cambiaron.
--
-- refrescar_visitas_entidad() (200) rehace los agregados de las ~450 entidades sobre las 10,8 M visitas: 24-30 min en
-- PROD. Las cargas semanales del Worker (congreso_visitas, jueves; pnda_visitas, días 1 y 15) la llamaban al final y
-- Hyperdrive la cortaba («Timed out while waiting for a message from the origin database»): congreso_visitas no terminó
-- nunca (2026-10-29, 1,556 s). Esta versión recibe los RUC que cambiaron y rehace sólo sus filas: la misma cuenta, filtrada.
-- La de sin argumentos sigue para rehacer todo a mano.

CREATE OR REPLACE FUNCTION refrescar_visitas_entidad(p_rucs text[]) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_visitas_entidad'));
  SET LOCAL work_mem = '256MB';

  CREATE TEMP TABLE _ve ON COMMIT DROP AS
    SELECT r.ruc AS entidad_ruc, v.id, v.fecha_visita, v.tipo_entidad_visitante, v.numero_documento,
           COALESCE(v.decisor, visita_decisor(v.funcionario_cargo, v.funcionario_area)) AS decisor, v.duracion_min,
           v.fuente, v.funcionario_area, v.funcionario_cargo, v.entidad_visitante,
           (v.hora_ingreso < TIME '07:00' OR v.hora_ingreso >= TIME '19:00' OR extract(isodow FROM v.fecha_visita) IN (6, 7)) AS fuera
      FROM visita_entidad_ruc r JOIN visitas_entidades v ON v.entidad_visitada = r.entidad_visitada
     WHERE r.ruc = ANY (p_rucs);

  DELETE FROM entidad_visita_resumen WHERE entidad_ruc = ANY (p_rucs);
  INSERT INTO entidad_visita_resumen
  SELECT entidad_ruc, count(*), min(fecha_visita), max(fecha_visita),
         count(*) FILTER (WHERE tipo_entidad_visitante = 'privada'), count(*) FILTER (WHERE tipo_entidad_visitante = 'publica'),
         count(*) FILTER (WHERE tipo_entidad_visitante = 'persona_natural'), count(DISTINCT numero_documento),
         count(*) FILTER (WHERE decisor), count(*) FILTER (WHERE fuera), count(*) FILTER (WHERE duracion_min >= 240),
         array_agg(DISTINCT fuente)
    FROM _ve GROUP BY 1;
  GET DIAGNOSTICS n = ROW_COUNT;

  DELETE FROM entidad_visita_org WHERE entidad_ruc = ANY (p_rucs);
  INSERT INTO entidad_visita_org
  SELECT x.entidad_ruc, x.org, max(x.tipo_entidad_visitante), count(*), count(DISTINCT x.numero_documento), min(x.fecha_visita),
         max(x.fecha_visita), count(*) FILTER (WHERE x.decisor), mode() WITHIN GROUP (ORDER BY ev.ruc)
    FROM (SELECT _ve.*, upper(btrim(entidad_visitante)) AS org FROM _ve
           WHERE entidad_visitante IS NOT NULL AND btrim(entidad_visitante) <> '' AND tipo_entidad_visitante <> 'persona_natural') x
    LEFT JOIN empresa_visita ev ON ev.visita_id = x.id AND ev.ruc ~ '^20\d{9}$'
   GROUP BY 1, 2;

  DELETE FROM entidad_visita_area WHERE entidad_ruc = ANY (p_rucs);
  INSERT INTO entidad_visita_area
  SELECT entidad_ruc, COALESCE(NULLIF(btrim(funcionario_area), ''), 'Sin área en el registro'), COALESCE(btrim(funcionario_cargo), ''),
         count(*), count(*) FILTER (WHERE tipo_entidad_visitante = 'privada'), bool_or(COALESCE(decisor, false))
    FROM _ve GROUP BY 1, 2, 3;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_visitas_entidad(text[]) OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_visitas_entidad(text[]) FROM PUBLIC;
