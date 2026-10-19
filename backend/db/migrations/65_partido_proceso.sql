-- 65 · Los procesos de cada partido desde 2018, con los datos de CONOSCE (no sólo la base de Vigía).
--
-- "Contratos por partido" (migraciones 41 y 59) asociaba al partido sólo los contratos de la base de Vigía, que son de
-- 2026 (~21 mil). Para el período 2019-2022 decía "Ningún contrato se asocia a un partido" y la ficha de un partido
-- listaba sus 15 entidades con más contratos. CONOSCE (conosce_adjudicaciones) trae los procesos adjudicados de todo el
-- Estado desde 2018 (≈ 470 mil): con ellos cada partido tiene su historia completa.
--
--   1. entidad_gobierno_amplia: de qué gobierno es cada entidad. La vista entidad_gobierno (41) sólo conoce las
--      entidades de la base de Vigía; una municipalidad que no convocó nada en 2026 quedaba sin gobierno y perdía su
--      historia. Aquí, además:
--        · municipalidades de CONOSCE por su nombre, contra las municipalidades del MEF (ejecutora = ubigeo), en su
--          departamento: igual, o el nombre más largo del MEF que empieza el de CONOSCE ("… DE HUANCAS - AMAZONAS"), si
--          es uno solo;
--        · entidades de tipo GOBIERNO REGIONAL (sedes, hospitales, UGEL…) por su departamento.
--   2. partido_proceso: un proceso adjudicado por fila (código de convocatoria × entidad; ítems repetidos entre años,
--      una vez), con el partido que gobernaba la entidad el día en que se convocó, el ganador principal (el de mayor
--      monto adjudicado), los montos y el ocid si el proceso también está en la base de Vigía. `monto_adjudicado_pen`
--      sólo para soles: los procesos en dólares o euros cuentan, pero no se suman a soles.
--
-- Lo que no dice: se asocia al GANADOR de la elección (una vacancia o un reemplazo no se registra) y CONOSCE empieza en
-- 2018 (del período 2015-2018 sólo está 2018).
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/65_partido_proceso.sql
-- y después: SELECT * FROM refrescar_partido_proceso();   (lo corre vigia-scrapers después de cada carga de CONOSCE)

CREATE TABLE IF NOT EXISTS entidad_gobierno_amplia (
  ruc     TEXT PRIMARY KEY,
  nivel   TEXT NOT NULL CHECK (nivel IN ('regional', 'provincial', 'distrital')),
  ubigeo  TEXT NOT NULL,
  como    TEXT NOT NULL            -- entidades (vista 41) · mef (nombre de la municipalidad) · departamento (gobierno regional)
);

CREATE TABLE IF NOT EXISTS partido_proceso (
  codigo_convocatoria  TEXT NOT NULL,
  entidad_ruc          TEXT NOT NULL,
  entidad              TEXT,
  anio                 SMALLINT,
  fecha_convocatoria   DATE NOT NULL,
  objeto               TEXT,
  tipo_proceso         TEXT,
  nomenclatura         TEXT,
  descripcion          TEXT,
  items                INT,
  monto_referencial    NUMERIC(18, 2),
  monto_adjudicado     NUMERIC(18, 2),
  monto_adjudicado_pen NUMERIC(18, 2),
  moneda               TEXT,
  proveedores          INT,
  proveedor            TEXT,
  ruc_proveedor        TEXT,
  org_clave            TEXT NOT NULL,
  anio_eleccion        INT NOT NULL,
  nivel                TEXT NOT NULL,
  gobierno_ubigeo      TEXT NOT NULL,
  autoridad            TEXT,
  ocid                 TEXT,
  PRIMARY KEY (codigo_convocatoria, entidad_ruc)
);
CREATE INDEX IF NOT EXISTS partido_proceso_org ON partido_proceso (org_clave, anio_eleccion, fecha_convocatoria DESC);
CREATE INDEX IF NOT EXISTS partido_proceso_gob ON partido_proceso (anio_eleccion, nivel, gobierno_ubigeo);
-- Sin índice de texto: la búsqueda (GET /partidos/:clave/procesos?q=) siempre va dentro de un partido y un período
-- (≤ 30 mil filas por el índice de arriba), y un GIN de trigramas triplicaba el tiempo del refresco.

ALTER TABLE entidad_gobierno_amplia OWNER TO vigia_jobs;
ALTER TABLE partido_proceso OWNER TO vigia_jobs;
GRANT SELECT ON entidad_gobierno_amplia, partido_proceso TO vigia_api;
GRANT SELECT ON entidad_gobierno, gobierno_periodo, conosce_adjudicaciones, mef_ejecutora_anual, zonas, convocatorias TO vigia_jobs;

