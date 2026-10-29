-- 209 · «Pago extraordinario» contra el sueldo de sus otros meses cuando el mes no trae sueldo.
--
-- En la ficha de una directora general del MIDIS que el usuario pidió ordenar, la señal decía: «Recibió un pago grande fuera
-- de su sueldo: S/ 21,544 fuera del sueldo en set. 2026, con un sueldo de S/ 0». Su sueldo de abril a agosto fue S/ 23,214;
-- en setiembre la entidad puso todo en «otros beneficios» (ese mes ya figura en la planilla del Minedu: es su último pago, no
-- el triple de su sueldo).
-- La regla pide «el triple del sueldo o más» y, sin sueldo ese mes, comparaba contra 0. En PROD (29-oct) eran 105 de las 611
-- señales: 32 por debajo del triple del sueldo de sus otros meses y 18 de personas que nunca traen sueldo aparte.
--
-- Ahora, si ese mes no trae sueldo, el sueldo es la mediana de sus meses con sueldo en la entidad y, si nunca trajo, la
-- mediana de lo que cobró cada mes. El detalle lleva `sueldo_usual` para decirlo en la ficha.
--
-- refrescar_planilla es la de la 202 con ese cambio. Al aplicarla se rehace la señal sobre la planilla de hoy sin correr la
-- cadena entera (~1 h en PROD): pago_extraordinario de planilla_persona y el resumen de cada alcance, como los pasos 7 y 8
-- de la 179. Nada más lee esta señal.

