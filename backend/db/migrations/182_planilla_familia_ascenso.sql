-- 182 · Planilla, fase 1C del plan del 2026-10-27 (medido en producción antes de escribirla):
--   · pariente_planilla (planilla, alta o media): un funcionario de la entidad declaró en su DJI a un pariente que está en
--     la planilla de esa misma entidad (la persona de la fila es el pariente). La DJI escribe al pariente «NOMBRES PATERNO
--     MATERNO» y la planilla «PATERNO MATERNO NOMBRES»: se cruzan pasando los dos últimos al frente (sin eso, 0 de 277 mil;
--     con eso, 1,128 en la planilla de su misma entidad). Por nombre completo (la planilla no trae DNI): alta con cuatro
--     palabras o más o apellidos poco comunes (10 personas o menos con los dos), media con hasta 30, y fuera con más.
--     La Ley 26771 prohíbe al funcionario con poder de nombrar o contratar hacerlo con sus parientes en su entidad.
--   · familiar_en_planilla (planilla, la misma severidad): el lado del funcionario (si está en la planilla): declaró a un
--     pariente que trabaja en su misma entidad. Del pariente sólo el parentesco y su cargo, nunca quién es.
--   · ascenso_expres (planilla, media o baja): pasó de un cargo que no es de jefatura a una jefatura (jefe, director,
--     gerente, coordinador, administrador…) en 12 meses o menos, con un sueldo base 1,5 veces mayor o más (y S/ 2,000 más
--     o más) que se sostiene el mes siguiente. Sin el primer mes de la persona (suele venir pagado por días) ni los meses
--     con un posible error de carga. 1,830 personas en 309 entidades; media (496) si el sueldo se duplicó en 6 meses o menos.
--   · planilla_entidad_mes: cuántas personas tuvo cada entidad en su planilla cada mes cargado, su sueldo base sumado, y
--     cuántas entraron y salieron frente al mes anterior que publicó (la evolución de la pestaña Planilla).
--   · dji_nepotismo: el cruce con las órdenes por el rango de la llave de persona_orden_anual ('10' || DNI || dígito), no
--     por substr(ruc, 3, 8) fila por fila (308 ms en una entidad chica, segundos en las grandes).
--
-- refrescar_planilla_extra(): paso aparte después de refrescar_socio_proveedor_locador() (181) en el Worker pte_personal
-- (y tras cada ronda de la DJI). Rehace sus tres tipos en planilla_persona y planilla_resumen, y planilla_entidad_mes.
-- Privacidad: del funcionario que declaró, su cargo y su primer apellido sólo si el parentesco no puede destapar el apellido
-- tapado (el materno) de la persona de la fila (la misma regla que apellidoFuncionario en la API); su ficha, con la misma
-- condición. Del pariente, en la fila del funcionario, nada que diga quién es. Indicios para revisar, no acusaciones.
--
-- Cómo aplicarla: python infrastructure/dev/dev.py migrar backend/db/migrations/182_planilla_familia_ascenso.sql (DEV) y
-- SELECT refrescar_planilla_extra(); en producción, backend/scripts/aplicar_182.py.

-- ── 1. dji_nepotismo, por el rango de la llave ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW dji_nepotismo AS
 SELECT v.entidad_ruc,
    v.declarante_norm,
    ( SELECT f.cargo
           FROM dji_funcionarios f
          WHERE f.nombre_norm = v.declarante_norm AND f.cargo IS NOT NULL
          ORDER BY f.fecha_inicio_cargo DESC NULLS LAST
         LIMIT 1) AS cargo,
    v.grado,
    v.parentesco,
    p.ruc AS proveedor_ruc,
    p.nombre AS proveedor_nombre,
    sum(p.ordenes)::integer AS ordenes,
    sum(p.monto)::double precision AS monto,
    min(p.anio) AS desde,
    max(p.anio) AS hasta
   FROM dji_vinculos v
     JOIN persona_orden_anual p ON p.entidad_ruc = v.entidad_ruc
                               AND p.ruc BETWEEN '10' || v.pariente_doc || '0' AND '10' || v.pariente_doc || '9'
  WHERE length(v.pariente_doc) = 8
  GROUP BY v.entidad_ruc, v.declarante_norm, v.grado, v.parentesco, p.ruc, p.nombre;

