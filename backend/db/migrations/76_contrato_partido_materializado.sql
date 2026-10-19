-- 76 · `contrato_partido` materializado entero: con la historia del OECE en la base, la vista calculada no alcanza.
--
-- La vista de la migración 41 cruzaba en cada consulta convocatorias × entidad_gobierno × gobierno_periodo por fecha.
-- Con ~20 mil contratos tardaba ~120 ms; con la historia desde 2015 (~650 mil) el ranking de partidos y la ficha de
-- un partido pasaron los 10 s del rol vigia_api y respondían 500. Ahora:
--   · contrato_partido_calculado: la definición de siempre (la usa sólo el refresco),
--   · contrato_partido_tabla: el resultado, con índices por partido y período (lo rehace refrescar_contrato_partido(),
--     dentro de refrescar_casos_cruce(), que vigia-scrapers corre tras cargar contratos),
--   · contrato_partido: la misma vista de siempre, con las mismas columnas, que lee la tabla. La API, el aporte por
--     partido y zona_de_partido() no cambian.
-- contrato_partido_idx (ocid, org_clave) se sigue rehaciendo igual, para el filtro de /contratos?partido=.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/76_contrato_partido_materializado.sql

CREATE OR REPLACE VIEW contrato_partido_calculado AS
SELECT c.ocid, c.entidad_ruc, c.fecha_convocatoria,
       g.org_clave, g.org_nombre, g.org_tipo, g.anio_eleccion, g.nivel, g.ubigeo AS gobierno_ubigeo, g.autoridad
FROM convocatorias c
JOIN entidad_gobierno eg ON eg.ruc = c.entidad_ruc
JOIN gobierno_periodo g  ON g.nivel = eg.nivel AND g.ubigeo = eg.ubigeo
                        AND c.fecha_convocatoria BETWEEN g.desde AND g.hasta;
ALTER VIEW contrato_partido_calculado OWNER TO vigia_jobs;

-- Las mismas columnas y tipos que la vista (CREATE TABLE AS ... WITH NO DATA los copia).
CREATE TABLE IF NOT EXISTS contrato_partido_tabla AS SELECT * FROM contrato_partido_calculado WITH NO DATA;
CREATE UNIQUE INDEX IF NOT EXISTS contrato_partido_tabla_pk ON contrato_partido_tabla (org_clave, anio_eleccion, ocid);
CREATE INDEX IF NOT EXISTS contrato_partido_tabla_ocid ON contrato_partido_tabla (ocid);
CREATE INDEX IF NOT EXISTS contrato_partido_tabla_periodo ON contrato_partido_tabla (anio_eleccion, org_clave);
ALTER TABLE contrato_partido_tabla OWNER TO vigia_jobs;
GRANT SELECT ON contrato_partido_tabla TO vigia_api, vigia_api_admin;

CREATE OR REPLACE VIEW contrato_partido AS
SELECT ocid, entidad_ruc, fecha_convocatoria, org_clave, org_nombre, org_tipo, anio_eleccion, nivel, gobierno_ubigeo, autoridad
FROM contrato_partido_tabla;
COMMENT ON VIEW contrato_partido IS
  'Contrato asociado al partido que gobernaba la entidad cuando se convocó (migración 41), leído de contrato_partido_tabla '
  '(migración 76; la rehace refrescar_contrato_partido()).';

CREATE OR REPLACE FUNCTION refrescar_contrato_partido() RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  -- DELETE y no TRUNCATE: quien lee (la API) sigue viendo lo anterior hasta que esto termina, sin quedar bloqueado.
  DELETE FROM contrato_partido_tabla;
  INSERT INTO contrato_partido_tabla
  SELECT DISTINCT ON (org_clave, anio_eleccion, ocid) * FROM contrato_partido_calculado WHERE org_clave IS NOT NULL
  ORDER BY org_clave, anio_eleccion, ocid;
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM contrato_partido_idx;
  INSERT INTO contrato_partido_idx (ocid, org_clave) SELECT DISTINCT ocid, org_clave FROM contrato_partido_tabla;
  ANALYZE contrato_partido_tabla;
  ANALYZE contrato_partido_idx;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_contrato_partido() OWNER TO vigia_jobs;
GRANT SELECT ON contrato_partido_calculado TO vigia_jobs;

SELECT refrescar_contrato_partido();
