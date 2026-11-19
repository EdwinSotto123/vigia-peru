-- 414 · Autovacuum al 2 % en las tablas grandes que más se leen por índice.
--
-- Con el umbral por defecto (10 % de filas muertas) las tablas grandes casi nunca se aspiraban y su mapa de visibilidad
-- quedaba viejo: los índices que cubren (405, 412, 413) volvían al heap. Medido el 2026-11-19: conosce_ordenes (15 GB,
-- 29 millones de filas) con 2,9 millones de muertas y 82 % visible, sin aspirar desde el 1 de noviembre; perucompras_orden
-- 74 %, documento_pieza 18 %. contrato_estado (405) y convocatorias (413) ya tienen lo suyo. Un VACUUM a mano dejó al
-- 100 % empresa_rnp_doc y empresa_cliente_nombre (las rehace la 242 con TRUNCATE: el mapa vuelve a cero en cada refresco).

ALTER TABLE conosce_ordenes SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02,
                                 autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE perucompras_orden SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02,
                                   autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE documento_pieza SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02,
                                 autovacuum_analyze_scale_factor = 0.02);
