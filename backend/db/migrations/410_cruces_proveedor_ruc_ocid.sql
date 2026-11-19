-- 410 · Los cruces de una empresa para UN contrato (ficha del contrato), sin leer todos los de la empresa.
--
-- lib/cruces.ts (crucesDeProceso) pide los cruces de las empresas ganadoras que no tienen contrato (antecedentes de la
-- empresa) o que son de ESE contrato: `ocid IS NULL OR ocid_corto(ocid) = ocid_corto($2)`. Con el OR, el índice por RUC
-- traía todas las filas de la empresa y las filtraba en el heap: la empresa con más cruces tiene 3 008 y se quedaban 6
-- (2 151 páginas, 1,2 s en frío; 319 llamadas a 69 ms en 33 min, medido el 2026-11-19). La API ahora pide las dos ramas
-- por separado (UNION ALL), cada una con su índice parcial: 6 ms → 0,4 ms en caliente; mismas filas en 10 casos.
--
-- Cómo aplicarla: sentencia por sentencia (CONCURRENTLY).

CREATE INDEX CONCURRENTLY IF NOT EXISTS cruces_proveedor_ruc_sin_ocid ON cruces_proveedor (ruc_empresa) WHERE ocid IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS cruces_proveedor_ruc_ocid ON cruces_proveedor (ruc_empresa, ocid_corto(ocid)) WHERE ocid IS NOT NULL;
