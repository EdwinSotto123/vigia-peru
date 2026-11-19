-- 421 · La validación externa, legible por la API pública (GET /senales/validacion y el MCP).
--
-- validacion_corrida y validacion_senal (401, 404) sólo tienen agregados: el AUC y los top del puntaje y, por tipo de
-- bandera, observados / esperados con su intervalo. Ni procesos ni personas. Hasta aquí sólo las leía el panel
-- (vigia_api_admin); un investigador que usa el MCP necesita saber qué señales tienen evidencia de acertar.

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'dev_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.validacion_corrida, public.validacion_senal TO %I', r);
    END IF;
  END LOOP;
END $$;
