-- 213: el DNI de los familiares que declaran los funcionarios en su DJI fuera del alcance de la API pública, y registro de
-- quién lee las tablas con documentos de personas (revisión de seguridad del 2026-10-30).
--
-- 1. dji_vinculos.pariente_doc nunca se publica: la API sólo lo cruzaba, en el perfil de una persona (quién la declaró
--    como pariente) y en el indicio de nepotismo (el pariente es locador de la entidad). Esos cruces pasan a funciones
--    SECURITY DEFINER que devuelven sólo lo que la API muestra, sin el DNI. La 214, ya desplegada la API que las usa, le
--    quita a la API la lectura de dji_vinculos: ni una inyección SQL en la API podría listar esos documentos. La vista
--    dji_nepotismo sigue igual (corre con los permisos de su dueño y no devuelve el DNI).
-- 2. Auditoría por objeto (pgaudit, ya cargado en shared_preload_libraries): el rol rds_pgaudit, sin login, tiene SELECT
--    sobre las tablas y vistas materializadas con un documento de persona. Con pgaudit.role = rds_pgaudit (grupo de
--    parámetros vigia-db-pg16, cloud_sql/terraform/modules/aws_rds) cada lectura de ellas, de cualquier rol, queda en el
--    log de la base (CloudWatch) sin los valores de los parámetros. Una tabla nueva con DNI entra volviendo a correr el
--    bloque 2.
-- Idempotente.

-- ─── 1. Cruces con el DNI de familiares, sin devolverlo ──────────────────────────────────────────────────────────────

/** Quién declaró a esta persona (por su DNI) como pariente en su DJI: la entidad, el funcionario y el vínculo. */
CREATE OR REPLACE FUNCTION public.dji_familia_de(p_doc text)
RETURNS TABLE (entidad_ruc text, declarante_norm text, parentesco text, grado text, codigo_ddjj bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT ON (v.entidad_ruc, v.declarante_norm) v.entidad_ruc, v.declarante_norm, v.parentesco, v.grado, v.codigo_ddjj
    FROM dji_vinculos v
   WHERE v.pariente_doc = p_doc AND v.declarante_norm IS NOT NULL
   ORDER BY v.entidad_ruc, v.declarante_norm, v.codigo_ddjj
$$;

-- El pariente declarado es locador de la misma entidad: su RUC 10 es «10» + su DNI + un dígito, así que basta un rango
-- sobre la llave de persona_orden_anual (entidad, ruc). Lo mismo que hacía la API (PARIENTE_LOCADOR, routes/entidades.ts).

/** Los pares entidad × funcionario del indicio de nepotismo (unos 320): la API los calcula una vez para todas las listas. */
CREATE OR REPLACE FUNCTION public.dji_nepotismo_pares()
RETURNS TABLE (entidad text, declarante text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT v.entidad_ruc, v.declarante_norm
    FROM dji_vinculos v
   WHERE v.declarante_norm IS NOT NULL AND length(v.pariente_doc) = 8
     AND EXISTS (SELECT 1 FROM persona_orden_anual po
                  WHERE po.entidad_ruc = v.entidad_ruc AND po.ruc BETWEEN '10' || v.pariente_doc || '0' AND '10' || v.pariente_doc || '9')
$$;

/** ¿La entidad tiene el indicio? (fila por fila, cuando la lista de pares no se pudo calcular). */
CREATE OR REPLACE FUNCTION public.dji_entidad_con_nepotismo(p_entidad text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM dji_vinculos v
     WHERE v.entidad_ruc = p_entidad AND length(v.pariente_doc) = 8
       AND EXISTS (SELECT 1 FROM persona_orden_anual po
                    WHERE po.entidad_ruc = v.entidad_ruc AND po.ruc BETWEEN '10' || v.pariente_doc || '0' AND '10' || v.pariente_doc || '9'))
$$;

/** ¿Este funcionario de la planilla (entidad y nombre normalizado) declaró a un pariente que es locador de su entidad? */
CREATE OR REPLACE FUNCTION public.dji_declarante_con_nepotismo(p_entidad text, p_declarante text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM dji_vinculos v
     WHERE v.entidad_ruc = p_entidad AND v.declarante_norm = p_declarante AND length(v.pariente_doc) = 8
       AND EXISTS (SELECT 1 FROM persona_orden_anual po
                    WHERE po.entidad_ruc = v.entidad_ruc AND po.ruc BETWEEN '10' || v.pariente_doc || '0' AND '10' || v.pariente_doc || '9'))
$$;

REVOKE EXECUTE ON FUNCTION public.dji_familia_de(text), public.dji_nepotismo_pares(), public.dji_entidad_con_nepotismo(text),
  public.dji_declarante_con_nepotismo(text, text) FROM PUBLIC;

-- La API de cada base (vigia_api en producción, dev_api en DEV) y la del panel.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'dev_api', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.dji_familia_de(text), public.dji_nepotismo_pares(),
                        public.dji_entidad_con_nepotismo(text), public.dji_declarante_con_nepotismo(text, text) TO %I', r);
    END IF;
  END LOOP;
END $$;

-- ─── 2. Auditoría de lecturas de las tablas con documentos de personas ─────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rds_pgaudit') THEN
    CREATE ROLE rds_pgaudit NOLOGIN;
  END IF;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT DISTINCT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'm')
       AND a.attname ~* '(^|_)(dni|doc|documento|numero_documento|nro_documento|pariente_doc|num_doc)($|_)'
  LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO rds_pgaudit', t);
  END LOOP;
END $$;
