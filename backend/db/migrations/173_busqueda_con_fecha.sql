-- 173 · La búsqueda de contratos con su fecha: ordenar las coincidencias sin cruzar contrato_estado.
--
-- Buscar "agua" en /contratos junta ~73 mil OCID en convocatoria_busqueda (migración 86) y, para ordenarlos por fecha,
-- los cruzaba con contrato_estado entero (829 mil filas por hash): 1,6 s con la caché fría y, con varias búsquedas a
-- la vez, más de los 10 s que tiene la API (500). convocatoria_texto lleva el vector Y las claves del orden (fecha de
-- convocatoria y alta), con un índice en ese orden: la página sale de una sola tabla angosta, recorriendo el índice de
-- fecha cuando la palabra es común (las 26 primeras aparecen enseguida) o el GIN cuando es rara. La búsqueda global
-- rankea sólo entre las coincidencias más recientes (antes calculaba ts_rank sobre todas: 3,8 s con "construccion").
--
-- Va en paralelo a convocatoria_busqueda (la API vieja la sigue leyendo hasta desplegar la nueva); la migración 174 la
-- borra. La mantienen tres triggers por sentencia, como contrato_estado (migración 35).
--
-- Cómo aplicarla: python infrastructure/dev/dev.py migrar backend/db/migrations/173_busqueda_con_fecha.sql (DEV); en
-- producción backend/scripts/aplicar_173.py (los índices CONCURRENTLY, sin frenar las cargas).

CREATE TABLE IF NOT EXISTS convocatoria_texto (
  ocid   TEXT PRIMARY KEY,
  texto  TSVECTOR NOT NULL,
  fecha  DATE NOT NULL,          -- COALESCE(fecha_convocatoria, '-infinity'): la clave k1 del orden por fecha
  alta   TIMESTAMPTZ            -- created_at: la clave k2
);
ALTER TABLE convocatoria_texto OWNER TO vigia_jobs;
GRANT SELECT ON convocatoria_texto TO vigia_api, vigia_api_admin, vigia_mcp;

CREATE OR REPLACE FUNCTION convocatoria_texto_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM convocatoria_texto b USING viejas v WHERE b.ocid = v.ocid;
  ELSE
    INSERT INTO convocatoria_texto (ocid, texto, fecha, alta)
    SELECT ocid, texto_busqueda, COALESCE(fecha_convocatoria, '-infinity'::date), created_at FROM nuevas WHERE texto_busqueda IS NOT NULL
    ON CONFLICT (ocid) DO UPDATE SET texto = EXCLUDED.texto, fecha = EXCLUDED.fecha, alta = EXCLUDED.alta
     WHERE (convocatoria_texto.texto, convocatoria_texto.fecha, convocatoria_texto.alta)
           IS DISTINCT FROM (EXCLUDED.texto, EXCLUDED.fecha, EXCLUDED.alta);
    -- Un contrato que se quedó sin texto deja de encontrarse (convocatoria_busqueda lo seguía devolviendo).
    IF TG_OP = 'UPDATE' THEN
      DELETE FROM convocatoria_texto b USING nuevas n WHERE b.ocid = n.ocid AND n.texto_busqueda IS NULL;
    END IF;
  END IF;
  RETURN NULL;
END $$;
ALTER FUNCTION convocatoria_texto_trg() OWNER TO vigia_jobs;

-- Primero los triggers y después el relleno: lo que se cargue mientras tanto entra por el trigger, y el relleno no lo
-- pisa (DO NOTHING: la fila del trigger es más nueva que la foto del relleno).
DROP TRIGGER IF EXISTS trg_convocatoria_texto_ins ON convocatorias;
DROP TRIGGER IF EXISTS trg_convocatoria_texto_upd ON convocatorias;
DROP TRIGGER IF EXISTS trg_convocatoria_texto_del ON convocatorias;
CREATE TRIGGER trg_convocatoria_texto_ins AFTER INSERT ON convocatorias
  REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION convocatoria_texto_trg();
CREATE TRIGGER trg_convocatoria_texto_upd AFTER UPDATE ON convocatorias
  REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION convocatoria_texto_trg();
CREATE TRIGGER trg_convocatoria_texto_del AFTER DELETE ON convocatorias
  REFERENCING OLD TABLE AS viejas FOR EACH STATEMENT EXECUTE FUNCTION convocatoria_texto_trg();

INSERT INTO convocatoria_texto (ocid, texto, fecha, alta)
SELECT ocid, texto_busqueda, COALESCE(fecha_convocatoria, '-infinity'::date), created_at
  FROM convocatorias WHERE texto_busqueda IS NOT NULL
ON CONFLICT (ocid) DO NOTHING;
-- Lo borrado entre la foto del relleno y su fin (casi nunca: las semillas de demostración).
DELETE FROM convocatoria_texto b WHERE NOT EXISTS (SELECT 1 FROM convocatorias c WHERE c.ocid = b.ocid);

CREATE INDEX IF NOT EXISTS convocatoria_texto_gin ON convocatoria_texto USING gin (texto);
CREATE INDEX IF NOT EXISTS convocatoria_texto_orden ON convocatoria_texto (fecha DESC, alta DESC, ocid DESC);
ANALYZE convocatoria_texto;
