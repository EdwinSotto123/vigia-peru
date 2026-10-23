-- 119 · "Recién fundada" en TRES segmentos por tiempo de fundación (no una sola bandera genérica).
--
-- El usuario: «no creaste buenos segmentos, solo dices recién fundada y ya, no explicas cuándo se creó». Así que el cruce
-- del contrato (migración 118) deja de ser un único `recien_fundada` y se parte por la brecha entre el alta en la SUNAT y
-- la buena pro, para que el filtro y las banderas digan cuánto tenía la empresa al ganar:
--   · recien_fundada_medio_ano  ≤ 6 meses  (≤180 d)  → alta
--   · recien_fundada_un_ano     < 1 año    (181-365) → media (alta si el contrato es ≥ S/ 1 M, «millonario»)
--   · recien_fundada_dos_anos   < 2 años   (366-729) → baja
-- El `detalle` sigue llevando meses/días/fundada/monto/millonario para el texto de la ficha. Slugs sin dígitos a
-- propósito: las validaciones de `tipo` por regex en el front y la API son [a-z_]. Sólo procesos ≥ 8 UIT (S/ 44,000).

CREATE OR REPLACE FUNCTION refrescar_cruce_recien_fundada() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  DELETE FROM cruces_proveedor WHERE tipo IN ('recien_fundada', 'recien_fundada_medio_ano', 'recien_fundada_un_ano', 'recien_fundada_dos_anos');
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  WITH ganados AS (
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
  SELECT CASE WHEN d.dias < 180 THEN 'recien_fundada_medio_ano'
              WHEN d.dias < 365 THEN 'recien_fundada_un_ano'
              ELSE 'recien_fundada_dos_anos' END,
         g.ruc, cv.ocid,
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
