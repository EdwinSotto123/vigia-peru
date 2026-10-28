-- 195 · La visita antes de la primera orden de un locador, con todas las visitas (fase 2.2 del plan del 2026-10-27).
--
-- La señal «Visitó la entidad antes de ser contratado» (persona_senal visita_previa, migración 91) tenía dos fallas:
--   1. Casaba la entidad por el nombre exacto (mef_norm(entidad_visitada) = el nombre de la entidad en CONOSCE). La
--      plataforma nacional de visitas (desde 2020, ~500 entidades) escribe los nombres a su manera: en DEV, de 8,157
--      locadores con una visita así, el nombre exacto encontraba 1,455. Ahora va por visita_entidad_ruc (migración 186:
--      todos los nombres de cada entidad, la regla de la 174).
--   2. Medía contra la primera orden DE CADA AÑO: un locador de siempre «visitaba antes» de su orden de enero porque ya
--      trabajaba ahí. Ahora es la PRIMERA orden en esa entidad (en los datos), y la visita es anterior a ese día.
-- Pesa más (media) si visitó a quien decide las compras (visita_decisor de la 188); si no, baja. Cada visita lleva de
-- qué registro salió (fuente_visita) para enlazar a él, y la lista se corta en 30 (n_visitas dice cuántas fueron).
-- Del funcionario visitado, sólo cargo y área: nunca su nombre.
--
-- refrescar_persona_visita_previa() la rehace sola (tras cargar visitas: cargar_visitas_nacional.py y
-- cargar_visitas_congreso.py la corren), con el resumen de cada par tocado como refrescar_senales_extra (179).
-- refrescar_personas_senales es la de la 106 con este paso cambiado.

CREATE OR REPLACE FUNCTION persona_visita_previa_insertar() RETURNS integer
LANGUAGE plpgsql AS $$
-- Lee _vpf (entidad_ruc, ruc, dni, primera), que arma quien la llama.
DECLARE n int;
BEGIN
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT x.entidad_ruc, x.ruc, 'visita_previa',
         CASE WHEN bool_or(x.decide) THEN 'media' ELSE 'baja' END,
         jsonb_build_object(
           'primera_orden', x.primera,
           'n_visitas', count(*),
           'a_quien_decide', count(*) FILTER (WHERE x.decide),
           'visitas', jsonb_agg(jsonb_build_object(
                        'fecha', x.fecha_visita, 'hora', to_char(x.hora_ingreso, 'HH24:MI'), 'dias_antes', x.primera - x.fecha_visita,
                        'cargo_visitado', x.funcionario_cargo, 'area', x.funcionario_area, 'motivo', left(x.motivo, 200),
                        'decide', x.decide, 'fuente_visita', x.fuente)
                      ORDER BY x.fecha_visita DESC, x.hora_ingreso DESC) FILTER (WHERE x.k <= 30)),
         'visitas_entidades', 'https://visitas.servicios.gob.pe/'
    FROM (SELECT y.*, row_number() OVER (PARTITION BY y.entidad_ruc, y.ruc ORDER BY y.fecha_visita DESC, y.hora_ingreso DESC) AS k
            FROM (SELECT DISTINCT ON (f.entidad_ruc, f.ruc, v.fecha_visita, COALESCE(v.hora_ingreso, '00:00'))
                         f.entidad_ruc, f.ruc, f.primera, v.fecha_visita, v.hora_ingreso, v.funcionario_cargo, v.funcionario_area,
                         v.motivo, v.fuente,
                         COALESCE(v.decisor, visita_decisor(v.funcionario_cargo, v.funcionario_area), false) AS decide
                    FROM _vpf f
                    JOIN visitas_entidades v ON v.numero_documento = f.dni
                    JOIN visita_entidad_ruc m ON m.entidad_visitada = v.entidad_visitada AND m.ruc = f.entidad_ruc
                   WHERE v.fecha_visita >= f.primera - 180 AND v.fecha_visita < f.primera
                   ORDER BY f.entidad_ruc, f.ruc, v.fecha_visita, COALESCE(v.hora_ingreso, '00:00'),
                            COALESCE(v.decisor, false) DESC) y) x
   GROUP BY x.entidad_ruc, x.ruc, x.primera;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION persona_visita_previa_insertar() OWNER TO vigia_jobs;

