-- 43 · Rol de mínimo privilegio para los agentes (antes corrían como `postgres`, el admin de RDS).
--
-- Los 4 servicios de agentes leen y escriben datos (alertas, banderas, procesamientos, documentos…), pero
-- NO crean ni alteran tablas, ni cargan extensiones, ni tocan roles. Con `vigia_agentes` un agente
-- comprometido no puede borrar el esquema, leer otras bases ni cambiar contraseñas.
--
-- La contraseña NO va aquí: la pone cloud_sql/archivos/crear_rol_agentes.py (SSM `/vigia/vigia-db/password-agentes`
-- y secreto de GCP `db-password-agentes`). Idempotente.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_agentes') THEN
    CREATE ROLE vigia_agentes LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 40;
  END IF;
END $$;

ALTER ROLE vigia_agentes SET idle_in_transaction_session_timeout = '300s';
ALTER ROLE vigia_agentes SET lock_timeout = '30s';

GRANT USAGE ON SCHEMA public TO vigia_agentes;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vigia_agentes;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO vigia_agentes;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO vigia_agentes;

-- Lo que se cree después (migraciones corridas por postgres / vigia_jobs) también les llega.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vigia_agentes;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO vigia_agentes;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO vigia_agentes;

-- Ni siquiera con GRANT: sin TRUNCATE, REFERENCES ni TRIGGER (no se otorgan arriba).
-- Si un día un agente necesita refrescar una vista materializada, hágalo una función SECURITY DEFINER, no el rol dueño.
