-- 131 · Permisos para que el Worker de scrapers (rol vigia_jobs) escriba en seace_menores (fuente `seace_menores`).
-- Las migraciones crean la tabla como `postgres`; los default privileges del esquema cubren vigia_api/vigia_ab/
-- vigia_agentes pero NO vigia_jobs, así que la fuente fallaba con «permission denied for table seace_menores».
GRANT SELECT, INSERT, UPDATE, DELETE ON seace_menores TO vigia_jobs;
