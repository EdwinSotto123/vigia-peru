-- 183 · Plazas CAS, fase 1D del plan del 2026-10-27:
--   · gestion_saliente (plaza, media o baja): la plaza la convocó un gobierno regional o municipal (o uno de sus
--     organismos, entidad_gobierno_amplia) DESPUÉS de las elecciones regionales y municipales (el primer domingo de octubre
--     del último año de su gestión: el 4 de octubre de 2026) y antes de entregar el cargo (el 31 de diciembre). Quien entra
--     ahora sigue con la gestión nueva. Medido el 2026-10-27: 540 plazas (971 vacantes, ~S/ 2,35 M al mes) de 68
--     entidades. Media si además pide experiencia en la propia entidad o ya hay locadores de ese servicio (la plaza puede
--     ser para alguien de adentro); baja si no.
--   Lo que se pensó y NO va: «plaza que se repite» (las plazas cargadas son de octubre de 2026: SERVIR sólo muestra las
--   vigentes; los títulos repetidos son convocatorias de varias vacantes) y «a la medida de un locador» (quién la ganó se
--   vería en la planilla de los meses siguientes, que aún no está cargada). Cuando haya historia, se agregan.
--
-- refrescar_plazas_extra(): después de refrescar_plazas() (que rehace todas las señales de las plazas), al final de
-- backend/scripts/cargar_servir_convocatorias.py. Agrega su tipo y recalcula tipos, n_senales y sev de cada plaza.
--
-- Cómo aplicarla: python infrastructure/dev/dev.py migrar backend/db/migrations/183_plazas_gestion_saliente.sql (DEV) y
-- SELECT refrescar_plazas_extra(); en producción, lo mismo con tunel_rds.

CREATE OR REPLACE FUNCTION refrescar_plazas_extra() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_plazas_extra'));
  CREATE TEMP TABLE _gs ON COMMIT DROP AS
    SELECT s.aviso,
           CASE WHEN s.tipos && ARRAY['pide_experiencia_propia', 'ya_hay_locadores'] THEN 'media' ELSE 'baja' END AS severidad,
           jsonb_build_object('nivel', g.nivel, 'partido', g.org_nombre, 'gestion', g.quien,
                              'eleccion', to_char(x.eleccion, 'YYYY-MM-DD'), 'entrega', to_char(gp.hasta, 'YYYY-MM-DD'),
                              'publicada', to_char(s.fecha_inicio, 'YYYY-MM-DD')) AS detalle
      FROM servir_convocatoria s
      JOIN entidad_gestion g ON g.ruc = s.entidad_ruc AND g.nivel IN ('distrital', 'provincial', 'regional')
      JOIN entidad_gobierno_amplia a ON a.ruc = s.entidad_ruc
      JOIN gobierno_periodo gp ON gp.nivel = a.nivel AND gp.ubigeo = a.ubigeo AND gp.desde = g.desde
      -- El primer domingo de octubre del último año de la gestión: el día de las elecciones regionales y municipales.
      CROSS JOIN LATERAL (SELECT make_date(extract(year FROM gp.hasta)::int, 10, 1)
                                 + ((7 - extract(dow FROM make_date(extract(year FROM gp.hasta)::int, 10, 1))::int) % 7) AS eleccion) x
     WHERE s.fecha_inicio > x.eleccion AND s.fecha_inicio <= gp.hasta;

  -- Se quita el tipo de una corrida anterior y se agrega el de ahora; tipos, cuenta y severidad desde la lista.
  UPDATE servir_convocatoria s
     SET senales = y.senales, tipos = y.tipos, n_senales = y.n, sev = y.sev
    FROM (
      SELECT t.aviso,
             COALESCE(jsonb_agg(e.v ORDER BY CASE e.v->>'severidad' WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, e.v->>'tipo')
                        FILTER (WHERE e.v IS NOT NULL), '[]'::jsonb) AS senales,
             COALESCE(array_agg(DISTINCT e.v->>'tipo') FILTER (WHERE e.v IS NOT NULL), '{}') AS tipos,
             count(e.v)::int AS n,
             COALESCE(max(CASE e.v->>'severidad' WHEN 'alta' THEN 3 WHEN 'media' THEN 2 WHEN 'baja' THEN 1 END), 0)::smallint AS sev
        FROM (SELECT aviso FROM servir_convocatoria WHERE 'gestion_saliente' = ANY (tipos) UNION SELECT aviso FROM _gs) t
        JOIN servir_convocatoria sc ON sc.aviso = t.aviso
        LEFT JOIN LATERAL (
          SELECT v FROM jsonb_array_elements(sc.senales) v WHERE v->>'tipo' <> 'gestion_saliente'
          UNION ALL
          SELECT jsonb_build_object('tipo', 'gestion_saliente', 'severidad', g.severidad, 'detalle', g.detalle) FROM _gs g WHERE g.aviso = t.aviso
        ) e ON true
       GROUP BY t.aviso) y
   WHERE s.aviso = y.aviso;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_plazas_extra() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_plazas_extra() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refrescar_plazas_extra() TO vigia_jobs;
