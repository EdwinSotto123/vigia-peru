-- 383: la pestaña «Procesos» de un partido sin recorrer sus 23 mil filas en cada visita.
--
-- Medido el 2026-11-18 con pg_stat_statements (desde el 2026-10-20): las tres cuentas sin filtro de /partidos/:clave/procesos
-- (total y monto, «¿Lo leyó Vigía?» y antecedentes) sumaban 8 500 s en ~9 mil llamadas cada una, de 220 a 340 ms de
-- media; en el partido más grande (Somos Perú 2022, 23 522 procesos) la cuenta tardaba 5,8 s en frío: las filas de
-- partido_proceso pesan 1,2 kB y para sumar un monto había que leer 8 800 bloques. Las de informes de control por partido
-- (`entidad_ruc IN (SELECT DISTINCT … FROM partido_proceso …)`) leían lo mismo: otros 2 300 s.
--
-- 1. Índice que cubre (org_clave, anio_eleccion) con monto, entidad y ocid: la cuenta, el monto y las entidades del partido
--    salen del índice solo, con cualquier filtro que no mire otras columnas.
-- 2. partido_proceso_facetas: las tres cuentas SIN filtro (o sin el suyo propio) por partido y elección, 438 pares. Se
--    refresca con los demás derivados de contratos (refrescar_derivados('contratos')), a lo más una vez por hora. La
--    lectura va como (estado_proc, riesgo, n): la API la reparte con la misma regla que casoLectura (lib/lectura.ts).
--    Comprobado igual a las consultas en vivo en 10 partidos (los 4 más grandes y 6 al azar). Cuenta y monto del más
--    grande: 5,8 s en frío → 8 ms (index-only).

CREATE INDEX CONCURRENTLY IF NOT EXISTS partido_proceso_org_cubre
    ON partido_proceso (org_clave, anio_eleccion) INCLUDE (monto_adjudicado_pen, entidad_ruc, ocid);

CREATE MATERIALIZED VIEW IF NOT EXISTS partido_proceso_facetas AS
WITH pp AS (SELECT org_clave, anio_eleccion, ocid, monto_adjudicado_pen FROM partido_proceso),
     base AS (SELECT org_clave, anio_eleccion, count(*)::int AS n, COALESCE(sum(monto_adjudicado_pen), 0)::float8 AS monto
                FROM pp GROUP BY 1, 2),
     lec AS (SELECT org_clave, anio_eleccion,
                    jsonb_agg(jsonb_build_object('estado', estado_proc, 'riesgo', riesgo, 'n', n)) AS lecturas
               FROM (SELECT pp.org_clave, pp.anio_eleccion, ce.estado_proc, ce.riesgo, count(*)::int AS n
                       FROM pp JOIN contrato_estado ce ON ce.ocid = pp.ocid GROUP BY 1, 2, 3, 4) x
              GROUP BY 1, 2),
     k AS (SELECT pp.org_clave, pp.anio_eleccion, k.ocid, k.n_alta, k.tipos FROM pp JOIN casos_cruce k ON k.ocid = pp.ocid),
     o AS (SELECT org_clave, anio_eleccion, count(*)::int AS con, count(*) FILTER (WHERE alta)::int AS alta
             FROM (SELECT org_clave, anio_eleccion, ocid, bool_or(n_alta > 0) AS alta FROM k GROUP BY 1, 2, 3) y GROUP BY 1, 2),
     t AS (SELECT org_clave, anio_eleccion, jsonb_object_agg(t, n) AS tipos
             FROM (SELECT org_clave, anio_eleccion, t, count(*)::int AS n
                     FROM (SELECT DISTINCT k.org_clave, k.anio_eleccion, k.ocid, t FROM k, unnest(k.tipos) t) z GROUP BY 1, 2, 3) w
            GROUP BY 1, 2)
SELECT b.org_clave, b.anio_eleccion, b.n, b.monto,
       COALESCE(l.lecturas, '[]'::jsonb) AS lecturas,
       jsonb_build_object('con', COALESCE(o.con, 0), 'alta', COALESCE(o.alta, 0), 'tipos', COALESCE(t.tipos, '{}'::jsonb)) AS cruces,
       now() AS calculado_at
  FROM base b
  LEFT JOIN lec l USING (org_clave, anio_eleccion)
  LEFT JOIN o USING (org_clave, anio_eleccion)
  LEFT JOIN t USING (org_clave, anio_eleccion);

CREATE UNIQUE INDEX IF NOT EXISTS partido_proceso_facetas_pk ON partido_proceso_facetas (org_clave, anio_eleccion);
GRANT SELECT ON partido_proceso_facetas TO vigia_api;

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
