-- 377: casos_cruce_dia (migración 375) también por tipo de contrato.
--
-- Tras la 375, la faceta «Antecedentes» con un rango de fechas salía de la vista por día; con un TIPO de contrato además
-- (bienes, servicios, obras…, el filtro de las pestañas de la lista) volvía a unir contrato_estado con casos_cruce: 4,45 s
-- por llamada (pg_stat_statements del 2026-11-18, tarde). Ahora la vista lleva `ce_tipo` (el tipo del contrato; '' si no
-- tiene) y la API suma con o sin ese filtro. Cada contrato tiene un día y un tipo: la suma sigue sin contar a nadie dos
-- veces. Mismo nombre y mismo refresco (refrescar_derivados('contratos') y cargar_obras.py).

DROP MATERIALIZED VIEW IF EXISTS casos_cruce_dia;
CREATE MATERIALIZED VIEW casos_cruce_dia AS
  WITH k AS MATERIALIZED (
    SELECT ce.fecha_convocatoria AS dia, COALESCE(ce.tipo, '') AS ce_tipo, k.ocid, k.n_alta, k.tipos
      FROM contrato_estado ce JOIN casos_cruce k ON k.ocid = ce.ocid
     WHERE ce.ocid NOT LIKE 'ocds-vigia-%' AND ce.fecha_convocatoria IS NOT NULL
  ),
  o AS (SELECT k.dia, k.ce_tipo, k.ocid, bool_or(k.n_alta > 0) AS alta,
               bool_or(array_to_string(k.tipos, ',') ~ '(^|,)(obra|inversion)_') AS obra
          FROM k GROUP BY 1, 2, 3),
  t AS (SELECT x.dia, x.ce_tipo, x.t, count(*)::int AS n
          FROM (SELECT k.dia, k.ce_tipo, k.ocid, t FROM k, unnest(k.tipos) t GROUP BY 1, 2, 3, 4) x GROUP BY 1, 2, 3)
  SELECT o.dia, o.ce_tipo, ''::text AS tipo, count(*)::int AS con, (count(*) FILTER (WHERE o.alta))::int AS alta,
         (count(*) FILTER (WHERE o.obra))::int AS obra
    FROM o GROUP BY o.dia, o.ce_tipo
  UNION ALL
  SELECT t.dia, t.ce_tipo, t.t, t.n, 0, 0 FROM t;

CREATE UNIQUE INDEX IF NOT EXISTS casos_cruce_dia_uidx ON casos_cruce_dia (dia, ce_tipo, tipo);
GRANT SELECT ON casos_cruce_dia TO vigia_api, vigia_api_admin;
COMMENT ON MATERIALIZED VIEW casos_cruce_dia IS 'Contratos con antecedentes del ganador por día de convocatoria y tipo de contrato (ce_tipo): totales (tipo = '''') y por tipo de antecedente. La faceta Antecedentes de la lista de contratos con sólo fechas y tipo. Migraciones 375 y 377.';
