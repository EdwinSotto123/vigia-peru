-- 116 · Señales de la empresa desde la SUNAT (API Perú, carga 2026-10): fundación y estado del contribuyente.
--
-- Con la ficha oficial de la SUNAT cargada en `empresas` (fecha_alta_ruc, estado_sunat, metadata->>'condicion'), se
-- derivan cuatro señales A NIVEL DE EMPRESA y se añaden a empresa_resumen.cruces/tipos/n_* para que salgan en la ficha
-- de la empresa y en sus filtros. NO se pegan a un contrato: son hechos de la empresa, no de una contratación (lección
-- de la migración 115). Son honestas con lo que el dato dice:
--   · recien_fundada   ganó su PRIMER proceso ≤180 días de iniciar actividades y por ≥8 UIT (alta ≤90 días, media ≤180).
--   · dada_de_baja     hoy figura de baja (de oficio/definitiva/provisional) en la SUNAT. Es un ESTADO ACTUAL: la SUNAT
--                      no publica desde cuándo, así que NO afirmamos «vendió estando de baja», sólo el estado de hoy.
--   · suspendida       hoy en suspensión temporal.
--   · no_habida        hoy «no habido»: ilocalizable para la SUNAT.
--
-- Se corre después de refrescar_empresas (que llena primera/fecha_alta/estado_sunat). Idempotente: primero quita las
-- cuatro señales que haya puesto antes, luego las recalcula.

CREATE OR REPLACE FUNCTION refrescar_senales_sunat() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  -- UIT 2026 = S/ 5,350; 8 UIT ≈ S/ 42,800. Se usa 44,000 como piso (deja fuera las contrataciones menores).
  WITH nuevos AS (
    SELECT r.ruc, jsonb_agg(x ORDER BY ord) AS cruces,
           array_agg(x->>'tipo') AS tipos,
           count(*) FILTER (WHERE x->>'severidad' = 'alta')::int  AS n_alta,
           count(*) FILTER (WHERE x->>'severidad' = 'media')::int AS n_media,
           count(*) FILTER (WHERE x->>'severidad' = 'baja')::int  AS n_baja
    FROM empresa_resumen r
    JOIN empresas e ON e.ruc = r.ruc
    CROSS JOIN LATERAL (VALUES
      (0, CASE WHEN e.fecha_alta_ruc IS NOT NULL AND r.primera IS NOT NULL
               AND r.primera <= e.fecha_alta_ruc + 180 AND (COALESCE(r.adj_monto,0) + COALESCE(r.ord_monto,0)) >= 44000
          THEN jsonb_build_object('tipo', 'recien_fundada',
                 'severidad', CASE WHEN r.primera <= e.fecha_alta_ruc + 90 THEN 'alta' ELSE 'media' END, 'n', 1,
                 'detalle', jsonb_build_object('fundada', e.fecha_alta_ruc, 'primera', r.primera,
                            'dias', (r.primera - e.fecha_alta_ruc))) END),
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
    -- quita cualquier señal SUNAT previa y vuelve a añadir las de ahora (idempotente).
    cruces = COALESCE((SELECT jsonb_agg(c) FROM jsonb_array_elements(r.cruces) c
                        WHERE c->>'tipo' NOT IN ('recien_fundada','dada_de_baja','suspendida','no_habida')), '[]'::jsonb)
             || nv.cruces,
    tipos  = ARRAY(SELECT t FROM unnest(r.tipos) t
                    WHERE t NOT IN ('recien_fundada','dada_de_baja','suspendida','no_habida')) || nv.tipos,
    n_alta  = (SELECT count(*) FILTER (WHERE c->>'severidad'='alta' AND c->>'tipo' NOT IN ('recien_fundada','dada_de_baja','suspendida','no_habida'))
                 FROM jsonb_array_elements(r.cruces) c)::int + nv.n_alta,
    n_media = (SELECT count(*) FILTER (WHERE c->>'severidad'='media' AND c->>'tipo' NOT IN ('recien_fundada','dada_de_baja','suspendida','no_habida'))
                 FROM jsonb_array_elements(r.cruces) c)::int + nv.n_media,
    n_baja  = (SELECT count(*) FILTER (WHERE c->>'severidad'='baja' AND c->>'tipo' NOT IN ('recien_fundada','dada_de_baja','suspendida','no_habida'))
                 FROM jsonb_array_elements(r.cruces) c)::int + nv.n_baja
  FROM nuevos nv WHERE nv.ruc = r.ruc;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE empresa_resumen;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_senales_sunat() OWNER TO vigia_jobs;
