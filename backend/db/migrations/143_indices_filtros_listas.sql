-- 143 · Dos índices para los filtros nuevos de las listas de Contratos y Órdenes (2026-10-26). La API funciona sin ellos
-- (mismos resultados); con ellos los dos filtros más caros dejan de leer la tabla en frío.
--
--   · conosce_ordenes_grandes_fecha: GET /ordenes?monto=50k_500k|mas_500k. Las órdenes de más de S/ 50 mil son ~2 % (las
--     de más de S/ 500 mil, ~0,2 %): por el índice de fecha, la primera página de «más de S/ 500 mil» recorre ~23 mil
--     órdenes recientes (47 ms con la caché caliente, más de 1 s en frío) y cada página siguiente, otras tantas. Este
--     índice parcial (~600 mil filas, ~15 MB) las trae ya ordenadas por fecha. La API escribe el tramo con literales
--     (`o.monto > 500000`) para que el planificador pueda probar que la condición implica la del índice.
--   · convocatorias_proveedor_ocid_idx: GET /contratos?ganadora=<tipo>. El filtro parte de las empresas con ese dato
--     (empresa_resumen.tipos) y busca sus contratos por proveedor; con el índice que había (convocatorias_proveedor_idx)
--     cada búsqueda iba también al heap de convocatorias (3,6 GB) por el ocid: con las 55 mil empresas dadas de baja,
--     ~19 mil lecturas de disco (1 s). Con el ocid incluido, se resuelve en el índice (index-only scan).
--
-- OJO en producción: las dos tablas reciben escrituras de los scrapers, así que en la base EN VIVO cada índice se crea con
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS conosce_ordenes_grandes_fecha ON conosce_ordenes (fecha_emision DESC) WHERE monto > 50000;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS convocatorias_proveedor_ocid_idx ON convocatorias (proveedor_ruc) INCLUDE (ocid) WHERE proveedor_ruc IS NOT NULL;
-- ejecutadas de a una en AUTOCOMMIT (CONCURRENTLY no puede ir en una transacción, y el runner de migraciones abre una;
-- tampoco con `dev.sh migrar`). Esta versión no-concurrente queda para montar la base desde cero. No hay que refrescar nada.
CREATE INDEX IF NOT EXISTS conosce_ordenes_grandes_fecha ON conosce_ordenes (fecha_emision DESC) WHERE monto > 50000;
CREATE INDEX IF NOT EXISTS convocatorias_proveedor_ocid_idx ON convocatorias (proveedor_ruc) INCLUDE (ocid) WHERE proveedor_ruc IS NOT NULL;
