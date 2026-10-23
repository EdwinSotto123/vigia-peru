-- 118 · "Recién fundada" como señal DEL CONTRATO (no sólo de la empresa).
--
-- La migración 116 marcaba la empresa si ganó su PRIMER proceso a los pocos meses de fundarse. Pero el usuario la quiere
-- también en la lista de contratos y en cada ficha: «ganó ESTE proceso con 6 meses de fundación», «ganó un contrato
-- millonario con menos de 1 año». Así que se vuelve un cruce por contrato (cruces_proveedor → casos_cruce), con la brecha
-- real entre la fecha de alta en la SUNAT y la buena pro de ese proceso. Al ser un cruce del proveedor, fluye a
-- casos_cruce y a empresa_resumen por el pipeline normal y sobrevive a las reconstrucciones.
--
-- Es un HECHO honesto del proceso: cuántos días/meses de fundada tenía la empresa al ganarlo. No acusa; segmenta:
--   · < 180 días (≈6 meses)  → alta   «Ganó con solo N meses de fundación»
--   · < 365 días (< 1 año)   → media  (alta si además el contrato es ≥ S/ 1 M: «millonario con menos de 1 año»)
--   · < 730 días (< 2 años)  → baja
-- Sólo procesos de ≥ 8 UIT (S/ 44,000), para dejar fuera las contrataciones menores. Igual que otro_postor: borra su tipo
-- y lo recalcula; corre en refrescarCasosCruce (comun.ts) después de refrescar_cruces y antes de refrescar_casos_cruce_base.

CREATE OR REPLACE FUNCTION refrescar_cruce_recien_fundada() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  DELETE FROM cruces_proveedor WHERE tipo = 'recien_fundada';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  WITH ganados AS (
    -- Lo adjudicado a cada proveedor (RUC 20) por proceso, en soles, con su buena pro.
    SELECT a.ruc_proveedor AS ruc, a.codigo_convocatoria AS codigo, a.entidad_ruc,
           max(a.fecha_buenapro) AS f,
           sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS monto
      FROM conosce_adjudicaciones a
     WHERE a.ruc_proveedor ~ '^20[0-9]{9}$'
     GROUP BY 1, 2, 3
  ), cv AS (
    SELECT DISTINCT ON (c.codigo, c.entidad_ruc) c.codigo, c.entidad_ruc, c.ocid
      FROM convocatorias c
     WHERE c.codigo IN (SELECT codigo FROM ganados)
     ORDER BY c.codigo, c.entidad_ruc, c.ocid
  )
  SELECT 'recien_fundada', g.ruc, cv.ocid,
         CASE WHEN d.dias < 180 THEN 'alta'
              WHEN g.monto >= 1000000 AND d.dias < 365 THEN 'alta'
              WHEN d.dias < 365 THEN 'media'
              ELSE 'baja' END,
         g.f, g.monto,
         jsonb_build_object('fundada', e.fecha_alta_ruc, 'buena_pro', g.f, 'dias', d.dias,
                            'meses', round(d.dias / 30.44), 'monto', g.monto, 'millonario', g.monto >= 1000000),
         'sunat', 'https://e-consultaruc.sunat.gob.pe/'
    FROM ganados g
    JOIN empresas e ON e.ruc = g.ruc AND e.fecha_alta_ruc IS NOT NULL
    JOIN cv ON cv.codigo = g.codigo AND cv.entidad_ruc = g.entidad_ruc
    CROSS JOIN LATERAL (SELECT (g.f - e.fecha_alta_ruc) AS dias) d
   WHERE g.f IS NOT NULL AND d.dias >= 0 AND d.dias < 730 AND g.monto >= 44000;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_cruce_recien_fundada() OWNER TO vigia_jobs;

-- recien_fundada ya NO es una señal de empresa (migración 116): ahora llega desde el cruce del contrato (arriba) y
-- fluye a empresa_resumen por el pipeline. Así que refrescar_senales_sunat se queda sólo con los TRES estados actuales
-- de la SUNAT (dada de baja, suspendida, no habida) y, clave, deja de limpiar/recalcular recien_fundada para no borrar
-- la que puso el cruce del contrato.
CREATE OR REPLACE FUNCTION refrescar_senales_sunat() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  WITH nuevos AS (
    SELECT r.ruc, jsonb_agg(x ORDER BY ord) AS cruces,
           array_agg(x->>'tipo') AS tipos,
           count(*) FILTER (WHERE x->>'severidad' = 'alta')::int  AS n_alta,
           count(*) FILTER (WHERE x->>'severidad' = 'media')::int AS n_media,
           count(*) FILTER (WHERE x->>'severidad' = 'baja')::int  AS n_baja
    FROM empresa_resumen r
    JOIN empresas e ON e.ruc = r.ruc
    CROSS JOIN LATERAL (VALUES
      (1, CASE WHEN e.estado_sunat ILIKE 'BAJA%'
          THEN jsonb_build_object('tipo', 'dada_de_baja', 'severidad', 'media', 'n', 1,
                 'detalle', jsonb_build_object('estado', e.estado_sunat)) END),
      (2, CASE WHEN e.estado_sunat ILIKE 'SUSPENSION%'
          THEN jsonb_build_object('tipo', 'suspendida', 'severidad', 'baja', 'n', 1,
                 'detalle', jsonb_build_object('estado', e.estado_sunat)) END),
      (3, CASE WHEN (e.metadata->>'condicion') ILIKE 'NO HABIDO%'
          THEN jsonb_build_object('tipo', 'no_habida', 'severidad', 'media', 'n', 1,
                 'detalle', jsonb_build_object('condicion', e.metadata->>'condicion')) END)
    ) v(ord, x)
    WHERE x IS NOT NULL
    GROUP BY r.ruc
  )
  UPDATE empresa_resumen r SET
    cruces = COALESCE((SELECT jsonb_agg(c) FROM jsonb_array_elements(r.cruces) c
                        WHERE c->>'tipo' NOT IN ('dada_de_baja','suspendida','no_habida')), '[]'::jsonb)
             || nv.cruces,
    tipos  = ARRAY(SELECT t FROM unnest(r.tipos) t
                    WHERE t NOT IN ('dada_de_baja','suspendida','no_habida')) || nv.tipos,
    n_alta  = (SELECT count(*) FILTER (WHERE c->>'severidad'='alta' AND c->>'tipo' NOT IN ('dada_de_baja','suspendida','no_habida'))
                 FROM jsonb_array_elements(r.cruces) c)::int + nv.n_alta,
    n_media = (SELECT count(*) FILTER (WHERE c->>'severidad'='media' AND c->>'tipo' NOT IN ('dada_de_baja','suspendida','no_habida'))
                 FROM jsonb_array_elements(r.cruces) c)::int + nv.n_media,
    n_baja  = (SELECT count(*) FILTER (WHERE c->>'severidad'='baja' AND c->>'tipo' NOT IN ('dada_de_baja','suspendida','no_habida'))
                 FROM jsonb_array_elements(r.cruces) c)::int + nv.n_baja
  FROM nuevos nv WHERE nv.ruc = r.ruc;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE empresa_resumen;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_senales_sunat() OWNER TO vigia_jobs;
