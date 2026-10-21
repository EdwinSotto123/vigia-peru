-- 95 · Plazas CAS: los años de experiencia que pide cada plaza, en los formatos que de verdad usa SERVIR.
--
-- La 93 sólo leía "EXPERIENCIA GENERAL: 8.00 AÑO(S)": 1 091 de 3 875 plazas (2026-10-21). Las entidades escriben,
-- además: "EXPERIENCIA LABORAL MÍNIMA DE UN (01) AÑO", "EXPERIENCIA LABORAL GENERAL MINIMA TRES (03) AÑOS",
-- "EXPERIENCIA GENERAL DE DOS (02) AÑOS", "EXPERIENCIA LABORAL MINIMA DE (03) AÑOS", "SEIS (6) MESES", "3 AÑOS" o sólo
-- "2". Se toma el primer número de años o meses que sigue a "EXPERIENCIA" (la general va antes que la específica; si
-- sólo dice la específica, también es un mínimo). refrescar_plazas() recalcula exp_general de todas en cada carga.
--
-- Y `pide_poco` pasa a exigir que la plaza no pida título ni grado: la 93 marcaba a médicos titulados con poca experiencia.
-- `sueldo_alto` se deja de calcular: el tipo de servicio es demasiado amplio para comparar sueldos de plazas (un médico
-- especialista contra toda plaza de salud): 203 marcas, casi todas falsas. Vuelve cuando haya planilla para comparar
-- cargo por cargo.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/95_plazas_experiencia.sql
-- y SELECT refrescar_plazas();

