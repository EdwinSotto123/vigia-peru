-- 120 · Quitar cruces_proveedor duplicados (y evitar que vuelvan en cada ciclo).
--
-- refrescar_cruces() arma varios cruces con JOINs que pueden multiplicar la MISMA fila: un aporte que calza con el
-- gobierno por más de un registro del JNE, un socio que aparece dos veces, etc. Resultado: en prod había ~179 mil filas
-- idénticas (p. ej. la misma "Financió al partido que gobierna" repetida 3 veces en un contrato), que inflaban los
-- conteos de casos_cruce y repetían el bloque en el dossier. Arreglar cada JOIN uno por uno es frágil; un dedup al final
-- los limpia todos. Se corre en el pipeline (comun.ts) después de refrescar_cruces y antes de casos_cruce_base.
--
-- "Idéntica" = mismo tipo, empresa, ocid, persona, severidad, fecha, monto y detalle. Se conserva la de menor id.

CREATE OR REPLACE FUNCTION dedup_cruces_proveedor() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  WITH d AS (
    SELECT id, row_number() OVER (
             PARTITION BY tipo, ruc_empresa, COALESCE(ocid, ''), COALESCE(persona_doc, ''),
                          severidad, fecha, monto, detalle::text
             ORDER BY id) AS rn
      FROM cruces_proveedor)
  DELETE FROM cruces_proveedor c USING d WHERE c.id = d.id AND d.rn > 1;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION dedup_cruces_proveedor() OWNER TO vigia_jobs;
