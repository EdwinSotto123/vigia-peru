-- 401 · Validación externa de las señales: ¿encuentran lo que la Contraloría después observó?
--
-- Hasta hoy ninguna señal ni el puntaje de riesgo se medía contra un hecho de afuera. Medido el 2026-11-19 (166 895
-- procesos de 2018 a 2025 en las 539 entidades con algún proceso observado; 1 129 observados por un informe de control):
--   · el puntaje de riesgo (10 por tipo alto, 3 por medio, 1 por bajo) tiene un AUC de 0,48: no ordena mejor que el azar
--     lo que la Contraloría termina observando; el monto solo, 0,80;
--   · a igual tipo y tamaño, los procesos con más banderas se observan MENOS (AUC 0,39 a 0,50 en cada estrato);
--   · con un solo postor se observan 14 % menos que lo esperado (en obras de más de S/ 10 M, 32 por mil contra 98-145
--     con cuatro o cinco): las observaciones de selección siguen, en parte, a que haya alguien que reclame.
-- No quiere decir que las señales fallen: la Contraloría audita sobre todo cumplimiento y obras grandes, y lo que marca
-- Vigía (competencia aparente, vínculos) casi no llega a sus informes. Sí quiere decir que el puntaje mide otra cosa, y
-- que cada señal debe juzgarse con datos. Esto lo mide solo, cada semana, y lo deja para el panel (/admin/senales):
--
--   validacion_corrida  una fila por corrida: universo, AUC del puntaje y del monto, observados en el 1 % y el 5 % de
--                       arriba (puntaje, monto y lo que daría el azar);
--   validacion_senal    por tipo de bandera: procesos, observados, esperados por el tipo, el tamaño y el año del
--                       proceso, y observados/esperados con su intervalo (Poisson, 95 %). > 1 = con esa bandera hay más
--                       observaciones de las que su tipo y tamaño explican.
--
-- Sin fuga: no cuentan como banderas las que nacen de los propios informes de control. La etiqueta es haber sido
-- observado (cruce observado_por_contraloria), no haber sido auditado: un proceso nunca auditado cuenta como no
-- observado, por eso el universo son sólo las entidades con algún proceso observado.

CREATE TABLE IF NOT EXISTS validacion_corrida (
  id            bigserial PRIMARY KEY,
  calculado_at  timestamptz NOT NULL DEFAULT now(),
  desde         date NOT NULL,
  hasta         date NOT NULL,
  universo      int NOT NULL,
  observados    int NOT NULL,
  entidades     int NOT NULL,
  auc_puntaje   numeric(5, 3),
  auc_monto     numeric(5, 3),
  top1_puntaje  int,
  top1_monto    int,
  top1_azar     numeric(8, 1),
  top5_puntaje  int,
  top5_monto    int,
  top5_azar     numeric(8, 1)
);

CREATE TABLE IF NOT EXISTS validacion_senal (
  corrida_id  bigint NOT NULL REFERENCES validacion_corrida (id) ON DELETE CASCADE,
  tipo        text NOT NULL,
  procesos    int NOT NULL,
  observados  int NOT NULL,
  esperados   numeric(10, 2) NOT NULL,
  oe          numeric(8, 3),
  oe_min      numeric(8, 3),
  oe_max      numeric(8, 3),
  PRIMARY KEY (corrida_id, tipo)
);

CREATE OR REPLACE FUNCTION refrescar_validacion_senales() RETURNS bigint
LANGUAGE plpgsql SET work_mem = '256MB' AS $$
DECLARE
  v_id    bigint;
  v_desde date := DATE '2018-01-01';
  -- Hasta el año pasado: los informes de control llegan años después y el año en curso todavía no tiene observaciones.
  v_hasta date := make_date(extract(year FROM now())::int, 1, 1);
  n1 int; n0 int; n int;
