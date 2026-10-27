-- 177 · Aportó o financió la campaña del que gobierna, y después trabajó ahí: locadores, planilla y ministerios.
--
-- El dueño (2026-10-27): «¿se puede hallar cosas como financió a la autoridad, aportó al partido, y luego obtuvo trabajo
-- en planilla? Para municipios, gobiernos y ministerios también». Lo que había:
--   · locadores (órdenes de servicio, por DNI): «Aportó al que gobierna» y «Candidato del que gobierna», sólo en
--     municipalidades y gobiernos regionales;
--   · planilla (sin DNI): sólo «Candidato del que gobierna»;
--   · ministerios y demás del Ejecutivo: nada, porque no tenían «partido que gobierna».
-- Esta migración agrega:
--   1. gobierno_nacional_periodo: el partido del Presidente en cada tramo. Sin partido no hay tramo: Vizcarra (2018-2020),
--      Merino (5 días), Castillo desde que renunció a Perú Libre (30 jun. 2022) y Boluarte (2022-2025, expulsada de Perú
--      Libre antes de asumir). Desde el 28 jul. 2026 falta: el resultado oficial de las EG 2026 no está en la base.
--   2. entidad_ejecutivo_nacional: las entidades del Gobierno Nacional del MEF (por su unidad ejecutora en el SIAF, el
--      cruce oficial de la OECE) sin los organismos autónomos (Poder Judicial, Contraloría, Defensoría, JNJ, Ministerio
--      Público, TC, Fuero Militar Policial, Congreso, JNE, ONPE, RENIEC) ni las universidades.
--   3. financio_campana (alta): aportó a la campaña de la organización en la elección que la puso a gobernar (ONPE, nivel
--      «campaña», el mismo proceso: ERM 2018, ERM 2022, EG 2021) y después trabajó para esa entidad durante ese gobierno.
--      Los aportes de la ONPE van a la organización, no a un candidato con nombre: es «la campaña del que gobierna».
--   4. En la planilla, por nombre completo (no trae DNI): financio_campana y aporte_gobierna, sólo con nombres sin
--      homónimos (un solo DNI entre los aportantes, y en a lo más dos entidades de la planilla).
--   5. En el Ejecutivo nacional: candidato_gobierna y aporte_gobierna (media: un ministerio es grande y el lazo con el
--      partido del Presidente es más débil que con el del alcalde) y financio_campana, para locadores y planilla.
--
-- refrescar_senales_politicas() es un paso aparte, como refrescar_nepotismo_senal() (137): corre DESPUÉS de
-- refrescar_personas_senales() y de refrescar_planilla() (que rehacen sus tablas enteras), inserta lo suyo y parcha
-- persona_entidad, planilla_persona y planilla_resumen. Lo llaman los Workers de scrapers (conosce_ordenes, pte_personal).
--
-- Indicios, no acusaciones: aportar o postular por un partido es legal; lo que se señala es la coincidencia con un
-- trabajo pagado por el gobierno de ese partido.
--
-- Cómo aplicarla: python infrastructure/dev/dev.py migrar backend/db/migrations/177_aportes_y_trabajo.sql (DEV) y luego
-- SELECT refrescar_senales_politicas(); refrescar_personas_resumen(); en producción, lo mismo con tunel_rds.

