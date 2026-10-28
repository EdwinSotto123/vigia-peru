-- 196 · Visitó la entidad antes de entrar a la planilla (fase 2.2 del plan del 2026-10-27: «visita antes de la plaza o la
-- orden», la parte de la planilla; la de los locadores es la 195).
--
-- refrescar_planilla_extra es la de la 182 con un paso más (C2) y su tipo en las dos listas del paso D, que quitan lo de
-- una corrida anterior. La corren pte_personal (tras refrescar_planilla), el orquestador de la DJI y las cargas de visitas.
-- En DEV, con 0,7 M de visitas nacionales: 622 de 101,567 personas que entraron desde 2021 (147 visitaron a quien decide).
-- Es por nombre, no por DNI (la planilla no lo trae): la ficha lo dice, como en «También en planilla».
--
-- Cómo aplicarla: después de la 182 (redefine su función); luego SELECT refrescar_planilla_extra();

CREATE OR REPLACE FUNCTION refrescar_planilla_extra() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n_pla int := 0; t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_planilla_extra'));
  SET LOCAL work_mem = '512MB';

  CREATE TEMP TABLE _pxs (entidad_ruc text, nombre_norm text, tipo text, severidad text, detalle jsonb) ON COMMIT DROP;

  -- Cuántas personas de las planillas llevan los mismos dos apellidos (la planilla escribe «PATERNO MATERNO NOMBRES»).
  CREATE TEMP TABLE _pap ON COMMIT DROP AS
    SELECT split_part(nombre_norm, ' ', 1) || ' ' || split_part(nombre_norm, ' ', 2) AS par, count(DISTINCT nombre_norm)::int AS f
      FROM planilla_persona GROUP BY 1;
  CREATE INDEX ON _pap (par);

  -- A. El pariente declarado en la DJI que está en la planilla de la misma entidad.
  CREATE TEMP TABLE _pv ON COMMIT DROP AS
    SELECT DISTINCT v.entidad_ruc, v.declarante_norm, v.parentesco, v.grado, v.codigo_ddjj,
           array_to_string(v.w[array_length(v.w, 1) - 1:array_length(v.w, 1)] || v.w[1:array_length(v.w, 1) - 2], ' ') AS pariente_pl
      FROM (SELECT d.*, regexp_split_to_array(d.pariente_norm, ' ') AS w FROM dji_vinculos d
             WHERE d.pariente_norm ~ '^\S+ \S+ \S+' AND d.pariente_norm ~ '^[A-ZÑ ]+$' AND d.declarante_norm IS NOT NULL) v;
  CREATE TEMP TABLE _pvp ON COMMIT DROP AS
    SELECT v.entidad_ruc, v.declarante_norm, v.parentesco, v.grado, v.pariente_pl,
           p.cargo AS cargo_pariente, d.ficha AS ficha_declarante,
           (SELECT fc.cargo FROM dji_funcionarios fc WHERE fc.codigo_ddjj = v.codigo_ddjj AND fc.cargo IS NOT NULL
             ORDER BY fc.fecha_inicio_cargo DESC NULLS LAST LIMIT 1) AS cargo_declarante,
           -- El primer apellido del funcionario sólo si no puede destapar el materno del pariente (apellidoFuncionario).
           upper(immutable_unaccent(COALESCE(v.parentesco, ''))) ~ '^(CONYUGE|CONVIVIENTE|PADRE|MADRE|HERMANO\(A\) DEL|TIO|CUNADO|HIJASTRO|ABUELO|SUEGRO|YERNO|NUERA)' AS seguro,
           CASE WHEN v.pariente_pl ~ '^\S+ \S+ \S+ \S+' OR COALESCE(ap.f, 0) <= 10 THEN 'alta' ELSE 'media' END AS severidad
      FROM _pv v
      JOIN planilla_persona p ON p.entidad_ruc = v.entidad_ruc AND p.nombre_norm = v.pariente_pl
      LEFT JOIN planilla_persona d ON d.entidad_ruc = v.entidad_ruc AND d.nombre_norm = v.declarante_norm
      LEFT JOIN _pap ap ON ap.par = split_part(v.pariente_pl, ' ', 1) || ' ' || split_part(v.pariente_pl, ' ', 2)
     WHERE v.pariente_pl <> v.declarante_norm
       -- Fuera los nombres de tres palabras con apellidos muy comunes: en una entidad grande puede ser otra persona.
       AND (v.pariente_pl ~ '^\S+ \S+ \S+ \S+' OR COALESCE(ap.f, 0) <= 30);
  INSERT INTO _pxs
  SELECT x.entidad_ruc, x.pariente_pl, 'pariente_planilla',
         CASE WHEN bool_or(x.severidad = 'alta') THEN 'alta' ELSE 'media' END,
         jsonb_build_object('funcionarios', jsonb_agg(jsonb_build_object(
           'cargo', x.cargo_declarante, 'parentesco', x.parentesco, 'grado', x.grado,
           'apellido', CASE WHEN x.seguro THEN split_part(x.declarante_norm, ' ', 1) END,
           'ficha', CASE WHEN x.seguro THEN x.ficha_declarante END)))
    FROM _pvp x GROUP BY x.entidad_ruc, x.pariente_pl;
  INSERT INTO _pxs
  SELECT x.entidad_ruc, x.declarante_norm, 'familiar_en_planilla',
         CASE WHEN bool_or(x.severidad = 'alta') THEN 'alta' ELSE 'media' END,
         jsonb_build_object('parientes', jsonb_agg(jsonb_build_object('parentesco', x.parentesco, 'grado', x.grado, 'cargo', x.cargo_pariente)))
    FROM _pvp x
   WHERE EXISTS (SELECT 1 FROM planilla_persona d WHERE d.entidad_ruc = x.entidad_ruc AND d.nombre_norm = x.declarante_norm)
   GROUP BY x.entidad_ruc, x.declarante_norm;
  RAISE NOTICE 'planilla extra: parientes en la planilla de su entidad (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- B. Lo que cobró cada persona cada mes (sueldo base, sin los meses con un posible error de carga), con su lugar en su
  --    historia: lo usan el ascenso exprés y la planilla de cada entidad mes a mes.
  CREATE TEMP TABLE _pm ON COMMIT DROP AS
    SELECT entidad_ruc, nombre_norm, m, base, cargo,
           row_number() OVER w AS i, lead(base) OVER w AS base_sig, lag(m) OVER w AS m_ant, lead(m) OVER w AS m_sig
      FROM (SELECT p.entidad_ruc, p.nombre_norm, make_date(p.anio, p.mes, 1) AS m,
                   sum(COALESCE(p.remuneraciones, 0) + COALESCE(p.honorarios, 0)) AS base,
                   max(mef_norm(p.cargo)) AS cargo
              FROM planilla_pte p
             WHERE motivo_planilla_dudosa(p.remuneraciones, p.honorarios, p.incentivo, p.gratificacion, p.otros, p.total) IS NULL
             GROUP BY 1, 2, 3
            HAVING sum(COALESCE(p.remuneraciones, 0) + COALESCE(p.honorarios, 0)) > 0) x
    WINDOW w AS (PARTITION BY entidad_ruc, nombre_norm ORDER BY m);
  CREATE INDEX ON _pm (entidad_ruc, nombre_norm, m);
  ANALYZE _pm;
  RAISE NOTICE 'planilla extra: meses por persona (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- C. ascenso_expres: de un cargo que no es jefatura a una jefatura, con un sueldo que sube y se sostiene.
  INSERT INTO _pxs
  SELECT DISTINCT ON (a.entidad_ruc, a.nombre_norm) a.entidad_ruc, a.nombre_norm, 'ascenso_expres',
         CASE WHEN b.base >= 2 * a.base AND b.m <= a.m + interval '6 months' THEN 'media' ELSE 'baja' END,
         jsonb_build_object('antes', jsonb_build_object('mes', to_char(a.m, 'YYYY-MM'), 'cargo', a.cargo, 'base', a.base),
                            'despues', jsonb_build_object('mes', to_char(b.m, 'YYYY-MM'), 'cargo', b.cargo, 'base', b.base),
                            'veces', round(b.base / a.base, 2),
                            'meses', ((extract(year FROM b.m)::int - extract(year FROM a.m)::int) * 12
                                      + extract(month FROM b.m)::int - extract(month FROM a.m)::int))
    FROM _pm a
    JOIN _pm b ON b.entidad_ruc = a.entidad_ruc AND b.nombre_norm = a.nombre_norm AND b.m > a.m AND b.m <= a.m + interval '12 months'
   WHERE a.i >= 2
     AND a.cargo !~ '\m(JEFE|JEFA|DIRECTOR|DIRECTORA|GERENTE|SUBGERENTE|SUB GERENTE|COORDINADOR|COORDINADORA|ADMINISTRADOR|ADMINISTRADORA|SECRETARIO GENERAL|SECRETARIA GENERAL|SUBDIRECTOR|SUBDIRECTORA|PROCURADOR|PROCURADORA)\M'
     AND b.cargo ~ '\m(JEFE|JEFA|DIRECTOR|DIRECTORA|GERENTE|SUBGERENTE|SUB GERENTE|COORDINADOR|COORDINADORA|ADMINISTRADOR|ADMINISTRADORA|SECRETARIO GENERAL|SECRETARIA GENERAL|SUBDIRECTOR|SUBDIRECTORA|PROCURADOR|PROCURADORA)\M'
     AND b.base >= 1.5 * a.base AND b.base - a.base >= 2000
     AND (b.base_sig IS NULL OR b.base_sig >= 1.5 * a.base)
   ORDER BY a.entidad_ruc, a.nombre_norm, (b.base / a.base) DESC;
  RAISE NOTICE 'planilla extra: ascenso exprés (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- C2. visita_antes_planilla (migración 196): visitó la entidad en los 180 días antes de su primer mes en la planilla. Por
  --     el nombre completo (la planilla no trae DNI: «PATERNO MATERNO NOMBRES», o con los nombres primero), de tres
  --     palabras o más, en la misma entidad (visita_entidad_ruc). Sólo quien entra desde 2021 (las visitas empiezan a
  --     mediados de 2020) y no en los dos primeros meses que la entidad tiene cargados: ahí «entrar» es sólo el inicio
  --     de la carga. Media si visitó a quien decide (titular, gerencia, administración, logística, un comité); baja si no.
  --     De quien recibió, sólo cargo y área.
  CREATE TEMP TABLE _pvi ON COMMIT DROP AS SELECT entidad_ruc, min(primer_mes) AS ini FROM planilla_persona GROUP BY 1;
  CREATE TEMP TABLE _pvn ON COMMIT DROP AS
    SELECT p.entidad_ruc, p.nombre_norm, p.primer_mes,
           mef_norm(p.nombres || ' ' || p.paterno || ' ' || COALESCE(p.materno, '')) AS n2
      FROM planilla_persona p JOIN _pvi i ON i.entidad_ruc = p.entidad_ruc
     WHERE p.paterno IS NOT NULL AND p.nombres IS NOT NULL AND p.primer_mes >= DATE '2021-01-01'
       AND p.primer_mes > i.ini + interval '2 months'
       AND array_length(string_to_array(p.nombre_norm, ' '), 1) >= 3;
  CREATE INDEX ON _pvn (nombre_norm);
  ANALYZE _pvn;
  INSERT INTO _pxs
  SELECT x.entidad_ruc, x.nombre_norm, 'visita_antes_planilla',
         CASE WHEN bool_or(x.decide) THEN 'media' ELSE 'baja' END,
         jsonb_build_object(
           'primer_mes', to_char(x.primer_mes, 'YYYY-MM'),
           'n_visitas', count(*),
           'a_quien_decide', count(*) FILTER (WHERE x.decide),
           'visitas', jsonb_agg(jsonb_build_object(
                        'fecha', x.fecha_visita, 'hora', to_char(x.hora_ingreso, 'HH24:MI'), 'dias_antes', x.primer_mes - x.fecha_visita,
                        'cargo_visitado', x.funcionario_cargo, 'area', x.funcionario_area, 'motivo', left(x.motivo, 200),
                        'decide', x.decide, 'fuente_visita', x.fuente)
                      ORDER BY x.fecha_visita DESC, x.hora_ingreso DESC) FILTER (WHERE x.k <= 30))
    FROM (SELECT y.*, row_number() OVER (PARTITION BY y.entidad_ruc, y.nombre_norm ORDER BY y.fecha_visita DESC, y.hora_ingreso DESC) AS k
            FROM (SELECT DISTINCT ON (p.entidad_ruc, p.nombre_norm, v.fecha_visita, COALESCE(v.hora_ingreso, '00:00'))
                         p.entidad_ruc, p.nombre_norm, p.primer_mes, v.fecha_visita, v.hora_ingreso, v.funcionario_cargo,
                         v.funcionario_area, v.motivo, v.fuente,
                         COALESCE(v.decisor, visita_decisor(v.funcionario_cargo, v.funcionario_area), false) AS decide
                    FROM _pvn p
                    JOIN visitas_entidades v ON v.visitante_norm IN (p.nombre_norm, p.n2)
                    JOIN visita_entidad_ruc m ON m.entidad_visitada = v.entidad_visitada AND m.ruc = p.entidad_ruc
                   WHERE v.fecha_visita >= p.primer_mes - 180 AND v.fecha_visita < p.primer_mes
                   ORDER BY p.entidad_ruc, p.nombre_norm, v.fecha_visita, COALESCE(v.hora_ingreso, '00:00'),
                            COALESCE(v.decisor, false) DESC) y) x
   GROUP BY x.entidad_ruc, x.nombre_norm, x.primer_mes;
  RAISE NOTICE 'planilla extra: visitó antes de entrar (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- D. Las filas de la planilla tocadas: se quitan estos tipos (de una corrida anterior) y se agregan los nuevos.
  CREATE TEMP TABLE _pxtoc ON COMMIT DROP AS
    SELECT entidad_ruc, nombre_norm FROM planilla_persona
     WHERE tipos && ARRAY['pariente_planilla', 'familiar_en_planilla', 'ascenso_expres', 'visita_antes_planilla']
    UNION SELECT entidad_ruc, nombre_norm FROM _pxs;
  UPDATE planilla_persona p
     SET senales = x.senales, tipos = x.tipos, n_senales = x.n, sev = x.sev
    FROM (
      SELECT t.entidad_ruc, t.nombre_norm,
             COALESCE(jsonb_agg(e.s ORDER BY CASE e.s->>'severidad' WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, e.s->>'tipo')
                        FILTER (WHERE e.s IS NOT NULL), '[]'::jsonb) AS senales,
             COALESCE(array_agg(DISTINCT e.s->>'tipo') FILTER (WHERE e.s IS NOT NULL), '{}') AS tipos,
             count(e.s)::int AS n,
             COALESCE(max(CASE e.s->>'severidad' WHEN 'alta' THEN 3 WHEN 'media' THEN 2 WHEN 'baja' THEN 1 END), 0)::smallint AS sev
        FROM _pxtoc t
        JOIN planilla_persona pp ON pp.entidad_ruc = t.entidad_ruc AND pp.nombre_norm = t.nombre_norm
        LEFT JOIN LATERAL (
          SELECT s FROM jsonb_array_elements(pp.senales) s WHERE s->>'tipo' NOT IN ('pariente_planilla', 'familiar_en_planilla', 'ascenso_expres', 'visita_antes_planilla')
          UNION ALL
          SELECT jsonb_build_object('tipo', n.tipo, 'severidad', n.severidad, 'detalle', n.detalle)
            FROM _pxs n WHERE n.entidad_ruc = t.entidad_ruc AND n.nombre_norm = t.nombre_norm
        ) e ON true
       GROUP BY t.entidad_ruc, t.nombre_norm) x
   WHERE p.entidad_ruc = x.entidad_ruc AND p.nombre_norm = x.nombre_norm;
  GET DIAGNOSTICS n_pla = ROW_COUNT;

  -- E. La planilla de cada entidad mes a mes: personas, sueldo base, y quiénes entraron y salieron frente al mes anterior
  --    que publicó completo. Incompleto: menos de la mitad de las personas que el menor de sus dos vecinos (o el único que
  --    tiene); una caída que se sostiene no lo es (el mes siguiente también es bajo).
  CREATE TEMP TABLE _pe ON COMMIT DROP AS
    SELECT entidad_ruc, m, count(*)::int AS personas, sum(base) AS base FROM _pm GROUP BY 1, 2;
  CREATE TEMP TABLE _pec ON COMMIT DROP AS
    SELECT x.entidad_ruc, x.m, x.personas, x.base,
           x.personas < 0.5 * LEAST(COALESCE(x.ant, x.sig), COALESCE(x.sig, x.ant)) AS incompleto
      FROM (SELECT e.*, lag(e.personas) OVER w AS ant, lead(e.personas) OVER w AS sig
              FROM _pe e WINDOW w AS (PARTITION BY e.entidad_ruc ORDER BY e.m)) x;
  UPDATE _pec SET incompleto = false WHERE incompleto IS NULL;
  -- Cada persona en los meses completos, con su mes completo anterior y siguiente en que figura.
  CREATE TEMP TABLE _pmc ON COMMIT DROP AS
    SELECT p.entidad_ruc, p.nombre_norm, p.m, lag(p.m) OVER w AS m_ant, lead(p.m) OVER w AS m_sig
      FROM _pm p JOIN _pec c ON c.entidad_ruc = p.entidad_ruc AND c.m = p.m AND NOT c.incompleto
    WINDOW w AS (PARTITION BY p.entidad_ruc, p.nombre_norm ORDER BY p.m);
  -- Los dos meses completos anteriores y los dos siguientes de cada mes: entra quien no estaba en ninguno de los dos
  -- anteriores, y sale quien no vuelve en ninguno de los dos siguientes. Así, una planilla publicada con un 25 % menos un
  -- mes (abril de 2025 en SENAMHI: 820 de 1,090) no cuenta como 277 salidas y 273 entradas.
  CREATE TEMP TABLE _pem ON COMMIT DROP AS
    SELECT entidad_ruc, m, lag(m) OVER e AS m_prev, lag(m, 2) OVER e AS m_prev2, lead(m) OVER e AS m_next, lead(m, 2) OVER e AS m_next2
      FROM _pec WHERE NOT incompleto
    WINDOW e AS (PARTITION BY entidad_ruc ORDER BY m);
  DELETE FROM planilla_entidad_mes;
  INSERT INTO planilla_entidad_mes (entidad_ruc, mes, personas, base, altas, bajas, incompleto)
  SELECT c.entidad_ruc, c.m, c.personas, c.base,
         CASE WHEN em.m_prev IS NOT NULL THEN COALESCE(a.altas, 0) END,
         CASE WHEN em.m_prev IS NOT NULL THEN COALESCE(b.bajas, 0) END,
         c.incompleto
    FROM _pec c
    LEFT JOIN _pem em ON em.entidad_ruc = c.entidad_ruc AND em.m = c.m
    LEFT JOIN (SELECT p.entidad_ruc, p.m,
                      count(*) FILTER (WHERE p.m_ant IS DISTINCT FROM e.m_prev AND p.m_ant IS DISTINCT FROM e.m_prev2)::int AS altas
                 FROM _pmc p JOIN _pem e ON e.entidad_ruc = p.entidad_ruc AND e.m = p.m
                GROUP BY 1, 2) a ON a.entidad_ruc = c.entidad_ruc AND a.m = c.m
    LEFT JOIN (SELECT p.entidad_ruc, e.m_next AS m, count(*)::int AS bajas
                 FROM _pmc p JOIN _pem e ON e.entidad_ruc = p.entidad_ruc AND e.m = p.m
                WHERE e.m_next IS NOT NULL AND p.m_sig IS DISTINCT FROM e.m_next AND p.m_sig IS DISTINCT FROM e.m_next2
                GROUP BY 1, 2) b ON b.entidad_ruc = c.entidad_ruc AND b.m = c.m;

  -- F. El resumen de cada alcance de la planilla (como al final de refrescar_planilla(), migración 108).
  CREATE TEMP TABLE _pxrb ON COMMIT DROP AS
  SELECT x.alcance, CASE WHEN p.dudoso IS NULL THEN p.total END AS total, p.n_senales, p.sev, p.tipos, p.regimen, p.ultimo_mes,
         p.dudoso IS NOT NULL AS es_dudoso
    FROM planilla_persona p
    CROSS JOIN LATERAL (SELECT 'pais' AS alcance UNION ALL SELECT 'dep:' || p.dep WHERE p.dep IS NOT NULL
                        UNION ALL SELECT 'ent:' || p.entidad_ruc) x;
  DELETE FROM planilla_resumen;
  INSERT INTO planilla_resumen (alcance, resumen)
  SELECT t.alcance, jsonb_build_object('personas', t.personas, 'totalMes', t.total, 'conSenales', t.con, 'alta', t.alta, 'media', t.media,
                                       'ultimoMes', t.ultimo, 'porSenal', COALESCE(ps.l, '[]'), 'porRegimen', COALESCE(pr.l, '[]'),
                                       'dudosos', t.dudosos)
    FROM (SELECT alcance, count(*)::int AS personas, COALESCE(sum(total), 0)::float AS total, count(*) FILTER (WHERE n_senales > 0)::int AS con,
                 count(*) FILTER (WHERE sev = 3)::int AS alta, count(*) FILTER (WHERE sev = 2)::int AS media,
                 to_char(max(ultimo_mes), 'YYYY-MM') AS ultimo, count(*) FILTER (WHERE es_dudoso)::int AS dudosos
            FROM _pxrb GROUP BY alcance) t
    LEFT JOIN (SELECT alcance, jsonb_agg(jsonb_build_object('tipo', tipo, 'n', c) ORDER BY c DESC) AS l
                 FROM (SELECT alcance, tipo, count(*)::int AS c FROM _pxrb, unnest(_pxrb.tipos) tipo GROUP BY 1, 2) z GROUP BY alcance) ps
           ON ps.alcance = t.alcance
    LEFT JOIN (SELECT alcance, jsonb_agg(jsonb_build_object('regimen', regimen, 'n', c) ORDER BY c DESC) AS l
                 FROM (SELECT alcance, regimen, count(*)::int AS c FROM _pxrb GROUP BY 1, 2) z GROUP BY alcance) pr
           ON pr.alcance = t.alcance;
  RAISE NOTICE 'planilla extra: % filas de planilla tocadas, resumen y meses al día (% s)', n_pla, round(extract(epoch FROM clock_timestamp() - t0));
  RETURN n_pla;
END $$;
ALTER FUNCTION refrescar_planilla_extra() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_planilla_extra() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refrescar_planilla_extra() TO vigia_jobs;
