-- 381: las cifras de los filtros de los contratos de UNA entidad, sin leer la tabla.
--
-- La ficha de cada entidad y la lista de contratos filtrada por entidad cuentan por tipo, estado y riesgo
-- (`cubo` en routes/contratos.ts), por «¿Lo leyó Vigía?» (`contarLectura`, con estado_proc) y los antecedentes y posibles
-- errores de carga (por ocid). Medido el 2026-11-18 con pg_stat_statements: era la consulta de usuario que más tiempo
-- sumaba (881 llamadas en hora y media, 209 ms de media). En una entidad grande (20131257750, 24 758 contratos) eran
-- 1,7 s en frío: el índice por entidad da las filas y después hay que ir a buscar 6 000 bloques de la tabla.
--
-- Con estas columnas en el índice el conteo sale de él solo (index-only scan; la tabla está 88 % visible).
-- No reemplaza a contrato_estado_entidad_idx: ese es chico y sirve a las búsquedas por entidad que traen la fila entera.
--
-- CONCURRENTLY: no bloquea las escrituras de los agentes. Va fuera de una transacción (migrar.sh la corre suelta).
CREATE INDEX CONCURRENTLY IF NOT EXISTS contrato_estado_entidad_facetas
    ON contrato_estado (entidad_ruc, tipo, operativo, riesgo) INCLUDE (estado_proc, ocid);
