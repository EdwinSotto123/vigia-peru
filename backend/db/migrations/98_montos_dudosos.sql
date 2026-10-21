-- 98 · Montos que no se pueden creer, sin borrarlos; y la brecha de la planilla sobre el sueldo, no sobre el total.
--
-- Órdenes (validado con casos reales del 2026-10-21): la O/S-106-2026 de la Municipalidad Distrital de Huarochirí paga
-- S/ 45,006,800 por tres meses de apoyo en tesorería. Una orden "hasta N UIT" no puede pasar de N UIT; 20 veces más es
-- un error de digitación (909 órdenes). Y una orden "sin proceso de selección" de más de S/ 1 M a una persona natural
-- (47). limpiar_montos_ordenes() ahora guarda el monto original en `monto_dudoso` (se muestra, no se suma) y deja
-- `monto` NULL; la 97 los borraba (sus 321 quedan sin el original).
--
-- Planilla: en el Banco de la Nación un analista con sueldo de S/ 5,500 cobró S/ 183,172 en agosto (S/ 177,672 en
-- "otros beneficios": una liquidación o un retiro). brecha_cargo comparaba el total del mes y decía "19,1 veces". Ahora:
--   · el sueldo base = remuneraciones + honorarios (o el total si el mes no trae nada más), y la brecha y la mediana
--     por cargo se calculan sobre él;
--   · pago_extraordinario (baja): S/ 20,000 o más fuera del sueldo y el triple del sueldo o más, aparte;
--   · planilla_persona guarda `base` y `extra`.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/98_montos_dudosos.sql
-- y después, fuera de Hyperdrive: refrescar_fraccionamiento(NULL), refrescar_personas_ordenes(NULL),
-- refrescar_personas_senales(NULL), refrescar_personas_resumen(), refrescar_planilla() y la cadena de los cruces.

ALTER TABLE conosce_ordenes ADD COLUMN IF NOT EXISTS monto_dudoso NUMERIC(18, 2);
ALTER TABLE planilla_persona ADD COLUMN IF NOT EXISTS base NUMERIC(14, 2), ADD COLUMN IF NOT EXISTS extra NUMERIC(14, 2);

