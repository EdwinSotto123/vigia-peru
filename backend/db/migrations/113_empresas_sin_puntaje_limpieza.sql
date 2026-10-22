-- 113 · Lo que quedó del puntaje de empresas (migración 112): sus columnas, su índice y sus tablas de reglas.
--
-- Va después de desplegar la API y la web que ya no los leen (migración 112). Nada más los usa.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/113_empresas_sin_puntaje_limpieza.sql

DROP INDEX IF EXISTS empresa_resumen_puntaje;
ALTER TABLE empresa_resumen DROP COLUMN IF EXISTS puntaje, DROP COLUMN IF EXISTS nivel, DROP COLUMN IF EXISTS antecedentes;
DROP TABLE IF EXISTS empresa_puntaje_regla;
DROP TABLE IF EXISTS empresa_puntaje_grupo;