CREATE OR REPLACE FUNCTION refrescar_persona_visita_previa() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  -- El mismo cerrojo que refrescar_personas_senales: las dos escriben visita_previa y el resumen de persona_entidad.
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_personas'));
  SET LOCAL work_mem = '256MB';
  CREATE TEMP TABLE _vpp ON COMMIT DROP AS SELECT DISTINCT entidad_ruc, ruc FROM persona_senal WHERE tipo = 'visita_previa';
  DELETE FROM persona_senal WHERE tipo = 'visita_previa';
  CREATE TEMP TABLE _vpf ON COMMIT DROP AS
    SELECT entidad_ruc, ruc, substr(ruc, 3, 8) AS dni, min(primera) AS primera
      FROM persona_orden_anual WHERE ruc ~ '^10[0-9]{9}$' GROUP BY entidad_ruc, ruc;
  CREATE INDEX ON _vpf (dni);
  ANALYZE _vpf;
  n := persona_visita_previa_insertar();
  -- El resumen de cada par tocado (antes y después), desde persona_senal (como refrescar_senales_extra, migración 179).
  INSERT INTO _vpp SELECT DISTINCT entidad_ruc, ruc FROM persona_senal WHERE tipo = 'visita_previa';
  CREATE TEMP TABLE _vpp2 ON COMMIT DROP AS SELECT DISTINCT entidad_ruc, ruc FROM _vpp;
  UPDATE persona_entidad pe SET tipos = '{}', senales = '[]', n_senales = 0, sev = 0
    FROM _vpp2 p WHERE pe.entidad_ruc = p.entidad_ruc AND pe.ruc = p.ruc;
  UPDATE persona_entidad pe
     SET tipos = s.tipos, senales = s.senales, n_senales = s.n, sev = s.sev
    FROM (SELECT ps.entidad_ruc, ps.ruc, array_agg(ps.tipo ORDER BY ps.tipo) AS tipos, count(*)::int AS n,
                 max(CASE ps.severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END)::smallint AS sev,
                 jsonb_agg(jsonb_build_object('tipo', ps.tipo, 'severidad', ps.severidad)
                           ORDER BY CASE ps.severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, ps.tipo) AS senales
            FROM persona_senal ps JOIN _vpp2 p ON p.entidad_ruc = ps.entidad_ruc AND p.ruc = ps.ruc
           GROUP BY ps.entidad_ruc, ps.ruc) s
   WHERE pe.entidad_ruc = s.entidad_ruc AND pe.ruc = s.ruc;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_persona_visita_previa() OWNER TO vigia_jobs;