CREATE OR REPLACE FUNCTION limpiar_montos_ordenes(p_anio int DEFAULT NULL, p_mes int DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  UPDATE conosce_ordenes SET monto_dudoso = monto, monto = NULL
   WHERE monto IS NOT NULL
     AND (p_anio IS NULL OR anio = p_anio) AND (p_mes IS NULL OR mes = p_mes)
     AND (monto > 100000000
          OR (monto > 1000000 AND ruc_contratista ~ '^\d{11}$' AND monto = ruc_contratista::numeric)
          OR (monto > 1000000 AND nro_orden ~ '^\d{1,15}$' AND monto = nro_orden::numeric)
          -- "hasta N UIT": 20 veces el tope o más.
          OR (tipo_contratacion ILIKE 'Contrataciones hasta%' AND fecha_emision IS NOT NULL
              AND monto > 20 * COALESCE(substring(tipo_contratacion FROM 'hasta (\d+) UIT')::int, 8) * uit_soles(extract(year FROM fecha_emision)::int))
          -- sin proceso de selección, a una persona natural, más de S/ 1 M.
          OR (monto > 1000000 AND ruc_contratista ~ '^10\d{9}$' AND tipo_contratacion ILIKE 'Otras contrataciones%'));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION limpiar_montos_ordenes(int, int) OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION limpiar_montos_ordenes(int, int) FROM PUBLIC;

SELECT limpiar_montos_ordenes() AS montos_dudosos;

CREATE OR REPLACE FUNCTION refrescar_planilla() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n INT;
  t0 timestamptz := clock_timestamp();
BEGIN
  SET LOCAL work_mem = '256MB';

  -- Lo que se paga por cargo en cada entidad y mes.
  DELETE FROM cargo_referencia;
  INSERT INTO cargo_referencia (entidad_ruc, anio, mes, cargo, personas, mediana, p25, p75, maximo)
  SELECT entidad_ruc, anio, mes, mef_norm(cargo), count(*),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY base), percentile_cont(0.25) WITHIN GROUP (ORDER BY base),
         percentile_cont(0.75) WITHIN GROUP (ORDER BY base), max(base)
    FROM (SELECT entidad_ruc, anio, mes, cargo, (CASE WHEN COALESCE(remuneraciones, 0) + COALESCE(honorarios, 0) > 0 THEN COALESCE(remuneraciones, 0) + COALESCE(honorarios, 0)
               WHEN COALESCE(otros, 0) + COALESCE(gratificacion, 0) + COALESCE(incentivo, 0) = 0 THEN total END) AS base FROM planilla_pte) x
   WHERE base > 0 AND cargo IS NOT NULL
   GROUP BY entidad_ruc, anio, mes, mef_norm(cargo);

  -- Cada persona en cada entidad: su último mes manda (cargo, régimen, sueldo).
  CREATE TEMP TABLE _pl ON COMMIT DROP AS
  SELECT DISTINCT ON (p.entidad_ruc, p.nombre_norm) p.entidad_ruc, p.nombre_norm, p.paterno, p.materno, p.nombres, p.regimen, p.cargo,
         p.dependencia, p.total, p.anio, p.mes, make_date(p.anio, p.mes, 1) AS ultimo_mes,
         (CASE WHEN COALESCE(p.remuneraciones, 0) + COALESCE(p.honorarios, 0) > 0 THEN COALESCE(p.remuneraciones, 0) + COALESCE(p.honorarios, 0)
               WHEN COALESCE(p.otros, 0) + COALESCE(p.gratificacion, 0) + COALESCE(p.incentivo, 0) = 0 THEN p.total END) AS base,
         COALESCE(p.otros, 0) + COALESCE(p.gratificacion, 0) + COALESCE(p.incentivo, 0) AS extra,
         mef_norm(p.paterno) AS ap1, mef_norm(p.materno) AS ap2
    FROM planilla_pte p
   WHERE p.nombre_norm <> ''
   ORDER BY p.entidad_ruc, p.nombre_norm, p.anio DESC, p.mes DESC, p.total DESC NULLS LAST;
  CREATE TEMP TABLE _plm ON COMMIT DROP AS
  SELECT entidad_ruc, nombre_norm, count(DISTINCT (anio, mes))::int AS meses, min(make_date(anio, mes, 1)) AS primer_mes,
         array_agg(DISTINCT make_date(anio, mes, 1)) AS lista_meses
    FROM planilla_pte WHERE nombre_norm <> '' GROUP BY 1, 2;
  CREATE TEMP TABLE _pls (entidad_ruc text, nombre_norm text, tipo text, severidad text, detalle jsonb) ON COMMIT DROP;
  RAISE NOTICE 'planilla: referencias y personas (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- entidad_gobierno es una vista (expresiones regulares sobre el nombre de cada entidad): materializada una vez. Cruzada
  -- en vivo, el planificador la recalculaba por cada fila (939 mil × 2 400 entidades: 570 s en DEV).
  CREATE TEMP TABLE _eg ON COMMIT DROP AS SELECT ruc::text AS ruc, nivel, ubigeo::text AS ubigeo FROM entidad_gobierno;
  CREATE UNIQUE INDEX ON _eg (ruc);
  ANALYZE _eg;

  -- Gobierno de la entidad el último mes, y su departamento.
  CREATE TEMP TABLE _plg ON COMMIT DROP AS
  SELECT l.entidad_ruc, l.nombre_norm, eg.nivel, eg.ubigeo AS gub, gp.org_nombre, mef_norm(gp.org_nombre) AS gob_n, gp.anio_eleccion,
         left(e.ubigeo, 2) AS dep, mef_norm(z.nombre) AS dep_n, e.nombre AS entidad
    FROM _pl l
    LEFT JOIN entidades e ON e.ruc = l.entidad_ruc
    LEFT JOIN zonas z ON z.ubigeo = left(e.ubigeo, 2)
    LEFT JOIN _eg eg ON eg.ruc = l.entidad_ruc
    LEFT JOIN LATERAL (
      SELECT g.org_nombre, g.anio_eleccion FROM gobierno_periodo g
       WHERE g.nivel = eg.nivel AND g.ubigeo = eg.ubigeo AND l.ultimo_mes BETWEEN g.desde AND g.hasta
       ORDER BY g.anio_eleccion DESC LIMIT 1
    ) gp ON TRUE;
  ANALYZE _pl; ANALYZE _plg;
  RAISE NOTICE 'planilla: gobierno (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- brecha_cargo: el doble o más que la mediana de su cargo en la entidad ese mes (5 o más con ese cargo), y S/ 5,000+.
  INSERT INTO _pls
  SELECT l.entidad_ruc, l.nombre_norm, 'brecha_cargo', 'media',
         jsonb_build_object('anio', l.anio, 'mes', l.mes, 'cargo', l.cargo, 'total', l.base, 'mediana', r.mediana, 'p75', r.p75,
                            'personas', r.personas, 'veces', round(l.base / r.mediana, 1))
    FROM _pl l JOIN cargo_referencia r ON r.entidad_ruc = l.entidad_ruc AND r.anio = l.anio AND r.mes = l.mes AND r.cargo = mef_norm(l.cargo)
   WHERE r.personas >= 5 AND r.mediana > 0 AND l.base >= 2 * r.mediana AND l.base >= 5000;

  -- pago_extraordinario: el mes trae S/ 20,000 o más fuera del sueldo (otros beneficios, gratificación, incentivo) y al
  -- menos el triple del sueldo: una liquidación, un retiro incentivado, un bono. No es irregular por sí mismo.
  INSERT INTO _pls
  SELECT l.entidad_ruc, l.nombre_norm, 'pago_extraordinario', 'baja',
         jsonb_build_object('anio', l.anio, 'mes', l.mes, 'base', l.base, 'extra', l.extra, 'total', l.total)
    FROM _pl l
   WHERE l.extra >= 20000 AND l.extra >= 3 * COALESCE(l.base, 0);

  -- tambien_ordenes / antes_locador: la misma persona (por nombre) recibe órdenes de servicio de la entidad.
  CREATE TEMP TABLE _plo ON COMMIT DROP AS
  SELECT l.entidad_ruc, l.nombre_norm, a.ruc, m.lista_meses, m.primer_mes
    FROM _pl l
    JOIN _plm m ON m.entidad_ruc = l.entidad_ruc AND m.nombre_norm = l.nombre_norm
    JOIN (SELECT DISTINCT entidad_ruc, ruc, nom_n FROM persona_orden_anual) a
      ON a.entidad_ruc = l.entidad_ruc AND a.nom_n = l.nombre_norm;
  ANALYZE _plo;
  RAISE NOTICE 'planilla: cruce con órdenes (% s)', round(extract(epoch FROM clock_timestamp() - t0));
  INSERT INTO _pls
  SELECT x.entidad_ruc, x.nombre_norm, 'tambien_ordenes', 'alta',
         jsonb_build_object('meses', jsonb_agg(DISTINCT to_char(o.mes, 'YYYY-MM')), 'ordenes', count(*), 'monto', sum(o.monto))
    FROM _plo x
    JOIN LATERAL (
      SELECT DISTINCT ON (c.orden, c.fecha_emision) date_trunc('month', c.fecha_emision)::date AS mes, c.monto
        FROM conosce_ordenes c
       WHERE c.ruc_contratista = x.ruc AND c.entidad_ruc = x.entidad_ruc AND c.tipo_orden = 'Orden de Servicio'
         AND c.estado IS DISTINCT FROM 'Anulada' AND c.monto > 0
       ORDER BY c.orden, c.fecha_emision, c.anio DESC, c.mes DESC
    ) o ON o.mes = ANY (x.lista_meses)
   GROUP BY x.entidad_ruc, x.nombre_norm;
  INSERT INTO _pls
  SELECT x.entidad_ruc, x.nombre_norm, 'antes_locador', 'baja',
         jsonb_build_object('primera_orden', min(a.primera), 'ultima_orden_antes', max(a.ultima) FILTER (WHERE a.ultima < x.primer_mes),
                            'primer_mes_planilla', x.primer_mes, 'monto', sum(a.monto))
    FROM _plo x JOIN persona_orden_anual a ON a.entidad_ruc = x.entidad_ruc AND a.ruc = x.ruc
   GROUP BY x.entidad_ruc, x.nombre_norm, x.primer_mes
  HAVING min(a.primera) < x.primer_mes;

  -- candidato_gobierna: candidato (JNE, por nombre y departamento) del partido que gobierna la entidad.
  CREATE TEMP TABLE _cpl ON COMMIT DROP AS
  SELECT mef_norm(c.nombre) AS nom_n, mef_norm(c.region) AS dep_n, mef_norm(c.partido) AS org_n, c.nombre, c.partido, c.cargo,
         c."año" AS anio, c.resultado
    FROM jne_candidaturas c WHERE c.nombre IS NOT NULL AND c.partido IS NOT NULL;
  ANALYZE _cpl;
  INSERT INTO _pls
  SELECT g.entidad_ruc, g.nombre_norm, 'candidato_gobierna', 'alta',
         jsonb_build_object('partido', max(g.org_nombre), 'por', 'nombre',
                            'candidaturas', jsonb_agg(DISTINCT jsonb_build_object('nombre', c.nombre, 'partido', c.partido, 'cargo', c.cargo,
                                                                                 'anio', c.anio, 'resultado', c.resultado)))
    FROM _plg g
    JOIN _cpl c ON c.nom_n = g.nombre_norm AND c.dep_n = g.dep_n
   WHERE g.gob_n IS NOT NULL AND mismo_partido(c.org_n, g.gob_n) AND c.anio BETWEEN g.anio_eleccion - 4 AND g.anio_eleccion
   GROUP BY g.entidad_ruc, g.nombre_norm;
  RAISE NOTICE 'planilla: candidaturas (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- apellidos_autoridad: los dos apellidos de una autoridad electa del gobierno de la entidad (JNE autoridades). Todo
  -- por igualdad (nivel, gobierno, apellidos): un OR en el JOIN sería un bucle de millones × miles.
  CREATE TEMP TABLE _frec_pl ON COMMIT DROP AS
  SELECT ap1, ap2, count(*)::int AS frec FROM (SELECT DISTINCT nombre_norm, ap1, ap2 FROM _pl) x GROUP BY 1, 2;
  CREATE TEMP TABLE _autpl ON COMMIT DROP AS
  SELECT a.nombre, a.cargo, a.organizacion_politica AS partido, mef_norm(a.nombre) AS nom_n,
         split_part(mef_norm(a.nombre), ' ', 1) AS ap1, split_part(mef_norm(a.nombre), ' ', 2) AS ap2,
         a.periodo_inicio AS desde, COALESCE(a.periodo_fin, DATE '2026-12-31') AS hasta,
         CASE WHEN a.cargo ILIKE '%DISTRITAL' THEN 'distrital' WHEN a.cargo ILIKE '%PROVINCIAL' THEN 'provincial' ELSE 'regional' END AS nivel,
         CASE WHEN a.cargo ILIKE '%DISTRITAL' THEN a.ubigeo WHEN a.cargo ILIKE '%PROVINCIAL' THEN left(a.ubigeo, 4) ELSE left(a.ubigeo, 2) END AS gub
    FROM jne_autoridades a
   WHERE a.ubigeo IS NOT NULL AND a.periodo_inicio IS NOT NULL AND a.cargo ~* '(DISTRITAL|PROVINCIAL|REGIONAL)$';
  ANALYZE _autpl;
  INSERT INTO _pls
  SELECT g.entidad_ruc, g.nombre_norm, 'apellidos_autoridad', CASE WHEN min(f.frec) <= 20 THEN 'media' ELSE 'baja' END,
         jsonb_build_object('frecuencia', min(f.frec),
                            'autoridades', jsonb_agg(DISTINCT jsonb_build_object('nombre', a.nombre, 'cargo', a.cargo, 'partido', a.partido)))
    FROM _plg g
    JOIN _pl l ON l.entidad_ruc = g.entidad_ruc AND l.nombre_norm = g.nombre_norm
    JOIN _autpl a ON a.nivel = g.nivel AND a.gub = g.gub AND a.ap1 = l.ap1 AND a.ap2 = l.ap2
    JOIN _frec_pl f ON f.ap1 = l.ap1 AND f.ap2 = l.ap2
   WHERE length(l.ap1) > 1 AND length(l.ap2) > 1 AND a.nom_n <> l.nombre_norm AND l.ultimo_mes BETWEEN a.desde AND a.hasta
   GROUP BY g.entidad_ruc, g.nombre_norm;

  -- apellidos_directivo: los dos apellidos, poco comunes, de un directivo de la misma planilla (no él mismo).
  INSERT INTO _pls
  SELECT l.entidad_ruc, l.nombre_norm, 'apellidos_directivo', 'media',
         jsonb_build_object('frecuencia', min(f.frec),
                            'funcionarios_designados', jsonb_agg(DISTINCT jsonb_build_object(
                              'nombre', trim(COALESCE(d.nombres, '') || ' ' || COALESCE(d.paterno, '') || ' ' || COALESCE(d.materno, '')),
                              'cargo', d.cargo)))
    FROM _pl l
    JOIN _pl d ON d.entidad_ruc = l.entidad_ruc AND d.ap1 = l.ap1 AND d.ap2 = l.ap2 AND d.nombre_norm <> l.nombre_norm
    JOIN _frec_pl f ON f.ap1 = l.ap1 AND f.ap2 = l.ap2
   WHERE f.frec <= 20 AND length(l.ap1) > 1 AND length(l.ap2) > 1 AND es_directivo(d.cargo, d.regimen) AND NOT es_directivo(l.cargo, l.regimen)
   GROUP BY l.entidad_ruc, l.nombre_norm;

  RAISE NOTICE 'planilla: apellidos (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- Resumen.
  DELETE FROM planilla_persona;
  INSERT INTO planilla_persona (entidad_ruc, nombre_norm, paterno, materno, nombres, entidad, dep, regimen, cargo, dependencia, total, meses,
                                primer_mes, ultimo_mes, tipos, senales, n_senales, sev, codigo, base, extra)
  SELECT l.entidad_ruc, l.nombre_norm, l.paterno, l.materno, l.nombres, g.entidad, g.dep, l.regimen, l.cargo, l.dependencia, l.total, m.meses,
         m.primer_mes, l.ultimo_mes,
         COALESCE(s.tipos, '{}'), COALESCE(s.senales, '[]'), COALESCE(s.n, 0), COALESCE(s.sev, 0), cod.codigo, l.base, l.extra
    FROM _pl l
    JOIN _plm m ON m.entidad_ruc = l.entidad_ruc AND m.nombre_norm = l.nombre_norm
    LEFT JOIN _plg g ON g.entidad_ruc = l.entidad_ruc AND g.nombre_norm = l.nombre_norm
    LEFT JOIN (
      SELECT entidad_ruc, nombre_norm, array_agg(tipo ORDER BY tipo) AS tipos, count(*)::int AS n,
             max(CASE severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END)::smallint AS sev,
             jsonb_agg(jsonb_build_object('tipo', tipo, 'severidad', severidad, 'detalle', detalle)
                       ORDER BY CASE severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, tipo) AS senales
        FROM _pls GROUP BY 1, 2
    ) s ON s.entidad_ruc = l.entidad_ruc AND s.nombre_norm = l.nombre_norm
    -- Su ficha de persona contratada, si también es locador: un cruce, no una subconsulta por fila (era 500 s).
    LEFT JOIN (SELECT DISTINCT ON (o.entidad_ruc, o.nombre_norm) o.entidad_ruc, o.nombre_norm, pc.codigo
                 FROM _plo o JOIN persona_codigo pc ON pc.ruc = o.ruc ORDER BY o.entidad_ruc, o.nombre_norm, pc.codigo) cod
           ON cod.entidad_ruc = l.entidad_ruc AND cod.nombre_norm = l.nombre_norm;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'planilla: personas (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- El resumen de cada alcance (lo que GET /planilla devuelve como `resumen`).
  CREATE TEMP TABLE _prb ON COMMIT DROP AS
  SELECT x.alcance, p.total, p.n_senales, p.sev, p.tipos, p.regimen, p.ultimo_mes
    FROM planilla_persona p
    CROSS JOIN LATERAL (SELECT 'pais' AS alcance UNION ALL SELECT 'dep:' || p.dep WHERE p.dep IS NOT NULL
                        UNION ALL SELECT 'ent:' || p.entidad_ruc) x;
  DELETE FROM planilla_resumen;
  INSERT INTO planilla_resumen (alcance, resumen)
  SELECT t.alcance, jsonb_build_object('personas', t.personas, 'totalMes', t.total, 'conSenales', t.con, 'alta', t.alta, 'media', t.media,
                                       'ultimoMes', t.ultimo, 'porSenal', COALESCE(ps.l, '[]'), 'porRegimen', COALESCE(pr.l, '[]'))
    FROM (SELECT alcance, count(*)::int AS personas, COALESCE(sum(total), 0)::float AS total, count(*) FILTER (WHERE n_senales > 0)::int AS con,
                 count(*) FILTER (WHERE sev = 3)::int AS alta, count(*) FILTER (WHERE sev = 2)::int AS media,
                 to_char(max(ultimo_mes), 'YYYY-MM') AS ultimo
            FROM _prb GROUP BY alcance) t
    LEFT JOIN (SELECT alcance, jsonb_agg(jsonb_build_object('tipo', tipo, 'n', c) ORDER BY c DESC) AS l
                 FROM (SELECT alcance, tipo, count(*)::int AS c FROM _prb, unnest(_prb.tipos) tipo GROUP BY 1, 2) z GROUP BY alcance) ps
           ON ps.alcance = t.alcance
    LEFT JOIN (SELECT alcance, jsonb_agg(jsonb_build_object('regimen', regimen, 'n', c) ORDER BY c DESC) AS l
                 FROM (SELECT alcance, regimen, count(*)::int AS c FROM _prb GROUP BY 1, 2) z GROUP BY alcance) pr
           ON pr.alcance = t.alcance;
  RAISE NOTICE 'planilla: listo (% s)', round(extract(epoch FROM clock_timestamp() - t0));
  RETURN n;
END $$;
ALTER FUNCTION refrescar_planilla() OWNER TO vigia_jobs;
