-- 58 · Cruce `otro_postor`: la buena pro pasó a otro postor sobre los mismos ítems.
--
-- El OCDS guarda varias adjudicaciones sobre los mismos ítems: la buena pro original y la que la reemplazó (el ganador
-- no firmó o la perdió y se adjudicó al siguiente en el orden de prelación). CONOSCE registra con quién quedó. Caso
-- 1228396: la buena pro fue de UNILENE por S/ 1,54 M y se contrató con MULTIMEDICAL (2.º) por S/ 2,28 M (+48 %).
-- 109 procesos tienen adjudicaciones que se pisan; en 82 CONOSCE dice cuál quedó.
--
--   otro_postor   sobre el proveedor con quien quedó (el de CONOSCE), en el proceso (`ocid`). `detalle`: monto y
--                 proveedor original, monto que quedó, diferencia y porcentaje. Severidad: alta si quedó ≥ 10 % más
--                 caro, media si más caro, baja si igual o más barato.
--                 Si el original es persona natural (RUC 10), su nombre no se guarda en `detalle`.
--
-- Va en `refrescar_casos_cruce()` (antes de armar los casos): `refrescar_cruces()` borra la tabla entera al empezar y
-- vigia-scrapers llama a las dos en ese orden, así que el cruce siempre se rehace después.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/58_cruce_buena_pro_reemplazada.sql

GRANT SELECT ON conosce_adjudicaciones TO vigia_jobs;

CREATE OR REPLACE FUNCTION refrescar_cruce_otro_postor() RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  DELETE FROM cruces_proveedor WHERE tipo = 'otro_postor';
  DROP TABLE IF EXISTS _op_aw;
  CREATE TEMP TABLE _op_aw ON COMMIT DROP AS
    SELECT c.ocid, c.codigo, a->>'id' AS aid,
           regexp_replace(a->'suppliers'->0->>'id', '^PE-RUC-', '') AS ruc, a->'suppliers'->0->>'name' AS nombre,
           (a->'value'->>'amount')::numeric AS monto, NULLIF(a->>'date', '')::date AS f,
           ARRAY(SELECT i->>'id' FROM jsonb_array_elements(COALESCE(a->'items', '[]'::jsonb)) i) AS items
    FROM convocatorias c, jsonb_array_elements(COALESCE(c.ocds_payload->'awards', '[]'::jsonb)) a
    WHERE c.ocid NOT LIKE 'ocds-vigia-%' AND jsonb_array_length(COALESCE(c.ocds_payload->'awards', '[]'::jsonb)) > 1;
  DROP TABLE IF EXISTS _op_k;
  CREATE TEMP TABLE _op_k ON COMMIT DROP AS
    SELECT DISTINCT codigo_convocatoria AS codigo, ruc_proveedor AS ruc FROM conosce_adjudicaciones
    WHERE codigo_convocatoria IN (SELECT DISTINCT codigo FROM _op_aw);

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT 'otro_postor', q.ruc, q.ocid,
         CASE WHEN o.monto > 0 AND q.monto >= o.monto * 1.10 THEN 'alta' WHEN q.monto > o.monto THEN 'media' ELSE 'baja' END,
         q.f, q.monto,
         jsonb_build_object(
           'monto_original', o.monto, 'monto_contratado', q.monto, 'diferencia', q.monto - o.monto,
           'porcentaje', CASE WHEN o.monto > 0 THEN round((q.monto - o.monto) / o.monto * 100, 1) END,
           'ruc_original', CASE WHEN o.ruc LIKE '20%' THEN o.ruc END,
           'proveedor_original', CASE WHEN o.ruc LIKE '20%' THEN o.nombre END),
         'conosce_adjudicaciones', 'https://conosce.osce.gob.pe/buscador/'
  FROM _op_aw q
  JOIN _op_k kq ON kq.codigo = q.codigo AND kq.ruc = q.ruc
  -- La original: entre las adjudicaciones del mismo proceso sobre LOS MISMOS ítems que CONOSCE no registra, la de
  -- menor monto (el 1.º del orden de prelación). Con ítems distintos los montos no se comparan.
  CROSS JOIN LATERAL (
    SELECT o.ruc, o.nombre, o.monto FROM _op_aw o
    WHERE o.ocid = q.ocid AND o.aid <> q.aid AND o.items @> q.items AND q.items @> o.items   -- los mismos ítems
      AND o.ruc ~ '^(10|20)\d{9}$'                                                     -- sin RUC de relleno (99999999999)
      AND NOT EXISTS (SELECT 1 FROM _op_k k WHERE k.codigo = o.codigo AND k.ruc = o.ruc)
    ORDER BY o.monto NULLS LAST LIMIT 1
  ) o
  WHERE q.ruc ~ '^(10|20)\d{9}$';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_cruce_otro_postor() OWNER TO vigia_jobs;

-- refrescar_casos_cruce() (migración 57) arma primero este cruce. Se agrega la llamada sin repetir la función entera:
-- un envoltorio con el mismo nombre que llama a la de la 57, renombrada.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'refrescar_casos_cruce_base') THEN
    ALTER FUNCTION refrescar_casos_cruce() RENAME TO refrescar_casos_cruce_base;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION refrescar_casos_cruce() RETURNS INT
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refrescar_cruce_otro_postor();
  RETURN refrescar_casos_cruce_base();
END $$;
ALTER FUNCTION refrescar_casos_cruce() OWNER TO vigia_jobs;

SELECT refrescar_casos_cruce();
