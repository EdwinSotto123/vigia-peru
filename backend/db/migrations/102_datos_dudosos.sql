-- 102 · Datos dudosos de todas las fuentes: se guardan tal como los publicó el Estado, con su motivo, y la web los
--       muestra con una bandera («posible error de carga»). No se suman ni entran en medianas ni señales.
--
-- Pedido del usuario (2026-10-21): "mandemos a la BBDD de Vigía y mostremos, pero con un flag de posible error de subida
-- de datos, de todas las fuentes". Lo que se midió ese día:
--   · CONOSCE, órdenes: 956 con monto dudoso (migración 98) y 321 que la 97 dejó en NULL sin guardar el original (2018-2021:
--     se recuperan recargando esos meses). Ahora cada una dice por qué (`dudoso_motivo`).
--   · Portal de Transparencia, planilla: 132 sueldos de S/ 100 mil o más en un mes (S/ 46,463,890 a un gerente de una
--     municipalidad, S/ 2,000,000 a un jefe de tesorería), 17 montos negativos, totales que no cuadran con sus partes
--     (S/ 2,648,803 con partes de S/ 4,182). El sueldo más alto del Estado no llega a S/ 40 mil al mes.
--   · OECE, adjudicaciones: 27 de 20 veces o más su valor referencial; varias con valor referencial de S/ 1 o S/ 0.01
--     (no se publicó el real) y otras justo 100 veces (decimales corridos). En ONPE (aportes) y en los valores
--     referenciales no hubo casos con estas reglas.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/102_datos_dudosos.sql (después de la 101);
-- luego refrescar_planilla() y refrescar_contratos_dudosos().

-- ── 1 · Órdenes de CONOSCE: el motivo ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE conosce_ordenes ADD COLUMN IF NOT EXISTS dudoso_motivo TEXT;

-- Por qué un monto de una orden no se puede creer (NULL si se puede). El orden importa: el RUC o el número escritos
-- como monto explican también los que pasan de S/ 100 M.
CREATE OR REPLACE FUNCTION motivo_monto_orden(p_monto numeric, p_ruc text, p_nro text, p_tipo text, p_fecha date) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_monto IS NULL THEN NULL
    WHEN p_monto > 1000000 AND p_ruc ~ '^\d{11}$' AND p_monto = p_ruc::numeric THEN 'igual_ruc'
    WHEN p_monto > 1000000 AND p_nro ~ '^\d{1,15}$' AND p_monto = p_nro::numeric THEN 'igual_numero'
    WHEN p_monto > 100000000 THEN 'mayor_100m'
    -- "hasta N UIT": 20 veces el tope o más.
    WHEN p_tipo ILIKE 'Contrataciones hasta%' AND p_fecha IS NOT NULL
         AND p_monto > 20 * COALESCE(substring(p_tipo FROM 'hasta (\d+) UIT')::int, 8) * uit_soles(extract(year FROM p_fecha)::int) THEN 'tope_uit'
    -- sin proceso de selección, a una persona natural, más de S/ 1 M.
    WHEN p_monto > 1000000 AND p_ruc ~ '^10\d{9}$' AND p_tipo ILIKE 'Otras contrataciones%' THEN 'persona_sin_proceso'
  END
$$;
ALTER FUNCTION motivo_monto_orden(numeric, text, text, text, date) OWNER TO vigia_jobs;

