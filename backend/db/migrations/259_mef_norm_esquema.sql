-- 259 · mef_norm con el esquema escrito: el ANALYZE automático de dos tablas fallaba desde el 2026-10-22.
--
-- El autovacuum (y su ANALYZE automático) corre con search_path = pg_catalog. mef_norm está en índices de expresión de
-- persona_entidad y planilla_persona, y llamaba a immutable_unaccent sin esquema: al calcular esos índices el ANALYZE
-- automático moría con «function immutable_unaccent(text) does not exist» (unas 240 veces por hora por tabla en el log
-- de PROD, 2026-11-06). Esas dos tablas quedaron sin estadísticas: persona_entidad con 32 M de cambios sin analizar
-- sobre 3,2 M de filas y planilla_persona con 5,4 M sobre 655 mil. Con estadísticas viejas el planificador elige mal en
-- los refrescos de personas, que ya rozan el corte de Hyperdrive.
--
-- Mismo cuerpo y mismo resultado (los índices siguen valiendo); sólo cambia `public.` delante de immutable_unaccent.
-- immutable_unaccent ya llama a public.unaccent con su diccionario calificado.

CREATE OR REPLACE FUNCTION public.mef_norm(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(regexp_replace(upper(public.immutable_unaccent(coalesce(t, ''))), '[^A-Z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- Lo que el autovacuum no pudo hacer en dos semanas.
ANALYZE public.persona_entidad;
ANALYZE public.planilla_persona;
