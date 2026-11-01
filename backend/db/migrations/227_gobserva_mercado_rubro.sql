-- 227 · Gobserva: «inteligencia de mercado» de un rubro, para el MCP (herramienta mercado_rubro) y quien la quiera.
--
-- Qué se adjudicó en los últimos N meses con unas palabras (en el ítem, el proceso o su objeto), en CONOSCE: cuántos
-- procesos y cuánto, mes a mes, qué entidades compran más, qué empresas ganan más (SÓLO RUC 20: una persona natural no se
-- nombra) y cuánto se adjudica frente al valor referencial. Devuelve sólo agregados.
--
-- SECURITY DEFINER: el rol del MCP (vigia_mcp) no lee conosce_adjudicaciones (trae personas naturales con su RUC 10);
-- esta función le da sólo los agregados. Las palabras (hasta 6, de 3 letras o más, todas a la vez) se comparan sin tildes
-- ni mayúsculas con una expresión (`combustible`, `v[ií][aá]s`) y no con mef_norm() por fila: 0,4 s en vez de 3 a 10 s
-- sobre 12 meses (medido en PROD el 2026-11-01, mismas cifras). De lo escrito sólo quedan letras y cifras.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/227_gobserva_mercado_rubro.sql

CREATE OR REPLACE FUNCTION gobserva_mercado_rubro(p_texto text, p_meses int DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  meses int := LEAST(GREATEST(COALESCE(p_meses, 12), 1), 36);
  desde date := (date_trunc('month', current_date) - make_interval(months => meses - 1))::date;
  palabras text[];
  r jsonb;
BEGIN
  -- Cada palabra, sin tildes y sólo con letras y cifras, como expresión que acepta la letra con o sin tilde.
  palabras := ARRAY(
    SELECT replace(replace(replace(replace(replace(replace(w, 'a', '[aá]'), 'e', '[eé]'), 'i', '[ií]'), 'o', '[oó]'), 'u', '[uúü]'), 'n', '[nñ]')
      FROM (SELECT regexp_replace(translate(lower(x), 'áéíóúüñ', 'aeiouun'), '[^a-z0-9]', '', 'g') AS w
              FROM unnest(regexp_split_to_array(COALESCE(p_texto, ''), '\s+')) x) t
     WHERE length(w) >= 3 LIMIT 6);
  IF cardinality(palabras) = 0 THEN
    RETURN jsonb_build_object('error', 'Escribe al menos una palabra de 3 letras o más (por ejemplo «combustible»).');
  END IF;
  WITH a AS MATERIALIZED (
    SELECT x.codigo_convocatoria, x.entidad, x.entidad_ruc, x.ruc_proveedor, x.proveedor, x.monto_adjudicado, x.monto_referencial,
           x.fecha_buenapro, x.entidad_departamento
      FROM conosce_adjudicaciones x
     WHERE x.anio >= extract(year FROM desde)::int - 1
       AND x.fecha_buenapro >= desde AND x.fecha_buenapro <= current_date
       AND concat_ws(' ', x.descripcion_item, x.descripcion_proceso, x.objeto) ~* ALL (palabras)
  )
  SELECT jsonb_build_object(
    'rubro', p_texto,
    'desde', to_char(desde, 'YYYY-MM-DD'),
    'procesos', (SELECT count(DISTINCT codigo_convocatoria) FROM a),
    'monto_adjudicado_soles', (SELECT round(COALESCE(sum(monto_adjudicado), 0)) FROM a),
    'adjudicado_frente_al_referencial', (
      SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY monto_adjudicado / monto_referencial))::numeric, 3)
        FROM a WHERE monto_referencial > 0 AND monto_adjudicado > 0 AND monto_adjudicado / monto_referencial BETWEEN 0.2 AND 2),
    'por_mes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('mes', m, 'procesos', n, 'monto', monto) ORDER BY m)
        FROM (SELECT to_char(date_trunc('month', fecha_buenapro), 'YYYY-MM') AS m, count(DISTINCT codigo_convocatoria) AS n,
                     round(COALESCE(sum(monto_adjudicado), 0)) AS monto
                FROM a GROUP BY 1) t), '[]'::jsonb),
    'entidades_que_mas_compran', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('entidad', entidad, 'ruc', entidad_ruc, 'procesos', n, 'monto', monto) ORDER BY monto DESC NULLS LAST)
        FROM (SELECT max(entidad) AS entidad, entidad_ruc, count(DISTINCT codigo_convocatoria) AS n, round(COALESCE(sum(monto_adjudicado), 0)) AS monto
                FROM a GROUP BY entidad_ruc ORDER BY 4 DESC NULLS LAST LIMIT 10) t), '[]'::jsonb),
    'empresas_que_mas_ganan', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('empresa', proveedor, 'ruc', ruc_proveedor, 'procesos', n, 'monto', monto) ORDER BY monto DESC NULLS LAST)
        FROM (SELECT max(proveedor) AS proveedor, ruc_proveedor, count(DISTINCT codigo_convocatoria) AS n, round(COALESCE(sum(monto_adjudicado), 0)) AS monto
                FROM a WHERE ruc_proveedor ~ '^20[0-9]{9}$' GROUP BY ruc_proveedor ORDER BY 4 DESC NULLS LAST LIMIT 10) t), '[]'::jsonb),
    'regiones', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('region', d, 'procesos', n) ORDER BY n DESC)
        FROM (SELECT COALESCE(entidad_departamento, 'Sin dato') AS d, count(DISTINCT codigo_convocatoria) AS n FROM a GROUP BY 1 ORDER BY 2 DESC LIMIT 25) t), '[]'::jsonb),
    'fuente', 'CONOSCE (OECE), adjudicaciones por ítem'
  ) INTO r;
  RETURN r;
END $$;
ALTER FUNCTION gobserva_mercado_rubro(text, int) OWNER TO vigia_jobs;
REVOKE ALL ON FUNCTION gobserva_mercado_rubro(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gobserva_mercado_rubro(text, int) TO vigia_mcp, vigia_api, vigia_api_admin;