CREATE OR REPLACE FUNCTION refrescar_planilla() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n INT;
  t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_planilla'));
  SET LOCAL work_mem = '256MB';

  -- El último mes que publicó cada entidad: la planilla que se muestra es la de ese mes (quienes trabajan hoy); la
  -- historia entera sólo cuenta los meses de cada persona y desde cuándo está (migración 100: con 21 meses cargados,
  -- todo sobre todo pasaba los 10 min de Hyperdrive).
  -- (Migración 202) El último mes COMPLETO: un mes publicado a medias —con menos de la mitad de la gente que el mes de al
  -- lado, la regla de la 182— no es la planilla de hoy. El GORE Ayacucho publicó setiembre de 2026 con 12 personas, todas
  -- FAG, de 1,190: la lista mostraba esas 12 (45 entidades así, 15 mil personas fuera de su lista).
  CREATE TEMP TABLE _pmx ON COMMIT DROP AS
    SELECT entidad_ruc, anio * 100 + mes AS am, count(DISTINCT nombre_norm) AS personas FROM planilla_pte GROUP BY 1, 2;
  CREATE TEMP TABLE _ult ON COMMIT DROP AS
  SELECT entidad_ruc, (COALESCE(max(am) FILTER (WHERE NOT parcial), max(am)) / 100)::smallint AS anio,
         (COALESCE(max(am) FILTER (WHERE NOT parcial), max(am)) % 100)::smallint AS mes,
         make_date(min(am) / 100, min(am) % 100, 1) AS desde
    FROM (SELECT x.entidad_ruc, x.am,
                 COALESCE(x.personas < 0.5 * LEAST(COALESCE(x.ant, x.sig), COALESCE(x.sig, x.ant)), false) AS parcial
            FROM (SELECT e.*, lag(e.personas) OVER w AS ant, lead(e.personas) OVER w AS sig
                    FROM _pmx e WINDOW w AS (PARTITION BY e.entidad_ruc ORDER BY e.am)) x) y
   GROUP BY entidad_ruc;
  CREATE TEMP TABLE _pult ON COMMIT DROP AS
  SELECT p.*, x.base, x.extra, motivo_planilla_dudosa(p.remuneraciones, p.honorarios, p.incentivo, p.gratificacion, p.otros, p.total) AS dudoso
    FROM planilla_pte p JOIN _ult u ON u.entidad_ruc = p.entidad_ruc AND u.anio = p.anio AND u.mes = p.mes
    CROSS JOIN LATERAL (
      SELECT (CASE WHEN COALESCE(p.remuneraciones, 0) + COALESCE(p.honorarios, 0) > 0 THEN COALESCE(p.remuneraciones, 0) + COALESCE(p.honorarios, 0)
                   WHEN COALESCE(p.otros, 0) + COALESCE(p.gratificacion, 0) + COALESCE(p.incentivo, 0) = 0 THEN p.total END) AS base,
             COALESCE(p.otros, 0) + COALESCE(p.gratificacion, 0) + COALESCE(p.incentivo, 0) AS extra
    ) x;
  ANALYZE _pult;
  RAISE NOTICE 'planilla: último mes de cada entidad (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- Lo que se paga por cargo en cada entidad, su último mes.
  DELETE FROM cargo_referencia;
  INSERT INTO cargo_referencia (entidad_ruc, anio, mes, cargo, personas, mediana, p25, p75, maximo)
  SELECT entidad_ruc, anio, mes, mef_norm(cargo), count(*),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY base), percentile_cont(0.25) WITHIN GROUP (ORDER BY base),
         percentile_cont(0.75) WITHIN GROUP (ORDER BY base), max(base)
    FROM _pult x
   WHERE base > 0 AND cargo IS NOT NULL AND dudoso IS NULL
   GROUP BY entidad_ruc, anio, mes, mef_norm(cargo);

  -- Cada persona en cada entidad: su último mes manda (cargo, régimen, sueldo).
  CREATE TEMP TABLE _pl ON COMMIT DROP AS
  SELECT DISTINCT ON (p.entidad_ruc, p.nombre_norm) p.entidad_ruc, p.nombre_norm, p.paterno, p.materno, p.nombres, p.regimen, p.cargo,
         p.dependencia, p.total, p.anio, p.mes, make_date(p.anio, p.mes, 1) AS ultimo_mes, p.base, p.extra, p.dudoso,
         mef_norm(p.paterno) AS ap1, mef_norm(p.materno) AS ap2
    FROM _pult p
   WHERE p.nombre_norm <> ''
   ORDER BY p.entidad_ruc, p.nombre_norm, p.anio DESC, p.mes DESC, p.total DESC NULLS LAST;
  CREATE TEMP TABLE _plm ON COMMIT DROP AS
  SELECT p.entidad_ruc, p.nombre_norm, count(DISTINCT (p.anio, p.mes))::int AS meses, min(make_date(p.anio, p.mes, 1)) AS primer_mes,
         array_agg(DISTINCT make_date(p.anio, p.mes, 1)) AS lista_meses
    FROM planilla_pte p JOIN _pl l ON l.entidad_ruc = p.entidad_ruc AND l.nombre_norm = p.nombre_norm
   GROUP BY 1, 2;
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
         left(e.ubigeo, 2) AS dep, mef_norm(z.nombre) AS dep_n, COALESCE(e.nombre, dir.nombre) AS entidad
    FROM _pl l
    LEFT JOIN entidades e ON e.ruc = l.entidad_ruc
    -- UGEL, redes de salud, hospitales que no están en `entidades`: el nombre del directorio del PTE (migración 99).
    LEFT JOIN LATERAL (SELECT d.nombre FROM pte_directorio d WHERE d.ruc = l.entidad_ruc ORDER BY d.id_pte LIMIT 1) dir ON TRUE
    LEFT JOIN zonas z ON z.ubigeo = left(e.ubigeo, 2)
    LEFT JOIN _eg eg ON eg.ruc = l.entidad_ruc
    LEFT JOIN LATERAL (
      SELECT g.org_nombre, g.anio_eleccion FROM gobierno_periodo g
       WHERE g.nivel = eg.nivel AND g.ubigeo = eg.ubigeo AND l.ultimo_mes BETWEEN g.desde AND g.hasta
       ORDER BY g.anio_eleccion DESC LIMIT 1
    ) gp ON TRUE;
  ANALYZE _pl; ANALYZE _plg;
  RAISE NOTICE 'planilla: gobierno (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- brecha_cargo: el doble o más que la mediana de su cargo en la entidad ese mes (5 o más con ese cargo), S/ 5,000+, y
  -- pocos con ese cargo ganan tanto (a lo más 10 y el 5 %; si son más, es otro nivel de la escala).
  INSERT INTO _pls
  SELECT x.entidad_ruc, x.nombre_norm, 'brecha_cargo', 'media',
         jsonb_build_object('anio', x.anio, 'mes', x.mes, 'cargo', x.cargo, 'total', x.base, 'mediana', x.mediana, 'p75', x.p75,
                            'personas', x.personas, 'veces', round(x.base / x.mediana, 1), 'ganan_tanto', x.altos)
    FROM (SELECT l.entidad_ruc, l.nombre_norm, l.anio, l.mes, l.cargo, l.base, r.mediana, r.p75, r.personas,
                 count(*) OVER (PARTITION BY l.entidad_ruc, r.cargo) AS altos
            FROM _pl l JOIN cargo_referencia r ON r.entidad_ruc = l.entidad_ruc AND r.anio = l.anio AND r.mes = l.mes AND r.cargo = mef_norm(l.cargo)
           WHERE r.personas >= 5 AND r.mediana > 0 AND l.base >= 2 * r.mediana AND l.base >= 5000 AND l.dudoso IS NULL
             AND r.cargo !~ '^(SIN ?CARGO|NINGUN|SIN ESPECIFICAR|NO REGISTRA|NO FISCALIZADO|OTROS?$)') x
   WHERE x.altos <= greatest(2, least(10, 0.05 * x.personas));

  -- pago_extraordinario: el mes trae S/ 20,000 o más fuera del sueldo (otros beneficios, gratificación, incentivo) y al
  -- menos el triple del sueldo: una liquidación, un retiro incentivado, un bono. No es irregular por sí mismo.
  -- (Migración 209) Si ese mes no trae sueldo (todo vino fuera de él), el sueldo es la mediana de sus meses con sueldo en
  -- la entidad y, si nunca trajo, la mediana de lo que cobró cada mes: comparado contra S/ 0, el último pago de una
  -- directora del MIDIS (S/ 21,544 en «otros beneficios», con un sueldo de S/ 23,214) salía como pago extraordinario.
  INSERT INTO _pls
  SELECT l.entidad_ruc, l.nombre_norm, 'pago_extraordinario', 'baja',
         jsonb_build_object('anio', l.anio, 'mes', l.mes, 'base', l.base, 'extra', l.extra, 'total', l.total)
           || CASE WHEN COALESCE(l.base, 0) = 0 AND r.ref IS NOT NULL THEN jsonb_build_object('sueldo_usual', round(r.ref::numeric, 2))
                   ELSE '{}'::jsonb END
    FROM _pl l
    LEFT JOIN LATERAL (
      SELECT COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY m.sueldo) FILTER (WHERE m.sueldo > 0),
                      percentile_cont(0.5) WITHIN GROUP (ORDER BY m.total)) AS ref
        FROM (SELECT sum(COALESCE(q.remuneraciones, 0) + COALESCE(q.honorarios, 0)) AS sueldo, sum(q.total) AS total
                FROM planilla_pte q
               WHERE COALESCE(l.base, 0) = 0 AND q.entidad_ruc = l.entidad_ruc AND q.nombre_norm = l.nombre_norm
               GROUP BY q.anio, q.mes) m
    ) r ON TRUE
   WHERE l.extra >= 20000 AND l.dudoso IS NULL AND l.extra >= 3 * COALESCE(NULLIF(l.base, 0), r.ref, 0);

  -- tambien_ordenes / antes_locador: la misma persona (por nombre) recibe órdenes de servicio de la entidad.
  CREATE TEMP TABLE _plo ON COMMIT DROP AS
  SELECT l.entidad_ruc, l.nombre_norm, a.ruc, m.lista_meses, m.primer_mes, a.ultima_orden
    FROM _pl l
    JOIN _plm m ON m.entidad_ruc = l.entidad_ruc AND m.nombre_norm = l.nombre_norm
    JOIN (SELECT entidad_ruc, ruc, nom_n, max(ultima) AS ultima_orden FROM persona_orden_anual GROUP BY 1, 2, 3) a
      ON a.entidad_ruc = l.entidad_ruc AND a.nom_n = l.nombre_norm;
  ANALYZE _plo;
  RAISE NOTICE 'planilla: cruce con órdenes (% s)', round(extract(epoch FROM clock_timestamp() - t0));
  INSERT INTO _pls
  SELECT x.entidad_ruc, x.nombre_norm, 'tambien_ordenes', 'alta',
         jsonb_build_object('meses', jsonb_agg(DISTINCT to_char(o.mes, 'YYYY-MM')), 'ordenes', count(*), 'monto', sum(o.monto))
    FROM (SELECT * FROM _plo WHERE ultima_orden >= primer_mes) x
    JOIN LATERAL (
      SELECT DISTINCT ON (c.orden, c.fecha_emision) date_trunc('month', c.fecha_emision)::date AS mes, c.monto
        FROM conosce_ordenes c
       WHERE c.ruc_contratista = x.ruc AND c.entidad_ruc = x.entidad_ruc AND c.tipo_orden = 'Orden de Servicio'
         AND c.estado IS DISTINCT FROM 'Anulada' AND c.monto > 0 AND c.fecha_emision >= x.primer_mes
       ORDER BY c.orden, c.fecha_emision, c.anio DESC, c.mes DESC
    ) o ON o.mes = ANY (x.lista_meses)
   GROUP BY x.entidad_ruc, x.nombre_norm;
  INSERT INTO _pls
  SELECT x.entidad_ruc, x.nombre_norm, 'antes_locador', 'baja',
         jsonb_build_object('primera_orden', min(a.primera), 'ultima_orden_antes', max(a.ultima) FILTER (WHERE a.ultima < x.primer_mes),
                            'primer_mes_planilla', x.primer_mes, 'monto', sum(a.monto))
    FROM _plo x JOIN persona_orden_anual a ON a.entidad_ruc = x.entidad_ruc AND a.ruc = x.ruc
    -- Sólo si entró dentro de los meses cargados: quien figura desde el primero ya estaba antes (migración 101).
    JOIN _ult u ON u.entidad_ruc = x.entidad_ruc AND x.primer_mes > u.desde
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

  -- es_autoridad: la persona ES una autoridad electa del gobierno de la entidad, en su mandato (el alcalde en la planilla
  -- de su municipalidad). Es normal que figure: no es «candidato del que gobierna» (era él mismo) sino un dato.
  CREATE TEMP TABLE _esaut ON COMMIT DROP AS
  SELECT DISTINCT g.entidad_ruc, g.nombre_norm, a.nombre, a.cargo, a.partido, a.desde, a.hasta
    FROM _plg g
    JOIN _pl l ON l.entidad_ruc = g.entidad_ruc AND l.nombre_norm = g.nombre_norm
    JOIN _autpl a ON a.nivel = g.nivel AND a.gub = g.gub AND a.ap1 = l.ap1 AND a.ap2 = l.ap2
   WHERE misma_persona(a.nom_n, l.nombre_norm) AND l.ultimo_mes BETWEEN a.desde AND a.hasta;
  DELETE FROM _pls s USING _esaut e
   WHERE s.tipo = 'candidato_gobierna' AND s.entidad_ruc = e.entidad_ruc AND s.nombre_norm = e.nombre_norm;
  INSERT INTO _pls
  SELECT entidad_ruc, nombre_norm, 'es_autoridad', 'baja',
         jsonb_build_object('autoridades', jsonb_agg(DISTINCT jsonb_build_object('nombre', nombre, 'cargo', cargo, 'partido', partido,
                                                                                'desde', desde, 'hasta', hasta)))
    FROM _esaut GROUP BY entidad_ruc, nombre_norm;
  INSERT INTO _pls
  SELECT g.entidad_ruc, g.nombre_norm, 'apellidos_autoridad', CASE WHEN min(f.frec) <= 20 THEN 'media' ELSE 'baja' END,
         jsonb_build_object('frecuencia', min(f.frec),
                            'autoridades', jsonb_agg(DISTINCT jsonb_build_object('nombre', a.nombre, 'cargo', a.cargo, 'partido', a.partido)))
    FROM _plg g
    JOIN _pl l ON l.entidad_ruc = g.entidad_ruc AND l.nombre_norm = g.nombre_norm
    JOIN _autpl a ON a.nivel = g.nivel AND a.gub = g.gub AND a.ap1 = l.ap1 AND a.ap2 = l.ap2
    JOIN _frec_pl f ON f.ap1 = l.ap1 AND f.ap2 = l.ap2
   WHERE length(l.ap1) > 1 AND length(l.ap2) > 1 AND NOT misma_persona(a.nom_n, l.nombre_norm) AND l.ultimo_mes BETWEEN a.desde AND a.hasta
   GROUP BY g.entidad_ruc, g.nombre_norm;

  -- apellidos_directivo: los dos apellidos, poco comunes, de un directivo de la misma planilla (no él mismo).
  INSERT INTO _pls
  SELECT l.entidad_ruc, l.nombre_norm, 'apellidos_directivo', 'media',
         jsonb_build_object('frecuencia', min(f.frec),
                            'funcionarios_designados', jsonb_agg(DISTINCT jsonb_build_object(
                              'nombre', trim(COALESCE(d.nombres, '') || ' ' || COALESCE(d.paterno, '') || ' ' || COALESCE(d.materno, '')),
                              'cargo', d.cargo)))
    FROM _pl l
    JOIN _pl d ON d.entidad_ruc = l.entidad_ruc AND d.ap1 = l.ap1 AND d.ap2 = l.ap2 AND NOT misma_persona(d.nombre_norm, l.nombre_norm)
    JOIN _frec_pl f ON f.ap1 = l.ap1 AND f.ap2 = l.ap2
   WHERE f.frec <= 20 AND length(l.ap1) > 1 AND length(l.ap2) > 1 AND es_directivo(d.cargo, d.regimen) AND NOT es_directivo(l.cargo, l.regimen)
   GROUP BY l.entidad_ruc, l.nombre_norm;

  RAISE NOTICE 'planilla: apellidos (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- Su ficha: un código al azar por persona y entidad (migración 107), el mismo en cada refresco. Nunca el nombre en la
  -- dirección: el nombre completo lleva el apellido materno, que va tapado. Dos pasadas por si dos códigos chocan.
  INSERT INTO planilla_codigo (entidad_ruc, nombre_norm, codigo)
  SELECT entidad_ruc, nombre_norm, substr(md5(random()::text || clock_timestamp()::text || nombre_norm), 1, 12) FROM _pl
  ON CONFLICT DO NOTHING;
  INSERT INTO planilla_codigo (entidad_ruc, nombre_norm, codigo)
  SELECT entidad_ruc, nombre_norm, substr(md5(random()::text || clock_timestamp()::text || nombre_norm), 1, 12) FROM _pl
  ON CONFLICT DO NOTHING;

  -- Resumen.
  DELETE FROM planilla_persona;
  INSERT INTO planilla_persona (entidad_ruc, nombre_norm, paterno, materno, nombres, entidad, dep, regimen, cargo, dependencia, total, meses,
                                primer_mes, ultimo_mes, tipos, senales, n_senales, sev, codigo, base, extra, dudoso, ficha)
  SELECT l.entidad_ruc, l.nombre_norm, l.paterno, l.materno, l.nombres, g.entidad, g.dep, l.regimen, l.cargo, l.dependencia, l.total, m.meses,
         m.primer_mes, l.ultimo_mes,
         COALESCE(s.tipos, '{}'), COALESCE(s.senales, '[]'), COALESCE(s.n, 0), COALESCE(s.sev, 0), cod.codigo, l.base, l.extra,
         CASE WHEN l.dudoso IS NOT NULL THEN jsonb_build_object('motivo', l.dudoso, 'base', l.base, 'extra', l.extra, 'total', l.total,
                                                                'anio', l.anio, 'mes', l.mes) END,
         pc.codigo
    FROM _pl l
    JOIN _plm m ON m.entidad_ruc = l.entidad_ruc AND m.nombre_norm = l.nombre_norm
    LEFT JOIN _plg g ON g.entidad_ruc = l.entidad_ruc AND g.nombre_norm = l.nombre_norm
    LEFT JOIN planilla_codigo pc ON pc.entidad_ruc = l.entidad_ruc AND pc.nombre_norm = l.nombre_norm
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

  -- (Migración 202) Quienes trabajaron en la entidad en los meses cargados y ya no están en su planilla de hoy: el «Trabajó
  -- antes» de la lista, con su último cargo, régimen, oficina y sueldo, y desde y hasta cuándo figuró. Sin señales. Quien
  -- sólo aparece en un mes posterior publicado a medias no va: no se sabe si está.
  CREATE TEMP TABLE _sal ON COMMIT DROP AS
    SELECT p.entidad_ruc, p.nombre_norm, min(make_date(p.anio, p.mes, 1)) AS primer_mes, max(make_date(p.anio, p.mes, 1)) AS ultimo_mes,
           count(DISTINCT (p.anio, p.mes))::int AS meses
      FROM planilla_pte p
     WHERE p.nombre_norm <> ''
       AND NOT EXISTS (SELECT 1 FROM _pl l WHERE l.entidad_ruc = p.entidad_ruc AND l.nombre_norm = p.nombre_norm)
     GROUP BY 1, 2;
  DELETE FROM _sal s USING _ult u WHERE u.entidad_ruc = s.entidad_ruc AND s.ultimo_mes > make_date(u.anio, u.mes, 1);
  DELETE FROM planilla_salida;
  INSERT INTO planilla_salida (entidad_ruc, nombre_norm, paterno, materno, nombres, regimen, cargo, dependencia, base,
                               primer_mes, ultimo_mes, meses)
  SELECT DISTINCT ON (p.entidad_ruc, p.nombre_norm) p.entidad_ruc, p.nombre_norm, p.paterno, p.materno, p.nombres, p.regimen,
         p.cargo, p.dependencia,
         CASE WHEN COALESCE(p.remuneraciones, 0) + COALESCE(p.honorarios, 0) > 0 THEN COALESCE(p.remuneraciones, 0) + COALESCE(p.honorarios, 0)
              WHEN COALESCE(p.otros, 0) + COALESCE(p.gratificacion, 0) + COALESCE(p.incentivo, 0) = 0 THEN p.total END,
         s.primer_mes, s.ultimo_mes, s.meses
    FROM _sal s
    JOIN planilla_pte p ON p.entidad_ruc = s.entidad_ruc AND p.nombre_norm = s.nombre_norm
                       AND p.anio = extract(year FROM s.ultimo_mes) AND p.mes = extract(month FROM s.ultimo_mes)
   ORDER BY p.entidad_ruc, p.nombre_norm, p.total DESC NULLS LAST;
  ANALYZE planilla_salida;
  RAISE NOTICE 'planilla: trabajaron antes (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- El resumen de cada alcance (lo que GET /planilla devuelve como `resumen`).
  CREATE TEMP TABLE _prb ON COMMIT DROP AS
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

