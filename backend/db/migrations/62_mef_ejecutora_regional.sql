-- 62 · El presupuesto de una entidad regional es el de SU unidad ejecutora, no el del gobierno regional entero.
--
-- Hasta acá `refrescar_mef_presupuesto()` (migración 47) le daba a cada una de las 379 entidades regionales del SEACE el
-- pliego "GOBIERNO REGIONAL DEL DEPARTAMENTO DE <depto>" completo: la ficha del Gobierno Regional de Cusco Sede Central
-- decía "S/ 4,0 mil M de PIM" sumando sus 33 unidades ejecutoras (hospitales, UGEL, redes de salud), y el Hospital
-- Antonio Lorena mostraba exactamente lo mismo. Ahora cada una cruza con su unidad ejecutora: por el código que trae el
-- nombre, por ser la sede central (ejecutora 001) o por un parecido de nombre alto y sin empate. Las que no se
-- identifican conservan el pliego entero con `keyword = 'pliego …'`, y la ficha dice que son las cifras de todo el
-- gobierno regional. `keyword` empieza por 'ejecutora ' cuando el cruce es por unidad ejecutora.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/62_mef_ejecutora_regional.sql
-- y después: SELECT * FROM refrescar_mef_presupuesto();  (lo corre también vigia-scrapers con cada carga del MEF)

-- Lo que sigue al departamento en el nombre de una entidad o de una unidad ejecutora regional, con las variantes de
-- escritura igualadas: "GOB. REG. DPTO. CUSCO - UGEL CUSCO" y "GOBIERNO REGIONAL DE CUSCO UNIDAD DE GESTION EDUCATIVA
-- LOCAL CUSCO" quedan en "EDUCACION CUSCO". Recibe nombres ya pasados por mef_norm().
CREATE OR REPLACE FUNCTION mef_sufijo_regional(t TEXT, dep TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(t, '^.*?\m' || dep || '\M ?', ''),
    '\m(UNIDAD EJECUTORA( N)?( ?\d{3,4})?|U ?E( N)? ?\d{3,4})\M', ' ', 'g'),
    '\m(UNIDAD DE GESTION EDUCATIVA( LOCAL)?|UNIDAD DE SERVICIOS EDUCATIVOS|UGEL( DE)?)\M', 'EDUCACION', 'g'),
    '\mDIRECCION REGIONAL (DE )?', '', 'g'),
    '\mHOSP\M', 'HOSPITAL', 'g'),
    '\m(DE|DEL|LA|LAS|LOS|Y|EL)\M', ' ', 'g'),
    '\mGOB REG( DPTO)?\M', ' ', 'g'),
    '\s+', ' ', 'g'))
$$;
ALTER FUNCTION mef_sufijo_regional(TEXT, TEXT) OWNER TO vigia_jobs;

/*
 * Igual que en la migración 47 (por departamento y por entidad), salvo los gobiernos regionales:
 *   · municipalidades: ejecutora = ubigeo de la entidad, mismo tipo (PROVINCIAL/DISTRITAL)
 *   · gobiernos regionales: su unidad ejecutora (gr_ok); si no se identifica, el pliego entero, marcado 'pliego …'
 *   · el resto: nombre igual, prefijo (≥ 20 letras) o trigramas ≥ 0,6 contra la ejecutora nacional
 */
