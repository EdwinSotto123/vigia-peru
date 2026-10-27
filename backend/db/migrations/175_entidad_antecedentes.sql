-- 175 · Cuántos contratos con antecedentes del ganador tiene cada entidad, contados una vez por carga y no en cada pedido.
--
-- La lista de entidades (GET /entidades) y sus cifras (summary) agregaban casos_cruce entero (~210 mil filas, por entidad
-- y contrato) cada vez que un Worker arrancaba con la caché vacía: 1 a 3 s, hasta 10 s con la base ocupada, y la
-- búsqueda de entidades tardaba 4 a 7 s aunque buscar un nombre entre 3 mil es instantáneo. entidad_antecedentes guarda
-- el resultado (~3 mil filas); lo rehace el Worker de scrapers después de refrescar_casos_cruce_base(), del que sale.
--
-- Cómo aplicarla: python infrastructure/dev/dev.py migrar backend/db/migrations/175_entidad_antecedentes.sql (DEV); en
-- producción, el mismo archivo con tunel_rds (se llena al aplicarla).

CREATE TABLE IF NOT EXISTS entidad_antecedentes (
  ruc          TEXT PRIMARY KEY,
  con          INT NOT NULL,          -- contratos con algún antecedente del ganador
  alta         INT NOT NULL,          -- de esos, con alguno grave
  actualizado  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE entidad_antecedentes OWNER TO vigia_jobs;
GRANT SELECT ON entidad_antecedentes TO vigia_api, vigia_api_admin, vigia_mcp;

-- La misma cuenta que hacía la API (routes/entidades.ts, SQL_ANTECEDENTES_POR_ENTIDAD).
CREATE OR REPLACE FUNCTION refrescar_entidad_antecedentes() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  DROP TABLE IF EXISTS _eant;
  CREATE TEMP TABLE _eant ON COMMIT DROP AS
    SELECT btrim(x.entidad_ruc) AS ruc, count(*)::int AS con, (count(*) FILTER (WHERE x.alta))::int AS alta
      FROM (SELECT k.entidad_ruc, k.ocid, bool_or(k.n_alta > 0) AS alta FROM casos_cruce k
             WHERE k.ocid NOT LIKE 'ocds-vigia-%' AND k.entidad_ruc IS NOT NULL GROUP BY 1, 2) x
     GROUP BY 1;
  DELETE FROM entidad_antecedentes;
  INSERT INTO entidad_antecedentes (ruc, con, alta) SELECT ruc, con, alta FROM _eant;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_entidad_antecedentes() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_entidad_antecedentes() FROM PUBLIC;

SELECT refrescar_entidad_antecedentes();
