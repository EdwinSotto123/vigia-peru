-- 423 · El Tribunal «corrigió» el proceso: la etiqueta comprobada con la que se validan las señales y se comparan las
-- entidades, aparte del resultado exacto que publica la ficha.
--
-- Hasta aquí ambas cosas usaban `resultado_ok` (el modelo y la regla dicen EXACTAMENTE lo mismo). Pero para la validación
-- (404, 419) y la comparación por entidad (422) sólo importa si el Tribunal corrigió el proceso (fundado, fundado en parte
-- o nulidad) o no (infundado, improcedente, desistimiento). «Declarar la NULIDAD de la resolución que declaró la nulidad»
-- es fundado para el modelo y nulidad para la regla: los dos dicen que el Tribunal corrigió a la entidad, y se perdía.
--
-- Medido el 2026-11-19 sobre 904 resoluciones, con la regla nueva (lector/tribunal.py: «La Sala resuelve:» y «por
-- unanimidad; 1.» como anclas, lo primero que aparece en el primer punto gana):
--   resultado exacto comprobado: 782 → 860;  corregido o no, comprobado: 875.
--
-- Columnas:
--   corregido_ok     el modelo y la regla coinciden en corregido / no corregido (NULL: aún no se comprobó con la regla 2).
--   regla_version    versión de la regla que escribió resultado_regla; tribunal_cargar.py recomprueba las de otra versión.
--   segunda_lectura  lo que dijo el modelo grande (GLM 5.3) al releer una resolución en disputa; si coincide con la
--                    regla, su lectura reemplaza a la del modelo chico (modelo = el grande). No se relee dos veces.

ALTER TABLE tribunal_resolucion ADD COLUMN IF NOT EXISTS corregido_ok boolean;
ALTER TABLE tribunal_resolucion ADD COLUMN IF NOT EXISTS regla_version text;
ALTER TABLE tribunal_resolucion ADD COLUMN IF NOT EXISTS segunda_lectura text;

-- Mientras no se recomprueben, lo que ya estaba comprobado exacto también lo está en el grupo.
UPDATE tribunal_resolucion SET corregido_ok = true WHERE resultado_ok AND corregido_ok IS NULL;

CREATE OR REPLACE FUNCTION tribunal_corrigio(r tribunal_resolucion) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(r.corregido_ok, r.resultado_ok) AND r.resultado IN ('fundado', 'fundado_en_parte', 'nulidad_de_oficio')
$$;
COMMENT ON FUNCTION tribunal_corrigio(tribunal_resolucion) IS 'La resolución corrigió el proceso (fundada, en parte o nulidad), comprobado por el modelo y la regla. Migración 423.';

-- Validación (419) con la etiqueta de grupo.
CREATE OR REPLACE FUNCTION refrescar_validacion_tribunal() RETURNS bigint
LANGUAGE plpgsql SET work_mem = '256MB' AS $$
DECLARE
  v_id bigint;
  n1 int; n0 int; n int;
BEGIN
  CREATE TEMP TABLE _tu ON COMMIT DROP AS
  SELECT cn.ocid, cn.tipo, cn.anio, COALESCE(c.cuantia_referencial, 0)::numeric AS monto,
         CASE WHEN COALESCE(c.cuantia_referencial, 0) < 400000 THEN 1 WHEN c.cuantia_referencial < 2000000 THEN 2
              WHEN c.cuantia_referencial < 10000000 THEN 3 ELSE 4 END AS banda,
         EXISTS (SELECT 1 FROM tribunal_proceso p JOIN tribunal_resolucion r ON r.id = p.resolucion_id
                  WHERE p.ocid = cn.ocid AND tribunal_corrigio(r)) AS observado,
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
   -- Fuera las señales que son CONSECUENCIA de la etiqueta (419).
   WHERE k.tipo <> ALL (ARRAY['otro_postor'])
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

-- Comparación por entidad (422) con la etiqueta de grupo.
CREATE OR REPLACE FUNCTION refrescar_tribunal_entidad() RETURNS integer
LANGUAGE plpgsql SET work_mem TO '128MB' AS $$
DECLARE n int; v_total int; v_corr int;
BEGIN
  CREATE TEMP TABLE _te ON COMMIT DROP AS
  SELECT btrim(c.entidad_ruc::text) AS ent,
         EXISTS (SELECT 1 FROM tribunal_proceso p JOIN tribunal_resolucion r ON r.id = p.resolucion_id
                  WHERE p.ocid = cn.ocid AND tribunal_corrigio(r)) AS corregido
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
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER FUNCTION public.refrescar_validacion_tribunal() OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_tribunal_entidad() OWNER TO vigia_jobs;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_validacion_tribunal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refrescar_tribunal_entidad() TO vigia_jobs;
