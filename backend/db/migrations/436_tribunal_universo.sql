-- 436 · La tasa de procesos corregidos por entidad, sobre TODOS sus procesos (no sólo los que ya están en CONOSCE).
--
-- tribunal_entidad (422, 423) tomaba las LP, CP y AS desde 2024 con dos o más postores EN CONOSCE. Un proceso apelado
-- queda trabado y CONOSCE no lo publica hasta después: de 963 corregidos sólo 250 tenían esos postores (26 %, contra el
-- 42 % del resto). La tasa de cada entidad contaba sólo una cuarta parte de sus correcciones. Ahora el denominador son
-- todas sus LP, CP y AS desde 2024 y el numerador todas las corregidas que se leyeron. EsSalud: 51 de 3 728 (2,2 veces el
-- resto del país) en vez de 12 de 1 467.
--
-- La VALIDACIÓN de señales contra el Tribunal (404, 429, 434) NO cambia de universo, y es a propósito: medida sobre todas
-- las LP, CP y AS (prueba del 11-20, deshecha) casi todas las señales salían por debajo de lo esperado y el AUC del
-- puntaje caía a 0,44. Las señales se calculan con datos de CONOSCE que los procesos trabados no tienen todavía: una señal
-- «ausente» en un corregido era falta de datos, no falta de indicio. Para validar señales se comparan procesos donde la
-- señal se pudo calcular; que el filtro saque más positivos que negativos baja el número de casos, como un muestreo de
-- casos y controles, pero no invierte la comparación.

CREATE OR REPLACE FUNCTION tribunal_universo()
RETURNS TABLE (ocid text, tipo text, anio int, monto numeric, banda int, entidad_ruc text, corregido boolean)
LANGUAGE sql STABLE AS $$
  SELECT cn.ocid::text, cn.tipo::text, cn.anio::int, COALESCE(c.cuantia_referencial, 0)::numeric,
         CASE WHEN COALESCE(c.cuantia_referencial, 0) < 400000 THEN 1 WHEN c.cuantia_referencial < 2000000 THEN 2
              WHEN c.cuantia_referencial < 10000000 THEN 3 ELSE 4 END,
         btrim(c.entidad_ruc::text),
         EXISTS (SELECT 1 FROM tribunal_proceso p JOIN tribunal_resolucion r ON r.id = p.resolucion_id
                  WHERE p.ocid = cn.ocid AND tribunal_corrigio(r))
    FROM convocatoria_nomenclatura cn
    JOIN convocatorias c ON c.ocid = cn.ocid
   WHERE cn.tipo IN ('LP', 'CP', 'AS') AND cn.anio >= 2024
$$;

CREATE OR REPLACE FUNCTION refrescar_tribunal_entidad() RETURNS integer
LANGUAGE plpgsql SET work_mem TO '128MB' AS $$
DECLARE n int; v_total int; v_corr int;
BEGIN
  -- El mismo universo que la validación (436).
  CREATE TEMP TABLE _te ON COMMIT DROP AS
  SELECT u.entidad_ruc AS ent, u.corregido FROM tribunal_universo() u;
  SELECT count(*), count(*) FILTER (WHERE corregido) INTO v_total, v_corr FROM _te;
  IF v_corr = 0 THEN RETURN 0; END IF;

  CREATE TEMP TABLE _tp ON COMMIT DROP AS
  SELECT ent, count(*)::int AS procesos, (count(*) FILTER (WHERE corregido))::int AS corregidos
    FROM _te WHERE ent IS NOT NULL GROUP BY ent;

  DELETE FROM tribunal_entidad;
  INSERT INTO tribunal_entidad (entidad_ruc, procesos, corregidos, tasa, tasa_resto, veces, p_valor, q_valor, destacada)
  WITH x AS (
    SELECT ent, procesos, corregidos, corregidos::float8 / procesos AS tasa,
           ((v_corr - corregidos) + 0.5) / ((v_total - procesos) + 1.0) AS resto,
           binomial_cola(procesos, corregidos, ((v_corr - corregidos) + 0.5) / ((v_total - procesos) + 1.0)) AS pv
      FROM _tp),
  o AS (SELECT x.*, row_number() OVER (ORDER BY pv, ent) AS i, count(*) OVER () AS l FROM x WHERE procesos >= 10),
  c AS (SELECT max(i) AS corte FROM o WHERE pv <= 0.10 * i / l)
  SELECT x.ent, x.procesos, x.corregidos, x.tasa, x.resto,
         CASE WHEN x.resto > 0 THEN x.tasa / x.resto END,
         x.pv,
         CASE WHEN o.i IS NOT NULL THEN least(1, x.pv * o.l / o.i) END,
         COALESCE(o.i <= c.corte AND x.corregidos >= 3 AND x.tasa > x.resto, false)
    FROM x LEFT JOIN o ON o.ent = x.ent CROSS JOIN c;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER FUNCTION public.tribunal_universo() OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_tribunal_entidad() OWNER TO vigia_jobs;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION refrescar_tribunal_entidad() TO vigia_jobs;

SELECT refrescar_tribunal_entidad();
