-- 214: la API pública ya no lee dji_vinculos (el DNI de los familiares de la DJI). Sus cruces van por las funciones de la
-- 213; correr esta migración DESPUÉS de desplegar la API que las usa. El panel (vigia_api_admin) y los refrescos
-- (vigia_jobs) siguen leyéndola.
--
-- OJO: los privilegios por omisión dan SELECT a vigia_api sobre las tablas nuevas. Si alguna vez se recrea dji_vinculos,
-- hay que repetir esto. Idempotente.

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'dev_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON public.dji_vinculos FROM %I', r);
    END IF;
  END LOOP;
END $$;
