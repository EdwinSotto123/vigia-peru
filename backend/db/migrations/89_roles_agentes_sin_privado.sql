-- 89 · Los roles de los agentes, sin acceso a lo privado (auditoría de seguridad del 2026-10-21).
--
-- `vigia_ab` (Lambdas de agentes, "solo lectura" según la 44) y `vigia_agentes` (agentes en Cloud Run, "mínimo
-- privilegio" según la 43) recibieron permisos sobre TODAS las tablas y funciones:
--   · vigia_ab leía usuarios, financiadores, contribuciones, equipo y admin_log, y podía ejecutar las funciones
--     SECURITY DEFINER que escriben (asignar_contribucion, refresh_*, refrescar_*). Su "solo lectura" es sólo
--     default_transaction_read_only, que una sesión anula con BEGIN READ WRITE.
--   · vigia_agentes además podía escribir y borrar en esas tablas.
-- Los agentes procesan archivos de terceros (PDF, Word, RAR): si alguno lograra ejecutar código, tendría todo eso.
-- El código de backend/agent no lee ni llama nada de lo que se quita aquí (revisado el 2026-10-21).
--
-- Se quita:
--   · todo permiso sobre las tablas de personas y dinero (las que la 45 ya cerró para solicitudes_privacidad);
--   · escribir en ajustes, tarifas y asignaciones (vigia_agentes);
--   · ejecutar las funciones SECURITY DEFINER que no son de trigger (los triggers no necesitan EXECUTE del que escribe).
-- Los privilegios por defecto de la 43/44 (SELECT en tablas nuevas) quedan: los agentes leen los datasets que se
-- agregan. Una tabla privada nueva debe revocarles el acceso en su propia migración.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/89_roles_agentes_sin_privado.sql

DO $$
DECLARE
  rol TEXT;
  tabla TEXT;
  f RECORD;
BEGIN
  FOREACH rol IN ARRAY ARRAY['vigia_ab', 'vigia_agentes'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol);

    FOREACH tabla IN ARRAY ARRAY['usuarios', 'financiadores', 'contribuciones', 'equipo', 'admin_log', 'solicitudes_privacidad'] LOOP
      IF to_regclass('public.' || tabla) IS NOT NULL THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', tabla, rol);
      END IF;
    END LOOP;

    FOREACH tabla IN ARRAY ARRAY['ajustes', 'tarifas', 'asignaciones'] LOOP
      IF to_regclass('public.' || tabla) IS NOT NULL THEN
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM %I', tabla, rol);
      END IF;
    END LOOP;

    FOR f IN
      SELECT p.oid::regprocedure AS firma
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prosecdef AND p.prorettype <> 'trigger'::regtype
         AND p.proname NOT LIKE 'pgaudit%'
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', f.firma, rol);
    END LOOP;
  END LOOP;
END $$;
