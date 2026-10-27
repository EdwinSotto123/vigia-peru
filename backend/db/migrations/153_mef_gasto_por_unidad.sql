-- 153 · Índice de mef_ejecutora_gasto por unidad ejecutora, para cuando la tabla tiene la historia desde 2015 (152).
--
-- La llave es (anio, sec_ejec, tipo, codigo): sirve para «este año, estas unidades», no para «el último año de estas
-- unidades». GET /entidades/:ruc/gasto de la API anterior a la 152 busca justamente eso (max(anio) WHERE sec_ejec =
-- ANY(...)) y, sin un índice que empiece por sec_ejec, recorre la tabla entera: medido en DEV el 2026-10-27, 2,4 s con
-- dos años cargados (1,1 M filas); con 2015-2026 serían ~6,6 M filas en cada ficha de entidad. La API nueva prueba año
-- por año por la llave y no lo necesita, pero la anterior sigue en producción hasta que se despliegue, y cualquier
-- consulta por unidad lo aprovecha. Con la deduplicación del B-tree (una entrada por par unidad-año) ocupa poco.
--
-- CONCURRENTLY: no bloquea las cargas ni la API. No puede ir dentro de una transacción: aplicarla en autocommit, sola
-- (psql "$DSN" -f backend/db/migrations/153_mef_gasto_por_unidad.sql), antes de cargar los años viejos.

CREATE INDEX CONCURRENTLY IF NOT EXISTS mef_ejecutora_gasto_unidad_idx ON mef_ejecutora_gasto (sec_ejec, anio);
