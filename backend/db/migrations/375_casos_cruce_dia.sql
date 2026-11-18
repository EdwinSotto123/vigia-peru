-- 375: la faceta «Antecedentes» de la lista de contratos con SÓLO un rango de fechas, precalculada por día.
--
-- La migración 114 precalculó la faceta sin filtros (casos_cruce_totales). Con un rango de fechas (el filtro más usado de
-- la lista y de la portada) contarCruces() volvía a unir contrato_estado con casos_cruce y a agregar: 0,5 s para un año,
-- 2,9 s para toda la historia, y en PROD 5 s de media (pg_stat_statements del 2026-11-18: 11 llamadas, 55 s de los 143 s
-- de base de datos de la API en 20 minutos; la consulta más cara del camino de usuario).
--
-- Cada contrato tiene UNA fecha de convocatoria, así que los conteos por día se pueden sumar sin contar a nadie dos
-- veces: con alguno (con), con uno grave (alta), con alguna bandera de obra (obra) y por tipo. Una fila por día con
-- tipo = '' (los totales) y una por día y tipo. La API suma el rango (unas decenas de miles de filas como mucho).
--
-- Se refresca con contratos_agregado y casos_cruce_totales en refrescar_derivados('contratos'), y en cargar_obras.py.

DROP MATERIALIZED VIEW IF EXISTS casos_cruce_dia;
CREATE MATERIALIZED VIEW casos_cruce_dia AS
  WITH k AS MATERIALIZED (
    SELECT ce.fecha_convocatoria AS dia, k.ocid, k.n_alta, k.tipos
      FROM contrato_estado ce JOIN casos_cruce k ON k.ocid = ce.ocid
     WHERE ce.ocid NOT LIKE 'ocds-vigia-%' AND ce.fecha_convocatoria IS NOT NULL
  ),
  o AS (SELECT k.dia, k.ocid, bool_or(k.n_alta > 0) AS alta,
               bool_or(array_to_string(k.tipos, ',') ~ '(^|,)(obra|inversion)_') AS obra
          FROM k GROUP BY 1, 2),
  t AS (SELECT x.dia, x.t, count(*)::int AS n FROM (SELECT k.dia, k.ocid, t FROM k, unnest(k.tipos) t GROUP BY 1, 2, 3) x GROUP BY 1, 2)
  SELECT o.dia, ''::text AS tipo, count(*)::int AS con, (count(*) FILTER (WHERE o.alta))::int AS alta,
         (count(*) FILTER (WHERE o.obra))::int AS obra
    FROM o GROUP BY o.dia
  UNION ALL
  SELECT t.dia, t.t, t.n, 0, 0 FROM t;

-- Único (lo pide REFRESH … CONCURRENTLY) y el que usa la suma por rango.
CREATE UNIQUE INDEX IF NOT EXISTS casos_cruce_dia_uidx ON casos_cruce_dia (dia, tipo);
GRANT SELECT ON casos_cruce_dia TO vigia_api, vigia_api_admin;
COMMENT ON MATERIALIZED VIEW casos_cruce_dia IS 'Contratos con antecedentes del ganador por día de convocatoria: totales (tipo = '''') y por tipo. La faceta Antecedentes de la lista de contratos con sólo un rango de fechas. Migración 375.';

-- refrescar_derivados('contratos') (migración 114) también la refresca.
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
    REFRESH MATERIALIZED VIEW CONCURRENTLY casos_cruce_dia;
  ELSE
    RAISE EXCEPTION 'grupo de derivados desconocido: %', p_nombre;
  END IF;
  UPDATE derivados_refresco
     SET refrescado_at = now(), refrescos = refrescos + 1,
         duracion_ms = (extract(epoch FROM clock_timestamp() - t0) * 1000)::int
   WHERE nombre = p_nombre;
END $$;
