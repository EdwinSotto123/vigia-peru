-- 412 · La lista de contratos con tipo y zona: la página sale ya filtrada y en orden, desde el índice.
--
-- Tras la 405, la consulta más cara de la base seguía siendo la lista con tipo y región (pg_stat_statements, 4 h del
-- 2026-11-19: 2 024 llamadas a 181 ms y 167 páginas de disco cada una; rastreadores recorriendo regiones y páginas). El
-- índice por tipo y fecha da el orden, pero con una zona poco común casi todo lo que recorre se descarta: obras de una
-- provincia del Cusco en la página 21 tocaban 3 663 páginas.
--
-- Un índice por cada largo de ubigeo (departamento, provincia, distrito) con la zona DENTRO de la clave
-- (tipo, left(ubigeo_zona, n), fecha DESC, alta DESC, ocid DESC): la API pide `left(ce.ubigeo_zona, n) = $x` cuando hay
-- tipo (routes/contratos.ts, filtros) y la página sale filtrada y en orden. INCLUDE de la fecha sin COALESCE y de
-- ubigeo_zona: sin ellas el planificador cree que necesita la tabla (la consulta nombra esas columnas) y no lo elige.
-- 8 combinaciones medidas: 1-25 ms → 0,07-1,2 ms, 267-3 663 → 8-539 páginas, las mismas filas.
--
-- Cómo aplicarla: sentencia por sentencia (CONCURRENTLY). Unos 60 MB cada uno.

CREATE INDEX CONCURRENTLY IF NOT EXISTS contrato_estado_tipo_zona2_fecha ON contrato_estado
    (tipo, left(ubigeo_zona, 2), (COALESCE(fecha_convocatoria, '-infinity'::date)) DESC, created_at DESC, ocid DESC)
    INCLUDE (fecha_convocatoria, ubigeo_zona);
CREATE INDEX CONCURRENTLY IF NOT EXISTS contrato_estado_tipo_zona4_fecha ON contrato_estado
    (tipo, left(ubigeo_zona, 4), (COALESCE(fecha_convocatoria, '-infinity'::date)) DESC, created_at DESC, ocid DESC)
    INCLUDE (fecha_convocatoria, ubigeo_zona);
CREATE INDEX CONCURRENTLY IF NOT EXISTS contrato_estado_tipo_zona6_fecha ON contrato_estado
    (tipo, left(ubigeo_zona, 6), (COALESCE(fecha_convocatoria, '-infinity'::date)) DESC, created_at DESC, ocid DESC)
    INCLUDE (fecha_convocatoria, ubigeo_zona);
