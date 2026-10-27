-- 152 · El presupuesto del MEF de cada entidad desde 2015, y el de los organismos públicos descentralizados (OPD) y las
-- empresas municipales (ETE), que no están en el archivo del SIAF.
--
-- Auditoría de la ficha de entidad (2026-10-27): la pestaña «Cuánto gasta» sólo tenía 2025 y 2026, y 77 fichas no tenían
-- presupuesto: 75 con su código de la OECE (entidad_siaf, migraciones 150 y 151) y 2 que la OECE no registra.
--   · 38 son unidades ejecutoras nacionales que ya no gastan (Hospital de Vitarte 1217, ARCC 1677, AATE 1338, las redes
--     de salud de Lima 1151-1156, FONDECYT 1522, FITEL 1260, PARSALUD 1315…) y 6 mancomunidades municipales (350xxx):
--     su último año es anterior a 2025. Ahora vigia-scrapers carga también `<año>-Gasto.zip` (2015-2024; el MEF los
--     regeneró del 18 al 20 de octubre de 2026, con las mismas 63 columnas que el diario) y refrescar_mef_presupuesto()
--     les da TODOS los años cargados, no los 5 últimos: así tienen su último presupuesto, y la ficha dice de qué año es.
--   · 31 tienen un código 500xxx: son OPD (SAT de Lima 500231, Serpar 500232, Parque de las Leyendas 500238, Hospital
--     Municipal Los Olivos 500294…) y ETE (EPS Loreto 500136, EMAPA Pisco 500138, SEDA Juliaca 500147…). El MEF publica
--     su gasto aparte: `<año>-Gasto-OPDS.zip` (desde 2018) y `<año>-Gastos-ETES.zip` (desde 2015). Los carga la fuente
--     `mef_opds_etes` de vigia-scrapers en las dos tablas de abajo.
--
-- Las OPD y ETE NO van en mef_ejecutora_anual a propósito: esa tabla la suman por departamento la ficha de la región
-- (mef_region_budget), el árbol del gobierno nacional (/poder), los gobiernos de cada partido (refrescar_partido_proceso,
-- /partidos/:clave/gasto) y corregir_ubigeo_municipal(). Ninguno de ellos las contó nunca, y así siguen: sólo las lee la
-- parte de las ENTIDADES de refrescar_mef_presupuesto() (y la API de la ficha). El código de una OPD o ETE (500xxx) nunca
-- es el de una unidad del SIAF (≤ 360003), así que una entidad no puede sumar las dos.
--
-- Lo que trae cada archivo (verificado con los 21 ZIP el 2026-10-27):
--   · OPDS: 58 columnas, los 7 montos (PIA, PIM, certificado, comprometido anual, comprometido, devengado, girado), sin
--     pliego, sector ni nivel de gobierno (trae GRUPO_ENTIDAD: 14 OPD municipales, 17 OPD regionales). 30-31 unidades.
--   · ETES: 51 columnas y tres montos: PIA, PIM y MONTO_EJECUCION, lo ejecutado que la empresa le reporta al MEF cada mes
--     (algunas, cada trimestre), sin partirlo en devengado y girado. Se guarda en `devengado` y `origen = 'etes'` lo dice;
--     certificado, comprometido y girado quedan en NULL (no es que sean cero). 68-98 unidades.
--   · Hasta 2018 el archivo de ETES trae también las OPD (grupos 14 y 17), y en 2018 están en los dos. Ahí su «ejecución»
--     no es su devengado (SAT de Lima 2018: S/ 455 M de «ejecución», con un PIM de S/ 124 M y un devengado de S/ 108 M en
--     el de OPDS), así que la fuente las salta: las OPD salen sólo del archivo de OPDS (desde 2018).
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/152_mef_historia_opds_etes.sql   (o dev.sh migrar)
-- Después, con el Worker de scrapers ya desplegado (un año por corrida: cada lectura del ZIP del SIAF usa ~150 s de CPU):
--   POST /correr {"fuente":"mef_presupuesto","desde":"2015","hasta":"2015"}   … y así hasta 2024
--   POST /correr {"fuente":"mef_opds_etes","desde":"2015","hasta":"2026"}
-- Cada corrida termina con refrescar_mef_presupuesto(). Mientras no corran, la función hace lo mismo que la de la 151 con
-- los años que haya.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS mef_opds_etes_anual (
  origen                  TEXT     NOT NULL CHECK (origen IN ('opds', 'etes')),
  anio                    SMALLINT NOT NULL,
  sec_ejec                TEXT     NOT NULL,             -- 500xxx: el código que la OECE da como CODIGO_SIAF
  ejecutora               TEXT,
  ejecutora_nombre        TEXT,
  grupo_entidad           TEXT,                          -- 05 EPS municipales, 06 eléctricas… 14 OPD municipales, 17 regionales
  grupo_entidad_nombre    TEXT,
  departamento            TEXT,
  departamento_nombre     TEXT,
  provincia               TEXT,
  provincia_nombre        TEXT,
  distrito                TEXT,
  distrito_nombre         TEXT,
  pia                     NUMERIC(18, 2) NOT NULL DEFAULT 0,
  pim                     NUMERIC(18, 2) NOT NULL DEFAULT 0,
  certificado             NUMERIC(18, 2),                -- NULL en las ETE: no lo publican
  comprometido_anual      NUMERIC(18, 2),
  comprometido            NUMERIC(18, 2),
  devengado               NUMERIC(18, 2),                -- en las ETE, MONTO_EJECUCION (ver arriba)
  girado                  NUMERIC(18, 2),
  filas                   INT      NOT NULL DEFAULT 0,   -- filas del archivo del MEF sumadas
  corte                   TIMESTAMPTZ,                   -- Last-Modified del archivo del MEF
  PRIMARY KEY (anio, sec_ejec)
);
COMMENT ON TABLE mef_opds_etes_anual IS
  'Presupuesto por año de las OPD (<año>-Gasto-OPDS.zip) y ETE (<año>-Gastos-ETES.zip) del MEF. Sólo para las fichas de entidad: no se suma por departamento. Migración 152.';