-- La planilla de hoy con la regla nueva (lo que haría refrescar_planilla() sobre su último mes, que es el de planilla_persona).
DO $$
DECLARE
  n_pla INT;
BEGIN
  -- El candado de refrescar_planilla(): si hay un refresco en curso, se espera a que termine y ninguno empieza a la mitad.
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_planilla'));
  CREATE TEMP TABLE _pex ON COMMIT DROP AS
  SELECT p.entidad_ruc, p.nombre_norm,
         jsonb_build_object('tipo', 'pago_extraordinario', 'severidad', 'baja', 'detalle',
           jsonb_build_object('anio', extract(year FROM p.ultimo_mes)::int, 'mes', extract(month FROM p.ultimo_mes)::int,
                              'base', p.base, 'extra', p.extra, 'total', p.total)
             || CASE WHEN COALESCE(p.base, 0) = 0 AND r.ref IS NOT NULL THEN jsonb_build_object('sueldo_usual', round(r.ref::numeric, 2))
                     ELSE '{}'::jsonb END) AS s
    FROM planilla_persona p
    LEFT JOIN LATERAL (
      SELECT COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY m.sueldo) FILTER (WHERE m.sueldo > 0),
                      percentile_cont(0.5) WITHIN GROUP (ORDER BY m.total)) AS ref
        FROM (SELECT sum(COALESCE(q.remuneraciones, 0) + COALESCE(q.honorarios, 0)) AS sueldo, sum(q.total) AS total
                FROM planilla_pte q
               WHERE COALESCE(p.base, 0) = 0 AND q.entidad_ruc = p.entidad_ruc AND q.nombre_norm = p.nombre_norm
               GROUP BY q.anio, q.mes) m
    ) r ON TRUE
   WHERE p.extra >= 20000 AND p.dudoso IS NULL AND p.extra >= 3 * COALESCE(NULLIF(p.base, 0), r.ref, 0);

  -- Las filas tocadas: se quita la señal vieja y se pone la nueva (si sigue).
  CREATE TEMP TABLE _pextoc ON COMMIT DROP AS
    SELECT entidad_ruc, nombre_norm FROM planilla_persona WHERE tipos && ARRAY['pago_extraordinario']
    UNION SELECT entidad_ruc, nombre_norm FROM _pex;
  UPDATE planilla_persona p
     SET senales = x.senales, tipos = x.tipos, n_senales = x.n, sev = x.sev
    FROM (
      SELECT t.entidad_ruc, t.nombre_norm,
             COALESCE(jsonb_agg(e.s ORDER BY CASE e.s->>'severidad' WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, e.s->>'tipo')
                        FILTER (WHERE e.s IS NOT NULL), '[]'::jsonb) AS senales,
             COALESCE(array_agg(DISTINCT e.s->>'tipo') FILTER (WHERE e.s IS NOT NULL), '{}') AS tipos,
             count(e.s)::int AS n,
             COALESCE(max(CASE e.s->>'severidad' WHEN 'alta' THEN 3 WHEN 'media' THEN 2 WHEN 'baja' THEN 1 END), 0)::smallint AS sev
        FROM _pextoc t
        JOIN planilla_persona pp ON pp.entidad_ruc = t.entidad_ruc AND pp.nombre_norm = t.nombre_norm
        LEFT JOIN LATERAL (
          SELECT s FROM jsonb_array_elements(pp.senales) s WHERE s->>'tipo' <> 'pago_extraordinario'
          UNION ALL
          SELECT n.s FROM _pex n WHERE n.entidad_ruc = t.entidad_ruc AND n.nombre_norm = t.nombre_norm
        ) e ON true
       GROUP BY t.entidad_ruc, t.nombre_norm) x
   WHERE p.entidad_ruc = x.entidad_ruc AND p.nombre_norm = x.nombre_norm;
  GET DIAGNOSTICS n_pla = ROW_COUNT;

  -- El resumen de cada alcance de la planilla (como al final de refrescar_planilla()).
  CREATE TEMP TABLE _pexrb ON COMMIT DROP AS
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
            FROM _pexrb GROUP BY alcance) t
    LEFT JOIN (SELECT alcance, jsonb_agg(jsonb_build_object('tipo', tipo, 'n', c) ORDER BY c DESC) AS l
                 FROM (SELECT alcance, tipo, count(*)::int AS c FROM _pexrb, unnest(_pexrb.tipos) tipo GROUP BY 1, 2) z GROUP BY alcance) ps
           ON ps.alcance = t.alcance
    LEFT JOIN (SELECT alcance, jsonb_agg(jsonb_build_object('regimen', regimen, 'n', c) ORDER BY c DESC) AS l
                 FROM (SELECT alcance, regimen, count(*)::int AS c FROM _pexrb GROUP BY 1, 2) z GROUP BY alcance) pr
           ON pr.alcance = t.alcance;
  RAISE NOTICE 'pago extraordinario: % filas de planilla tocadas, % con la señal', n_pla, (SELECT count(*) FROM _pex);
END $$;
