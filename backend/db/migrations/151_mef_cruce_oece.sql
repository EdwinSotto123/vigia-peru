-- 151 · Cada entidad con SU unidad ejecutora del MEF: primero la llave oficial de la OECE (migración 150), y el parecido
-- del nombre sólo para las que la OECE no registra.
--
-- Hasta acá refrescar_mef_presupuesto() (47, 62, 63) cruzaba por ubigeo (municipalidades), por la unidad ejecutora de su
-- pliego (gobiernos regionales) o por el parecido del nombre (el resto). Medido en producción el 2026-10-26 contra la
-- llave de la OECE: 424 fichas sin presupuesto, 127 con el pliego regional entero y 21 con el de otra entidad. Aplicada
-- el 2026-10-27: 2,846 con su propia unidad (+115, ninguna con el pliego entero) y 316 sin presupuesto, de las que 239
-- están fuera del SIAF. Ahora:
--   · la entidad está en entidad_siaf (3,160 de 3,162): manda la OECE, sin parecido de por medio.
--       - con código de unidad ejecutora → esa unidad (keyword 'oece …', fuente 'oece');
--       - con código de pliego (es_pliego) → el pliego entero, dicho como tal (keyword 'pliego …', fuente 'oece');
--       - fuera del SIAF (código vacío o 930xxx) o con una unidad que no está en los años cargados → sin presupuesto: no
--         se le busca otra por parecido (eran justamente los cruces equivocados: el IAFAS de la Marina con la Marina, el
--         centro poblado de Santa María de la Colina con el distrito de Majes, el Hospital de Vitarte con el de Lima Este).
--   · la entidad no está en la OECE (las nuevas, hasta la próxima carga): mef_cruce_heuristico(), las reglas de antes más
--     las de la auditoría de cobertura del 2026-10-27, cada una sin empates y sin tomar nunca una unidad que la OECE le da
--     a otro RUC (fuente 'heuristica').
-- mef_entity_budget.fuente dice cuál de las dos fue; la API la publica junto con si la entidad está fuera del SIAF.
--
-- Mismas firmas que antes (CREATE OR REPLACE): refrescar_mef_presupuesto() sigue devolviendo (regiones, entidades) y la
-- llaman igual vigia-scrapers (mef_presupuesto.ts) y el script de la OECE.
--
-- Cómo aplicarla (después de la 150): psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/151_mef_cruce_oece.sql
-- y después: SET statement_timeout = 0; SELECT * FROM refrescar_mef_presupuesto();
-- Para medir las reglas de respaldo contra la llave de la OECE: SELECT * FROM mef_cruce_heuristico(true) (todas las
-- entidades, como si ninguna estuviera en la OECE salvo para saber de quién es cada unidad).

SET lock_timeout = '5s';
ALTER TABLE mef_entity_budget ADD COLUMN IF NOT EXISTS fuente TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mef_entity_budget_fuente_check') THEN
    ALTER TABLE mef_entity_budget ADD CONSTRAINT mef_entity_budget_fuente_check CHECK (fuente IN ('oece', 'heuristica'));
  END IF;
END $$;

-- Nombre de una municipalidad sin su tipo: "MUNICIPALIDAD DISTRITAL DE SAN ANTONIO PUNO" → "SAN ANTONIO PUNO". Recibe
-- nombres ya pasados por mef_norm().
CREATE OR REPLACE FUNCTION mef_base_municipal(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(t, '^(MUNICIPALIDAD|GOBIERNO LOCAL|CONCEJO)( (DISTRITAL|PROVINCIAL|METROPOLITANA))?( DEL?)? ', ''))
$$;

