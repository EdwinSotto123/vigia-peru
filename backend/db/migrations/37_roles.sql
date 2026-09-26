-- Vigía Perú · Migración 37 — Roles por componente con tiempos límite ──────────────────────────────
--
-- Auditoría técnica 2026-09-25, hallazgo A3: todo (API, MCP, dispatcher, jobs, agentes) conecta como
-- `postgres`, sin statement_timeout, lock_timeout ni idle_in_transaction_session_timeout y sin tope de
-- conexiones por componente. Un bug o una consulta cara en cualquiera puede tocar cualquier tabla o
-- agotar las ~100 conexiones de la instancia.
--
-- Qué hace (detalle y pruebas: DB_LISTO.md § "Roles (37)"):
--   · Crea 6 roles con LOGIN y SIN contraseña (sin contraseña no pueden entrar: la pone el coordinador
--     desde Secret Manager, ver abajo). Tiempos por rol (ALTER ROLE … SET: valen al conectar):
--        rol                statement  lock   idle_in_tx  conexiones  uso
--        vigia_api          10 s       3 s    60 s        40          API pública (backend/api, rutas no admin)
--        vigia_api_admin    120 s      5 s    120 s       15          rutas /admin/*, POST /alertas, Scheduler (POST /admin/asignar)
--        vigia_mcp          15 s       3 s    60 s        12          backend/mcp/server.py (sólo lectura)
--        vigia_dispatcher   60 s       10 s   60 s        10          backend/dispatcher
--        vigia_jobs         0 (sin)    —      10 min      10          scrapers, batch (vigia-ingest), loaders
--     Con PgBouncer en modo transacción las `options` de conexión se ignoran: por eso el pool admin de
--     la API usa su propio rol (vigia_api_admin) en vez de subir statement_timeout por sesión.
--   · vigia_api_admin es miembro de vigia_api (hereda todo lo público) y suma lo que sólo hace el panel.
--   · vigia_jobs pasa a ser DUEÑO de las tablas de datasets que carga entero (TRUNCATE + COPY, TRUNCATE
--     … RESTART IDENTITY y CREATE UNIQUE INDEX en tiempo de ejecución exigen ser dueño). `postgres` queda
--     miembro de vigia_jobs (INHERIT + SET) para que los agentes y las migraciones, que siguen como
--     postgres, conserven todos los derechos sobre esas tablas (en Cloud SQL postgres NO es superusuario).
--   · Funciones SECURITY DEFINER (dueño postgres, search_path = public, pg_temp) sólo donde hace falta
--     ser dueño (REFRESH de vistas materializadas) o para no abrir escrituras a un rol entero; EXECUTE
--     quitado a PUBLIC y dado sólo a quien las llama. Ninguna arma SQL con texto que venga de afuera.
--   · Privilegios por defecto: lo que postgres (migraciones) o vigia_jobs creen después se puede leer
--     desde vigia_api y vigia_mcp.
--   · Los agentes (backend/agent) siguen como postgres por ahora.
--
-- Contraseñas (NUNCA en este archivo ni en un argumento de psql: C1). Con gcloud, que no pasa por el log
-- de sentencias de Postgres:
--     gcloud sql users set-password vigia_api --instance=vigia-db \
--       --password="$(gcloud secrets versions access latest --secret=pg-vigia-api)"
--   (idem vigia_api_admin, vigia_mcp, vigia_dispatcher, vigia_jobs). Después cada servicio/job cambia
--   PGUSER y toma PGPASSWORD del secreto. Volver atrás = PGUSER=postgres otra vez (los roles no estorban).
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/37_roles.sql   (después de la 36)
-- Una transacción corta. ALTER TABLE … OWNER toma un bloqueo exclusivo breve de cada tabla de datasets:
-- aplicar cuando ningún loader esté corriendo (lock_timeout 5 s: falla en vez de esperar).
-- Idempotente: roles con IF NOT EXISTS, GRANT/ALTER repetibles. Sólo agrega permisos (no revoca los
-- que otra migración haya dado), salvo en contribuciones/financiadores para vigia_api (por columnas).
--
-- Cómo verificar:
--     SELECT rolname, rolconnlimit, rolconfig FROM pg_roles WHERE rolname LIKE 'vigia_%';
--     SELECT relname, pg_get_userbyid(relowner) FROM pg_class WHERE relowner = 'vigia_jobs'::regrole;
--     SELECT proname, prosecdef, proconfig, proacl FROM pg_proc WHERE prosecdef AND pronamespace = 'public'::regnamespace;
--     SELECT has_table_privilege('vigia_api', 'alertas', 'INSERT');        -- f (sólo el admin)

\set ON_ERROR_STOP on
SET lock_timeout = '5s';

BEGIN;

-- ── 1 · Roles ────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('vigia_api', 40), ('vigia_api_admin', 15), ('vigia_mcp', 12),
                                 ('vigia_dispatcher', 10), ('vigia_jobs', 10)) t(rol, limite) LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r.rol) THEN
      EXECUTE format('CREATE ROLE %I LOGIN', r.rol);
    END IF;
    EXECUTE format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION '
                   'NOBYPASSRLS CONNECTION LIMIT %s', r.rol, r.limite);
  END LOOP;
END $$;

ALTER ROLE vigia_api        SET statement_timeout = '10s';
ALTER ROLE vigia_api        SET lock_timeout = '3s';
ALTER ROLE vigia_api        SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE vigia_api_admin  SET statement_timeout = '120s';
ALTER ROLE vigia_api_admin  SET lock_timeout = '5s';
ALTER ROLE vigia_api_admin  SET idle_in_transaction_session_timeout = '120s';
ALTER ROLE vigia_mcp        SET statement_timeout = '15s';
ALTER ROLE vigia_mcp        SET lock_timeout = '3s';
ALTER ROLE vigia_mcp        SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE vigia_mcp        SET default_transaction_read_only = on;
ALTER ROLE vigia_dispatcher SET statement_timeout = '60s';
ALTER ROLE vigia_dispatcher SET lock_timeout = '10s';
ALTER ROLE vigia_dispatcher SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE vigia_jobs       SET statement_timeout = 0;
ALTER ROLE vigia_jobs       SET idle_in_transaction_session_timeout = '10min';

-- Membresías. El admin hereda lo público. postgres hereda (y puede asumir) vigia_jobs: sigue pudiendo
-- leer, escribir y alterar las tablas de datasets que pasan a ser de vigia_jobs.
GRANT vigia_api  TO vigia_api_admin WITH INHERIT TRUE, SET FALSE;
GRANT vigia_jobs TO postgres        WITH INHERIT TRUE, SET TRUE;

-- ── 2 · Esquema ──────────────────────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO vigia_api, vigia_api_admin, vigia_mcp, vigia_dispatcher, vigia_jobs;
-- vigia_jobs crea objetos (índices de sus tablas; y ALTER … OWNER exige que el nuevo dueño pueda crear en el esquema).
GRANT CREATE ON SCHEMA public TO vigia_jobs;

-- ── 3 · Tablas de datasets → dueño vigia_jobs ────────────────────────────────────────────────────
-- Las que existan en esta base (en staging faltaban algunas). Las secuencias ligadas cambian con la
-- tabla; una secuencia usada en un DEFAULT pero no ligada, se cambia aparte.
DO $$
DECLARE t TEXT; s TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['dji_funcionarios', 'dji_empleos', 'rnp_conformacion_juridica', 'jne_autoridades',
                           'jne_candidaturas', 'onpe_aportantes', 'onpe_candidatos', 'visitas_entidades',
                           'osce_sancionados', 'peps', 'mef_entity_budget', 'mef_region_budget',
                           'datasets_cargas', 'lotes_ingesta', 'lotes_items'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    IF (SELECT relowner FROM pg_class WHERE oid = to_regclass('public.' || t)) <> 'vigia_jobs'::regrole THEN
      EXECUTE format('ALTER TABLE public.%I OWNER TO vigia_jobs', t);
    END IF;
    FOR s IN SELECT DISTINCT substring(pg_get_expr(d.adbin, d.adrelid) FROM $r$nextval\('([^']+)'$r$)
               FROM pg_attrdef d WHERE d.adrelid = to_regclass('public.' || t)
                AND pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval(%' LOOP
      IF s IS NOT NULL AND to_regclass(s) IS NOT NULL
         AND (SELECT relowner FROM pg_class WHERE oid = to_regclass(s)) <> 'vigia_jobs'::regrole
         AND NOT EXISTS (SELECT 1 FROM pg_depend WHERE objid = to_regclass(s) AND deptype IN ('a', 'i')) THEN
        EXECUTE format('ALTER SEQUENCE %s OWNER TO vigia_jobs', to_regclass(s));
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ── 4 · Permisos por tabla ───────────────────────────────────────────────────────────────────────
-- otorgar(privilegios, rol, tablas): sólo las que existen; con INSERT también USAGE sobre las secuencias
-- de sus columnas (nextval del DEFAULT).
CREATE OR REPLACE FUNCTION pg_temp.otorgar(p_priv TEXT, p_rol TEXT, p_tablas TEXT[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE t TEXT; s TEXT;
BEGIN
  FOREACH t IN ARRAY p_tablas LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    EXECUTE format('GRANT %s ON public.%I TO %I', p_priv, t, p_rol);
    IF p_priv ILIKE '%INSERT%' THEN
      FOR s IN SELECT DISTINCT substring(pg_get_expr(d.adbin, d.adrelid) FROM $r$nextval\('([^']+)'$r$)
                 FROM pg_attrdef d WHERE d.adrelid = to_regclass('public.' || t)
                  AND pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval(%' LOOP
        IF s IS NOT NULL AND to_regclass(s) IS NOT NULL THEN
          EXECUTE format('GRANT USAGE ON SEQUENCE %s TO %I', to_regclass(s), p_rol);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- vigia_api: lo que leen las rutas públicas (backend/api/src/routes/*.ts salvo admin*, lib/dossier,
-- lib/publicacion, lib/cache) + los modelos de lectura de la 35.
SELECT pg_temp.otorgar('SELECT', 'vigia_api', ARRAY[
  'ajustes', 'alertas', 'asignaciones', 'banderas', 'cola_auditoria', 'contribuciones', 'convergencias',
  'convocatoria_zona', 'convocatorias', 'documentos_gcs', 'empresas', 'entidades', 'financiadores',
  'lotes_ingesta', 'mef_entity_budget', 'network_expansions', 'osce_sancionados', 'pedidos_descarga',
  'procesamientos', 'procesamientos_publico', 'reportes_indexados', 'tarifas', 'usuarios', 'zona_estado',
  'zonas', 'ranking_impacto', 'contrato_estado', 'contratos_agregado', 'entidad_stats', 'senales_publicas']);
-- Escrituras públicas: denuncias, cuentas de usuario y el alta/edición de un aporte por su dueño.
SELECT pg_temp.otorgar('INSERT, UPDATE', 'vigia_api', ARRAY['usuarios']);
SELECT pg_temp.otorgar('INSERT', 'vigia_api', ARRAY['reportes_indexados']);
-- contribuciones y financiadores: por COLUMNAS. Lo público crea un aporte pendiente y sube su comprobante;
-- validar el pago (estado, pagada_at, validada_por…) y editar el perfil del aliado son del panel.
REVOKE INSERT, UPDATE ON public.contribuciones, public.financiadores FROM vigia_api;
GRANT INSERT (codigo, financiador_id, ubigeo, contratos, tarifa_id, monto_pen, pasarela, mensaje_publico)
  ON public.contribuciones TO vigia_api;
GRANT UPDATE (comprobante_url, pasarela_ref, financiador_id) ON public.contribuciones TO vigia_api;
GRANT INSERT (tipo, nombre_publico, slug, ruc, logo_url, email, firebase_uid, visible) ON public.financiadores TO vigia_api;
GRANT UPDATE (nombre_publico, slug, logo_url, ruc, tipo, visible, motivo_no_visible, email, firebase_uid)
  ON public.financiadores TO vigia_api;
GRANT USAGE ON SEQUENCE public.contribuciones_id_seq, public.contribuciones_codigo_seq, public.financiadores_id_seq
  TO vigia_api;
DO $$ BEGIN
  IF to_regclass('public.reportes_codigo_seq') IS NOT NULL THEN
    GRANT USAGE ON SEQUENCE public.reportes_codigo_seq TO vigia_api;   -- next_codigo_reporte() (33)
  END IF;
END $$;

-- vigia_api_admin (además de todo lo de vigia_api): panel, revisión, equipo, operación, procesar.
SELECT pg_temp.otorgar('SELECT', 'vigia_api_admin', ARRAY[
  'admin_log', 'equipo', 'lotes_items', 'cobertura_contratos', 'datasets_cobertura', 'derivados_estado',
  'derivados_refresco']);
SELECT pg_temp.otorgar('INSERT', 'vigia_api_admin', ARRAY['admin_log', 'banderas', 'pedidos_descarga']);
SELECT pg_temp.otorgar('INSERT, UPDATE', 'vigia_api_admin', ARRAY['ajustes', 'alertas', 'contribuciones', 'financiadores']);
SELECT pg_temp.otorgar('UPDATE', 'vigia_api_admin', ARRAY['procesamientos', 'pedidos_descarga']);
SELECT pg_temp.otorgar('INSERT, UPDATE, DELETE', 'vigia_api_admin', ARRAY['equipo']);

-- vigia_mcp: las cuatro relaciones que consultan sus tres herramientas.
SELECT pg_temp.otorgar('SELECT', 'vigia_mcp', ARRAY['alertas', 'banderas', 'convocatorias', 'osce_sancionados_vigentes']);

-- vigia_dispatcher: reclamar/latir/cerrar procesamientos, mirar alertas y convocatorias, documentos
-- vigentes y pedidos de descarga (esperar_documentos → pedir_descarga).
SELECT pg_temp.otorgar('SELECT', 'vigia_dispatcher', ARRAY['alertas', 'convocatorias', 'documentos_gcs', 'pedidos_descarga', 'procesamientos']);
SELECT pg_temp.otorgar('UPDATE', 'vigia_dispatcher', ARRAY['procesamientos']);
SELECT pg_temp.otorgar('INSERT', 'vigia_dispatcher', ARRAY['pedidos_descarga']);

-- vigia_jobs (además de sus tablas propias): ingesta de convocatorias/entidades/documentos, pedidos y
-- procesamientos (batch/descargar.py, cerrar_pedidos_atendidos()), zonas para los ubigeos.
SELECT pg_temp.otorgar('SELECT, INSERT, UPDATE', 'vigia_jobs', ARRAY['convocatorias', 'entidades', 'documentos_gcs']);
SELECT pg_temp.otorgar('SELECT, UPDATE', 'vigia_jobs', ARRAY['pedidos_descarga', 'procesamientos']);
SELECT pg_temp.otorgar('SELECT', 'vigia_jobs', ARRAY['zonas']);

-- ── 5 · Privilegios por defecto de lo que se cree después ───────────────────────────────────────
-- Solo la API lee por defecto las tablas nuevas. El MCP NO: una tabla nueva con datos sensibles
-- (correos, contactos) quedaría expuesta a sus herramientas sin que nadie lo decida; lo que el MCP
-- necesite se le otorga explícito arriba. El REVOKE deja bien una base donde ya se aplicó la versión
-- anterior de esta migración (que también se lo daba al MCP).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres   IN SCHEMA public GRANT SELECT ON TABLES TO vigia_api;
ALTER DEFAULT PRIVILEGES FOR ROLE vigia_jobs IN SCHEMA public GRANT SELECT ON TABLES TO vigia_api;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres   IN SCHEMA public REVOKE SELECT ON TABLES FROM vigia_mcp;
ALTER DEFAULT PRIVILEGES FOR ROLE vigia_jobs IN SCHEMA public REVOKE SELECT ON TABLES FROM vigia_mcp;

-- ── 6 · Funciones SECURITY DEFINER ───────────────────────────────────────────────────────────────
--   refresh_financiamiento(), refresh_financiamiento_si_hace_falta(), refrescar_derivados(text),
--   refresh_ranking(): REFRESH MATERIALIZED VIEW exige ser dueño de la vista.
--   asignar_contribucion(bigint): inserta asignaciones (y su trigger, procesamientos) y cambia el estado
--   de la contribución; así ningún rol necesita INSERT sobre asignaciones/procesamientos.
--   borrar_cuenta(text): anonimiza el financiador, desvincula denuncias y borra la fila de usuarios; así
--   vigia_api no necesita DELETE sobre usuarios ni UPDATE sobre reportes_indexados.
--   Funciones de trigger (encolar_procesamiento, cerrar_procesamiento_por_alerta, marcar_derivados*,
--   *_ubigeo_zona_trg, contrato_estado_*_trg): quien escribe no necesita permisos sobre lo que el trigger
--   recalcula (derivados_marcas, contrato_estado, procesamientos, asignaciones, contribuciones…). Una
--   función de trigger no se puede llamar directamente.
-- Todas: argumentos sólo como valores en SQL estático (ningún EXECUTE con texto del llamador).
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
      'refresh_financiamiento()', 'refresh_financiamiento_si_hace_falta()', 'refrescar_derivados(text)',
      'refresh_ranking()', 'asignar_contribucion(bigint)', 'borrar_cuenta(text)',
      'encolar_procesamiento()', 'cerrar_procesamiento_por_alerta()', 'marcar_derivados()', 'marcar_derivados_si_filas()',
      'convocatorias_ubigeo_zona_trg()', 'entidades_ubigeo_zona_trg()', 'zonas_ubigeo_zona_trg()',
      'contrato_estado_convocatorias_trg()', 'contrato_estado_alertas_trg()', 'contrato_estado_procesamientos_trg()',
      'contrato_estado_documentos_trg()', 'contrato_estado_ajustes_trg()'] LOOP
    CONTINUE WHEN to_regprocedure(f) IS NULL;
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', to_regprocedure(f));
    EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER SET search_path = public, pg_temp', to_regprocedure(f));
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', to_regprocedure(f));
  END LOOP;
  -- Internas (las llaman las de arriba, que ya corren como postgres): nadie más.
  FOREACH f IN ARRAY ARRAY['contrato_estado_recalcular(text[])', 'contrato_estado_recalcular_todo()',
                           'contrato_estado_vencidos()'] LOOP
    CONTINUE WHEN to_regprocedure(f) IS NULL;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', to_regprocedure(f));
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION refresh_financiamiento(), refresh_financiamiento_si_hace_falta()
  TO vigia_api_admin, vigia_dispatcher, vigia_jobs;
GRANT EXECUTE ON FUNCTION refresh_ranking() TO vigia_api_admin, vigia_dispatcher;
GRANT EXECUTE ON FUNCTION asignar_contribucion(bigint) TO vigia_api_admin;
GRANT EXECUTE ON FUNCTION borrar_cuenta(text) TO vigia_api;

COMMIT;