CREATE OR REPLACE FUNCTION refrescar_mef_presupuesto() RETURNS TABLE (regiones INT, entidades INT)
LANGUAGE plpgsql AS $$
DECLARE r INT; e INT; ult SMALLINT; primero SMALLINT;
BEGIN
  SELECT max(anio), min(anio) INTO ult, primero FROM mef_ejecutora_anual;
  IF ult IS NULL THEN RETURN QUERY SELECT 0, 0; RETURN; END IF;

  WITH anios AS (SELECT DISTINCT anio FROM mef_ejecutora_anual ORDER BY anio DESC LIMIT 5),
  por AS (
    SELECT departamento_nombre AS dep, anio, sum(pia) pia, sum(pim) pim, sum(certificado) cert, sum(comprometido) comp,
           sum(devengado) dev, sum(girado) gir, sum(filas) filas
      FROM mef_ejecutora_anual WHERE anio IN (SELECT anio FROM anios) AND btrim(departamento_nombre) <> '' GROUP BY 1, 2),
  top AS (
    SELECT departamento_nombre AS dep, tipo,
           jsonb_agg(jsonb_build_object('nombre', nombre, 'pia', pia, 'pim', pim, 'devengado', devengado,
                     'ejecPct', CASE WHEN pim > 0 THEN round(devengado / pim * 100, 2) ELSE 0 END) ORDER BY pim DESC) AS filas
      FROM (SELECT d.*, row_number() OVER (PARTITION BY departamento_nombre, tipo ORDER BY pim DESC) AS n
              FROM mef_departamento_desglose d WHERE anio = ult AND pim > 0 AND btrim(nombre) <> '') x
     WHERE n <= 6 GROUP BY 1, 2)
  INSERT INTO mef_region_budget AS rb (departamento, total_rows, by_year, top_sectores, top_pliegos, top_programas, top_genericas, last_refreshed)
  SELECT p.dep,
         max(p.filas) FILTER (WHERE p.anio = ult),
         jsonb_agg(jsonb_build_object('year', p.anio, 'pia', p.pia, 'pim', p.pim, 'certificado', p.cert,
                   'comprometido', p.comp, 'devengado', p.dev, 'girado', p.gir) ORDER BY p.anio),
         coalesce((SELECT filas FROM top WHERE top.dep = p.dep AND tipo = 'sector'), '[]'),
         coalesce((SELECT filas FROM top WHERE top.dep = p.dep AND tipo = 'pliego'), '[]'),
         coalesce((SELECT filas FROM top WHERE top.dep = p.dep AND tipo = 'programa'), '[]'),
         coalesce((SELECT filas FROM top WHERE top.dep = p.dep AND tipo = 'generica'), '[]'),
         now()
    FROM por p GROUP BY p.dep
  ON CONFLICT (departamento) DO UPDATE SET total_rows = EXCLUDED.total_rows,
    -- los años más viejos que el primero cargado se conservan; quedan los últimos 5
    by_year = (SELECT jsonb_agg(v ORDER BY (v->>'year')::int)
                 FROM (SELECT v FROM (SELECT v FROM jsonb_array_elements(EXCLUDED.by_year) v
                                      UNION ALL
                                      SELECT v FROM jsonb_array_elements(coalesce(rb.by_year, '[]')) v
                                       WHERE (v->>'year')::int < primero) t
                        ORDER BY (v->>'year')::int DESC LIMIT 5) u),
    top_sectores = EXCLUDED.top_sectores, top_pliegos = EXCLUDED.top_pliegos, top_programas = EXCLUDED.top_programas,
    top_genericas = EXCLUDED.top_genericas, last_refreshed = now();
  GET DIAGNOSTICS r = ROW_COUNT;

  WITH ejec AS (SELECT DISTINCT ON (sec_ejec) sec_ejec, ejecutora, ejecutora_nombre, pliego_nombre, nivel_gobierno
                  FROM mef_ejecutora_anual ORDER BY sec_ejec, anio DESC),
  ent AS (SELECT ruc, nombre, mef_norm(nombre) AS n, ubigeo FROM entidades),
  -- Cada entidad regional frente a las unidades ejecutoras de SU pliego (el departamento puede tener varias palabras:
  -- LA LIBERTAD, MADRE DE DIOS, SAN MARTIN; el Callao tiene su propio nombre de pliego).
  gr AS (
    SELECT e.ruc, x.sec_ejec, x.ejecutora, x.ejecutora_nombre, x.pliego_nombre,
           mef_sufijo_regional(e.n, x.dep) AS es, mef_sufijo_regional(mef_norm(x.ejecutora_nombre), x.dep) AS xs,
           (regexp_match(e.n, '\m(?:UNIDAD EJECUTORA|U ?E)(?: N)? ?(\d{3,4})\M'))[1] AS cod
      FROM ent e
      JOIN (SELECT x.*, regexp_replace(mef_norm(x.pliego_nombre),
                          '^GOBIERNO REGIONAL (DEL DEPARTAMENTO DE|DE LA PROVINCIA CONSTITUCIONAL DEL) ', '') AS dep
              FROM ejec x WHERE x.nivel_gobierno = 'R' AND mef_norm(x.pliego_nombre) LIKE 'GOBIERNO REGIONAL %') x
        ON e.n ~ ('^GOB(IERNO)? REG(IONAL)? (DEL? )?(DEPARTAMENTO DE |LA PROVINCIA CONSTITUCIONAL DEL )?' || x.dep || '( |$)')
     WHERE e.n LIKE 'GOB% REG%'),
  -- Qué tan seguro es cada par: 2 = el código de la ejecutora está en el nombre ("UNIDAD EJECUTORA 309", "UE 409") o es
  -- la sede central (ejecutora 001 en los 26 pliegos); si no, el parecido de lo que sigue al departamento en los dos
  -- nombres ("HOSPITAL ANTONIO LORENA" ↔ "HOSPITAL ANTONIO LORENA").
  gr_p AS (
    SELECT g.*, CASE WHEN g.cod IS NOT NULL AND (g.cod = g.ejecutora OR g.cod = g.sec_ejec) THEN 2
                     WHEN (g.es = '' OR g.es ~ '\mSEDE CENTRAL\M') AND g.ejecutora = '001' THEN 2
                     WHEN g.es = '' OR g.xs = '' THEN 0
                     ELSE greatest(similarity(g.es, g.xs), least(word_similarity(g.xs, g.es), word_similarity(g.es, g.xs))) END AS s
      FROM gr g),
  gr_r AS (
    SELECT p.*, row_number() OVER w AS puesto, lead(p.s) OVER w AS s2
      FROM gr_p p WINDOW w AS (PARTITION BY p.ruc ORDER BY p.s DESC, similarity(p.es, p.xs) DESC)),
  -- Se acepta la mejor sólo si es segura: por código o sede, o con parecido ≥ 0,8 y 0,1 por encima de la segunda (con
  -- menos, "HOSPITAL REGIONAL CUSCO" caía en el Hospital de Espinar y "UGEL 09" en la de Oyón). 2026-10-19: 257 de 379.
  gr_ok AS (
    SELECT ruc, sec_ejec, ejecutora_nombre FROM gr_r
     WHERE puesto = 1 AND (s >= 2 OR (s >= 0.8 AND s - coalesce(s2, 0) >= 0.1))),
  cruce AS (
    -- municipalidades: la ejecutora del gobierno local es el ubigeo de la municipalidad
    SELECT e.ruc, x.sec_ejec, 'ubigeo ' || e.ubigeo AS como
      FROM ent e JOIN ejec x ON x.nivel_gobierno = 'M' AND x.ejecutora = e.ubigeo
     WHERE e.n LIKE 'MUNICIPALIDAD%'
       AND (e.n NOT LIKE '%PROVINCIAL%' OR mef_norm(x.ejecutora_nombre) LIKE '%PROVINCIAL%')
       AND (e.n NOT LIKE '%DISTRITAL%' OR mef_norm(x.ejecutora_nombre) LIKE '%DISTRITAL%')
    UNION ALL
    -- gobiernos regionales: su unidad ejecutora, si se identifica (gr_ok)…
    SELECT ruc, sec_ejec, 'ejecutora ' || ejecutora_nombre FROM gr_ok
    UNION ALL
    -- …y si no, el pliego del departamento entero, como antes: la ficha avisa que son las cifras de todo el gobierno
    -- regional (keyword 'pliego …'), no las de la entidad.
    SELECT g.ruc, g.sec_ejec, 'pliego ' || g.pliego_nombre
      FROM gr g WHERE NOT EXISTS (SELECT 1 FROM gr_ok k WHERE k.ruc = g.ruc)
    UNION ALL
    -- el resto: la ejecutora nacional más parecida (igual, prefijo o trigramas)
    (SELECT DISTINCT ON (e.ruc) e.ruc, x.sec_ejec, 'nombre ' || x.ejecutora_nombre
       FROM ent e JOIN ejec x ON x.nivel_gobierno = 'E'
        AND (mef_norm(x.ejecutora_nombre) = e.n
             OR (length(mef_norm(x.ejecutora_nombre)) >= 20 AND (e.n LIKE mef_norm(x.ejecutora_nombre) || '%' OR mef_norm(x.ejecutora_nombre) LIKE e.n || '%'))
             OR similarity(mef_norm(x.ejecutora_nombre), e.n) >= 0.6)
      WHERE e.n NOT LIKE 'MUNICIPALIDAD%' AND e.n NOT LIKE 'GOB% REG%'
      ORDER BY e.ruc, similarity(mef_norm(x.ejecutora_nombre), e.n) DESC)),
  sumas AS (
    SELECT c.ruc, m.anio, sum(m.pia) pia, sum(m.pim) pim, sum(m.certificado) cert, sum(m.comprometido) comp,
           sum(m.devengado) dev, sum(m.girado) gir, sum(m.filas) filas
      FROM cruce c JOIN mef_ejecutora_anual m ON m.sec_ejec = c.sec_ejec
     WHERE m.anio IN (SELECT DISTINCT anio FROM mef_ejecutora_anual ORDER BY anio DESC LIMIT 5)
     GROUP BY 1, 2)
  INSERT INTO mef_entity_budget (entidad_ruc, keyword, total_rows, by_year, matched_pliegos, kind, last_refreshed)
  SELECT s.ruc,
         (SELECT min(como) FROM cruce c WHERE c.ruc = s.ruc),
         coalesce(max(s.filas) FILTER (WHERE s.anio = ult), 0),
         jsonb_agg(jsonb_build_object('year', s.anio, 'pia', s.pia, 'pim', s.pim, 'certificado', s.cert,
                   'comprometido', s.comp, 'devengado', s.dev, 'girado', s.gir) ORDER BY s.anio),
         (SELECT array_agg(DISTINCT x.ejecutora_nombre) FROM cruce c JOIN ejec x USING (sec_ejec) WHERE c.ruc = s.ruc),
         'ok', now()
    FROM sumas s GROUP BY s.ruc
  ON CONFLICT (entidad_ruc) DO UPDATE SET keyword = EXCLUDED.keyword, total_rows = EXCLUDED.total_rows,
    by_year = EXCLUDED.by_year, matched_pliegos = EXCLUDED.matched_pliegos, kind = 'ok', last_refreshed = now();
  GET DIAGNOSTICS e = ROW_COUNT;
  -- Lo que no se tocó en esta corrida ya no cruza (o era del método anterior): fuera.
  DELETE FROM mef_entity_budget WHERE last_refreshed < now();
  RETURN QUERY SELECT r, e;
END $$;
ALTER FUNCTION refrescar_mef_presupuesto() OWNER TO vigia_jobs;