CREATE OR REPLACE FUNCTION limpiar_montos_ordenes(p_anio int DEFAULT NULL, p_mes int DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  UPDATE conosce_ordenes o SET monto_dudoso = o.monto, monto = NULL, dudoso_motivo = x.motivo
    FROM (SELECT ctid, motivo_monto_orden(monto, ruc_contratista, nro_orden, tipo_contratacion, fecha_emision) AS motivo
            FROM conosce_ordenes
           WHERE monto IS NOT NULL AND (p_anio IS NULL OR anio = p_anio) AND (p_mes IS NULL OR mes = p_mes)) x
   WHERE o.ctid = x.ctid AND x.motivo IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION limpiar_montos_ordenes(int, int) OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION limpiar_montos_ordenes(int, int) FROM PUBLIC;

-- Los que ya estaban (migración 98) reciben su motivo. Un índice parcial: son ~1 mil de 29 M.
CREATE INDEX IF NOT EXISTS conosce_ordenes_dudoso ON conosce_ordenes (anio, mes) WHERE monto_dudoso IS NOT NULL;
UPDATE conosce_ordenes SET dudoso_motivo = motivo_monto_orden(monto_dudoso, ruc_contratista, nro_orden, tipo_contratacion, fecha_emision)
 WHERE monto_dudoso IS NOT NULL AND dudoso_motivo IS NULL;

-- ── 2 · Planilla: el motivo de una fila que no se puede creer ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION motivo_planilla_dudosa(p_rem numeric, p_hon numeric, p_inc numeric, p_gra numeric, p_otros numeric, p_total numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN least(COALESCE(p_rem, 0), COALESCE(p_hon, 0), COALESCE(p_inc, 0), COALESCE(p_gra, 0), COALESCE(p_otros, 0), COALESCE(p_total, 0)) < 0 THEN 'negativo'
    -- El total no sale de sus partes (S/ 2,648,803 con partes de S/ 4,182).
    WHEN p_total >= 100000 AND p_total > 5 * (COALESCE(p_rem, 0) + COALESCE(p_hon, 0) + COALESCE(p_inc, 0) + COALESCE(p_gra, 0) + COALESCE(p_otros, 0)) THEN 'total_no_cuadra'
    WHEN p_total >= 1000000 THEN 'mes_1m'
    -- Un sueldo de S/ 100 mil o más en un mes: el más alto del Estado no llega a S/ 40 mil.
    WHEN COALESCE(p_rem, 0) + COALESCE(p_hon, 0) >= 100000 THEN 'sueldo_100k'
  END
$$;
ALTER FUNCTION motivo_planilla_dudosa(numeric, numeric, numeric, numeric, numeric, numeric) OWNER TO vigia_jobs;

ALTER TABLE planilla_persona ADD COLUMN IF NOT EXISTS dudoso JSONB;

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
  CREATE TEMP TABLE _ult ON COMMIT DROP AS
  SELECT entidad_ruc, (max(anio * 100 + mes) / 100)::smallint AS anio, (max(anio * 100 + mes) % 100)::smallint AS mes,
         make_date(min(anio * 100 + mes) / 100, min(anio * 100 + mes) % 100, 1) AS desde
    FROM planilla_pte GROUP BY entidad_ruc;
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
  INSERT INTO _pls
  SELECT l.entidad_ruc, l.nombre_norm, 'pago_extraordinario', 'baja',
         jsonb_build_object('anio', l.anio, 'mes', l.mes, 'base', l.base, 'extra', l.extra, 'total', l.total)
    FROM _pl l
   WHERE l.extra >= 20000 AND l.extra >= 3 * COALESCE(l.base, 0) AND l.dudoso IS NULL;

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
                                primer_mes, ultimo_mes, tipos, senales, n_senales, sev, codigo, base, extra, dudoso)
  SELECT l.entidad_ruc, l.nombre_norm, l.paterno, l.materno, l.nombres, g.entidad, g.dep, l.regimen, l.cargo, l.dependencia, l.total, m.meses,
         m.primer_mes, l.ultimo_mes,
         COALESCE(s.tipos, '{}'), COALESCE(s.senales, '[]'), COALESCE(s.n, 0), COALESCE(s.sev, 0), cod.codigo, l.base, l.extra,
         CASE WHEN l.dudoso IS NOT NULL THEN jsonb_build_object('motivo', l.dudoso, 'base', l.base, 'extra', l.extra, 'total', l.total,
                                                                'anio', l.anio, 'mes', l.mes) END
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

-- ── 3 · Contratos del OECE: lo adjudicado frente al valor referencial ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contrato_dudoso (
  ocid          TEXT PRIMARY KEY,
  motivo        TEXT NOT NULL,          -- referencial_simbolico | adjudicado_20x
  referencial   NUMERIC,
  adjudicado    NUMERIC,                -- la adjudicación más grande del proceso, en soles
  detectado_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE contrato_dudoso OWNER TO vigia_jobs;
GRANT SELECT ON contrato_dudoso TO vigia_api, vigia_api_admin;

-- Una sola adjudicación (no la suma: varios ítems suman su parte) de 20 veces o más el valor referencial de TODO el
-- proceso, y más de S/ 1 M; o un valor referencial de S/ 1 o menos con una adjudicación de más de S/ 100 mil. Sólo en
-- soles (en yenes o dólares la diferencia es la moneda).
CREATE OR REPLACE FUNCTION refrescar_contratos_dudosos() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_contratos_dudosos'));
  CREATE TEMP TABLE _cd ON COMMIT DROP AS
  SELECT ocid, CASE WHEN cr <= 1 THEN 'referencial_simbolico' ELSE 'adjudicado_20x' END AS motivo, cr, adj
    FROM (SELECT c.ocid, c.cuantia_referencial AS cr, max((aw->'value'->>'amount')::numeric) AS adj
            FROM convocatorias c
            CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(COALESCE(c.ocds_payload->'awards', c.adjudicaciones)) = 'array'
                                                         THEN COALESCE(c.ocds_payload->'awards', c.adjudicaciones) ELSE '[]'::jsonb END) aw
           WHERE c.cuantia_referencial > 0
             AND aw->'value'->>'amount' ~ '^[0-9]+(\.[0-9]+)?$' AND COALESCE(aw->'value'->>'currency', 'PEN') = 'PEN'
           GROUP BY c.ocid, c.cuantia_referencial) x
   WHERE (cr <= 1 AND adj > 100000) OR (cr > 1 AND adj >= 20 * cr AND adj > 1000000);
  DELETE FROM contrato_dudoso d WHERE NOT EXISTS (SELECT 1 FROM _cd WHERE _cd.ocid = d.ocid);
  INSERT INTO contrato_dudoso (ocid, motivo, referencial, adjudicado)
  SELECT ocid, motivo, cr, adj FROM _cd
  ON CONFLICT (ocid) DO UPDATE SET motivo = EXCLUDED.motivo, referencial = EXCLUDED.referencial, adjudicado = EXCLUDED.adjudicado;
  SELECT count(*) INTO n FROM contrato_dudoso;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_contratos_dudosos() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_contratos_dudosos() FROM PUBLIC;
