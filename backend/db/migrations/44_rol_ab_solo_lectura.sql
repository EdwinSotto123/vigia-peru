-- 44 · Rol de SOLO LECTURA para las pruebas A/B de modelos (backend/scripts/ab_modelos.py).
-- Los servicios sombra (agente-ab-*) corren el pipeline real contra la base de producción pero no pueden
-- escribir nada: default_transaction_read_only = on hace fallar cualquier INSERT/UPDATE/DELETE/DDL.
-- La contraseña la fija cloud_sql/archivos/crear_rol_ab.py (SSM + secreto db-password-ab). Idempotente.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_ab') THEN
    CREATE ROLE vigia_ab LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 20;
  END IF;
END $$;
ALTER ROLE vigia_ab SET default_transaction_read_only = on;
ALTER ROLE vigia_ab SET statement_timeout = '120s';
GRANT USAGE ON SCHEMA public TO vigia_ab;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO vigia_ab;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO vigia_ab;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO vigia_ab;
