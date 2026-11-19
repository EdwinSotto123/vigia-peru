-- 416 · La historia por mes de una entidad (pestaña «Historia» de su ficha), sólo desde índices.
--
-- pg_stat_statements (acumulado al 2026-11-19): convocatorias por mes de una entidad, 8 720 llamadas, 224 ms de media y
-- hasta 10 s en frío (sumaba cuantia_referencial: cada contrato iba al heap ancho de convocatorias, 19 836 páginas en la
-- entidad más grande); sus banderas por mes en casos_cruce, hasta 8,9 s (índice sólo por entidad). Ahora:
--   · el índice de la 413 lleva también cuantia_referencial en INCLUDE (reemplaza al de la 413: mismas claves);
--   · casos_cruce (entidad_ruc, fecha_buena_pro) INCLUDE (severidad).
-- 19 836 → 1 289 páginas y 3 574 → 3 097 en la entidad más grande; mismos resultados en 3 entidades.
--
-- Cómo aplicarla: sentencia por sentencia (CONCURRENTLY).

CREATE INDEX CONCURRENTLY IF NOT EXISTS convocatorias_entidad_orden_cubre2 ON convocatorias
    (entidad_ruc, (COALESCE(fecha_convocatoria, '-infinity'::date)) DESC, created_at DESC, ocid DESC)
    INCLUDE (fecha_convocatoria, cuantia_referencial);
DROP INDEX CONCURRENTLY IF EXISTS convocatorias_entidad_orden_cubre;

CREATE INDEX CONCURRENTLY IF NOT EXISTS casos_cruce_entidad_fecha ON casos_cruce (entidad_ruc, fecha_buena_pro) INCLUDE (severidad);