COMMENT ON COLUMN mef_opds_etes_anual.devengado IS
  'OPD: MONTO_DEVENGADO. ETE: MONTO_EJECUCION, lo ejecutado que la empresa reporta (no lo separa en devengado y girado).';

CREATE TABLE IF NOT EXISTS mef_opds_etes_gasto (
  origen     TEXT     NOT NULL CHECK (origen IN ('opds', 'etes')),
  anio       SMALLINT NOT NULL,
  sec_ejec   TEXT     NOT NULL,
  tipo       TEXT     NOT NULL CHECK (tipo IN ('partida', 'funcion', 'proyecto', 'especifica', 'rubro', 'mes', 'programa', 'producto')),
  codigo     TEXT     NOT NULL,
  nombre     TEXT,
  grupo      TEXT,
  pia        NUMERIC(18, 2) NOT NULL DEFAULT 0,
  pim        NUMERIC(18, 2) NOT NULL DEFAULT 0,
  devengado  NUMERIC(18, 2) NOT NULL DEFAULT 0,          -- en las ETE, la ejecución (como en mef_opds_etes_anual)
  PRIMARY KEY (anio, sec_ejec, tipo, codigo)
);
COMMENT ON TABLE mef_opds_etes_gasto IS
  'En qué gasta cada OPD y ETE (las mismas ocho miradas que mef_ejecutora_gasto, migraciones 63 y 64). Migración 152.';

-- De qué archivo del MEF sale el presupuesto de la entidad: 'siaf' (mef_ejecutora_anual), 'opds' o 'etes'. La API lo
-- publica: con 'etes', lo que en las demás es «devengado» es la ejecución que reporta la empresa.
ALTER TABLE mef_entity_budget ADD COLUMN IF NOT EXISTS origen TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mef_entity_budget_origen_check') THEN
    ALTER TABLE mef_entity_budget ADD CONSTRAINT mef_entity_budget_origen_check CHECK (origen IN ('siaf', 'opds', 'etes'));
  END IF;
END $$;

