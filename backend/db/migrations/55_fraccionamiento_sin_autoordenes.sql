-- 55 · Fraccionamiento: fuera las órdenes en que la entidad figura como su propio contratista.
--
-- Algunas entidades registran órdenes con su mismo RUC como contratista (p. ej. una municipalidad que se
-- "compra" a sí misma: transferencias internas o errores de registro). Inflaban el conteo de órdenes del mismo día.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/55_fraccionamiento_sin_autoordenes.sql
-- (después: SELECT refrescar_fraccionamiento(); SELECT * FROM refrescar_cruces();)

CREATE OR REPLACE FUNCTION refrescar_fraccionamiento() RETURNS INT LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  DELETE FROM ordenes_fraccionadas;
  INSERT INTO ordenes_fraccionadas (entidad_ruc, entidad, ruc_contratista, contratista, fecha, objeto, ordenes, total, tope,
                                    misma_descripcion, severidad, detalle)
  SELECT o.entidad_ruc, max(o.entidad), o.ruc_contratista, max(o.contratista), o.fecha_emision, o.objeto, count(*), sum(o.monto),
         max(o.n_uit) * uit_soles(extract(year FROM o.fecha_emision)::int),
         count(DISTINCT left(mef_norm(o.descripcion), 40)) = 1,
         CASE WHEN count(DISTINCT left(mef_norm(o.descripcion), 40)) = 1 THEN 'alta' ELSE 'media' END,
         jsonb_agg(jsonb_build_object('orden', o.orden, 'monto', o.monto, 'descripcion', left(o.descripcion, 200), 'estado', o.estado)
                   ORDER BY o.monto DESC)
  FROM (
    -- Una vez cada orden (un mismo archivo puede repetirla).
    SELECT DISTINCT ON (entidad_ruc, orden, fecha_emision) *,
           COALESCE(substring(tipo_contratacion FROM 'hasta (\d+) UIT')::int, 8) AS n_uit,
           regexp_replace(orden, '^[^-]*-[^-]*-\d{4}-?', '') AS unidad
    FROM conosce_ordenes
    WHERE tipo_contratacion ILIKE 'Contrataciones hasta%' AND estado IS DISTINCT FROM 'Anulada'
      AND moneda = 'Nuevos Soles' AND ruc_contratista ~ '^20\d{9}$' AND fecha_emision IS NOT NULL AND monto > 0
      AND ruc_contratista IS DISTINCT FROM entidad_ruc   -- la entidad no es su propio proveedor (migración 55)
      AND mef_norm(descripcion) !~ '(^| )(RECIBO|SUMINISTRO|ENERGIA ELECTRICA|AGUA POTABLE|TELEFONIA|INTERNET|PASAJES?|BOLETOS?|PACIENTES?)( |$)'
    ORDER BY entidad_ruc, orden, fecha_emision, anio DESC, mes DESC
  ) o
  GROUP BY o.entidad_ruc, o.unidad, o.ruc_contratista, o.fecha_emision, o.objeto
  HAVING count(*) BETWEEN 2 AND 10 AND sum(o.monto) > max(o.n_uit) * uit_soles(extract(year FROM o.fecha_emision)::int);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_fraccionamiento() OWNER TO vigia_jobs;