CREATE OR REPLACE FUNCTION anios_experiencia(t text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  u text := upper(COALESCE(t, ''));
  m text[];
  n numeric;
BEGIN
  IF u = '' THEN RETURN NULL; END IF;
  IF u ~ '(NO REQUIERE|SIN EXPERIENCIA|NO SE REQUIERE)' THEN RETURN 0; END IF;
  -- La general, si la nombra; si no, la primera que aparezca.
  m := regexp_match(u, 'EXPERIENCIA(\s+LABORAL)?\s+GENERAL[^.;]{0,70}?\(?(\d+([.,]\d+)?)\)?\s*(A.OS?|A.O\(S\)|MES)');
  IF m IS NOT NULL THEN m := ARRAY[m[2], m[4]]; END IF;
  IF m IS NULL THEN
    m := regexp_match(u, 'EXPERIENCIA[^.;]{0,70}?\(?(\d+([.,]\d+)?)\)?\s*(A.OS?|A.O\(S\)|MES)');
    IF m IS NOT NULL THEN m := ARRAY[m[1], m[3]]; END IF;
  END IF;
  IF m IS NULL THEN
    m := regexp_match(u, '^\s*\(?(\d+([.,]\d+)?)\)?\s*(A.OS?|A.O\(S\)|MES)');
    IF m IS NOT NULL THEN m := ARRAY[m[1], m[3]]; END IF;
  END IF;
  IF m IS NULL AND u ~ '^\s*\d{1,2}\s*$' THEN m := ARRAY[trim(u), 'ANO']; END IF;
  IF m IS NULL THEN RETURN NULL; END IF;
  n := replace(m[1], ',', '.')::numeric;
  RETURN CASE WHEN m[2] LIKE 'MES%' THEN round(n / 12, 2) ELSE n END;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
ALTER FUNCTION anios_experiencia(text) OWNER TO vigia_jobs;

CREATE OR REPLACE FUNCTION refrescar_plazas() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  -- La entidad por su nombre (el de CONOSCE o el del directorio de entidades).
  UPDATE servir_convocatoria s SET entidad_ruc = e.ruc
    FROM (SELECT DISTINCT ON (mef_norm(nombre)) mef_norm(nombre) AS n, ruc FROM (
            SELECT nombre, ruc FROM entidades UNION ALL SELECT entidad, entidad_ruc FROM persona_entidad) x
          WHERE nombre IS NOT NULL ORDER BY mef_norm(nombre), ruc) e
   WHERE s.entidad_ruc IS NULL AND e.n = mef_norm(s.entidad);
  -- Si no hay una igual: la única entidad cuyo nombre empieza con el de SERVIR ("MINISTERIO PUBLICO" →
  -- "MINISTERIO PUBLICO GERENCIA GENERAL").
  UPDATE servir_convocatoria s SET entidad_ruc = c.ruc
    FROM (SELECT s2.entidad, min(x.ruc) AS ruc
            FROM (SELECT DISTINCT entidad FROM servir_convocatoria WHERE entidad_ruc IS NULL) s2
            JOIN (SELECT DISTINCT ruc, mef_norm(nombre) AS n FROM entidades WHERE nombre IS NOT NULL) x
              ON x.n LIKE mef_norm(s2.entidad) || ' %' AND length(mef_norm(s2.entidad)) >= 12
           GROUP BY s2.entidad HAVING count(DISTINCT x.ruc) = 1) c
   WHERE s.entidad_ruc IS NULL AND s.entidad = c.entidad;
  -- El tipo de servicio, del título sin "CONTRATACIÓN ADMINISTRATIVA DE SERVICIOS DE UN(A)" (todas lo llevan). Se
  -- rehace siempre: son unos miles y el clasificador cambia.
  UPDATE servir_convocatoria
     SET servicio = servicio_persona(regexp_replace(titulo, '^\s*CONTRATACI.N ADMINISTRATIVA DE SERVICIOS( DE)?( UN\(A\)| UNA?)?\s*', '', 'i')),
         exp_general = anios_experiencia(experiencia);

  CREATE TEMP TABLE _ss (aviso int, tipo text, severidad text, detalle jsonb) ON COMMIT DROP;

  -- pide_experiencia_propia: los requisitos nombran a la propia entidad (o "en la entidad").
  INSERT INTO _ss
  SELECT s.aviso, 'pide_experiencia_propia', 'media', jsonb_build_object('texto', left(s.experiencia, 400))
    FROM servir_convocatoria s
   WHERE (length(mef_norm(s.entidad)) >= 12 AND position(mef_norm(s.entidad) IN mef_norm(COALESCE(s.experiencia, '') || ' ' || COALESCE(s.conocimiento, ''))) > 0)
      OR mef_norm(s.experiencia) ~ 'EXPERIENCIA (LABORAL )?EN LA (ENTIDAD|MISMA ENTIDAD|INSTITUCION CONVOCANTE)';

  -- pide_poco: S/ 6,000 o más sin pedir ningún título ni grado (secundaria, estudiante, técnico) o, sin título, con menos
  -- de un año de experiencia. Un médico titulado con seis meses no es eso (migración 95: la 93 los marcaba).
  INSERT INTO _ss
  SELECT s.aviso, 'pide_poco', 'media',
         jsonb_build_object('remuneracion', s.remuneracion, 'exp_general', s.exp_general, 'formacion', left(s.formacion, 300))
    FROM servir_convocatoria s
   WHERE s.remuneracion >= 6000
     AND mef_norm(s.formacion) !~ '\m(BACHILLER|TITULO|TITULAD|LICENCIAD|MAESTR|DOCTOR|MEDIC|CIRUJAN|ABOGAD|INGENIER|PROFESIONAL|UNIVERSITARI)'
     AND ((s.exp_general IS NOT NULL AND s.exp_general < 1)
       OR mef_norm(s.formacion) ~ '\m(SECUNDARIA|ESTUDIANTE|ESTUDIOS (TECNICOS|SUPERIORES) (EN CURSO|INCOMPLETOS)|EGRESADO TECNICO)');

  -- plazo_corto: publicada 3 días o menos.
  INSERT INTO _ss
  SELECT s.aviso, 'plazo_corto', 'media', jsonb_build_object('dias', s.fecha_fin - s.fecha_inicio + 1, 'desde', s.fecha_inicio, 'hasta', s.fecha_fin)
    FROM servir_convocatoria s
   WHERE s.fecha_inicio IS NOT NULL AND s.fecha_fin IS NOT NULL AND s.fecha_fin - s.fecha_inicio + 1 <= 3;

  -- ya_hay_locadores: en los 12 meses antes de publicar la plaza, la entidad pagó por órdenes ese tipo de servicio a una,
  -- dos o tres personas (con más, es un servicio común de la entidad y no dice nada de esta plaza).
  INSERT INTO _ss
  SELECT s.aviso, 'ya_hay_locadores', 'baja', jsonb_build_object('personas', count(DISTINCT a.ruc), 'servicio', s.servicio)
    FROM servir_convocatoria s
    JOIN persona_orden_anual a ON a.entidad_ruc = s.entidad_ruc AND a.servicio = s.servicio
                              AND a.ultima >= s.fecha_inicio - 365 AND a.primera <= s.fecha_inicio
   WHERE s.entidad_ruc IS NOT NULL AND servicio_es_personal(s.servicio) AND s.servicio <> 'Otros servicios personales'
   GROUP BY s.aviso, s.servicio
  HAVING count(DISTINCT a.ruc) BETWEEN 1 AND 3;

  UPDATE servir_convocatoria SET tipos = '{}', senales = '[]', n_senales = 0, sev = 0 WHERE n_senales > 0 OR sev > 0;
  UPDATE servir_convocatoria s SET tipos = x.tipos, senales = x.senales, n_senales = x.n, sev = x.sev
    FROM (
      SELECT aviso, array_agg(tipo ORDER BY tipo) AS tipos, count(*)::int AS n,
             max(CASE severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END)::smallint AS sev,
             jsonb_agg(jsonb_build_object('tipo', tipo, 'severidad', severidad, 'detalle', detalle)
                       ORDER BY CASE severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, tipo) AS senales
        FROM _ss GROUP BY aviso
    ) x
   WHERE x.aviso = s.aviso;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_plazas() OWNER TO vigia_jobs;
