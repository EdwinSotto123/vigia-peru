-- 371: hasta dónde llegan las obras de INFOBRAS sin leer la tabla entera.
--
-- GET /estado (routes/estado.ts) pide `max(dataset_fecha)` de obra_infobras para decir hasta qué día llegan sus datos.
-- Sin índice, recorría los 894 MB de la tabla: 6,7 s (medido con pg_stat_statements el 2026-11-18). inversion_mef ya tenía
-- el suyo. CONCURRENTLY: no bloquea las cargas semanales; por eso va fuera de una transacción.
CREATE INDEX CONCURRENTLY IF NOT EXISTS obra_infobras_dataset_fecha ON obra_infobras (dataset_fecha);
