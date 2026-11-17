-- 347 · Grupos de proveedores (343): la severidad según cuánto DEPENDE el grupo de la entidad.
--
-- Con la primera corrida en PROD (2026-11-17: 79 927 grupos resumidos) las órdenes correlativas también marcaban a grupos
-- corporativos grandes que venden a todo el país: MAPFRE Perú, MAPFRE Vida y Latina Seguros en un gobierno regional (SOAT y
-- vida ley en lote, 2 014 pares correlativos), laboratorios en EsSalud. Lo que distingue un caso como el de la UNI (grupo
-- Valencia: 46 pares correlativos en 40 días; juntos, el 2.° proveedor de la universidad) es que sus empresas viven de esa
-- entidad (del 92 % al 99,9 % de sus ventas por órdenes).
--
--   parte_entidad  qué parte de lo que el grupo le vendió al Estado por órdenes desde 2018 viene de esta entidad.
--   severidad      alta  si depende de la entidad (≥ 50 %) y tiene correlativas (3 o más), objeto repartido, órdenes por
--                        encima del tope o una cuarta parte o más de sus órdenes de hasta 8 UIT al borde del tope (con 8 o
--                        más); o si un integrante es pariente declarado de un funcionario de la entidad (344, después);
--                  media si depende en parte (≥ 25 %) y tiene alguno de esos hechos o 3 días con órdenes a varios
--                        integrantes; o, sin depender, 10 o más pares correlativos o 2 o más objetos repartidos;
--                  baja  el resto: un grupo, sin más.
-- calibrar_grupos_proveedor() corre después de refrescar_grupos_proveedor() y antes de marcar_grupos_parientes().

ALTER TABLE grupo_proveedor_resumen ADD COLUMN IF NOT EXISTS parte_entidad NUMERIC(6, 4);

CREATE OR REPLACE FUNCTION calibrar_grupos_proveedor() RETURNS jsonb
LANGUAGE plpgsql SET work_mem = '256MB' AS $$
DECLARE n int;
BEGIN
  CREATE TEMP TABLE _tot ON COMMIT DROP AS
    SELECT ruc, sum(monto) AS monto FROM (
      SELECT ruc, monto FROM empresa_orden_anual WHERE anio >= 2018
      UNION ALL SELECT ruc, monto FROM persona_orden_anual WHERE anio >= 2018) x
     WHERE ruc IN (SELECT DISTINCT g.ruc FROM grupo_proveedor g JOIN grupo_proveedor_resumen r ON r.entidad_ruc = g.entidad_ruc AND r.grupo = g.grupo)
     GROUP BY ruc;
  CREATE INDEX ON _tot (ruc); ANALYZE _tot;
  UPDATE grupo_proveedor_resumen r SET parte_entidad = LEAST(1, round(r.monto / NULLIF(t.total, 0), 4))
    FROM (SELECT g.entidad_ruc, g.grupo, sum(t.monto) AS total FROM grupo_proveedor g JOIN _tot t ON t.ruc = g.ruc GROUP BY 1, 2) t
   WHERE t.entidad_ruc = r.entidad_ruc AND t.grupo = r.grupo;
  UPDATE grupo_proveedor_resumen r SET severidad = CASE
      WHEN COALESCE(r.parte_entidad, 0) >= 0.5
           AND (r.correlativas >= 3 OR r.repartidos >= 1 OR r.sobre_tope >= 1 OR (r.hasta_8uit >= 8 AND r.borde * 4 >= r.hasta_8uit)) THEN 'alta'
      WHEN (COALESCE(r.parte_entidad, 0) >= 0.25
            AND (r.correlativas >= 1 OR r.repartidos >= 1 OR r.sobre_tope >= 1 OR r.dias_juntos >= 3 OR r.borde >= 3))
           OR (COALESCE(r.parte_entidad, 0) >= 0.05 AND (r.correlativas >= 10 OR r.repartidos >= 2)) THEN 'media'
      ELSE 'baja' END;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN (SELECT jsonb_object_agg(severidad, c) FROM (SELECT severidad, count(*) AS c FROM grupo_proveedor_resumen GROUP BY 1) z);
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER FUNCTION public.calibrar_grupos_proveedor() OWNER TO vigia_jobs;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION calibrar_grupos_proveedor() FROM PUBLIC;
