-- 178 · Cuántas personas que financiaron la campaña del que gobierna trabajan para cada entidad (migración 177), para la
-- bandera de la entidad en su ficha y en la lista. Contarlo en cada pedido recorría persona_entidad de la entidad (100 mil
-- filas en un ministerio grande); entidad_senal_politica lo guarda (una fila por entidad con alguna) y la rehace el Worker
-- de scrapers después de refrescar_senales_politicas().
--
-- Cómo aplicarla: python infrastructure/dev/dev.py migrar backend/db/migrations/178_entidad_senal_politica.sql (DEV); en
-- producción, el mismo archivo con tunel_rds (se llena al aplicarla). Antes de desplegar la API que la lee.

CREATE TABLE IF NOT EXISTS entidad_senal_politica (
  ruc          TEXT PRIMARY KEY,
  locadores    INT NOT NULL,          -- con financio_campana en persona_senal
  planilla     INT NOT NULL,          -- con financio_campana en planilla_persona
  partido      TEXT,                  -- el partido de esa campaña (el más frecuente)
  actualizado  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE entidad_senal_politica OWNER TO vigia_jobs;
GRANT SELECT ON entidad_senal_politica TO vigia_api, vigia_api_admin, vigia_mcp;

CREATE OR REPLACE FUNCTION refrescar_entidad_senal_politica() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  DROP TABLE IF EXISTS _esp;
  CREATE TEMP TABLE _esp ON COMMIT DROP AS
    SELECT ruc, sum(loc)::int AS locadores, sum(pla)::int AS planilla, mode() WITHIN GROUP (ORDER BY partido) AS partido
      FROM (SELECT entidad_ruc AS ruc, 1 AS loc, 0 AS pla, detalle->>'partido' AS partido FROM persona_senal WHERE tipo = 'financio_campana'
            UNION ALL
            SELECT p.entidad_ruc, 0, 1, s->'detalle'->>'partido'
              FROM planilla_persona p, jsonb_array_elements(p.senales) s
             WHERE p.tipos @> '{financio_campana}' AND s->>'tipo' = 'financio_campana') x
     GROUP BY ruc;
  DELETE FROM entidad_senal_politica;
  INSERT INTO entidad_senal_politica (ruc, locadores, planilla, partido) SELECT ruc, locadores, planilla, partido FROM _esp;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_entidad_senal_politica() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_entidad_senal_politica() FROM PUBLIC;

SELECT refrescar_entidad_senal_politica();