BEGIN
  -- El universo: procesos adjudicados en el período, en entidades con algún proceso observado por la Contraloría.
  CREATE TEMP TABLE _vu ON COMMIT DROP AS
  WITH obs AS (SELECT DISTINCT ocid FROM cruces_proveedor WHERE tipo = 'observado_por_contraloria'),
       ent AS (SELECT DISTINCT btrim(c.entidad_ruc::text) AS ent FROM obs JOIN convocatorias c USING (ocid)),
       cv  AS (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
                WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid),
       adj AS (SELECT cv.ocid, max(a.fecha_buenapro) AS f,
                      sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('PEN', 'Soles', 'SOLES', 'Nuevos Soles')) AS monto
                 FROM conosce_adjudicaciones a JOIN cv ON cv.codigo = a.codigo_convocatoria AND cv.entidad_ruc = a.entidad_ruc
                WHERE btrim(a.entidad_ruc::text) IN (SELECT ent FROM ent)
                GROUP BY cv.ocid)
  SELECT adj.ocid, btrim(c.entidad_ruc::text) AS ent, extract(year FROM adj.f)::int AS anio, COALESCE(adj.monto, 0) AS monto,
         lower(COALESCE(c.tipo_contratacion, '')) AS tipo,
         CASE WHEN COALESCE(adj.monto, 0) < 400000 THEN 1 WHEN adj.monto < 2000000 THEN 2 WHEN adj.monto < 10000000 THEN 3 ELSE 4 END AS banda,
         (adj.ocid IN (SELECT ocid FROM obs)) AS observado, 0::float AS esperado
    FROM adj JOIN convocatorias c ON c.ocid = adj.ocid
   WHERE adj.f >= v_desde AND adj.f < v_hasta;
  CREATE INDEX ON _vu (ocid);
  -- Lo esperado de cada proceso: la tasa de observación de los de su tipo, su tamaño y su año.
  UPDATE _vu u SET esperado = s.tasa
    FROM (SELECT tipo, banda, anio, avg(observado::int)::float AS tasa FROM _vu GROUP BY 1, 2, 3) s
   WHERE s.tipo = u.tipo AND s.banda = u.banda AND s.anio = u.anio;
  ANALYZE _vu;

  -- Las banderas de cada proceso (cada tipo una vez, con su severidad más grave), sin las que salen de los informes.
  CREATE TEMP TABLE _vb ON COMMIT DROP AS
  SELECT k.ocid, k.tipo, min(CASE k.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END) AS sev
    FROM cruces_proveedor k JOIN _vu u ON u.ocid = k.ocid
   WHERE k.tipo NOT IN ('observado_por_contraloria', 'gano_tras_observacion', 'obra_informe_control',
                        'socio_con_informe_control', 'informe_control_observacion')
   GROUP BY 1, 2;

  -- El puntaje como lo calcula casos_cruce (10/3/1 por tipo), sin los indicadores en observación.
  CREATE INDEX ON _vb (ocid);
  ANALYZE _vb;
  CREATE TEMP TABLE _vs ON COMMIT DROP AS
  SELECT u.ocid, u.observado, u.monto, COALESCE(p.puntaje, 0) AS puntaje
    FROM _vu u
    LEFT JOIN (SELECT b.ocid, sum(CASE b.sev WHEN 0 THEN 10 WHEN 1 THEN 3 ELSE 1 END) AS puntaje
                 FROM _vb b WHERE NOT EXISTS (SELECT 1 FROM senal_en_observacion o WHERE o.tipo = b.tipo)
                GROUP BY b.ocid) p ON p.ocid = u.ocid;

  SELECT count(*) FILTER (WHERE observado), count(*) FILTER (WHERE NOT observado), count(*) INTO n1, n0, n FROM _vs;
  IF n1 = 0 OR n0 = 0 THEN
    RAISE NOTICE 'validación sin observados o sin no observados: nada que medir';
    RETURN NULL;
  END IF;

  INSERT INTO validacion_corrida (desde, hasta, universo, observados, entidades, auc_puntaje, auc_monto,
                                  top1_puntaje, top1_monto, top1_azar, top5_puntaje, top5_monto, top5_azar)
  SELECT v_desde, v_hasta - 1, n, n1, (SELECT count(DISTINCT ent) FROM _vu),
         -- AUC por rangos (Mann-Whitney), con los empates en su rango medio.
         (SELECT ((sum(r) FILTER (WHERE observado)) - n1 * (n1 + 1) / 2.0) / (n1::numeric * n0)
            FROM (SELECT observado, rank() OVER (ORDER BY puntaje) + (count(*) OVER (PARTITION BY puntaje) - 1) / 2.0 AS r FROM _vs) x),
         (SELECT ((sum(r) FILTER (WHERE observado)) - n1 * (n1 + 1) / 2.0) / (n1::numeric * n0)
            FROM (SELECT observado, rank() OVER (ORDER BY monto) + (count(*) OVER (PARTITION BY monto) - 1) / 2.0 AS r FROM _vs) x),
         -- Observados en el 1 % y el 5 % de arriba; los empates se rompen al azar, pero siempre igual (md5 del OCID).
         (SELECT count(*) FILTER (WHERE observado) FROM (SELECT observado FROM _vs ORDER BY puntaje DESC, md5(ocid) LIMIT n / 100) t),
         (SELECT count(*) FILTER (WHERE observado) FROM (SELECT observado FROM _vs ORDER BY monto DESC, md5(ocid) LIMIT n / 100) t),
         round(n1 * 0.01, 1),
         (SELECT count(*) FILTER (WHERE observado) FROM (SELECT observado FROM _vs ORDER BY puntaje DESC, md5(ocid) LIMIT n / 20) t),
         (SELECT count(*) FILTER (WHERE observado) FROM (SELECT observado FROM _vs ORDER BY monto DESC, md5(ocid) LIMIT n / 20) t),
         round(n1 * 0.05, 1)
  RETURNING id INTO v_id;

  -- Por tipo de bandera: observados / esperados, con su intervalo de Poisson aproximado al 95 %.
  INSERT INTO validacion_senal (corrida_id, tipo, procesos, observados, esperados, oe, oe_min, oe_max)
  SELECT v_id, b.tipo, count(*), count(*) FILTER (WHERE u.observado), sum(u.esperado),
         CASE WHEN sum(u.esperado) > 0 THEN (count(*) FILTER (WHERE u.observado)) / sum(u.esperado) END,
         CASE WHEN sum(u.esperado) > 0 AND count(*) FILTER (WHERE u.observado) > 0
              THEN power(greatest(sqrt(count(*) FILTER (WHERE u.observado)) - 0.98, 0), 2) / sum(u.esperado) ELSE 0 END,
         CASE WHEN sum(u.esperado) > 0 THEN power(sqrt(count(*) FILTER (WHERE u.observado) + 1) + 0.98, 2) / sum(u.esperado) END
    FROM _vb b JOIN _vu u ON u.ocid = b.ocid
   GROUP BY b.tipo;
  RETURN v_id;
END $$;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.validacion_corrida OWNER TO vigia_jobs;
    ALTER TABLE public.validacion_senal OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_validacion_senales() OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api_admin', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.validacion_corrida, public.validacion_senal TO %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_validacion_senales() FROM PUBLIC;

-- Cada lunes (09:30 UTC, 04:30 en Lima), después de la carga semanal de las fuentes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('vigia-validacion-senales', '30 9 * * 1', 'SELECT public.refrescar_validacion_senales()');
  ELSE
    RAISE NOTICE 'Sin pg_cron: llama a refrescar_validacion_senales() desde donde corran los refrescos.';
  END IF;
END $$;
