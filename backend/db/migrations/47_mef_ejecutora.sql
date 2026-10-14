-- 47 · Presupuesto del MEF desde el archivo "Presupuesto y Ejecución de Gasto".
--
-- En octubre de 2026 el MEF quitó `datastore_search_sql` (404 "Recurso no encontrado") y vació el recurso
-- comparativo_gastos_2022_2026 (510bae6d…): la consulta en vivo del frontend y fetch_mef_*.py dejaron de
-- funcionar. La fuente completa que queda es `<año>-Gasto-Diario.zip` (dataset presupuesto-y-ejecucion-de-gasto,
-- regenerado a diario; 2026: 549 MB zip / 8,2 GB CSV / 8,95 M filas). El scraper `mef_presupuesto`
-- (backend/scrapers-worker y backend/scrapers) lo agrega por unidad ejecutora (≈ 2 900 filas por año) y por
-- departamento × sector/pliego/programa/genérica, y `refrescar_mef_presupuesto()` rehace las dos tablas que ya
-- lee Vigía (mef_region_budget, mef_entity_budget).
--
-- Semántica del archivo: MES_EJE = 0 trae PIA y PIM (anuales); MES_EJE 1-12, la ejecución del mes (certificado,
-- comprometido, devengado, girado). Sumar todas las filas da el año (verificado con la unidad ejecutora 721 contra
-- la descarga filtrada del MEF: PIA 395,64 M · PIM 446,65 M · devengado 366,64 M).
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/47_mef_ejecutora.sql

CREATE TABLE IF NOT EXISTS mef_ejecutora_anual (
  anio                    SMALLINT NOT NULL,
  sec_ejec                TEXT     NOT NULL,             -- código de la unidad ejecutora en el año
  ejecutora               TEXT,                          -- en gobiernos locales = ubigeo de la municipalidad
  ejecutora_nombre        TEXT,
  pliego                  TEXT,                          -- vacío en gobiernos locales
  pliego_nombre           TEXT,
  sector                  TEXT,
  sector_nombre           TEXT,
  nivel_gobierno          CHAR(1),                       -- E nacional · R regional · M local
  departamento            TEXT,
  departamento_nombre     TEXT,
  provincia               TEXT,
  provincia_nombre        TEXT,
  distrito                TEXT,
  distrito_nombre         TEXT,
  pia                     NUMERIC(18, 2) NOT NULL DEFAULT 0,
  pim                     NUMERIC(18, 2) NOT NULL DEFAULT 0,
  certificado             NUMERIC(18, 2) NOT NULL DEFAULT 0,
  comprometido_anual      NUMERIC(18, 2) NOT NULL DEFAULT 0,
  comprometido            NUMERIC(18, 2) NOT NULL DEFAULT 0,
  devengado               NUMERIC(18, 2) NOT NULL DEFAULT 0,
  girado                  NUMERIC(18, 2) NOT NULL DEFAULT 0,
  filas                   INT      NOT NULL DEFAULT 0,   -- filas del archivo del MEF sumadas
  corte                   TIMESTAMPTZ,                   -- Last-Modified del archivo del MEF
  PRIMARY KEY (anio, sec_ejec)
);
CREATE INDEX IF NOT EXISTS mef_ejecutora_dep_idx ON mef_ejecutora_anual (anio, departamento_nombre);
CREATE INDEX IF NOT EXISTS mef_ejecutora_ejec_idx ON mef_ejecutora_anual (nivel_gobierno, ejecutora);

CREATE TABLE IF NOT EXISTS mef_departamento_desglose (
  anio                    SMALLINT NOT NULL,
  departamento_nombre     TEXT     NOT NULL,
  tipo                    TEXT     NOT NULL CHECK (tipo IN ('sector', 'pliego', 'programa', 'generica')),
  nombre                  TEXT     NOT NULL,             -- en 'pliego', las municipalidades van por su ejecutora
  pia                     NUMERIC(18, 2) NOT NULL DEFAULT 0,
  pim                     NUMERIC(18, 2) NOT NULL DEFAULT 0,
  devengado               NUMERIC(18, 2) NOT NULL DEFAULT 0,
  PRIMARY KEY (anio, departamento_nombre, tipo, nombre)
);

-- Las carga vigia_jobs (dueño, como las demás tablas de datasets: 37/46); la API solo lee.
ALTER TABLE mef_ejecutora_anual OWNER TO vigia_jobs;
ALTER TABLE mef_departamento_desglose OWNER TO vigia_jobs;
GRANT SELECT ON mef_ejecutora_anual, mef_departamento_desglose TO vigia_api;

-- Clave de nombre: mayúsculas, sin tildes ni signos, espacios simples.
CREATE OR REPLACE FUNCTION mef_norm(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(regexp_replace(upper(immutable_unaccent(coalesce(t, ''))), '[^A-Z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

/*
 * Rehace mef_region_budget (por departamento: los últimos 5 años y el top 6 del último por sector, pliego,
 * programa y genérica) y mef_entity_budget (cada entidad con su(s) unidad(es) ejecutora(s)):
 *   · municipalidades: ejecutora = ubigeo de la entidad, mismo tipo (PROVINCIAL/DISTRITAL)
 *   · gobiernos regionales: el pliego "GOBIERNO REGIONAL DEL DEPARTAMENTO DE <depto>" entero
 *   · el resto: nombre igual, prefijo (≥ 20 letras) o trigramas ≥ 0,6 contra la ejecutora nacional
 * (2026-10-14: 1 974 de 2 187 entidades; lo que falta son sobre todo empresas de FONAFE, fuera de este
 * presupuesto). Los años de una región que todavía no están en mef_ejecutora_anual (más viejos que el primero
 * cargado) se conservan de lo que ya tenía la fila: así no se pierde la historia que vino del recurso anterior.
 * Las entidades que dejan de cruzar se borran. Devuelve cuántas filas escribió.
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
  cruce AS (
    -- municipalidades: la ejecutora del gobierno local es el ubigeo de la municipalidad
    SELECT e.ruc, x.sec_ejec, 'ubigeo ' || e.ubigeo AS como
      FROM ent e JOIN ejec x ON x.nivel_gobierno = 'M' AND x.ejecutora = e.ubigeo
     WHERE e.n LIKE 'MUNICIPALIDAD%'
       AND (e.n NOT LIKE '%PROVINCIAL%' OR mef_norm(x.ejecutora_nombre) LIKE '%PROVINCIAL%')
       AND (e.n NOT LIKE '%DISTRITAL%' OR mef_norm(x.ejecutora_nombre) LIKE '%DISTRITAL%')
    UNION ALL
    -- gobiernos regionales: el pliego del departamento (todas sus unidades), como antes
    -- (el departamento puede tener varias palabras: LA LIBERTAD, MADRE DE DIOS, SAN MARTIN)
    SELECT e.ruc, x.sec_ejec, 'pliego ' || x.pliego_nombre
      FROM ent e JOIN ejec x ON x.nivel_gobierno = 'R'
       AND mef_norm(x.pliego_nombre) LIKE 'GOBIERNO REGIONAL DEL DEPARTAMENTO DE %'
       AND e.n ~ ('^GOB(IERNO)? REG(IONAL)? (DEL? )?(DEPARTAMENTO DE )?'
                  || replace(mef_norm(x.pliego_nombre), 'GOBIERNO REGIONAL DEL DEPARTAMENTO DE ', '') || '( |$)')
     WHERE e.n LIKE 'GOB% REG%'
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
