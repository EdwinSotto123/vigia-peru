-- 70 · Permisos de vigia_jobs para bajar los documentos de la cola (fuente `documentos` de vigia-scrapers).
--
-- Lo hacía vigia-batch en GCP (con postgres); ahora corre en Cloudflare como vigia_jobs, que necesita leer la cola
-- (la vista y `ajustes`, que leen sus funciones con los permisos de quien consulta), abrir y cerrar pedidos de
-- descarga y anotar los documentos. Nada más: no toca alertas, asignaciones ni aportes.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/70_documentos_vigia_jobs.sql

GRANT SELECT ON cola_auditoria, ajustes TO vigia_jobs;
GRANT SELECT, INSERT, UPDATE ON pedidos_descarga, documentos_gcs TO vigia_jobs;
GRANT SELECT, UPDATE ON procesamientos TO vigia_jobs;
-- Cada corrida es un lote (documentos_gcs.lote_id → lotes_ingesta), como los del batch.
GRANT SELECT, INSERT, UPDATE ON lotes_ingesta TO vigia_jobs;
GRANT USAGE, SELECT ON SEQUENCE pedidos_descarga_id_seq, documentos_gcs_id_seq TO vigia_jobs;
