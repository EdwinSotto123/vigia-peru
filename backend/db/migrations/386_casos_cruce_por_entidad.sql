-- 386: la faceta «Antecedentes» de los contratos de UNA entidad, precalculada (como casos_cruce_dia de la 375 y la 377).
--
-- Medido el 2026-11-18 (noche) con pg_stat_statements: con sólo el filtro de entidad (la ficha de cada entidad y su lista
-- de contratos) unía contrato_estado con casos_cruce contrato por contrato: 812 llamadas en una hora y cuarto, 120 ms de
-- media y 231 bloques cada una (un rastreador recorriendo fichas). Aquí: por entidad y tipo de contrato (ce_tipo, '' si no
-- tiene), los totales (tipo = '') y por tipo de antecedente. Cada contrato tiene una entidad y un tipo: la suma no cuenta a
-- nadie dos veces. A diferencia de la vista por día, entran también los contratos sin fecha de convocatoria (la faceta sin
-- fechas los cuenta). Se refresca con los demás derivados de contratos, a lo más una vez por hora: los antecedentes sólo
-- cambian cuando se rehace casos_cruce (una vez al día) y el refresco son ~5 s. Igual a la consulta en vivo en 21 casos
-- (7 entidades, con y sin tipo de contrato).

DROP MATERIALIZED VIEW IF EXISTS casos_cruce_por_entidad;
CREATE MATERIALIZED VIEW casos_cruce_por_entidad AS
  WITH k AS MATERIALIZED (
    SELECT ce.entidad_ruc, COALESCE(ce.tipo, '') AS ce_tipo, k.ocid, k.n_alta, k.tipos
      FROM contrato_estado ce JOIN casos_cruce k ON k.ocid = ce.ocid
     WHERE ce.ocid NOT LIKE 'ocds-vigia-%' AND ce.entidad_ruc IS NOT NULL
  ),
  o AS (SELECT k.entidad_ruc, k.ce_tipo, k.ocid, bool_or(k.n_alta > 0) AS alta,
               bool_or(array_to_string(k.tipos, ',') ~ '(^|,)(obra|inversion)_') AS obra
          FROM k GROUP BY 1, 2, 3),
  t AS (SELECT x.entidad_ruc, x.ce_tipo, x.t, count(*)::int AS n
          FROM (SELECT k.entidad_ruc, k.ce_tipo, k.ocid, t FROM k, unnest(k.tipos) t GROUP BY 1, 2, 3, 4) x GROUP BY 1, 2, 3)
  SELECT o.entidad_ruc, o.ce_tipo, ''::text AS tipo, count(*)::int AS con, (count(*) FILTER (WHERE o.alta))::int AS alta,
         (count(*) FILTER (WHERE o.obra))::int AS obra, now() AS calculado_at
    FROM o GROUP BY o.entidad_ruc, o.ce_tipo
  UNION ALL
  SELECT t.entidad_ruc, t.ce_tipo, t.t, t.n, 0, 0, now() FROM t;

CREATE UNIQUE INDEX IF NOT EXISTS casos_cruce_por_entidad_uidx ON casos_cruce_por_entidad (entidad_ruc, ce_tipo, tipo);
GRANT SELECT ON casos_cruce_por_entidad TO vigia_api, vigia_api_admin;
COMMENT ON MATERIALIZED VIEW casos_cruce_por_entidad IS 'Contratos con antecedentes del ganador por entidad y tipo de contrato (ce_tipo): totales (tipo = '''') y por tipo de antecedente. La faceta Antecedentes de la lista de contratos de una entidad. Migración 386.';

CREATE OR REPLACE FUNCTION public.refrescar_derivados(p_nombre text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET work_mem TO '64MB'
AS $function$
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
    -- 386: la faceta Antecedentes de cada entidad, a lo más una vez por hora (cambia con casos_cruce, una vez al día).
    IF NOT EXISTS (SELECT 1 FROM casos_cruce_por_entidad WHERE calculado_at > now() - interval '1 hour') THEN
      REFRESH MATERIALIZED VIEW CONCURRENTLY casos_cruce_por_entidad;
    END IF;
    -- 383: las cuentas sin filtro de los procesos de cada partido, a lo más una vez por hora: el refresco son 5-6 s y
    -- este grupo corre decenas de veces al día (refrescarla siempre costaba lo que ahorraba). La lista sigue en vivo.
    IF NOT EXISTS (SELECT 1 FROM partido_proceso_facetas WHERE calculado_at > now() - interval '1 hour') THEN
      REFRESH MATERIALIZED VIEW CONCURRENTLY partido_proceso_facetas;
    END IF;
  ELSE
    RAISE EXCEPTION 'grupo de derivados desconocido: %', p_nombre;
  END IF;
  UPDATE derivados_refresco
     SET refrescado_at = now(), refrescos = refrescos + 1,
         duracion_ms = (extract(epoch FROM clock_timestamp() - t0) * 1000)::int
   WHERE nombre = p_nombre;
END $function$;
