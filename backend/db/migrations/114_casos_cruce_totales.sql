-- 114: la faceta "Antecedentes" de la lista de contratos SIN filtros, precomputada.
--
-- contarCruces() sin filtros de usuario recorría los 174 mil casos_cruce y los agregaba (seq scan + unnest + tres
-- agregados que se desbordan a disco con work_mem de 32 MB): ~0,9-1,2 s por frío, la consulta de USUARIO más cara del
-- camino caliente (pg_stat_statements 2026-10-23: 511 llamadas, 1198 ms de media). Sólo cambia cuando cambia
-- casos_cruce, así que se precalcula en una vista materializada de una fila y la API la lee en O(1).
--
-- Se refresca junto a contratos_agregado en refrescar_derivados('contratos') (misma dependencia y cadencia: tras cada
-- ingesta de OCDS, vía refresh_financiamiento_si_hace_falta en oece_ocds.ts).

DROP MATERIALIZED VIEW IF EXISTS casos_cruce_totales;
CREATE MATERIALIZED VIEW casos_cruce_totales AS
  WITH k AS MATERIALIZED (SELECT k.ocid, k.n_alta, k.tipos FROM casos_cruce k WHERE k.ocid NOT LIKE 'ocds-vigia-%'),
       o AS (SELECT k.ocid, bool_or(k.n_alta > 0) AS alta FROM k GROUP BY 1),
       t AS (SELECT x.t, count(*)::int AS n FROM (SELECT k.ocid, t FROM k, unnest(k.tipos) t GROUP BY 1, 2) x GROUP BY 1)
  SELECT 1 AS id,
         (SELECT count(*)::int FROM o) AS con,
         (SELECT count(*)::int FROM o WHERE alta) AS alta,
         (SELECT COALESCE(jsonb_object_agg(t, n), '{}'::jsonb) FROM t) AS tipos;

-- Unique index: lo pide REFRESH ... CONCURRENTLY (y la vista es de una sola fila, id = 1).
CREATE UNIQUE INDEX IF NOT EXISTS casos_cruce_totales_id ON casos_cruce_totales (id);
GRANT SELECT ON casos_cruce_totales TO vigia_api, vigia_api_admin;

-- Añade el refresh de la vista a refrescar_derivados('contratos'), junto a contratos_agregado. work_mem a 64 MB para
-- que la reconstrucción de la faceta no se desborde a disco (con 32 MB eran 5 lotes en temp).
CREATE OR REPLACE FUNCTION refrescar_derivados(p_nombre TEXT) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET work_mem = '64MB' AS $$
DECLARE t0 TIMESTAMPTZ := clock_timestamp();
BEGIN
  DELETE FROM derivados_marcas WHERE nombre = p_nombre;
  IF p_nombre = 'financiamiento' THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY zona_estado;
    REFRESH MATERIALIZED VIEW CONCURRENTLY ranking_impacto;
  ELSIF p_nombre = 'contratos' THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY contratos_agregado;
    REFRESH MATERIALIZED VIEW CONCURRENTLY entidad_stats;
    REFRESH MATERIALIZED VIEW CONCURRENTLY casos_cruce_totales;
  ELSE
    RAISE EXCEPTION 'grupo de derivados desconocido: %', p_nombre;
  END IF;
  UPDATE derivados_refresco
     SET refrescado_at = now(), refrescos = refrescos + 1,
         duracion_ms = (extract(epoch FROM clock_timestamp() - t0) * 1000)::int
   WHERE nombre = p_nombre;
END $$;
