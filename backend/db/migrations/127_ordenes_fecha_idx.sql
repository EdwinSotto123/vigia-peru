-- 127 · Índice por fecha de emisión de las órdenes, para la subsección general "Órdenes" de Contratos
-- (GET /ordenes). Sin un RUC que ancle, los índices existentes de conosce_ordenes no sirven para ordenar/traer las
-- órdenes más recientes entre ~28 M filas; este btree lo habilita (la vista toma una ventana por él y luego dedup/filtra).
--
-- OJO en producción: esta tabla recibe escrituras de los scrapers, así que en la base EN VIVO el índice se crea con
--   CREATE INDEX CONCURRENTLY idx_conosce_ordenes_fecha_emision ON conosce_ordenes (fecha_emision);
-- ejecutado en AUTOCOMMIT (CONCURRENTLY no puede ir en una transacción, y el runner de migraciones abre una). Esta
-- versión no-concurrente queda para montar la base desde cero.
CREATE INDEX IF NOT EXISTS idx_conosce_ordenes_fecha_emision ON conosce_ordenes (fecha_emision);
