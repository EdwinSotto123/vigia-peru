-- Los grupos «un socio, varias empresas, una entidad» ya calculados (2026-11-15).
--
-- GET /patrones/duenos agrupaba los 3 261 cruces `mismo_dueno` con sus convocatorias en cada pedido: 5 a 10 segundos. Son
-- unos 700 grupos que sólo cambian con el refresco diario: se guardan en una tabla y la consulta es una lectura.

CREATE TABLE IF NOT EXISTS mismo_dueno_grupo (
  entidad_ruc  TEXT NOT NULL,
  persona_doc  TEXT NOT NULL,            -- sólo para agrupar: nunca se publica
  nombre       TEXT,                     -- la API le tapa un apellido
  contratos    INT NOT NULL,
  seguidos     INT NOT NULL,             -- contratos con otro parecido de una empresa hermana a 90 días o menos
  monto        NUMERIC,
  desde        DATE,
  hasta        DATE,
  rucs         TEXT[] NOT NULL,          -- las empresas del socio que ganaron ahí (RUC 20)
  empresas     JSONB NOT NULL,           -- [{ruc, nombre}]
  ejemplos     TEXT[] NOT NULL,          -- hasta 3 OCID, primero los de 90 días o menos
  PRIMARY KEY (entidad_ruc, persona_doc)
);
CREATE INDEX IF NOT EXISTS mismo_dueno_grupo_orden ON mismo_dueno_grupo (seguidos DESC, contratos DESC, entidad_ruc);
CREATE INDEX IF NOT EXISTS mismo_dueno_grupo_rucs ON mismo_dueno_grupo USING gin (rucs);

CREATE OR REPLACE FUNCTION refrescar_mismo_dueno_grupo() RETURNS integer
LANGUAGE plpgsql SET statement_timeout = '120s' AS $$
DECLARE v_filas int;
BEGIN
  DELETE FROM mismo_dueno_grupo;
  INSERT INTO mismo_dueno_grupo (entidad_ruc, persona_doc, nombre, contratos, seguidos, monto, desde, hasta, rucs, empresas, ejemplos)
  SELECT g.entidad_ruc, g.persona_doc, g.nombre, g.contratos, g.seguidos, g.monto, g.desde, g.hasta, g.rucs,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('ruc', e.ruc, 'nombre', e.razon_social) ORDER BY e.razon_social) FROM empresas e WHERE e.ruc = ANY(g.rucs)), '[]'::jsonb),
         g.ejemplos
    FROM (SELECT c.entidad_ruc, x.persona_doc, max(x.persona_nombre) AS nombre, count(DISTINCT x.ocid)::int AS contratos,
                 count(DISTINCT x.ocid) FILTER (WHERE x.severidad = 'alta')::int AS seguidos, sum(x.monto) AS monto,
                 min(x.fecha) AS desde, max(x.fecha) AS hasta, array_agg(DISTINCT x.ruc_empresa) AS rucs,
                 (array_agg(x.ocid ORDER BY (x.severidad = 'alta') DESC, x.fecha DESC))[1:3] AS ejemplos
            FROM cruces_proveedor x JOIN convocatorias c ON c.ocid = x.ocid
           WHERE x.tipo = 'mismo_dueno' AND c.entidad_ruc IS NOT NULL AND x.persona_doc IS NOT NULL
           GROUP BY c.entidad_ruc, x.persona_doc) g
   WHERE cardinality(g.rucs) >= 2;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas;
END $$;
ALTER FUNCTION refrescar_mismo_dueno_grupo() OWNER TO vigia_jobs;
ALTER TABLE mismo_dueno_grupo OWNER TO vigia_jobs;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.mismo_dueno_grupo TO %I', r);
    END IF;
  END LOOP;
END $$;

SELECT refrescar_mismo_dueno_grupo() AS grupos;
