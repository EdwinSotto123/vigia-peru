-- 238: las penalidades de contratistas se renuevan cada semana desde la wiki del OSCE (2026-11-03).
--
-- La fuente osce_penalidades del Worker de scrapers (backend/scrapers-worker/src/fuentes/osce_penalidades.ts) baja los
-- dos adjuntos de la página «Penalidades de contratistas» (penalidades.csv y penalidades2018.csv, ~20 mil filas) y
-- reemplaza la tabla en una transacción. Hasta hoy se cargaba a mano una copia de mayo (load_sanciones.py) y vigia_jobs
-- sólo podía leerla. La llave foránea de la 08 pide cada contratista en `empresas`: la fuente lo inserta antes.
--
-- DEV: bash infrastructure/deploy/dev.sh migrar backend/db/migrations/238_penalidades_semanales.sql

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    GRANT SELECT, INSERT, DELETE ON penalidades TO vigia_jobs;
    GRANT USAGE, SELECT ON SEQUENCE penalidades_id_seq TO vigia_jobs;
    GRANT SELECT, INSERT ON empresas TO vigia_jobs;
  END IF;
END $$;