CREATE OR REPLACE FUNCTION refrescar_partido_proceso() RETURNS TABLE (entidades INT, procesos INT)
LANGUAGE plpgsql AS $$
DECLARE ne INT; np INT;
BEGIN
  -- DELETE y no TRUNCATE: quien lee (la API) sigue viendo lo anterior hasta que esto termina, sin quedar bloqueado.
  DELETE FROM entidad_gobierno_amplia;
  INSERT INTO entidad_gobierno_amplia (ruc, nivel, ubigeo, como)
  WITH e AS (SELECT DISTINCT ON (entidad_ruc) entidad_ruc AS ruc, mef_norm(entidad) AS n, mef_norm(entidad_departamento) AS dep, tipo_entidad
               FROM conosce_adjudicaciones ORDER BY entidad_ruc, anio DESC),
       m AS (SELECT DISTINCT ON (ejecutora) ejecutora AS ubigeo, mef_norm(ejecutora_nombre) AS n, mef_norm(departamento_nombre) AS dep
               FROM mef_ejecutora_anual WHERE nivel_gobierno = 'M' AND ejecutora ~ '^\d{6}$' ORDER BY ejecutora, anio DESC),
       d AS (SELECT ubigeo, mef_norm(nombre) AS dep FROM zonas WHERE length(ubigeo) = 2),
       muni AS (SELECT e.ruc, e.n, e.dep, CASE WHEN e.n ~ '^MUNICIPALIDAD DISTRITAL' THEN 'distrital' ELSE 'provincial' END AS nivel
                  FROM e WHERE e.n ~ '^MUNICIPALIDAD (PROVINCIAL|METROPOLITANA|DISTRITAL)'),
       -- Igual nombre en el mismo departamento; si no, el nombre más largo del MEF que empieza el de CONOSCE.
       cand AS (SELECT u.ruc, u.nivel, m.ubigeo, (m.n = u.n) AS igual, length(m.n) AS largo
                  FROM muni u JOIN m ON m.dep = u.dep AND (m.n = u.n OR left(u.n, length(m.n) + 1) = m.n || ' ')),
       mejor AS (SELECT DISTINCT ON (ruc) ruc, nivel, ubigeo, igual, largo FROM cand ORDER BY ruc, igual DESC, largo DESC),
       -- Sin empate: otro candidato igual de bueno descarta el cruce.
       unico AS (SELECT b.* FROM mejor b
                  WHERE NOT EXISTS (SELECT 1 FROM cand c WHERE c.ruc = b.ruc AND c.ubigeo <> b.ubigeo AND c.igual = b.igual AND c.largo = b.largo))
  SELECT eg.ruc, eg.nivel, eg.ubigeo, 'entidades' FROM entidad_gobierno eg
  UNION ALL
  SELECT x.ruc, x.nivel, CASE WHEN x.nivel = 'provincial' THEN left(x.ubigeo, 4) ELSE x.ubigeo END, 'mef'
    FROM unico x WHERE NOT EXISTS (SELECT 1 FROM entidad_gobierno eg WHERE eg.ruc = x.ruc)
  UNION ALL
  SELECT e.ruc, 'regional', d.ubigeo, 'departamento'
    FROM e JOIN d ON d.dep = e.dep
   WHERE e.tipo_entidad = 'GOBIERNO REGIONAL' AND e.n !~ 'METROPOLITANA'
     AND NOT EXISTS (SELECT 1 FROM entidad_gobierno eg WHERE eg.ruc = e.ruc)
  ON CONFLICT (ruc) DO NOTHING;
  GET DIAGNOSTICS ne = ROW_COUNT;

  DELETE FROM partido_proceso;
  INSERT INTO partido_proceso (codigo_convocatoria, entidad_ruc, entidad, anio, fecha_convocatoria, objeto, tipo_proceso, nomenclatura,
                               descripcion, items, monto_referencial, monto_adjudicado, monto_adjudicado_pen, moneda, proveedores, proveedor,
                               ruc_proveedor, org_clave, anio_eleccion, nivel, gobierno_ubigeo, autoridad, ocid)
  WITH a AS (SELECT DISTINCT ON (x.codigo_convocatoria, x.entidad_ruc, x.n_item) x.*
               FROM conosce_adjudicaciones x JOIN entidad_gobierno_amplia g ON g.ruc = x.entidad_ruc
              ORDER BY x.codigo_convocatoria, x.entidad_ruc, x.n_item, x.anio DESC),
       p AS (SELECT a.codigo_convocatoria, a.entidad_ruc, max(a.entidad) AS entidad, min(a.anio) AS anio, min(a.fecha_convocatoria) AS fecha,
                    max(a.objeto) AS objeto, max(a.tipo_proceso) AS tipo_proceso, max(a.nomenclatura) AS nomenclatura,
                    max(a.descripcion_proceso) AS descripcion, count(*)::int AS items, sum(a.monto_referencial) AS referencial,
                    sum(a.monto_adjudicado) AS adjudicado,
                    sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS adjudicado_pen,
                    max(a.moneda) AS moneda, count(DISTINCT a.ruc_proveedor)::int AS proveedores,
                    (array_agg(a.proveedor ORDER BY a.monto_adjudicado DESC NULLS LAST))[1] AS proveedor,
                    (array_agg(a.ruc_proveedor ORDER BY a.monto_adjudicado DESC NULLS LAST))[1] AS ruc_proveedor
               FROM a GROUP BY 1, 2)
  SELECT p.codigo_convocatoria, p.entidad_ruc, p.entidad, p.anio, p.fecha, p.objeto, p.tipo_proceso, p.nomenclatura, p.descripcion, p.items,
         p.referencial, p.adjudicado, p.adjudicado_pen, p.moneda, p.proveedores, p.proveedor, p.ruc_proveedor,
         gp.org_clave, gp.anio_eleccion, gp.nivel, gp.ubigeo, gp.autoridad, c.ocid
    FROM p
    JOIN entidad_gobierno_amplia eg ON eg.ruc = p.entidad_ruc
    JOIN gobierno_periodo gp ON gp.nivel = eg.nivel AND gp.ubigeo = eg.ubigeo AND p.fecha BETWEEN gp.desde AND gp.hasta
    LEFT JOIN convocatorias c ON c.ocid = p.codigo_convocatoria
  ON CONFLICT (codigo_convocatoria, entidad_ruc) DO NOTHING;
  GET DIAGNOSTICS np = ROW_COUNT;
  RETURN QUERY SELECT ne, np;
END $$;
ALTER FUNCTION refrescar_partido_proceso() OWNER TO vigia_jobs;
GRANT EXECUTE ON FUNCTION refrescar_partido_proceso() TO vigia_jobs;
