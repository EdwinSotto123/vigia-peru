-- 413 · La lista de contratos de una entidad, sólo desde el índice.
--
-- pg_stat_statements (4 h del 2026-11-19): la lista por entidad (DRIVER_C, convocatorias) era la cuarta en tiempo de base,
-- 2 724 llamadas a 59 ms y 37 páginas de disco cada una. El índice de la 277 (entidad, fecha, alta, ocid) da el orden,
-- pero cada fila iba al heap de convocatorias (968 MB, filas anchas) por la fecha sin COALESCE: en la página 100 de la
-- entidad más grande, 1 954 páginas. Con la fecha en INCLUDE, la página sale del índice: 1 954 → 335 páginas, 0 idas al
-- heap, mismas filas en 3 casos.
--
-- convocatorias no se aspiraba desde el 19 de octubre (71 mil filas muertas: sin el mapa de visibilidad el índice no
-- alcanza): autovacuum al 2 % (un VACUUM son ~30 s).
--
-- Cómo aplicarla: sentencia por sentencia (CONCURRENTLY).

CREATE INDEX CONCURRENTLY IF NOT EXISTS convocatorias_entidad_orden_cubre ON convocatorias
    (entidad_ruc, (COALESCE(fecha_convocatoria, '-infinity'::date)) DESC, created_at DESC, ocid DESC)
    INCLUDE (fecha_convocatoria);

-- El de la 277 tiene las mismas claves: sobra.
DROP INDEX CONCURRENTLY IF EXISTS convocatorias_entidad_orden;

ALTER TABLE convocatorias SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02,
                               autovacuum_analyze_scale_factor = 0.02);
