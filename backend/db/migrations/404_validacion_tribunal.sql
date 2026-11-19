-- 404 · La validación externa con una segunda verdad: las apelaciones que el Tribunal declaró fundadas o los procesos que
-- anuló (migraciones 401-403).
--
-- La Contraloría observa sobre todo cumplimiento y obras grandes (migración 401): no sirve para juzgar las señales de
-- competencia. El Tribunal sí mira la etapa de selección: cuando declara FUNDADA una apelación o la NULIDAD de un
-- procedimiento, el comité se equivocó (descalificó mal, calificó mal, otorgó mal la buena pro) o el proceso tenía un
-- vicio. Es la verdad contra la que se miden «sólo admitieron al ganador», «descalificados por formalidad» y compañía.
--
-- Universo: los procesos competitivos (LP, CP, AS) de 2024 en adelante con dos postores o más (sin otro postor no hay
-- quien apele). Etiqueta: una resolución con el resultado comprobado (resultado_ok) fundado, fundado en parte o nulidad de
-- oficio, unida al proceso. Lo esperado de cada proceso: los de su tipo, su año y su tamaño (valor referencial).
-- Las resoluciones se bajan y leen cada hora desde la PC (tarea VigiaTribunal): mientras no estén todas, la corrida mide
-- con las que hay y lo dice en `observados`.
--
-- validacion_corrida y validacion_senal ganan la columna `etiqueta` ('contraloria' | 'tribunal'); las corridas
-- anteriores son de la Contraloría.

ALTER TABLE validacion_corrida ADD COLUMN IF NOT EXISTS etiqueta text NOT NULL DEFAULT 'contraloria';

CREATE OR REPLACE FUNCTION refrescar_validacion_tribunal() RETURNS bigint
LANGUAGE plpgsql SET work_mem = '256MB' AS $$
DECLARE
  v_id bigint;
  n1 int; n0 int; n int;