-- ── 1. El partido del Presidente, por tramo ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gobierno_nacional_periodo (
  desde       DATE PRIMARY KEY,
  hasta       DATE NOT NULL,
  presidente  TEXT NOT NULL,
  org_nombre  TEXT NOT NULL,       -- como lo escribe la ONPE
  eleccion    TEXT,                -- el proceso ONPE de la campaña que lo llevó al cargo; NULL si asumió por sucesión
  nota        TEXT
);
ALTER TABLE gobierno_nacional_periodo OWNER TO vigia_jobs;
GRANT SELECT ON gobierno_nacional_periodo TO vigia_api, vigia_api_admin, vigia_mcp;
INSERT INTO gobierno_nacional_periodo (desde, hasta, presidente, org_nombre, eleccion, nota) VALUES
  ('2016-07-28', '2018-03-23', 'Pedro Pablo Kuczynski', 'PERUANOS POR EL KAMBIO', 'EG2016',
   'Elegido en las Elecciones Generales 2016; renunció el 23 de marzo de 2018.'),
  ('2020-11-17', '2021-07-28', 'Francisco Sagasti', 'PARTIDO MORADO', NULL,
   'Presidente del Congreso que asumió por sucesión.'),
  ('2021-07-28', '2022-06-30', 'Pedro Castillo', 'PARTIDO POLITICO NACIONAL PERU LIBRE', 'EG2021',
   'Elegido en las Elecciones Generales 2021; renunció a Perú Libre el 30 de junio de 2022.'),
  ('2025-10-10', '2026-07-28', 'José Jerí', 'PARTIDO DEMOCRATICO SOMOS PERU', NULL,
   'Presidente del Congreso que asumió tras la vacancia de Dina Boluarte.')
ON CONFLICT (desde) DO UPDATE SET hasta = EXCLUDED.hasta, presidente = EXCLUDED.presidente, org_nombre = EXCLUDED.org_nombre,
                                  eleccion = EXCLUDED.eleccion, nota = EXCLUDED.nota;

-- ── 2. El Ejecutivo nacional ─────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW entidad_ejecutivo_nacional AS
SELECT DISTINCT btrim(s.ruc::text) AS ruc
  FROM entidad_siaf s
  JOIN LATERAL (
    SELECT m.nivel_gobierno, m.sector, m.pliego_nombre
      FROM mef_ejecutora_anual m WHERE m.sec_ejec = s.sec_ejec::text ORDER BY m.anio DESC LIMIT 1
  ) m ON true
 WHERE m.nivel_gobierno = 'E'
   AND m.sector NOT IN ('04', '19', '20', '21', '22', '24', '27', '28', '31', '32', '33')
   -- Las universidades (autónomas): el MEF las nombra «U.N. AGRARIA LA MOLINA», la OECE con su nombre entero.
   AND m.pliego_nombre !~* '(UNIVERSIDAD|^U\.\s*N\.)' AND COALESCE(s.nombre, '') !~* 'UNIVERSIDAD';
ALTER VIEW entidad_ejecutivo_nacional OWNER TO vigia_jobs;
GRANT SELECT ON entidad_ejecutivo_nacional TO vigia_api, vigia_api_admin, vigia_mcp;

