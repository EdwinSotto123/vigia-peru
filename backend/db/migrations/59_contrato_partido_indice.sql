-- 59 · `contrato_partido_idx`: contrato → partido que gobernaba la entidad, materializado e indexado.
--
-- El filtro "Partido que gobierna" de /app/contratos y del mapa (GET /contratos?partido=, /contratos/geo?partido=)
-- consultaba la vista `contrato_partido` (migración 41: convocatorias × entidad_gobierno × gobierno_periodo por fecha),
-- ~45 ms por partido y ~120 ms entera; el resumen la recorre 3 o 4 veces y en frío tardaba 1,3–1,7 s. Esta tabla
-- guarda sólo (ocid, org_clave) con índice por partido: el filtro pasa a ser una búsqueda por índice.
--
-- Se rehace en `refrescar_casos_cruce()` (vigia-scrapers la llama tras cargar contratos nuevos).
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/59_contrato_partido_indice.sql

CREATE TABLE IF NOT EXISTS contrato_partido_idx (
  ocid       TEXT NOT NULL,
  org_clave  TEXT NOT NULL,
  PRIMARY KEY (org_clave, ocid)
);
CREATE INDEX IF NOT EXISTS contrato_partido_idx_ocid ON contrato_partido_idx (ocid);
ALTER TABLE contrato_partido_idx OWNER TO vigia_jobs;
GRANT SELECT ON contrato_partido_idx TO vigia_api;

CREATE OR REPLACE FUNCTION refrescar_contrato_partido() RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  DELETE FROM contrato_partido_idx;
  INSERT INTO contrato_partido_idx (ocid, org_clave)
  SELECT DISTINCT ocid, org_clave FROM contrato_partido WHERE org_clave IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE contrato_partido_idx;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_contrato_partido() OWNER TO vigia_jobs;

-- El envoltorio de la migración 58, con este refresco también.
CREATE OR REPLACE FUNCTION refrescar_casos_cruce() RETURNS INT
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refrescar_contrato_partido();
  PERFORM refrescar_cruce_otro_postor();
  RETURN refrescar_casos_cruce_base();
END $$;
ALTER FUNCTION refrescar_casos_cruce() OWNER TO vigia_jobs;

GRANT SELECT ON contrato_partido, entidad_gobierno, gobierno_periodo TO vigia_jobs;
SELECT refrescar_contrato_partido();