BEGIN
  -- Procesos competitivos desde 2024, con su número de postores (CONOSCE) y su tamaño.
  CREATE TEMP TABLE _tu ON COMMIT DROP AS
  SELECT cn.ocid, cn.tipo, cn.anio, COALESCE(c.cuantia_referencial, 0)::numeric AS monto,
         CASE WHEN COALESCE(c.cuantia_referencial, 0) < 400000 THEN 1 WHEN c.cuantia_referencial < 2000000 THEN 2
              WHEN c.cuantia_referencial < 10000000 THEN 3 ELSE 4 END AS banda,
         EXISTS (SELECT 1 FROM tribunal_proceso p JOIN tribunal_resolucion r ON r.id = p.resolucion_id
                  WHERE p.ocid = cn.ocid AND r.resultado_ok
                    AND r.resultado IN ('fundado', 'fundado_en_parte', 'nulidad_de_oficio')) AS observado,
         0::float AS esperado
    FROM convocatoria_nomenclatura cn
    JOIN convocatorias c ON c.ocid = cn.ocid
   WHERE cn.tipo IN ('LP', 'CP', 'AS') AND cn.anio >= 2024
     AND (SELECT count(DISTINCT p.ruc_postor) FROM conosce_postores p WHERE p.codigo_convocatoria = c.codigo) >= 2;
  CREATE INDEX ON _tu (ocid);
  UPDATE _tu u SET esperado = s.tasa
    FROM (SELECT tipo, banda, anio, avg(observado::int)::float AS tasa FROM _tu GROUP BY 1, 2, 3) s
   WHERE s.tipo = u.tipo AND s.banda = u.banda AND s.anio = u.anio;
  ANALYZE _tu;

  CREATE TEMP TABLE _tb ON COMMIT DROP AS
  SELECT k.ocid, k.tipo, min(CASE k.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END) AS sev
    FROM cruces_proveedor k JOIN _tu u ON u.ocid = k.ocid
   GROUP BY 1, 2;
  CREATE INDEX ON _tb (ocid);
  ANALYZE _tb;
  CREATE TEMP TABLE _ts ON COMMIT DROP AS
  SELECT u.ocid, u.observado, u.monto, COALESCE(p.puntaje, 0) AS puntaje
    FROM _tu u
    LEFT JOIN (SELECT b.ocid, sum(CASE b.sev WHEN 0 THEN 10 WHEN 1 THEN 3 ELSE 1 END) AS puntaje
                 FROM _tb b WHERE NOT EXISTS (SELECT 1 FROM senal_en_observacion o WHERE o.tipo = b.tipo)
                GROUP BY b.ocid) p ON p.ocid = u.ocid;

  SELECT count(*) FILTER (WHERE observado), count(*) FILTER (WHERE NOT observado), count(*) INTO n1, n0, n FROM _ts;
  IF n1 = 0 OR n0 = 0 THEN
    RAISE NOTICE 'validación del Tribunal sin apelaciones fundadas unidas todavía: nada que medir';
    RETURN NULL;
  END IF;

  INSERT INTO validacion_corrida (etiqueta, desde, hasta, universo, observados, entidades, auc_puntaje, auc_monto,
                                  top1_puntaje, top1_monto, top1_azar, top5_puntaje, top5_monto, top5_azar)
  SELECT 'tribunal', DATE '2024-01-01', current_date, n, n1,
         (SELECT count(DISTINCT btrim(c.entidad_ruc::text)) FROM _tu u JOIN convocatorias c ON c.ocid = u.ocid),
         (SELECT ((sum(r) FILTER (WHERE observado)) - n1 * (n1 + 1) / 2.0) / (n1::numeric * n0)
            FROM (SELECT observado, rank() OVER (ORDER BY puntaje) + (count(*) OVER (PARTITION BY puntaje) - 1) / 2.0 AS r FROM _ts) x),
         (SELECT ((sum(r) FILTER (WHERE observado)) - n1 * (n1 + 1) / 2.0) / (n1::numeric * n0)
            FROM (SELECT observado, rank() OVER (ORDER BY monto) + (count(*) OVER (PARTITION BY monto) - 1) / 2.0 AS r FROM _ts) x),
         (SELECT count(*) FILTER (WHERE observado) FROM (SELECT observado FROM _ts ORDER BY puntaje DESC, md5(ocid) LIMIT n / 100) t),
         (SELECT count(*) FILTER (WHERE observado) FROM (SELECT observado FROM _ts ORDER BY monto DESC, md5(ocid) LIMIT n / 100) t),
         round(n1 * 0.01, 1),
         (SELECT count(*) FILTER (WHERE observado) FROM (SELECT observado FROM _ts ORDER BY puntaje DESC, md5(ocid) LIMIT n / 20) t),
         (SELECT count(*) FILTER (WHERE observado) FROM (SELECT observado FROM _ts ORDER BY monto DESC, md5(ocid) LIMIT n / 20) t),
         round(n1 * 0.05, 1)
  RETURNING id INTO v_id;

  INSERT INTO validacion_senal (corrida_id, tipo, procesos, observados, esperados, oe, oe_min, oe_max)
  SELECT v_id, b.tipo, count(*), count(*) FILTER (WHERE u.observado), sum(u.esperado),
         CASE WHEN sum(u.esperado) > 0 THEN (count(*) FILTER (WHERE u.observado)) / sum(u.esperado) END,
         CASE WHEN sum(u.esperado) > 0 AND count(*) FILTER (WHERE u.observado) > 0
              THEN power(greatest(sqrt(count(*) FILTER (WHERE u.observado)) - 0.98, 0), 2) / sum(u.esperado) ELSE 0 END,
         CASE WHEN sum(u.esperado) > 0 THEN power(sqrt(count(*) FILTER (WHERE u.observado) + 1) + 0.98, 2) / sum(u.esperado) END
    FROM _tb b JOIN _tu u ON u.ocid = b.ocid
   GROUP BY b.tipo;
  RETURN v_id;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER FUNCTION public.refrescar_validacion_tribunal() OWNER TO vigia_jobs;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_validacion_tribunal() FROM PUBLIC;

-- Cada lunes, después de la de la Contraloría.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('vigia-validacion-tribunal', '45 9 * * 1', 'SELECT public.refrescar_validacion_tribunal()');
  END IF;
END $$;