-- ── 3. Las señales ───────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refrescar_senales_politicas() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n_loc int := 0; n_pla int := 0; t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_senales_politicas'));
  SET LOCAL work_mem = '256MB';

  -- A. El gobierno de cada entidad en cada tramo: el local (gobierno_periodo por el nivel y el ubigeo de su gobierno) y el
  --    nacional (el partido del Presidente, en el Ejecutivo). `eleccion` = el proceso ONPE de la campaña que lo eligió.
  CREATE TEMP TABLE _sgp ON COMMIT DROP AS
    SELECT eg.ruc, g.nivel, g.desde, g.hasta, g.org_nombre, mef_norm(g.org_nombre) AS gob_n, 'ERM' || g.anio_eleccion AS eleccion,
           NULL::text AS presidente
      FROM (SELECT ruc::text AS ruc, nivel, ubigeo::text AS ubigeo FROM entidad_gobierno) eg
      JOIN gobierno_periodo g ON g.nivel = eg.nivel AND g.ubigeo = eg.ubigeo
     WHERE g.org_nombre IS NOT NULL
    UNION ALL
    SELECT en.ruc, 'nacional', gn.desde, gn.hasta, gn.org_nombre, mef_norm(gn.org_nombre), gn.eleccion, gn.presidente
      FROM entidad_ejecutivo_nacional en CROSS JOIN gobierno_nacional_periodo gn;
  CREATE INDEX ON _sgp (ruc);
  ANALYZE _sgp;

  -- B. Aportes (ONPE Claridad, con DNI) y candidaturas con DNI (ONPE; JNE cuando lo trae).
  CREATE TEMP TABLE _sap ON COMMIT DROP AS
    SELECT a.id, a.numero_documento AS dni, mef_norm(a.nombre) AS nom_n, a.nombre, a.partido, mef_norm(a.partido) AS partido_n,
           a.proceso, a.nivel, a.fecha_aporte AS fecha, a."año" AS anio, a.monto
      FROM onpe_aportantes a
     WHERE a.partido IS NOT NULL AND a.numero_documento ~ '^\d{8}$';
  CREATE INDEX ON _sap (dni);
  CREATE INDEX ON _sap (nom_n);
  ANALYZE _sap;
  CREATE TEMP TABLE _sca ON COMMIT DROP AS
    SELECT DISTINCT dni, nom_n, org_n, partido, cargo, anio, resultado, nombre FROM (
      SELECT c.dni, mef_norm(c.apellidos || ' ' || c.nombres) AS nom_n, mef_norm(c.organizacion) AS org_n, c.organizacion AS partido,
             NULL::text AS cargo, substring(c.proceso FROM '\d{4}')::int AS anio, NULL::text AS resultado, c.apellidos || ' ' || c.nombres AS nombre
        FROM onpe_candidatos c WHERE c.dni ~ '^\d{8}$' AND c.organizacion IS NOT NULL
      UNION ALL
      SELECT j.numero_documento, mef_norm(j.nombre), mef_norm(j.partido), j.partido, j.cargo, j."año", j.resultado, j.nombre
        FROM jne_candidaturas j WHERE j.numero_documento ~ '^\d{8}$' AND j.partido IS NOT NULL) x;
  CREATE INDEX ON _sca (dni);
  ANALYZE _sca;
  RAISE NOTICE 'senales politicas: gobiernos, aportes y candidaturas (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- C. Locadores: cada entidad × persona × gobierno en que recibió órdenes, sólo para quien aportó o postuló.
  CREATE TEMP TABLE _sdni ON COMMIT DROP AS SELECT dni FROM _sap UNION SELECT dni FROM _sca;
  CREATE TEMP TABLE _slo ON COMMIT DROP AS
    SELECT po.entidad_ruc, po.ruc, substr(po.ruc, 3, 8) AS dni, g.nivel, g.desde, g.hasta, g.org_nombre, g.gob_n, g.eleccion, g.presidente
      FROM persona_orden_anual po
      JOIN _sgp g ON g.ruc = po.entidad_ruc AND po.ultima >= g.desde AND po.primera <= g.hasta
     WHERE po.ruc LIKE '10%' AND substr(po.ruc, 3, 8) IN (SELECT dni FROM _sdni)
     GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10;
  ANALYZE _slo;

  -- Los pares que hoy llevan estas señales (para rehacer su resumen aunque se queden sin ninguna).
  CREATE TEMP TABLE _spar ON COMMIT DROP AS
    SELECT DISTINCT entidad_ruc, ruc FROM persona_senal
     WHERE tipo = 'financio_campana' OR (tipo IN ('candidato_gobierna', 'aporte_gobierna') AND detalle->>'nivel' = 'nacional');
  DELETE FROM persona_senal WHERE tipo = 'financio_campana' OR (tipo IN ('candidato_gobierna', 'aporte_gobierna') AND detalle->>'nivel' = 'nacional');

  -- Los aportes al partido de cada gobierno en que trabajó (de campaña de su elección o no).
  CREATE TEMP TABLE _sla ON COMMIT DROP AS
    SELECT l.*, a.id, a.partido, a.monto, a.fecha, a.anio, a.proceso, a.nivel AS nivel_aporte, a.nombre,
           (a.nivel = 'campaña' AND a.proceso = l.eleccion) AS de_su_campana
      FROM _slo l JOIN _sap a ON a.dni = l.dni
     WHERE mismo_partido(a.partido_n, l.gob_n)
       AND (l.nivel <> 'nacional' OR a.anio BETWEEN extract(year FROM l.desde)::int - 5 AND extract(year FROM l.hasta)::int);
  -- Las órdenes de cada par durante ese gobierno, contadas de verdad (CONOSCE, una vez cada orden).
  CREATE TEMP TABLE _slord ON COMMIT DROP AS
    SELECT p.entidad_ruc, p.ruc, p.desde, o.primera, o.ultima, o.ordenes, o.monto
      FROM (SELECT DISTINCT entidad_ruc, ruc, desde, hasta FROM _sla WHERE de_su_campana) p
      CROSS JOIN LATERAL (
        SELECT min(x.fecha_emision) AS primera, max(x.fecha_emision) AS ultima, count(*)::int AS ordenes, sum(x.monto) AS monto
          FROM (SELECT DISTINCT ON (c.orden, c.fecha_emision) c.fecha_emision, c.monto
                  FROM conosce_ordenes c
                 WHERE c.ruc_contratista = p.ruc AND c.entidad_ruc = p.entidad_ruc AND c.tipo_orden = 'Orden de Servicio'
                   AND c.estado IS DISTINCT FROM 'Anulada' AND c.monto > 0 AND c.fecha_emision BETWEEN p.desde AND p.hasta
                 ORDER BY c.orden, c.fecha_emision, c.anio DESC, c.mes DESC) x) o
     WHERE o.ordenes > 0;

  -- C1. financio_campana: aportó a la campaña que puso a ese gobierno y después recibió sus órdenes (todas las órdenes
  --     son del gobierno ya instalado, es decir, posteriores a la campaña). El detalle trae todos sus aportes a ese partido.
  -- Un aporte cuenta una vez aunque trabajara en dos gobiernos del mismo partido (sus filas en _sla se repiten por tramo).
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  WITH ap AS (
    SELECT entidad_ruc, ruc, id, max(nombre) AS nombre, max(partido) AS partido, max(monto) AS monto, max(fecha) AS fecha,
           max(anio) AS anio, max(proceso) AS proceso, bool_or(de_su_campana) AS campana
      FROM _sla GROUP BY entidad_ruc, ruc, id),
  gob AS (
    -- El gobierno cuya campaña financió (el más reciente, si fueron dos).
    SELECT DISTINCT ON (entidad_ruc, ruc) entidad_ruc, ruc, org_nombre, nivel, presidente, eleccion, desde, hasta
      FROM _sla WHERE de_su_campana ORDER BY entidad_ruc, ruc, desde DESC),
  o AS (SELECT entidad_ruc, ruc, min(primera) AS primera, sum(ordenes)::int AS ordenes, sum(monto) AS monto FROM _slord GROUP BY 1, 2)
  SELECT g.entidad_ruc, g.ruc, 'financio_campana', 'alta',
         jsonb_build_object('partido', g.org_nombre, 'nivel', g.nivel, 'presidente', g.presidente, 'eleccion', g.eleccion,
                            'gobierno_desde', g.desde, 'gobierno_hasta', g.hasta,
                            'primera_orden', o.primera, 'ordenes', o.ordenes, 'monto_ordenes', o.monto,
                            'monto', x.monto, 'aportes', x.aportes),
         'onpe_aportantes', 'https://claridad.onpe.gob.pe/'
    FROM gob g
    JOIN o ON o.entidad_ruc = g.entidad_ruc AND o.ruc = g.ruc
    CROSS JOIN LATERAL (
      SELECT sum(ap.monto) AS monto,
             jsonb_agg(jsonb_build_object('nombre', ap.nombre, 'partido', ap.partido, 'monto', ap.monto, 'fecha', ap.fecha,
                                          'anio', ap.anio, 'proceso', ap.proceso, 'campana', ap.campana) ORDER BY ap.fecha) AS aportes
        FROM ap WHERE ap.entidad_ruc = g.entidad_ruc AND ap.ruc = g.ruc) x;
  GET DIAGNOSTICS n_loc = ROW_COUNT;
  -- Quien ya tiene financio_campana no repite su aporte como aporte_gobierna (el detalle de arriba los trae todos).
  DELETE FROM persona_senal s USING (SELECT entidad_ruc, ruc FROM persona_senal WHERE tipo = 'financio_campana') f
   WHERE s.tipo = 'aporte_gobierna' AND s.entidad_ruc = f.entidad_ruc AND s.ruc = f.ruc;

  -- C2. En el Ejecutivo nacional: candidato y aporte al partido del Presidente (media), como en lo local.
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT l.entidad_ruc, l.ruc, 'candidato_gobierna', 'media',
         jsonb_build_object('partido', max(l.org_nombre), 'nivel', 'nacional', 'presidente', max(l.presidente), 'por', 'dni',
                            'gobierno_desde', min(l.desde), 'gobierno_hasta', max(l.hasta), 'anios', jsonb_agg(DISTINCT extract(year FROM l.desde)::int),
                            'candidaturas', jsonb_agg(DISTINCT jsonb_build_object('nombre', c.nombre, 'partido', c.partido, 'cargo', c.cargo,
                                                                                 'anio', c.anio, 'resultado', c.resultado))),
         'onpe_candidatos', 'https://claridad.onpe.gob.pe/'
    FROM _slo l JOIN _sca c ON c.dni = l.dni
   WHERE l.nivel = 'nacional' AND mismo_partido(c.org_n, l.gob_n)
     AND c.anio BETWEEN extract(year FROM l.desde)::int - 5 AND extract(year FROM l.hasta)::int + 1
   GROUP BY l.entidad_ruc, l.ruc;
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT a.entidad_ruc, a.ruc, 'aporte_gobierna', 'media',
         jsonb_build_object('partido', max(a.org_nombre), 'nivel', 'nacional', 'presidente', max(a.presidente), 'monto', sum(a.monto),
                            'gobierno_desde', min(a.desde), 'gobierno_hasta', max(a.hasta),
                            'aportes', jsonb_agg(DISTINCT jsonb_build_object('nombre', a.nombre, 'partido', a.partido, 'monto', a.monto,
                                                                             'fecha', a.fecha, 'anio', a.anio, 'proceso', a.proceso))),
         'onpe_aportantes', 'https://claridad.onpe.gob.pe/'
    FROM _sla a
   WHERE a.nivel = 'nacional'
     AND NOT EXISTS (SELECT 1 FROM persona_senal f WHERE f.entidad_ruc = a.entidad_ruc AND f.ruc = a.ruc AND f.tipo = 'financio_campana')
   GROUP BY a.entidad_ruc, a.ruc;
  -- En el Ejecutivo, refrescar_personas_senales() no conoce al partido del Presidente y marca ese aporte o esa candidatura
  -- como «a otro partido» (baja): si todo lo que lista es del partido que ahora sí gobierna, sale (ya está arriba).
  DELETE FROM persona_senal a
   USING (SELECT entidad_ruc, ruc, max(detalle->>'partido') AS partido FROM persona_senal
           WHERE tipo = 'financio_campana' OR (tipo IN ('aporte_gobierna', 'candidato_gobierna') AND detalle->>'nivel' = 'nacional')
           GROUP BY 1, 2) g
   WHERE a.entidad_ruc = g.entidad_ruc AND a.ruc = g.ruc AND a.tipo IN ('aporte', 'candidato')
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(a.detalle->CASE a.tipo WHEN 'aporte' THEN 'aportes' ELSE 'candidaturas' END, '[]')) x
                      WHERE NOT mismo_partido(mef_norm(x->>'partido'), mef_norm(g.partido)));
  RAISE NOTICE 'senales politicas: locadores (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- C3. El resumen de cada par tocado (como refrescar_nepotismo_senal): se vacía y se rehace desde persona_senal.
  INSERT INTO _spar SELECT DISTINCT entidad_ruc, ruc FROM persona_senal
   WHERE tipo = 'financio_campana' OR (tipo IN ('candidato_gobierna', 'aporte_gobierna') AND detalle->>'nivel' = 'nacional');
  CREATE TEMP TABLE _spar2 ON COMMIT DROP AS SELECT DISTINCT entidad_ruc, ruc FROM _spar;
  UPDATE persona_entidad pe SET tipos = '{}', senales = '[]', n_senales = 0, sev = 0
    FROM _spar2 p WHERE pe.entidad_ruc = p.entidad_ruc AND pe.ruc = p.ruc;
  UPDATE persona_entidad pe
     SET tipos = s.tipos, senales = s.senales, n_senales = s.n, sev = s.sev
    FROM (SELECT ps.entidad_ruc, ps.ruc, array_agg(ps.tipo ORDER BY ps.tipo) AS tipos, count(*)::int AS n,
                 max(CASE ps.severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END)::smallint AS sev,
                 jsonb_agg(jsonb_build_object('tipo', ps.tipo, 'severidad', ps.severidad)
                           ORDER BY CASE ps.severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, ps.tipo) AS senales
            FROM persona_senal ps JOIN _spar2 p ON p.entidad_ruc = ps.entidad_ruc AND p.ruc = ps.ruc
           GROUP BY ps.entidad_ruc, ps.ruc) s
   WHERE pe.entidad_ruc = s.entidad_ruc AND pe.ruc = s.ruc;

  -- D. Planilla, por nombre completo. Sin homónimos: el nombre tiene un solo DNI entre los aportantes (o los candidatos) y
  --    está en a lo más dos entidades de la planilla; tres palabras o más.
  CREATE TEMP TABLE _snu ON COMMIT DROP AS
    SELECT nom_n, min(dni) AS dni FROM (SELECT DISTINCT nom_n, dni FROM _sap) x GROUP BY nom_n HAVING count(*) = 1;
  CREATE INDEX ON _snu (nom_n);
  CREATE TEMP TABLE _snc ON COMMIT DROP AS
    SELECT nom_n, min(dni) AS dni FROM (SELECT DISTINCT nom_n, dni FROM _sca) x GROUP BY nom_n HAVING count(*) = 1;
  CREATE INDEX ON _snc (nom_n);
  CREATE TEMP TABLE _spn ON COMMIT DROP AS
    SELECT nombre_norm FROM planilla_persona
     WHERE nombre_norm ~ '^\S+ \S+ \S+' AND (nombre_norm IN (SELECT nom_n FROM _snu) OR nombre_norm IN (SELECT nom_n FROM _snc))
     GROUP BY 1 HAVING count(DISTINCT entidad_ruc) <= 2;
  -- El primer mes cargado de cada entidad: quien aparece después entró a la planilla dentro de lo que se ve.
  CREATE TEMP TABLE _sdesde ON COMMIT DROP AS
    SELECT entidad_ruc, make_date(min(anio * 100 + mes) / 100, min(anio * 100 + mes) % 100, 1) AS desde FROM planilla_pte
     WHERE entidad_ruc IN (SELECT DISTINCT p.entidad_ruc FROM planilla_persona p JOIN _spn n ON n.nombre_norm = p.nombre_norm)
     GROUP BY entidad_ruc;
  CREATE TEMP TABLE _spl ON COMMIT DROP AS
    SELECT p.entidad_ruc, p.nombre_norm, p.primer_mes, p.ultimo_mes, (p.primer_mes > d.desde) AS entro_en_lo_visto, p.regimen,
           g.nivel, g.desde, g.hasta, g.org_nombre, g.gob_n, g.eleccion, g.presidente
      FROM planilla_persona p
      JOIN _spn n ON n.nombre_norm = p.nombre_norm
      JOIN _sgp g ON g.ruc = p.entidad_ruc AND p.ultimo_mes >= g.desde AND p.primer_mes <= g.hasta
      LEFT JOIN _sdesde d ON d.entidad_ruc = p.entidad_ruc;
  CREATE TEMP TABLE _sps (entidad_ruc text, nombre_norm text, tipo text, severidad text, detalle jsonb) ON COMMIT DROP;
  -- financio_campana: alta si entró a la planilla dentro de los meses cargados (después del aporte y ya con ese gobierno) o
  -- si es alto funcionario (régimen 7: un cargo que el gobierno designa); media si ya figuraba en el primer mes cargado.
  INSERT INTO _sps
  SELECT l.entidad_ruc, l.nombre_norm, 'financio_campana',
         CASE WHEN bool_or(l.entro_en_lo_visto) OR bool_or(l.regimen = 7) THEN 'alta' ELSE 'media' END,
         jsonb_build_object('partido', max(l.org_nombre), 'nivel', max(l.nivel), 'presidente', max(l.presidente), 'por', 'nombre',
                            'eleccion', max(l.eleccion), 'gobierno_desde', max(l.desde), 'gobierno_hasta', max(l.hasta),
                            'primer_mes', min(l.primer_mes), 'entro_en_lo_visto', bool_or(l.entro_en_lo_visto), 'alto_funcionario', bool_or(l.regimen = 7),
                            'monto', sum(a.monto),
                            'aportes', jsonb_agg(DISTINCT jsonb_build_object('nombre', a.nombre, 'partido', a.partido, 'monto', a.monto, 'fecha', a.fecha,
                                                                             'anio', a.anio, 'proceso', a.proceso, 'campana', true)))
    FROM _spl l JOIN _snu u ON u.nom_n = l.nombre_norm JOIN _sap a ON a.dni = u.dni
   WHERE mismo_partido(a.partido_n, l.gob_n) AND a.nivel = 'campaña' AND a.proceso = l.eleccion
   GROUP BY l.entidad_ruc, l.nombre_norm;
  -- aporte_gobierna: otros aportes a ese partido (anuales, o de otra campaña), si no lleva ya financio_campana.
  INSERT INTO _sps
  SELECT l.entidad_ruc, l.nombre_norm, 'aporte_gobierna', 'media',
         jsonb_build_object('partido', max(l.org_nombre), 'nivel', max(l.nivel), 'presidente', max(l.presidente), 'por', 'nombre',
                            'gobierno_desde', min(l.desde), 'gobierno_hasta', max(l.hasta), 'monto', sum(a.monto),
                            'aportes', jsonb_agg(DISTINCT jsonb_build_object('nombre', a.nombre, 'partido', a.partido, 'monto', a.monto,
                                                                             'fecha', a.fecha, 'anio', a.anio, 'proceso', a.proceso)))
    FROM _spl l JOIN _snu u ON u.nom_n = l.nombre_norm JOIN _sap a ON a.dni = u.dni
   WHERE mismo_partido(a.partido_n, l.gob_n)
     AND (l.nivel <> 'nacional' OR a.anio BETWEEN extract(year FROM l.desde)::int - 5 AND extract(year FROM l.hasta)::int)
     AND NOT EXISTS (SELECT 1 FROM _sps f WHERE f.entidad_ruc = l.entidad_ruc AND f.nombre_norm = l.nombre_norm)
   GROUP BY l.entidad_ruc, l.nombre_norm;
  -- candidato_gobierna en el Ejecutivo nacional (lo local ya lo hace refrescar_planilla, por nombre y departamento).
  INSERT INTO _sps
  SELECT l.entidad_ruc, l.nombre_norm, 'candidato_gobierna', 'media',
         jsonb_build_object('partido', max(l.org_nombre), 'nivel', 'nacional', 'presidente', max(l.presidente), 'por', 'nombre',
                            'gobierno_desde', min(l.desde), 'gobierno_hasta', max(l.hasta), 'anios', jsonb_agg(DISTINCT extract(year FROM l.desde)::int),
                            'candidaturas', jsonb_agg(DISTINCT jsonb_build_object('nombre', c.nombre, 'partido', c.partido, 'cargo', c.cargo,
                                                                                 'anio', c.anio, 'resultado', c.resultado)))
    FROM _spl l JOIN _snc u ON u.nom_n = l.nombre_norm JOIN _sca c ON c.dni = u.dni
   WHERE l.nivel = 'nacional' AND mismo_partido(c.org_n, l.gob_n)
     AND c.anio BETWEEN extract(year FROM l.desde)::int - 5 AND extract(year FROM l.hasta)::int + 1
   GROUP BY l.entidad_ruc, l.nombre_norm;
  RAISE NOTICE 'senales politicas: planilla (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- D1. Las señales de la planilla viven en planilla_persona.senales: se quitan las de esta función (de una corrida
  --     anterior) y se agregan las nuevas, y se rehacen tipos, n_senales y sev de las filas tocadas.
  CREATE TEMP TABLE _sptoc ON COMMIT DROP AS
    SELECT entidad_ruc, nombre_norm FROM planilla_persona
     WHERE senales @> '[{"tipo": "financio_campana"}]' OR senales @> '[{"tipo": "aporte_gobierna"}]'
        OR senales @> '[{"tipo": "candidato_gobierna", "detalle": {"nivel": "nacional"}}]'
    UNION SELECT entidad_ruc, nombre_norm FROM _sps;
  UPDATE planilla_persona p
     SET senales = x.senales, tipos = x.tipos, n_senales = x.n, sev = x.sev
    FROM (
      SELECT t.entidad_ruc, t.nombre_norm,
             COALESCE(jsonb_agg(e.s ORDER BY CASE e.s->>'severidad' WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, e.s->>'tipo')
                        FILTER (WHERE e.s IS NOT NULL), '[]'::jsonb) AS senales,
             COALESCE(array_agg(DISTINCT e.s->>'tipo') FILTER (WHERE e.s IS NOT NULL), '{}') AS tipos,
             count(e.s)::int AS n,
             COALESCE(max(CASE e.s->>'severidad' WHEN 'alta' THEN 3 WHEN 'media' THEN 2 WHEN 'baja' THEN 1 END), 0)::smallint AS sev
        FROM _sptoc t
        JOIN planilla_persona pp ON pp.entidad_ruc = t.entidad_ruc AND pp.nombre_norm = t.nombre_norm
        LEFT JOIN LATERAL (
          SELECT s FROM jsonb_array_elements(pp.senales) s
           WHERE NOT (s->>'tipo' IN ('financio_campana', 'aporte_gobierna')
                      OR (s->>'tipo' = 'candidato_gobierna' AND s->'detalle'->>'nivel' = 'nacional'))
          UNION ALL
          SELECT jsonb_build_object('tipo', n.tipo, 'severidad', n.severidad, 'detalle', n.detalle)
            FROM _sps n WHERE n.entidad_ruc = t.entidad_ruc AND n.nombre_norm = t.nombre_norm
        ) e ON true
       GROUP BY t.entidad_ruc, t.nombre_norm) x
   WHERE p.entidad_ruc = x.entidad_ruc AND p.nombre_norm = x.nombre_norm;
  GET DIAGNOSTICS n_pla = ROW_COUNT;

  -- D2. El resumen de cada alcance de la planilla, como al final de refrescar_planilla() (migración 108).
  CREATE TEMP TABLE _sprb ON COMMIT DROP AS
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
            FROM _sprb GROUP BY alcance) t
    LEFT JOIN (SELECT alcance, jsonb_agg(jsonb_build_object('tipo', tipo, 'n', c) ORDER BY c DESC) AS l
                 FROM (SELECT alcance, tipo, count(*)::int AS c FROM _sprb, unnest(_sprb.tipos) tipo GROUP BY 1, 2) z GROUP BY alcance) ps
           ON ps.alcance = t.alcance
    LEFT JOIN (SELECT alcance, jsonb_agg(jsonb_build_object('regimen', regimen, 'n', c) ORDER BY c DESC) AS l
                 FROM (SELECT alcance, regimen, count(*)::int AS c FROM _sprb GROUP BY 1, 2) z GROUP BY alcance) pr
           ON pr.alcance = t.alcance;
  RAISE NOTICE 'senales politicas: % locadores con financio_campana, % filas de planilla tocadas (% s)', n_loc, n_pla,
    round(extract(epoch FROM clock_timestamp() - t0));
  RETURN n_loc + n_pla;
END $$;
ALTER FUNCTION refrescar_senales_politicas() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_senales_politicas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refrescar_senales_politicas() TO vigia_jobs;