-- Sin las palabras que no distinguen a una unidad de otra (artículos, "UNIDAD EJECUTORA", "SEDE", "S A", "REGION"…).
CREATE OR REPLACE FUNCTION mef_nucleo(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(regexp_replace(t,
    '\m(DE|DEL|LA|LAS|LOS|EL|Y|EN|PARA|POR|UNIDAD EJECUTORA|U E|UE|N|NRO|SEDE|S A|SA|SAC|GOB|REG|GOBIERNO|REGIONAL|REGION|DPTO|DEPARTAMENTO)\M',
    ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- Sin el prefijo de unidad ejecutora ni el de sector, hasta tres veces: "UNIDAD EJECUTORA 036 001634 FONDO SIERRA AZUL" →
-- "FONDO SIERRA AZUL", "MINAG PROYECTO ESPECIAL PICHIS PALCAZU" → "PICHIS PALCAZU", "MC CHANKILLO …" → "CHANKILLO …".
CREATE OR REPLACE FUNCTION mef_sin_prefijo(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT mef_nucleo(regexp_replace(regexp_replace(regexp_replace(t, p, ''), p, ''), p, ''))
    FROM (SELECT '^((UNIDAD EJECUTORA|U ?E)( N| NRO| DEL PLIEGO [0-9]+)?( ?[0-9]{1,6})*|MINISTERIO DE [A-Z ]+ UNIDAD EJECUTORA( N)? ?[0-9]+|'
                 'MINAG(RI)?|MTC|MEF|PCM|MIDIS|ONP|MC|PNP|MINSA|MINEDU|PROYECTO ESPECIAL|PROGRAMA NACIONAL( DE| PARA)?|'
                 'INSTITUTO NACIONAL( DE)?)\M ?' AS p) x
$$;

/*
 * El cruce por parecido, para las entidades que la OECE no registra (con `todas`, para todas: así se mide contra la OECE).
 * Una fila por (entidad, unidad ejecutora), con la regla que la dio; por entidad gana la primera regla que encuentra
 * algo, en este orden:
 *   1 municipalidad por ubigeo: la unidad del gobierno local es el ubigeo de la municipalidad, del mismo tipo (47);
 *   2 municipalidad por nombre en su departamento ("SAN ANTONIO PUNO" ↔ "MUNICIPALIDAD DISTRITAL DE SAN ANTONIO"): para
 *     los distritos nuevos que traen el ubigeo del distrito del que se separaron, o ninguno;
 *   3 gobierno regional: su unidad por el código del nombre, por ser la sede o por un nombre casi igual (62);
 *   4 mancomunidad: la mancomunidad del MEF de nombre casi igual (≥ 0,8);
 *   5 UGEL 01-07 de Lima = "USE 0n" del MEF; región policial (RPNP) = "Dirección Territorial de Policía" del mismo número;
 *   6 nacional por nombre: igual, prefijo de 20 letras o trigramas ≥ 0,6 (47);
 *   7 nacional sin prefijos ("UNIDAD EJECUTORA 140", "MINAG", "MC", "PROGRAMA NACIONAL DE"…), trigramas ≥ 0,75;
 *   8 sede de un pliego nacional: la entidad se llama como el pliego (MINSA, MEF, Poder Judicial) → su UE de menor código;
 *   9 unidad regional nombrada sin "Gobierno Regional" ("UNIDAD EJECUTORA 411 SALUD JULCAN"), en su departamento;
 *  10 gobierno regional sin unidad identificada: el pliego entero, marcado 'pliego …' (la ficha lo avisa).
 * Ninguna regla toma una unidad que la OECE da a otro RUC, y las de parecido exigen que la primera supere a la segunda
 * (0,1; 0,05 en la 6), sin empates. Las empresas, EPS, cajas, bancos, beneficencias e institutos viales no se buscan por
 * nombre: no están en el SIAF.
 */
CREATE OR REPLACE FUNCTION mef_cruce_heuristico(todas BOOLEAN DEFAULT false)
RETURNS TABLE (ruc CHAR(11), sec_ejec TEXT, como TEXT, regla TEXT)
LANGUAGE sql STABLE AS $$
WITH ejec AS MATERIALIZED (
  SELECT x.*, mef_sin_prefijo(x.xn) AS xsp, mef_sufijo_regional(x.xn, x.dep) AS xsr, mef_base_municipal(x.xn) AS xmb
    FROM (SELECT DISTINCT ON (m.sec_ejec) m.sec_ejec, m.ejecutora, m.ejecutora_nombre, mef_norm(m.ejecutora_nombre) AS xn,
                 m.pliego, m.pliego_nombre, m.sector, m.nivel_gobierno,
                 regexp_replace(mef_norm(m.departamento_nombre), '^PROVINCIA CONSTITUCIONAL DEL ', '') AS dep
            FROM mef_ejecutora_anual m ORDER BY m.sec_ejec, m.anio DESC) x),
ent AS MATERIALIZED (
  SELECT e.ruc, e.n, e.ubigeo, e.dep, mef_base_municipal(e.n) AS emb, mef_sin_prefijo(e.n) AS esp, mef_nucleo(e.n) AS enu,
         CASE WHEN e.dep IS NOT NULL THEN mef_sufijo_regional(e.n, e.dep) END AS esr
    FROM (SELECT e.ruc, mef_norm(e.nombre) AS n, e.ubigeo, nullif(mef_norm(e.region), '') AS dep
            FROM entidades e
           WHERE todas OR NOT EXISTS (SELECT 1 FROM entidad_siaf s WHERE s.ruc = e.ruc)) e),
-- La unidad que la OECE le da a un RUC: no se le da por parecido a otro.
duena AS (SELECT DISTINCT s.sec_ejec::text AS sec_ejec, s.ruc FROM entidad_siaf s WHERE s.sec_ejec IS NOT NULL AND NOT s.es_pliego),
-- Las que se buscan entre las unidades nacionales: ni municipales ni regionales (tienen sus reglas), ni las que no están
-- en el SIAF (empresas, EPS, cajas, bancos, beneficencias, institutos viales, IAFAS).
nac AS (
  SELECT e.* FROM ent e
   WHERE e.n !~ '^(MUNICIPALIDAD|GOBIERNO LOCAL|CONCEJO|MANCOMUNIDAD|GOB(IERNO)? REG|REGION (?!POLICIAL|MILITAR|NAVAL|AEREA))'
     AND e.n !~ '\m(EMPRESA|S A|SA|SAC|SAA|S A C|S R L|SRL|SRLTDA|EPS|E P S|ENTIDAD PRESTADORA|SEDAPAL|BENEFICENCIA|CAJA|BANCO|SEGURO SOCIAL|PETROLEOS|INSTITUTO VIAL|VIALIDAD|IAFAS)\M'),
r1 AS (
  SELECT e.ruc, x.sec_ejec, 'ubigeo ' || e.ubigeo AS como, 'municipalidad por ubigeo' AS regla, 1 AS orden
    FROM ent e JOIN ejec x ON x.nivel_gobierno = 'M' AND x.ejecutora = e.ubigeo
   WHERE e.n LIKE 'MUNICIPALIDAD%' AND e.n !~ 'CENTRO POBLADO'
     AND (e.n NOT LIKE '%PROVINCIAL%' OR x.xn LIKE '%PROVINCIAL%')
     AND (e.n NOT LIKE '%DISTRITAL%' OR x.xn LIKE '%DISTRITAL%')),
r2c AS (
  SELECT c.*, max(c.s) OVER (PARTITION BY c.ruc) AS smax, count(*) OVER (PARTITION BY c.ruc, c.s) AS n_s
    FROM (SELECT e.ruc, x.sec_ejec, x.ejecutora_nombre,
                 CASE WHEN x.xmb = e.emb THEN 3
                      WHEN x.xmb = regexp_replace(e.emb, ' [A-Z0-9]+$', '') THEN 2
                      WHEN length(x.xmb) >= 5 AND e.emb LIKE x.xmb || ' %' THEN 1 END AS s
            FROM ent e JOIN ejec x ON x.nivel_gobierno = 'M' AND x.dep = e.dep AND x.xn ~ '^MUNICIPALIDAD '
           WHERE e.n ~ '^(MUNICIPALIDAD|GOBIERNO LOCAL|CONCEJO) ' AND e.n !~ 'CENTRO POBLADO'
             AND NOT (e.n ~ '\mDISTRITAL\M' AND x.xn !~ '\mDISTRITAL\M')
             AND NOT (e.n ~ '\mPROVINCIAL\M' AND x.xn !~ '\mPROVINCIAL\M')) c
   WHERE c.s IS NOT NULL),
r2 AS (
  SELECT c.ruc, c.sec_ejec, 'nombre ' || c.ejecutora_nombre AS como, 'municipalidad por nombre' AS regla, 2 AS orden
    FROM r2c c WHERE c.s = c.smax AND c.n_s = 1),
-- Gobiernos regionales (62): cada entidad frente a las unidades de SU pliego.
gr AS (
  SELECT e.ruc, x.sec_ejec, x.ejecutora, x.ejecutora_nombre, x.pliego_nombre,
         mef_sufijo_regional(e.n, x.gdep) AS es, mef_sufijo_regional(x.xn, x.gdep) AS xs,
         (regexp_match(e.n, '\m(?:UNIDAD EJECUTORA|U ?E)(?: N)? ?(\d{3,4})\M'))[1] AS cod
    FROM ent e
    JOIN (SELECT x.*, regexp_replace(mef_norm(x.pliego_nombre),
                        '^GOBIERNO REGIONAL (DEL DEPARTAMENTO DE|DE LA PROVINCIA CONSTITUCIONAL DEL) ', '') AS gdep
            FROM ejec x WHERE x.nivel_gobierno = 'R' AND mef_norm(x.pliego_nombre) LIKE 'GOBIERNO REGIONAL %') x
      ON e.n ~ ('^GOB(IERNO)? REG(IONAL)? (DEL? )?(DEPARTAMENTO DE |LA PROVINCIA CONSTITUCIONAL DEL )?' || x.gdep || '( |$)')
   WHERE e.n LIKE 'GOB% REG%'),
gr_p AS (
  SELECT g.*, CASE WHEN g.cod IS NOT NULL AND (g.cod = g.ejecutora OR g.cod = g.sec_ejec) THEN 2
                   WHEN (g.es = '' OR g.es ~ '\mSEDE CENTRAL\M') AND g.ejecutora = '001' THEN 2
                   WHEN g.es = '' OR g.xs = '' THEN 0
                   ELSE greatest(similarity(g.es, g.xs), least(word_similarity(g.xs, g.es), word_similarity(g.es, g.xs))) END AS s
    FROM gr g),
gr_r AS (
  SELECT p.*, row_number() OVER w AS puesto, lead(p.s) OVER w AS s2
    FROM gr_p p WINDOW w AS (PARTITION BY p.ruc ORDER BY p.s DESC, similarity(p.es, p.xs) DESC)),
r3 AS (
  SELECT g.ruc, g.sec_ejec, 'ejecutora ' || g.ejecutora_nombre AS como, 'gobierno regional' AS regla, 3 AS orden
    FROM gr_r g WHERE g.puesto = 1 AND (g.s >= 2 OR (g.s >= 0.8 AND g.s - coalesce(g.s2, 0) >= 0.1))),
r4 AS (
  SELECT c.ruc, c.sec_ejec, 'nombre ' || c.ejecutora_nombre AS como, 'mancomunidad' AS regla, 4 AS orden
    FROM (SELECT c.*, row_number() OVER w AS puesto, lead(c.s) OVER w AS s2
            FROM (SELECT e.ruc, x.sec_ejec, x.ejecutora_nombre, similarity(e.n, x.xn) AS s
                    FROM ent e JOIN ejec x ON x.xn LIKE 'MANCOMUNIDAD%' AND similarity(e.n, x.xn) >= 0.5
                   WHERE e.n LIKE 'MANCOMUNIDAD%') c
          WINDOW w AS (PARTITION BY c.ruc ORDER BY c.s DESC)) c
   WHERE c.puesto = 1 AND c.s >= 0.8 AND c.s - coalesce(c.s2, 0) >= 0.1),
r5c AS (
  -- UGEL 01-07 de Lima Metropolitana: en el MEF son "USE 01 …" a "USE 07 …" del Ministerio de Educación.
  SELECT e.ruc, x.sec_ejec, x.ejecutora_nombre, 'UGEL de Lima' AS regla
    FROM nac e JOIN ejec x ON x.nivel_gobierno = 'E'
     AND x.xn ~ ('^USE 0?' || (regexp_match(e.n, '\mUGEL (?:N )?0?([1-7])\M'))[1] || '\M')
   WHERE e.n ~ '\mUGEL (N )?0?[1-7]\M' AND (e.dep = 'LIMA' OR e.n ~ '\m(RIMAC|COMAS|VITARTE|SAN BORJA|LURIGANCHO|MIRAFLORES|CERCADO)\M')
  UNION ALL
  -- Regiones policiales: "JEFATURA DE LA VII RPNP LIMA" = "VII DIRECCION TERRITORIAL DE POLICIA LIMA".
  SELECT e.ruc, x.sec_ejec, x.ejecutora_nombre, 'región policial'
    FROM nac e JOIN ejec x ON x.nivel_gobierno = 'E'
     AND x.xn ~ ('\m' || (regexp_match(e.n, '\m([IVX]+) (?:RPNP|REGION POLICIAL|DIRTEPOL|DIRECCION TERRITORIAL)\M'))[1]
                 || ' (DIRECCION TERRITORIAL|DIRTEPOL)\M')
   WHERE e.n ~ '\m[IVX]+ (RPNP|REGION POLICIAL|DIRTEPOL|DIRECCION TERRITORIAL)\M'),
r5 AS (
  SELECT c.ruc, c.sec_ejec, 'nombre ' || c.ejecutora_nombre AS como, c.regla, 5 AS orden
    FROM (SELECT c.*, count(*) OVER (PARTITION BY c.ruc) AS n FROM r5c c) c WHERE c.n = 1),
r6 AS (
  SELECT c.ruc, c.sec_ejec, 'nombre ' || c.ejecutora_nombre AS como, 'nacional por nombre' AS regla, 6 AS orden
    FROM (SELECT c.*, row_number() OVER w AS puesto, lead(c.s) OVER w AS s2
            FROM (SELECT e.ruc, x.sec_ejec, x.ejecutora_nombre, similarity(x.xn, e.n) AS s
                    FROM nac e JOIN ejec x ON x.nivel_gobierno = 'E'
                     AND (x.xn = e.n
                          OR (length(x.xn) >= 20 AND (e.n LIKE x.xn || '%' OR x.xn LIKE e.n || '%'))
                          OR similarity(x.xn, e.n) >= 0.6)) c
          WINDOW w AS (PARTITION BY c.ruc ORDER BY c.s DESC)) c
   WHERE c.puesto = 1 AND c.s - coalesce(c.s2, 0) >= 0.05),
r7 AS (
  SELECT c.ruc, c.sec_ejec, 'nombre ' || c.ejecutora_nombre AS como, 'nacional sin prefijos' AS regla, 7 AS orden
    FROM (SELECT c.*, row_number() OVER w AS puesto, lead(c.s) OVER w AS s2
            FROM (SELECT e.ruc, x.sec_ejec, x.ejecutora_nombre, similarity(x.xsp, e.esp) AS s
                    FROM nac e JOIN ejec x ON x.nivel_gobierno = 'E' AND e.esp <> '' AND similarity(x.xsp, e.esp) >= 0.5) c
          WINDOW w AS (PARTITION BY c.ruc ORDER BY c.s DESC)) c
   WHERE c.puesto = 1 AND c.s >= 0.75 AND c.s - coalesce(c.s2, 0) >= 0.1),
pl AS (
  SELECT DISTINCT ON (x.sector, x.pliego) x.sector, x.pliego, x.sec_ejec AS sede, x.ejecutora_nombre AS sede_nombre,
         mef_nucleo(regexp_replace(regexp_replace(mef_norm(x.pliego_nombre), '^M ', 'MINISTERIO '), '^U N ', 'UNIVERSIDAD NACIONAL ')) AS pn
    FROM ejec x WHERE x.nivel_gobierno = 'E' AND btrim(coalesce(x.pliego, '')) <> ''
   ORDER BY x.sector, x.pliego, x.ejecutora, x.sec_ejec),
r8 AS (
  SELECT c.ruc, c.sede AS sec_ejec, 'nombre ' || c.sede_nombre AS como, 'sede del pliego' AS regla, 8 AS orden
    FROM (SELECT c.*, row_number() OVER w AS puesto, lead(c.s) OVER w AS s2
            FROM (SELECT e.ruc, p.sede, p.sede_nombre, similarity(e.enu, p.pn) AS s
                    FROM nac e JOIN pl p ON similarity(e.enu, p.pn) >= 0.5) c
          WINDOW w AS (PARTITION BY c.ruc ORDER BY c.s DESC)) c
   WHERE c.puesto = 1 AND c.s >= 0.8 AND c.s - coalesce(c.s2, 0) >= 0.1),
r9 AS (
  SELECT c.ruc, c.sec_ejec, 'ejecutora ' || c.ejecutora_nombre AS como, 'regional sin prefijo' AS regla, 9 AS orden
    FROM (SELECT c.*, row_number() OVER w AS puesto, lead(c.s) OVER w AS s2
            FROM (SELECT e.ruc, x.sec_ejec, x.ejecutora_nombre,
                         CASE WHEN (regexp_match(e.n, '\m(?:UNIDAD EJECUTORA|U ?E)(?: N| NRO)? ?(\d{3,4})\M'))[1] IN (x.ejecutora, x.sec_ejec)
                              THEN 2
                              ELSE greatest(similarity(e.esr, x.xsr),
                                            least(word_similarity(x.xsr, e.esr), word_similarity(e.esr, x.xsr))) END AS s
                    FROM nac e JOIN ejec x ON x.nivel_gobierno = 'R' AND x.dep = e.dep
                     AND mef_norm(x.pliego_nombre) LIKE 'GOBIERNO REGIONAL %'
                   WHERE e.esr <> '' AND x.xsr <> '') c
          WINDOW w AS (PARTITION BY c.ruc ORDER BY c.s DESC)) c
   WHERE c.puesto = 1 AND (c.s >= 2 OR (c.s >= 0.8 AND c.s - coalesce(c.s2, 0) >= 0.1))),
r10 AS (
  SELECT g.ruc, g.sec_ejec, 'pliego ' || g.pliego_nombre AS como, 'pliego regional entero' AS regla, 10 AS orden FROM gr g),
-- Ninguna regla de una sola unidad toma la de otro RUC (el pliego regional entero las suma todas: es el total del gobierno).
una AS (
  SELECT u.* FROM (SELECT * FROM r1 UNION ALL SELECT * FROM r2 UNION ALL SELECT * FROM r3 UNION ALL SELECT * FROM r4
                   UNION ALL SELECT * FROM r5 UNION ALL SELECT * FROM r6 UNION ALL SELECT * FROM r7 UNION ALL SELECT * FROM r8
                   UNION ALL SELECT * FROM r9) u
   WHERE NOT EXISTS (SELECT 1 FROM duena d WHERE d.sec_ejec = u.sec_ejec AND d.ruc <> u.ruc)),
todo AS (SELECT * FROM una UNION ALL SELECT * FROM r10),
gana AS (SELECT t.ruc, min(t.orden) AS orden FROM todo t GROUP BY t.ruc)
SELECT DISTINCT t.ruc, t.sec_ejec, t.como, t.regla
  FROM todo t JOIN gana g ON g.ruc = t.ruc AND g.orden = t.orden
$$;

/*
 * Como en la 63 (por departamento y por entidad), pero cada entidad cruza primero por la llave de la OECE (entidad_siaf):
 *   · código de unidad ejecutora → esa unidad (keyword 'oece <unidad>');
 *   · código de pliego → todas las unidades del pliego (keyword 'pliego <pliego>');
 *   · fuera del SIAF, o una unidad sin datos en los años cargados → sin fila (no se le busca otra por parecido).
 * Las entidades que no están en entidad_siaf, por mef_cruce_heuristico(). `fuente` dice cuál de los dos fue.
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

  WITH ejec AS (SELECT DISTINCT ON (sec_ejec) sec_ejec, ejecutora_nombre, pliego, pliego_nombre, sector, nivel_gobierno
                  FROM mef_ejecutora_anual ORDER BY sec_ejec, anio DESC),
  oece AS (
    -- la unidad ejecutora que la OECE registra para el RUC…
    SELECT s.ruc, x.sec_ejec, 'oece ' || x.ejecutora_nombre AS como
      FROM entidad_siaf s JOIN entidades en ON en.ruc = s.ruc JOIN ejec x ON x.sec_ejec = s.sec_ejec::text
     WHERE NOT s.es_pliego
    UNION ALL
    -- …o, si su código es el de un pliego, todas las unidades del pliego (la ficha dice que es el pliego entero)
    SELECT s.ruc, y.sec_ejec, 'pliego ' || x.pliego_nombre
      FROM entidad_siaf s JOIN entidades en ON en.ruc = s.ruc JOIN ejec x ON x.sec_ejec = s.sec_ejec::text
      JOIN ejec y ON y.nivel_gobierno = x.nivel_gobierno AND y.sector IS NOT DISTINCT FROM x.sector AND y.pliego = x.pliego
     WHERE s.es_pliego AND btrim(coalesce(x.pliego, '')) <> ''),
  cruce AS (
    SELECT DISTINCT c.ruc, c.sec_ejec, c.como, c.fuente
      FROM (SELECT o.ruc, o.sec_ejec, o.como, 'oece' AS fuente FROM oece o
            UNION ALL
            -- sólo las entidades que la OECE no registra (mef_cruce_heuristico(false))
            SELECT h.ruc, h.sec_ejec, h.como, 'heuristica' FROM mef_cruce_heuristico(false) h) c),
  sumas AS (
    SELECT c.ruc, m.anio, sum(m.pia) pia, sum(m.pim) pim, sum(m.certificado) cert, sum(m.comprometido) comp,
           sum(m.devengado) dev, sum(m.girado) gir, sum(m.filas) filas
      FROM cruce c JOIN mef_ejecutora_anual m ON m.sec_ejec = c.sec_ejec
     WHERE m.anio IN (SELECT DISTINCT anio FROM mef_ejecutora_anual ORDER BY anio DESC LIMIT 5)
     GROUP BY 1, 2)
  INSERT INTO mef_entity_budget (entidad_ruc, keyword, total_rows, by_year, matched_pliegos, sec_ejecs, fuente, kind, last_refreshed)
  SELECT s.ruc,
         (SELECT min(como) FROM cruce c WHERE c.ruc = s.ruc),
         coalesce(max(s.filas) FILTER (WHERE s.anio = ult), 0),
         jsonb_agg(jsonb_build_object('year', s.anio, 'pia', s.pia, 'pim', s.pim, 'certificado', s.cert,
                   'comprometido', s.comp, 'devengado', s.dev, 'girado', s.gir) ORDER BY s.anio),
         (SELECT array_agg(DISTINCT x.ejecutora_nombre) FROM cruce c JOIN ejec x USING (sec_ejec) WHERE c.ruc = s.ruc),
         (SELECT array_agg(DISTINCT c.sec_ejec ORDER BY c.sec_ejec) FROM cruce c WHERE c.ruc = s.ruc),
         (SELECT min(fuente) FROM cruce c WHERE c.ruc = s.ruc),
         'ok', now()
    FROM sumas s GROUP BY s.ruc
  ON CONFLICT (entidad_ruc) DO UPDATE SET keyword = EXCLUDED.keyword, total_rows = EXCLUDED.total_rows,
    by_year = EXCLUDED.by_year, matched_pliegos = EXCLUDED.matched_pliegos, sec_ejecs = EXCLUDED.sec_ejecs,
    fuente = EXCLUDED.fuente, kind = 'ok', last_refreshed = now();
  GET DIAGNOSTICS e = ROW_COUNT;
  -- Lo que no se tocó en esta corrida ya no cruza (o era del método anterior): fuera.
  DELETE FROM mef_entity_budget WHERE last_refreshed < now();
  RETURN QUERY SELECT r, e;
END $$;

ALTER FUNCTION mef_base_municipal(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION mef_nucleo(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION mef_sin_prefijo(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION mef_cruce_heuristico(BOOLEAN) OWNER TO vigia_jobs;
ALTER FUNCTION refrescar_mef_presupuesto() OWNER TO vigia_jobs;
-- Con `todas` recorre las 3,162 entidades (~30 s de CPU): sólo la corren vigia_jobs (dueño) y el operador.
REVOKE EXECUTE ON FUNCTION mef_cruce_heuristico(BOOLEAN) FROM PUBLIC;
DO $$
BEGIN
  -- Los privilegios por defecto de la 43 dan a vigia_agentes EXECUTE en toda función nueva.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_agentes') THEN
    REVOKE EXECUTE ON FUNCTION mef_cruce_heuristico(BOOLEAN) FROM vigia_agentes;
  END IF;
END $$;
