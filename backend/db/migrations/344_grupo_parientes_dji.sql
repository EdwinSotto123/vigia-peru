-- 344 · Grupos de proveedores (migración 343) con un integrante que un funcionario de LA MISMA entidad declaró como
-- pariente en su declaración jurada de intereses (dji_nepotismo): el vínculo de familia deja de ser probable para ese
-- integrante y pasa a ser declarado, con el cargo y el parentesco. Sube el grupo a grave.
--
-- Los proveedores no presentan declaración jurada; los funcionarios sí, y en ella declaran a sus parientes (hermanos,
-- cónyuge, hijos, padres, cuñados, suegros, yernos…) con su DNI: 782 mil parientes con DNI en dji_vinculos. Por eso un
-- grupo puede tener un parentesco comprobado con la entidad aunque sus integrantes nunca declaren nada.

CREATE OR REPLACE FUNCTION marcar_grupos_parientes() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  WITH p AS (
    SELECT r.entidad_ruc, r.grupo,
           jsonb_agg(DISTINCT jsonb_build_object('ruc', d.proveedor_ruc, 'cargo', d.cargo, 'parentesco', d.parentesco,
                                                 'ordenes', d.ordenes, 'monto', d.monto)) AS parientes
      FROM grupo_proveedor_resumen r
      JOIN grupo_proveedor g ON g.entidad_ruc = r.entidad_ruc AND g.grupo = r.grupo
      JOIN dji_nepotismo d ON d.entidad_ruc = r.entidad_ruc AND d.proveedor_ruc = g.ruc
     GROUP BY 1, 2)
  UPDATE grupo_proveedor_resumen r
     SET severidad = 'alta',
         detalle = r.detalle || jsonb_build_object('parientes_de_funcionarios', p.parientes)
    FROM p WHERE p.entidad_ruc = r.entidad_ruc AND p.grupo = r.grupo;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER FUNCTION public.marcar_grupos_parientes() OWNER TO vigia_jobs;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION marcar_grupos_parientes() FROM PUBLIC;
