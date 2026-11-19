-- 405 · La lista de contratos con filtros de tipo, región, etapa o riesgo, leída sólo del índice.
--
-- Medido el 2026-11-19 con pg_stat_statements (ventana de 11 min, madrugada): la página de la lista con tipo y región era
-- la consulta más cara de la base (111 llamadas, 179 ms y 430 páginas de disco cada una; un rastreador recorriendo
-- regiones). El índice por tipo y fecha daba el orden, pero cada fila iba al heap sólo para ver su región y descartarla
-- (11 134 descartes para la página 21 de consultorías del Cusco). Con la región sola, sin tipo, no había índice con el orden
-- y la base recorría la tabla entera en paralelo (184-670 ms).
--
-- Los dos índices llevan en INCLUDE las columnas de los filtros (tipo, región, etapa, riesgo, operativo, estado y la fecha
-- sin COALESCE, que el planificador pide para usar la expresión): con el mapa de visibilidad al día (lo está: relallvisible
-- = relpages) la página sale del índice sin tocar la tabla. Y un índice por prefijo de región, para las provincias y los
-- distritos con pocos contratos, donde conviene juntar sus filas y ordenarlas.
--
-- El conteo de la lista (contratos_agregado con tipo y región) recorría las filas de la región en el heap para sumar `n`:
-- 284 mil llamadas acumuladas a 28 ms. El índice por prefijo de región lleva ahora tipo y n.
--
-- Cómo aplicarla: sentencia por sentencia (CONCURRENTLY no corre dentro de una transacción). La 406 va después.

CREATE INDEX CONCURRENTLY IF NOT EXISTS contrato_estado_tipo_fecha_cubre
    ON contrato_estado (tipo, (COALESCE(fecha_convocatoria, '-infinity'::date)) DESC, created_at DESC, ocid DESC)
    INCLUDE (fecha_convocatoria, ubigeo_zona, etapa, riesgo, operativo, estado_proc);

CREATE INDEX CONCURRENTLY IF NOT EXISTS contrato_estado_fecha_cubre
    ON contrato_estado ((COALESCE(fecha_convocatoria, '-infinity'::date)) DESC, created_at DESC, ocid DESC)
    INCLUDE (tipo, fecha_convocatoria, ubigeo_zona, etapa, riesgo, operativo, estado_proc);

CREATE INDEX CONCURRENTLY IF NOT EXISTS contrato_estado_ubigeo_prefijo
    ON contrato_estado (ubigeo_zona text_pattern_ops);

-- El de tipo y fecha sin INCLUDE queda de más: el nuevo tiene las mismas claves.
DROP INDEX CONCURRENTLY IF EXISTS contrato_estado_tipo_fecha_idx;

CREATE INDEX CONCURRENTLY IF NOT EXISTS contratos_agregado_ubigeo_cubre
    ON contratos_agregado (ubigeo text_pattern_ops) INCLUDE (tipo, n);

DROP INDEX CONCURRENTLY IF EXISTS contratos_agregado_ubigeo_idx;

-- Sin el mapa de visibilidad al día, el escaneo sólo de índice vuelve al heap por cada fila (8 761 idas en una página
-- recién aplicados los índices). El autovacuum de esta tabla esperaba el 10 % de filas muertas (83 mil) y no corría desde
-- el 19 de octubre; un VACUUM son 1,7 s. Al 1 %, corre cada pocas horas.
ALTER TABLE contrato_estado SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_vacuum_insert_scale_factor = 0.01,
                                 autovacuum_analyze_scale_factor = 0.02);

-- Resultado (PROD, 2026-11-19, con VACUUM): 11 combinaciones de tipo, región, etapa y riesgo dan las mismas filas que
-- recorriendo la tabla entera; región sola 118-127 ms → 0,3-0,9 ms; etapa sola 112-143 ms → 0,05-11 ms; tipo con región
-- 7-21 ms → 0,2-3 ms; conteo de bienes en Lima 26 → 14 ms.