/*
 * Como en la 151, con dos cambios en la parte de las ENTIDADES (la de los departamentos queda igual: sólo el SIAF, los 5
 * últimos años):
 *   · cada entidad lleva TODOS los años cargados de sus unidades, no sólo los 5 últimos: una unidad que dejó de gastar en
 *     2019 conserva su historia (antes quedaba sin presupuesto). `total_rows` es el de su último año.
 *   · sus unidades pueden ser también OPD o ETE (mef_opds_etes_anual), a las que llega por el código de la OECE; `origen`
 *     dice de qué archivo salió. Las reglas por parecido (mef_cruce_heuristico) siguen buscando sólo en el SIAF.
 * (Además cada par entidad-unidad se suma una vez: `cruce` lo garantizaba ya, ahora explícito.)
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

  WITH unidad AS MATERIALIZED (
    -- Cada unidad ejecutora en cada año: las del SIAF y, sólo para las entidades, las OPD y ETE.
    SELECT 'siaf'::text AS origen, m.anio, m.sec_ejec, m.ejecutora_nombre, m.pliego, m.pliego_nombre, m.sector, m.nivel_gobierno,
           m.pia, m.pim, m.certificado, m.comprometido, m.devengado, m.girado, m.filas
      FROM mef_ejecutora_anual m
    UNION ALL
    SELECT o.origen, o.anio, o.sec_ejec, o.ejecutora_nombre, NULL, NULL, NULL, NULL,
           o.pia, o.pim, o.certificado, o.comprometido, o.devengado, o.girado, o.filas
      FROM mef_opds_etes_anual o),
  ejec AS (SELECT DISTINCT ON (sec_ejec) sec_ejec, ejecutora_nombre, pliego, pliego_nombre, sector, nivel_gobierno, origen
             FROM unidad ORDER BY sec_ejec, anio DESC),
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
            -- sólo las entidades que la OECE no registra (mef_cruce_heuristico(false)), y sólo con unidades del SIAF
            SELECT h.ruc, h.sec_ejec, h.como, 'heuristica' FROM mef_cruce_heuristico(false) h) c),
  sumas AS (
    -- todos los años de cada unidad
    SELECT c.ruc, m.anio, sum(m.pia) pia, sum(m.pim) pim, sum(m.certificado) cert, sum(m.comprometido) comp,
           sum(m.devengado) dev, sum(m.girado) gir, sum(m.filas) filas
      FROM (SELECT DISTINCT ruc, sec_ejec FROM cruce) c JOIN unidad m ON m.sec_ejec = c.sec_ejec
     GROUP BY 1, 2)
  INSERT INTO mef_entity_budget (entidad_ruc, keyword, total_rows, by_year, matched_pliegos, sec_ejecs, fuente, origen, kind, last_refreshed)
  SELECT s.ruc,
         (SELECT min(como) FROM cruce c WHERE c.ruc = s.ruc),
         coalesce((array_agg(s.filas ORDER BY s.anio DESC))[1], 0),
         -- En las ETE certificado, comprometido y girado van en null (no los publican) y devengado es su ejecución.
         jsonb_agg(jsonb_build_object('year', s.anio, 'pia', s.pia, 'pim', s.pim, 'certificado', s.cert,
                   'comprometido', s.comp, 'devengado', s.dev, 'girado', s.gir) ORDER BY s.anio),
         (SELECT array_agg(DISTINCT x.ejecutora_nombre) FROM cruce c JOIN ejec x USING (sec_ejec) WHERE c.ruc = s.ruc),
         (SELECT array_agg(DISTINCT c.sec_ejec ORDER BY c.sec_ejec) FROM cruce c WHERE c.ruc = s.ruc),
         (SELECT min(fuente) FROM cruce c WHERE c.ruc = s.ruc),
         -- una entidad cruza con unidades de un solo archivo (los códigos 500xxx no están en el SIAF)
         (SELECT min(x.origen) FROM cruce c JOIN ejec x USING (sec_ejec) WHERE c.ruc = s.ruc),
         'ok', now()
    FROM sumas s GROUP BY s.ruc
  ON CONFLICT (entidad_ruc) DO UPDATE SET keyword = EXCLUDED.keyword, total_rows = EXCLUDED.total_rows,
    by_year = EXCLUDED.by_year, matched_pliegos = EXCLUDED.matched_pliegos, sec_ejecs = EXCLUDED.sec_ejecs,
    fuente = EXCLUDED.fuente, origen = EXCLUDED.origen, kind = 'ok', last_refreshed = now();
  GET DIAGNOSTICS e = ROW_COUNT;
  -- Lo que no se tocó en esta corrida ya no cruza (o era del método anterior): fuera.
  DELETE FROM mef_entity_budget WHERE last_refreshed < now();
  RETURN QUERY SELECT r, e;
END $$;

-- Las carga vigia_jobs (dueño, como las demás tablas del MEF: 47, 63); la API, el panel y los agentes sólo leen.
ALTER TABLE mef_opds_etes_anual OWNER TO vigia_jobs;
ALTER TABLE mef_opds_etes_gasto OWNER TO vigia_jobs;
ALTER FUNCTION refrescar_mef_presupuesto() OWNER TO vigia_jobs;
GRANT SELECT ON mef_opds_etes_anual, mef_opds_etes_gasto TO vigia_api, vigia_api_admin;
DO $$
BEGIN
  -- Los privilegios por defecto de la 43 dan a vigia_agentes escritura en toda tabla nueva: aquí sólo lee.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_agentes') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON mef_opds_etes_anual, mef_opds_etes_gasto FROM vigia_agentes;
    GRANT SELECT ON mef_opds_etes_anual, mef_opds_etes_gasto TO vigia_agentes;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_ab') THEN
    GRANT SELECT ON mef_opds_etes_anual, mef_opds_etes_gasto TO vigia_ab;
  END IF;
END $$;