-- ── 2. La planilla de cada entidad mes a mes ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS planilla_entidad_mes (
  entidad_ruc TEXT NOT NULL,
  mes         DATE NOT NULL,
  personas    INTEGER NOT NULL,   -- con sueldo base ese mes
  base        NUMERIC,            -- remuneraciones y honorarios sumados (sin los meses con un posible error de carga)
  altas       INTEGER,            -- no estaban el mes anterior que publicó la entidad (NULL en su primer mes)
  bajas       INTEGER,            -- estaban el mes anterior y ya no
  PRIMARY KEY (entidad_ruc, mes)
);
ALTER TABLE planilla_entidad_mes OWNER TO vigia_jobs;
GRANT SELECT ON planilla_entidad_mes TO vigia_api, vigia_api_admin, vigia_mcp;

-- ── 3. Las señales ───────────────────────────────────────────────────────────────────────────────────────────────────
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

  -- D. Las filas de la planilla tocadas: se quitan estos tipos (de una corrida anterior) y se agregan los nuevos.
  CREATE TEMP TABLE _pxtoc ON COMMIT DROP AS
    SELECT entidad_ruc, nombre_norm FROM planilla_persona
     WHERE tipos && ARRAY['pariente_planilla', 'familiar_en_planilla', 'ascenso_expres']
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
          SELECT s FROM jsonb_array_elements(pp.senales) s WHERE s->>'tipo' NOT IN ('pariente_planilla', 'familiar_en_planilla', 'ascenso_expres')
          UNION ALL
          SELECT jsonb_build_object('tipo', n.tipo, 'severidad', n.severidad, 'detalle', n.detalle)
            FROM _pxs n WHERE n.entidad_ruc = t.entidad_ruc AND n.nombre_norm = t.nombre_norm
        ) e ON true
       GROUP BY t.entidad_ruc, t.nombre_norm) x
   WHERE p.entidad_ruc = x.entidad_ruc AND p.nombre_norm = x.nombre_norm;
  GET DIAGNOSTICS n_pla = ROW_COUNT;

  -- E. La planilla de cada entidad mes a mes: personas, sueldo base, y quiénes entraron y salieron frente al mes anterior
  --    que publicó (una entidad que no publicó un mes se compara con el último que sí).
  CREATE TEMP TABLE _pem ON COMMIT DROP AS
    SELECT entidad_ruc, m, lag(m) OVER e AS m_prev, lead(m) OVER e AS m_next
      FROM (SELECT DISTINCT entidad_ruc, m FROM _pm) x
    WINDOW e AS (PARTITION BY entidad_ruc ORDER BY m);
  DELETE FROM planilla_entidad_mes;
  INSERT INTO planilla_entidad_mes (entidad_ruc, mes, personas, base, altas, bajas)
  SELECT em.entidad_ruc, em.m, a.personas, a.base,
         CASE WHEN em.m_prev IS NULL THEN NULL ELSE a.altas END,
         CASE WHEN em.m_prev IS NULL THEN NULL ELSE COALESCE(b.bajas, 0) END
    FROM _pem em
    JOIN (SELECT p.entidad_ruc, p.m, count(*)::int AS personas, sum(p.base) AS base,
                 count(*) FILTER (WHERE p.m_ant IS DISTINCT FROM e.m_prev)::int AS altas
            FROM _pm p JOIN _pem e ON e.entidad_ruc = p.entidad_ruc AND e.m = p.m
           GROUP BY 1, 2) a ON a.entidad_ruc = em.entidad_ruc AND a.m = em.m
    LEFT JOIN (SELECT p.entidad_ruc, e.m_next AS m, count(*)::int AS bajas
                 FROM _pm p JOIN _pem e ON e.entidad_ruc = p.entidad_ruc AND e.m = p.m
                WHERE e.m_next IS NOT NULL AND p.m_sig IS DISTINCT FROM e.m_next
                GROUP BY 1, 2) b ON b.entidad_ruc = em.entidad_ruc AND b.m = em.m;

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
