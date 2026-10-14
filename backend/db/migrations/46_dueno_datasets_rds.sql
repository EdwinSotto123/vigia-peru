-- 46 · Las tablas de datasets vuelven a ser de vigia_jobs (se perdió al pasar a RDS).
--
-- La 37 dejó a vigia_jobs como DUEÑO de las tablas que cargan los scrapers (TRUNCATE + COPY, DELETE por
-- periodo, CREATE UNIQUE INDEX en tiempo de ejecución). La restauración en RDS (2026-10-12) las dejó a
-- nombre de `postgres`, y vigia_jobs quedó sin permiso sobre ellas: solo seguía funcionando oece_ocds
-- (convocatorias/entidades tienen GRANT explícito). Es el mismo bloque 3 de la 37, idempotente.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/46_dueno_datasets_rds.sql
-- Verificar:      SELECT relname FROM pg_class WHERE relowner = 'vigia_jobs'::regrole AND relkind = 'r';

-- ALTER … OWNER exige que el nuevo dueño pueda crear en el esquema y que quien lo ejecuta sea miembro de él.
GRANT CREATE ON SCHEMA public TO vigia_jobs;
GRANT vigia_jobs TO postgres WITH INHERIT TRUE, SET TRUE;

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
