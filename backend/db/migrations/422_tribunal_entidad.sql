-- 422 · Las entidades cuyos procesos el Tribunal corrige más que el resto del país.
--
-- Una apelación declarada FUNDADA o una nulidad de oficio dice que el comité se equivocó (descalificó mal, calificó mal,
-- otorgó mal) o que el proceso tenía un vicio (migraciones 402-404). Una vez puede pasar en cualquier entidad; que pase
-- mucho más que en el resto del país es un patrón de la entidad: comités que no respetan las reglas o procesos armados
-- para un postor. Por entidad, entre sus procesos apelables (LP, CP o AS desde 2024 con dos postores o más):
--   procesos, corregidos, su tasa, la del resto del país sin ella, cuántas veces más, la probabilidad binomial de tantos
--   corregidos con la tasa del resto (binomial_cola, 415) y si pasa Benjamini-Hochberg al 10 % sobre todas las entidades
--   con 10 procesos o más (destacada).
-- Sesgo conocido: las resoluciones se bajan de las más nuevas a las más viejas (tarea VigiaTribunal); mientras no estén
-- todas, la tasa del país y la de cada entidad tienen el mismo sesgo y la comparación sigue valiendo. Medido el 2026-11-19
-- con 904 de ~23 500 resoluciones: 429 procesos corregidos, 26 entidades con 3 o más.
--
-- La lee GET /entidades/:ruc/tribunal (`comparacion`), la ficha de la entidad y el MCP (ficha_entidad). La rehace
-- refrescar_tribunal_entidad(): tribunal_cargar.py al terminar cada corrida y pg_cron los lunes.

-- binomial_cola (415) con n grande: exp() de un logaritmo muy negativo no da 0 en PostgreSQL, lanza «underflow». Un
-- término menor que e^-700 cuenta como cero (no cambia ninguna probabilidad que importe).
CREATE OR REPLACE FUNCTION binomial_cola(n int, m int, p float8) RETURNS float8
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s float8 := 0; k int; i int; lc float8; t float8;
BEGIN
  IF m <= 0 THEN RETURN 1; END IF;
  IF m > n THEN RETURN 0; END IF;
  p := least(greatest(p, 1e-9), 1 - 1e-9);
  FOR k IN m..n LOOP
    lc := 0;
    FOR i IN 1..k LOOP lc := lc + ln(n - k + i) - ln(i); END LOOP;
    t := lc + k * ln(p) + (n - k) * ln(1 - p);
    IF t > -700 THEN s := s + exp(t); END IF;
  END LOOP;
  RETURN least(s, 1);
END $$;

CREATE TABLE IF NOT EXISTS tribunal_entidad (
  entidad_ruc   text PRIMARY KEY,
  procesos      int NOT NULL,
  corregidos    int NOT NULL,
  tasa          float8 NOT NULL,
  tasa_resto    float8 NOT NULL,
  veces         float8,
  p_valor       float8 NOT NULL,
  q_valor       float8,
  destacada     boolean NOT NULL DEFAULT false,
  calculado_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE tribunal_entidad IS 'Procesos apelables de cada entidad corregidos por el Tribunal frente al resto del país (binomial y Benjamini-Hochberg al 10 %). Migración 422.';

CREATE OR REPLACE FUNCTION refrescar_tribunal_entidad() RETURNS integer
LANGUAGE plpgsql SET work_mem TO '128MB' AS $$
DECLARE n int; v_total int; v_corr int;
BEGIN
  CREATE TEMP TABLE _te ON COMMIT DROP AS
  SELECT btrim(c.entidad_ruc::text) AS ent,
         EXISTS (SELECT 1 FROM tribunal_proceso p JOIN tribunal_resolucion r ON r.id = p.resolucion_id
                  WHERE p.ocid = cn.ocid AND r.resultado_ok
                    AND r.resultado IN ('fundado', 'fundado_en_parte', 'nulidad_de_oficio')) AS corregido
    FROM convocatoria_nomenclatura cn
    JOIN convocatorias c ON c.ocid = cn.ocid
   WHERE cn.tipo IN ('LP', 'CP', 'AS') AND cn.anio >= 2024
     AND (SELECT count(DISTINCT p.ruc_postor) FROM conosce_postores p WHERE p.codigo_convocatoria = c.codigo) >= 2;
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
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.tribunal_entidad OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_tribunal_entidad() OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'dev_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.tribunal_entidad TO %I', r);
    END IF;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION refrescar_tribunal_entidad() TO vigia_jobs;

SELECT cron.schedule('vigia-tribunal-entidad', '0 10 * * 1', 'SELECT refrescar_tribunal_entidad()');