CREATE OR REPLACE FUNCTION refrescar_personas_senales(p_desde date DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n INT;
  v_anio INT := extract(year FROM p_desde)::int;   -- NULL: todo
  t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_personas'));
  SET LOCAL work_mem = '256MB';

  -- entidad_gobierno es una vista (expresiones regulares sobre el nombre de cada entidad): materializada una vez. Cruzada
  -- en vivo, el planificador la recalculaba por cada fila (939 mil × 2 400 entidades: 570 s en DEV).
  CREATE TEMP TABLE _eg ON COMMIT DROP AS SELECT ruc::text AS ruc, nivel, ubigeo::text AS ubigeo FROM entidad_gobierno;
  CREATE UNIQUE INDEX ON _eg (ruc);
  ANALYZE _eg;

  -- Los pares entidad × persona que se rehacen: los que tienen órdenes desde v_anio (con todos sus años), o todos.
  CREATE TEMP TABLE _par ON COMMIT DROP AS
  SELECT DISTINCT entidad_ruc, ruc FROM persona_orden_anual WHERE v_anio IS NULL OR anio >= v_anio;
  CREATE UNIQUE INDEX ON _par (entidad_ruc, ruc);
  ANALYZE _par;
  RAISE NOTICE 'personas: % pares (% s)', (SELECT count(*) FROM _par), round(extract(epoch FROM clock_timestamp() - t0));

  -- Cada persona en cada entidad y año, con quién gobernaba la entidad ese año (los mandatos empiezan el 1 de enero;
  -- si una elección complementaria se superpone, la más reciente).
  CREATE TEMP TABLE _pa ON COMMIT DROP AS
  SELECT a.entidad_ruc, a.ruc, a.anio, a.primera, a.ultima, a.entidad, a.nombre, a.servicio, a.ordenes, a.meses, a.monto,
         substr(a.ruc, 3, 8) AS dni, a.nom_n, a.dep_n, a.ent_n, a.ap1, a.ap2,
         eg.nivel, eg.ubigeo AS gub, gp.org_clave, gp.org_nombre, mef_norm(gp.org_nombre) AS gob_n, gp.anio_eleccion
    FROM persona_orden_anual a
    JOIN _par USING (entidad_ruc, ruc)
    LEFT JOIN _eg eg ON eg.ruc = a.entidad_ruc
    LEFT JOIN LATERAL (
      SELECT g.org_clave, g.org_nombre, g.anio_eleccion FROM gobierno_periodo g
       WHERE g.nivel = eg.nivel AND g.ubigeo = eg.ubigeo AND make_date(a.anio, 7, 1) BETWEEN g.desde AND g.hasta
       ORDER BY g.anio_eleccion DESC LIMIT 1
    ) gp ON TRUE;
  CREATE INDEX ON _pa (dni);
  ANALYZE _pa;

  -- Cuántas personas contratadas llevan cada pareja de apellidos (para no marcar QUISPE MAMANI).
  CREATE TEMP TABLE _frec ON COMMIT DROP AS
  SELECT ap1, ap2, count(*)::int AS frec FROM (SELECT DISTINCT ruc, ap1, ap2 FROM persona_orden_anual) x GROUP BY 1, 2;
  ANALYZE _frec;
  RAISE NOTICE 'personas: _pa y _frec (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  IF v_anio IS NULL THEN
    DELETE FROM persona_senal;
  ELSE
    DELETE FROM persona_senal s USING _par p WHERE s.entidad_ruc = p.entidad_ruc AND s.ruc = p.ruc;
    -- Los pares que ya no tienen órdenes (un mes recargado sin ellas).
    DELETE FROM persona_senal s WHERE NOT EXISTS (SELECT 1 FROM persona_orden_anual a WHERE a.entidad_ruc = s.entidad_ruc AND a.ruc = s.ruc);
  END IF;

  -- ── Candidaturas: JNE (desde 2014) y ONPE Claridad (con DNI). Sin DNI en la fuente, por nombre y departamento.
  CREATE TEMP TABLE _cand ON COMMIT DROP AS
  SELECT DISTINCT * FROM (
    SELECT NULLIF(numero_documento, '') AS dni, mef_norm(nombre) AS nom_n, mef_norm(region) AS dep_n,
           mef_norm(partido) AS org_n, partido, cargo, "año" AS anio, resultado, nombre
      FROM jne_candidaturas WHERE partido IS NOT NULL AND nombre IS NOT NULL
    UNION ALL
    SELECT dni, mef_norm(apellidos || ' ' || nombres), mef_norm(departamento), mef_norm(organizacion), organizacion, NULL,
           substring(proceso FROM '\d{4}')::int, NULL, apellidos || ' ' || nombres
      FROM onpe_candidatos WHERE dni ~ '^\d{8}$' AND organizacion IS NOT NULL
  ) x;
  ANALYZE _cand;

  CREATE TEMP TABLE _pc ON COMMIT DROP AS
  SELECT p.entidad_ruc, p.ruc, p.anio, p.gob_n, p.org_nombre, p.anio_eleccion, c.org_n, c.partido, c.cargo,
         c.anio AS anio_cand, c.resultado, c.nombre, 'dni'::text AS por
    FROM _pa p JOIN _cand c ON c.dni = p.dni
  UNION ALL
  SELECT p.entidad_ruc, p.ruc, p.anio, p.gob_n, p.org_nombre, p.anio_eleccion, c.org_n, c.partido, c.cargo,
         c.anio, c.resultado, c.nombre, 'nombre'
    FROM _pa p JOIN _cand c ON c.nom_n = p.nom_n AND c.dep_n = p.dep_n
   WHERE c.dni IS NULL;

  -- candidato_gobierna: del partido que gobernaba, en la elección que lo puso o después (hasta un año tras la orden).
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT entidad_ruc, ruc, 'candidato_gobierna', 'alta',
         jsonb_build_object('partido', max(org_nombre), 'por', min(por),
                            'anios', jsonb_agg(DISTINCT anio),
                            'candidaturas', jsonb_agg(DISTINCT jsonb_build_object('nombre', nombre, 'partido', partido, 'cargo', cargo,
                                                                                 'anio', anio_cand, 'resultado', resultado))),
         'jne_candidaturas', 'https://plataformaelectoral.jne.gob.pe/'
    FROM _pc
   WHERE gob_n IS NOT NULL AND mismo_partido(org_n, gob_n) AND anio_cand BETWEEN anio_eleccion - 4 AND anio + 1
   GROUP BY entidad_ruc, ruc;

  -- candidato: de otro partido, en los 8 años antes de la orden o el siguiente.
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT c.entidad_ruc, c.ruc, 'candidato', 'baja',
         jsonb_build_object('por', min(c.por),
                            'candidaturas', jsonb_agg(DISTINCT jsonb_build_object('nombre', c.nombre, 'partido', c.partido, 'cargo', c.cargo,
                                                                                 'anio', c.anio_cand, 'resultado', c.resultado))),
         'jne_candidaturas', 'https://plataformaelectoral.jne.gob.pe/'
    FROM _pc c
   WHERE c.anio_cand BETWEEN c.anio - 8 AND c.anio + 1
     AND NOT (c.gob_n IS NOT NULL AND mismo_partido(c.org_n, c.gob_n))
     AND NOT EXISTS (SELECT 1 FROM persona_senal g WHERE g.entidad_ruc = c.entidad_ruc AND g.ruc = c.ruc AND g.tipo = 'candidato_gobierna')
   GROUP BY c.entidad_ruc, c.ruc;

  -- ── Aportes (ONPE, sólo con DNI). Cada aporte una vez aunque la persona tenga órdenes de varios años.
  CREATE TEMP TABLE _ap ON COMMIT DROP AS
  SELECT DISTINCT ON (p.entidad_ruc, p.ruc, a.id, (p.gob_n IS NOT NULL AND mismo_partido(mef_norm(a.partido), p.gob_n)))
         p.entidad_ruc, p.ruc, p.org_nombre, (p.gob_n IS NOT NULL AND mismo_partido(mef_norm(a.partido), p.gob_n)) AS al_que_gobierna,
         a.id, a.partido, a.monto, a.fecha_aporte, a."año" AS anio, a.nombre
    FROM _pa p JOIN onpe_aportantes a ON a.numero_documento = p.dni
   WHERE a.partido IS NOT NULL
   ORDER BY p.entidad_ruc, p.ruc, a.id, 4, p.anio DESC;
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT entidad_ruc, ruc, 'aporte_gobierna', 'media',
         jsonb_build_object('partido', max(org_nombre), 'monto', sum(monto),
                            'aportes', jsonb_agg(jsonb_build_object('nombre', nombre, 'partido', partido, 'monto', monto,
                                                                    'fecha', fecha_aporte, 'anio', anio) ORDER BY fecha_aporte)),
         'onpe_aportantes', 'https://claridad.onpe.gob.pe/'
    FROM _ap WHERE al_que_gobierna
   GROUP BY entidad_ruc, ruc;
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT entidad_ruc, ruc, 'aporte', 'baja',
         jsonb_build_object('monto', sum(monto),
                            'aportes', jsonb_agg(jsonb_build_object('nombre', nombre, 'partido', partido, 'monto', monto,
                                                                    'fecha', fecha_aporte, 'anio', anio) ORDER BY fecha_aporte)),
         'onpe_aportantes', 'https://claridad.onpe.gob.pe/'
    FROM _ap a
   WHERE NOT al_que_gobierna
     AND NOT EXISTS (SELECT 1 FROM _ap g WHERE g.entidad_ruc = a.entidad_ruc AND g.ruc = a.ruc AND g.id = a.id AND g.al_que_gobierna)
     AND NOT EXISTS (SELECT 1 FROM persona_senal g WHERE g.entidad_ruc = a.entidad_ruc AND g.ruc = a.ruc AND g.tipo = 'aporte_gobierna')
   GROUP BY entidad_ruc, ruc;

  -- ── Autoridades electas con su gobierno: JNE autoridades (ERM 2022 y complementarias, con ubigeo) y los electos de
  -- 2014 y 2018 de las candidaturas (el gobierno sale de los nombres de lugar, que vienen sin ubigeo).
  CREATE TEMP TABLE _zon ON COMMIT DROP AS
  SELECT d.ubigeo AS dist, p.ubigeo AS prov, r.ubigeo AS dep, mef_norm(d.nombre) AS dn, mef_norm(p.nombre) AS pn, mef_norm(r.nombre) AS rn
    FROM zonas d JOIN zonas p ON p.ubigeo = d.padre_ubigeo JOIN zonas r ON r.ubigeo = p.padre_ubigeo
   WHERE d.nivel = 'distrito';
  CREATE TEMP TABLE _el ON COMMIT DROP AS
  SELECT NULLIF(c.numero_documento, '') AS dni, mef_norm(c.nombre) AS nom_n, mef_norm(c.region) AS rn, mef_norm(c.provincia) AS pn,
         mef_norm(c.distrito) AS dn, c.nombre, c.cargo, c.partido, c."año" AS anio,
         CASE WHEN c.cargo ILIKE '%DISTRITAL' THEN 'distrital' WHEN c.cargo ILIKE '%PROVINCIAL' THEN 'provincial' ELSE 'regional' END AS nivel
    FROM jne_candidaturas c
   WHERE c."año" IN (2014, 2018) AND c.resultado = 'electo' AND c.cargo ~* '(DISTRITAL|PROVINCIAL|REGIONAL)$';
  CREATE TEMP TABLE _aut ON COMMIT DROP AS
  SELECT DISTINCT * FROM (
    SELECT NULLIF(a.dni, '') AS dni, mef_norm(a.nombre) AS nom_n, mef_norm(a.departamento) AS dep_n, a.nombre, a.cargo,
           a.organizacion_politica AS partido, a.periodo_inicio AS desde, COALESCE(a.periodo_fin, DATE '2026-12-31') AS hasta,
           CASE WHEN a.cargo ILIKE '%DISTRITAL' THEN 'distrital' WHEN a.cargo ILIKE '%PROVINCIAL' THEN 'provincial'
                WHEN a.cargo ILIKE '%REGIONAL' THEN 'regional' END AS nivel,
           CASE WHEN a.cargo ILIKE '%DISTRITAL' THEN a.ubigeo WHEN a.cargo ILIKE '%PROVINCIAL' THEN left(a.ubigeo, 4)
                WHEN a.cargo ILIKE '%REGIONAL' THEN left(a.ubigeo, 2) END AS gub
      FROM jne_autoridades a WHERE a.ubigeo IS NOT NULL AND a.periodo_inicio IS NOT NULL
    UNION ALL
    SELECT e.dni, e.nom_n, e.rn, e.nombre, e.cargo, e.partido, make_date(e.anio + 1, 1, 1), make_date(e.anio + 4, 12, 31), e.nivel,
           CASE e.nivel WHEN 'distrital' THEN zd.dist WHEN 'provincial' THEN zp.prov ELSE zr.dep END
      FROM _el e
      LEFT JOIN (SELECT DISTINCT ON (rn, pn, dn) rn, pn, dn, dist FROM _zon ORDER BY rn, pn, dn, dist) zd
             ON e.nivel = 'distrital' AND zd.rn = e.rn AND zd.pn = e.pn AND zd.dn = e.dn
      LEFT JOIN (SELECT DISTINCT ON (rn, pn) rn, pn, prov FROM _zon ORDER BY rn, pn, prov) zp
             ON e.nivel = 'provincial' AND zp.rn = e.rn AND zp.pn = e.pn
      LEFT JOIN (SELECT DISTINCT ON (rn) rn, dep FROM _zon ORDER BY rn, dep) zr
             ON e.nivel = 'regional' AND zr.rn = e.rn
  ) x WHERE nivel IS NOT NULL;
  ALTER TABLE _aut ADD COLUMN ap1 text, ADD COLUMN ap2 text;
  UPDATE _aut SET ap1 = split_part(nom_n, ' ', 1), ap2 = split_part(nom_n, ' ', 2);
  ANALYZE _aut;

  -- autoridad_contratada: la persona es la autoridad, con el mandato en curso.
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT entidad_ruc, ruc, 'autoridad_contratada',
         CASE max(CASE WHEN mismo THEN 3 WHEN cargo ~* '^(ALCALDE|GOBERNADOR|VICEGOBERNADOR)' THEN 2 ELSE 1 END)
              WHEN 3 THEN 'alta' WHEN 2 THEN 'media' ELSE 'baja' END,
         jsonb_build_object('mismo_gobierno', bool_or(mismo), 'por', min(por),
                            'autoridades', jsonb_agg(DISTINCT jsonb_build_object('nombre', nombre, 'cargo', cargo, 'partido', partido,
                                                                                'desde', desde, 'hasta', hasta, 'mismo_gobierno', mismo))),
         'jne_autoridades', 'https://plataformaelectoral.jne.gob.pe/'
    FROM (
      SELECT p.entidad_ruc, p.ruc, a.nombre, a.cargo, a.partido, a.desde, a.hasta,
             COALESCE(a.nivel = p.nivel AND a.gub = p.gub, false) AS mismo, 'dni' AS por
        FROM _pa p JOIN _aut a ON a.dni = p.dni
       WHERE p.primera <= a.hasta AND p.ultima >= a.desde
      UNION ALL
      SELECT p.entidad_ruc, p.ruc, a.nombre, a.cargo, a.partido, a.desde, a.hasta,
             COALESCE(a.nivel = p.nivel AND a.gub = p.gub, false), 'nombre'
        FROM _pa p JOIN _aut a ON a.ap1 = p.ap1 AND a.ap2 = p.ap2 AND a.dep_n = p.dep_n
       WHERE a.dni IS NULL AND misma_persona(a.nom_n, p.nom_n) AND p.primera <= a.hasta AND p.ultima >= a.desde
    ) x
   GROUP BY entidad_ruc, ruc;

  -- apellidos_autoridad: los dos apellidos de una autoridad del gobierno de la entidad, en su mandato; no ella misma.
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT entidad_ruc, ruc, 'apellidos_autoridad', CASE WHEN min(frec) <= 20 THEN 'media' ELSE 'baja' END,
         jsonb_build_object('frecuencia', min(frec),
                            'autoridades', jsonb_agg(DISTINCT jsonb_build_object('nombre', nombre, 'cargo', cargo, 'partido', partido,
                                                                                'desde', desde, 'hasta', hasta))),
         'jne_autoridades', 'https://plataformaelectoral.jne.gob.pe/'
    FROM (
      SELECT p.entidad_ruc, p.ruc, a.nombre, a.cargo, a.partido, a.desde, a.hasta, f.frec
        FROM _pa p
        JOIN _aut a ON a.nivel = p.nivel AND a.gub = p.gub AND a.ap1 = p.ap1 AND a.ap2 = p.ap2
        JOIN _frec f ON f.ap1 = p.ap1 AND f.ap2 = p.ap2
       WHERE length(p.ap1) > 1 AND length(p.ap2) > 1
         AND p.primera <= a.hasta AND p.ultima >= a.desde
         AND NOT misma_persona(a.nom_n, p.nom_n) AND (a.dni IS NULL OR a.dni <> p.dni)
    ) x
   GROUP BY entidad_ruc, ruc;
  RAISE NOTICE 'personas: candidaturas, aportes y autoridades (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- ── DJI: quienes declararon trabajar en la entidad (por su nombre), en la declaración de cada año.
  CREATE TEMP TABLE _ent ON COMMIT DROP AS SELECT DISTINCT ent_n FROM _pa;
  CREATE TEMP TABLE _djie ON COMMIT DROP AS
  SELECT x.entidad, mef_norm(x.entidad) AS ent_n FROM (SELECT DISTINCT entidad FROM dji_funcionarios WHERE entidad IS NOT NULL) x;
  CREATE TEMP TABLE _dji ON COMMIT DROP AS
  SELECT DISTINCT m.ent_n, f.nombre_norm AS nom_n, mef_norm(f.apellido_paterno) AS ap1, mef_norm(f.apellido_materno) AS ap2,
         trim(COALESCE(f.nombres, '') || ' ' || COALESCE(f.apellido_paterno, '') || ' ' || COALESCE(f.apellido_materno, '')) AS nombre,
         f.cargo, extract(year FROM fecha_dji(f.fecha_presentacion))::int AS anio,
         fecha_dji(f.fecha_inicio_cargo) AS inicio, fecha_dji(f.fecha_cese_cargo) AS cese
    FROM dji_funcionarios f
    JOIN _djie m ON m.entidad = f.entidad
    JOIN _ent e ON e.ent_n = m.ent_n
   WHERE f.nombre_norm IS NOT NULL;
  ANALYZE _dji;

  -- funcionario_contratado: la misma persona declaró trabajar en la entidad el año de las órdenes, con el cargo vigente.
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT p.entidad_ruc, p.ruc, 'funcionario_contratado', 'media',
         jsonb_build_object('anios', jsonb_agg(DISTINCT p.anio),
                            'cargos', jsonb_agg(DISTINCT jsonb_build_object('cargo', d.cargo, 'anio', d.anio, 'inicio', d.inicio, 'cese', d.cese))),
         'dji_contraloria', 'https://www.datosabiertos.gob.pe/'
    FROM _pa p JOIN _dji d ON d.ent_n = p.ent_n AND d.nom_n = p.nom_n
   WHERE d.anio = p.anio AND (d.inicio IS NULL OR d.inicio <= p.ultima) AND (d.cese IS NULL OR d.cese >= p.primera)
   GROUP BY p.entidad_ruc, p.ruc;

  -- apellidos_funcionario: los dos apellidos, poco comunes, de otro declarante de la entidad, ese año o el anterior.
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT p.entidad_ruc, p.ruc, 'apellidos_funcionario', 'media',
         jsonb_build_object('frecuencia', min(f.frec),
                            'funcionarios_designados', jsonb_agg(DISTINCT jsonb_build_object('nombre', d.nombre, 'cargo', d.cargo, 'anio', d.anio))),
         'dji_contraloria', 'https://www.datosabiertos.gob.pe/'
    FROM _pa p
    JOIN _dji d ON d.ent_n = p.ent_n AND d.ap1 = p.ap1 AND d.ap2 = p.ap2
    JOIN _frec f ON f.ap1 = p.ap1 AND f.ap2 = p.ap2
   WHERE f.frec <= 20 AND length(p.ap1) > 1 AND length(p.ap2) > 1 AND NOT misma_persona(d.nom_n, p.nom_n) AND d.anio BETWEEN p.anio - 1 AND p.anio
   GROUP BY p.entidad_ruc, p.ruc;

  RAISE NOTICE 'personas: DJI (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- ── inhabilitado: órdenes emitidas dentro de una inhabilitación del Tribunal (temporal o definitiva).
  CREATE TEMP TABLE _san ON COMMIT DROP AS
  SELECT s.ruc, s.tipo, s.resolucion, s.fecha_desde, s.fecha_hasta, left(s.infraccion, 300) AS infraccion,
         COALESCE(s.fecha_hasta, CASE WHEN s.tipo = 'definitivo' THEN DATE '9999-12-31' END) AS hasta
    FROM osce_sancionados s
   WHERE s.ruc ~ '^10\d{9}$' AND s.tipo IN ('temporal', 'definitivo') AND s.fecha_desde IS NOT NULL
     AND s.ruc IN (SELECT ruc FROM _par);
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT o.entidad_ruc, o.ruc, 'inhabilitado', 'alta',
         jsonb_build_object('ordenes', count(*), 'monto', sum(o.monto),
                            'sanciones', (SELECT jsonb_agg(jsonb_build_object('tipo', s.tipo, 'resolucion', s.resolucion, 'desde', s.fecha_desde,
                                                                              'hasta', s.fecha_hasta, 'infraccion', s.infraccion) ORDER BY s.fecha_desde)
                                            FROM _san s WHERE s.ruc = o.ruc)),
         'osce_sancionados', 'https://www.gob.pe/tce'
    FROM (
      SELECT DISTINCT ON (c.entidad_ruc, c.orden, c.fecha_emision) c.entidad_ruc, c.ruc_contratista AS ruc, c.monto
        FROM _san s
        JOIN conosce_ordenes c ON c.ruc_contratista = s.ruc AND c.fecha_emision BETWEEN s.fecha_desde AND s.hasta
        JOIN _par p ON p.entidad_ruc = c.entidad_ruc AND p.ruc = c.ruc_contratista
       WHERE c.tipo_orden = 'Orden de Servicio' AND c.estado IS DISTINCT FROM 'Anulada' AND c.moneda = 'Nuevos Soles' AND c.monto > 0
       ORDER BY c.entidad_ruc, c.orden, c.fecha_emision, c.anio DESC, c.mes DESC
    ) o
   GROUP BY o.entidad_ruc, o.ruc;

  -- ── meses_seguidos: órdenes en 10 o más meses de un mismo año.
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT entidad_ruc, ruc, 'meses_seguidos', 'media',
         jsonb_build_object('anios', jsonb_agg(jsonb_build_object('anio', anio, 'meses', meses, 'ordenes', ordenes, 'monto', monto) ORDER BY anio)),
         'conosce_ordenes', 'https://conosce.osce.gob.pe/buscador/'
    FROM persona_orden_anual JOIN _par USING (entidad_ruc, ruc) WHERE meses >= 10
   GROUP BY entidad_ruc, ruc;

  -- ── Lo que se paga por mes por cada tipo de servicio, en cada entidad y en todo el país.
  DELETE FROM servicio_referencia WHERE v_anio IS NULL OR anio >= v_anio;
  INSERT INTO servicio_referencia (entidad_ruc, anio, servicio, personas, mediana_mes, p25_mes, p75_mes, p90_mes)
  SELECT entidad_ruc, anio, servicio, count(*),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY monto / meses), percentile_cont(0.25) WITHIN GROUP (ORDER BY monto / meses),
         percentile_cont(0.75) WITHIN GROUP (ORDER BY monto / meses), percentile_cont(0.9) WITHIN GROUP (ORDER BY monto / meses)
    FROM persona_orden_anual WHERE servicio IS NOT NULL AND meses > 0 AND (v_anio IS NULL OR anio >= v_anio)
   GROUP BY entidad_ruc, anio, servicio
  UNION ALL
  SELECT '', anio, servicio, count(*),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY monto / meses), percentile_cont(0.25) WITHIN GROUP (ORDER BY monto / meses),
         percentile_cont(0.75) WITHIN GROUP (ORDER BY monto / meses), percentile_cont(0.9) WITHIN GROUP (ORDER BY monto / meses)
    FROM persona_orden_anual WHERE servicio IS NOT NULL AND meses > 0 AND (v_anio IS NULL OR anio >= v_anio)
   GROUP BY anio, servicio;

  -- pago_alto: 2,5 veces o más la mediana por mes de la entidad para ese servicio (con 10 personas o más), y
  -- S/ 6,000 o más por mes, con órdenes en dos meses o más (una sola orden grande puede pagar varios meses de trabajo).
  -- Sólo servicios que son el trabajo de una persona, y no "otros servicios personales" (mezcla demasiado).
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT a.entidad_ruc, a.ruc, 'pago_alto', 'media',
         jsonb_build_object('anios', jsonb_agg(jsonb_build_object('anio', a.anio, 'servicio', a.servicio, 'por_mes', round(a.monto / a.meses, 2),
                                                                  'mediana_mes', r.mediana_mes, 'personas', r.personas,
                                                                  'veces', round(a.monto / a.meses / r.mediana_mes, 1)) ORDER BY a.anio)),
         'conosce_ordenes', 'https://conosce.osce.gob.pe/buscador/'
    FROM persona_orden_anual a
    JOIN _par p ON p.entidad_ruc = a.entidad_ruc AND p.ruc = a.ruc
    JOIN servicio_referencia r ON r.entidad_ruc = a.entidad_ruc AND r.anio = a.anio AND r.servicio = a.servicio
   WHERE servicio_es_personal(a.servicio) AND a.servicio <> 'Otros servicios personales' AND a.meses >= 2
     AND r.personas >= 10 AND r.mediana_mes > 0
     AND a.monto / a.meses >= 2.5 * r.mediana_mes AND a.monto / a.meses >= 6000
   GROUP BY a.entidad_ruc, a.ruc;

  -- ── visita_previa (migración 195): visitó la entidad en los 180 días antes de su PRIMERA orden ahí, por el RUC de la
  --    entidad visitada (todos sus nombres: también los de la plataforma nacional de visitas). persona_visita_previa_insertar().
  CREATE TEMP TABLE _vpf ON COMMIT DROP AS
    SELECT entidad_ruc, ruc, dni, min(primera) AS primera FROM _pa GROUP BY entidad_ruc, ruc, dni;
  CREATE INDEX ON _vpf (dni);
  ANALYZE _vpf;
  PERFORM persona_visita_previa_insertar();

  -- ── Lo que sale de la planilla (migración 92: tambien_planilla, antes_locador), si ya está.
  IF to_regprocedure('senales_planilla_de_personas()') IS NOT NULL THEN
    PERFORM senales_planilla_de_personas();
  END IF;

  -- ── Resumen por persona y entidad, para las listas.
  CREATE TEMP TABLE _ps ON COMMIT DROP AS
  SELECT entidad_ruc, ruc, array_agg(tipo ORDER BY tipo) AS tipos, count(*)::int AS n,
         max(CASE severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END)::smallint AS sev,
         jsonb_agg(jsonb_build_object('tipo', tipo, 'severidad', severidad)
                   ORDER BY CASE severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, tipo) AS senales
    FROM persona_senal JOIN _par USING (entidad_ruc, ruc) GROUP BY entidad_ruc, ruc;
  RAISE NOTICE 'personas: señales (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  IF v_anio IS NULL THEN
    DELETE FROM persona_entidad;
  ELSE
    DELETE FROM persona_entidad pe USING _par p WHERE pe.entidad_ruc = p.entidad_ruc AND pe.ruc = p.ruc;
    DELETE FROM persona_entidad pe WHERE NOT EXISTS (SELECT 1 FROM persona_orden_anual a WHERE a.entidad_ruc = pe.entidad_ruc AND a.ruc = pe.ruc);
  END IF;
  INSERT INTO persona_entidad (entidad_ruc, ruc, codigo, entidad, nombre, dep, servicio, ordenes, meses, monto, primera, ultima, anios,
                               gobiernos, tipos, senales, n_senales, sev)
  SELECT p.entidad_ruc, p.ruc, pc.codigo, max(p.entidad), max(p.nombre), max(left(e.ubigeo, 2)),
         (array_agg(p.servicio ORDER BY p.monto DESC))[1],
         sum(p.ordenes), sum(p.meses), sum(p.monto), min(p.primera), max(p.ultima), array_agg(p.anio ORDER BY p.anio),
         COALESCE(array_agg(DISTINCT p.org_clave || ':' || p.anio_eleccion) FILTER (WHERE p.org_clave IS NOT NULL), '{}'),
         COALESCE(max(s.tipos), '{}'), COALESCE((array_agg(s.senales))[1], '[]'), COALESCE(max(s.n), 0), COALESCE(max(s.sev), 0)
    FROM _pa p
    JOIN persona_codigo pc ON pc.ruc = p.ruc
    LEFT JOIN entidades e ON e.ruc = p.entidad_ruc
    LEFT JOIN _ps s ON s.entidad_ruc = p.entidad_ruc AND s.ruc = p.ruc
   GROUP BY p.entidad_ruc, p.ruc, pc.codigo;
  GET DIAGNOSTICS n = ROW_COUNT;

  RAISE NOTICE 'personas: listo (% s)', round(extract(epoch FROM clock_timestamp() - t0));
  RETURN n;
END $$;

ALTER FUNCTION refrescar_personas_senales(date) OWNER TO vigia_jobs;
