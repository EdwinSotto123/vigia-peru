-- 86 · La búsqueda de contratos en una tabla angosta: con la historia en la base, buscar se caía por tiempo.
--
-- "cemento" encuentra ~21 mil contratos: el GIN de convocatorias.texto_busqueda los ubica en 46 ms, pero para sacar su
-- ocid PostgreSQL lee una página de convocatorias por cada uno (filas anchas, 3,6 GB, que no caben en memoria): 19 mil
-- lecturas de disco, 16 s, y la API (10 s por consulta) respondía 500. convocatoria_busqueda tiene sólo el ocid y el
-- vector (~200 MB): cabe en memoria y la búsqueda queda en milisegundos. La mantienen dos triggers por sentencia, como
-- contrato_estado (migración 35).
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/86_busqueda_angosta.sql

CREATE TABLE IF NOT EXISTS convocatoria_busqueda (
  ocid   TEXT PRIMARY KEY,
  texto  TSVECTOR NOT NULL
);
ALTER TABLE convocatoria_busqueda OWNER TO vigia_jobs;
GRANT SELECT ON convocatoria_busqueda TO vigia_api, vigia_api_admin, vigia_mcp;

INSERT INTO convocatoria_busqueda (ocid, texto)
SELECT ocid, texto_busqueda FROM convocatorias WHERE texto_busqueda IS NOT NULL
ON CONFLICT (ocid) DO UPDATE SET texto = EXCLUDED.texto;
CREATE INDEX IF NOT EXISTS convocatoria_busqueda_gin ON convocatoria_busqueda USING gin (texto);
ANALYZE convocatoria_busqueda;

CREATE OR REPLACE FUNCTION convocatoria_busqueda_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM convocatoria_busqueda b USING viejas v WHERE b.ocid = v.ocid;
  ELSE
    INSERT INTO convocatoria_busqueda (ocid, texto)
    SELECT ocid, texto_busqueda FROM nuevas WHERE texto_busqueda IS NOT NULL
    ON CONFLICT (ocid) DO UPDATE SET texto = EXCLUDED.texto WHERE convocatoria_busqueda.texto IS DISTINCT FROM EXCLUDED.texto;
  END IF;
  RETURN NULL;
END $$;
ALTER FUNCTION convocatoria_busqueda_trg() OWNER TO vigia_jobs;

DROP TRIGGER IF EXISTS trg_convocatoria_busqueda_ins ON convocatorias;
DROP TRIGGER IF EXISTS trg_convocatoria_busqueda_upd ON convocatorias;
DROP TRIGGER IF EXISTS trg_convocatoria_busqueda_del ON convocatorias;
CREATE TRIGGER trg_convocatoria_busqueda_ins AFTER INSERT ON convocatorias
  REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION convocatoria_busqueda_trg();
CREATE TRIGGER trg_convocatoria_busqueda_upd AFTER UPDATE ON convocatorias
  REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION convocatoria_busqueda_trg();
CREATE TRIGGER trg_convocatoria_busqueda_del AFTER DELETE ON convocatorias
  REFERENCING OLD TABLE AS viejas FOR EACH STATEMENT EXECUTE FUNCTION convocatoria_busqueda_trg();
