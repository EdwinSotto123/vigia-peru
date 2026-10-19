-- 82 · vigia_jobs lee contrato_estado: los resúmenes por partido (migraciones 78-81) lo cruzan.
--
-- refrescar_resumen_vigia() y los de mes y gobierno corren dentro de refrescar_contrato_partido(), que vigia-scrapers
-- llama como vigia_jobs en la corrida diaria; al aplicarlas como postgres funcionaron, pero la corrida diaria falló con
-- "permission denied for table contrato_estado".
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/82_vigia_jobs_contrato_estado.sql

GRANT SELECT ON contrato_estado TO vigia_jobs;
