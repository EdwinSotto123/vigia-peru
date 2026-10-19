-- 77 · refrescar_cruce_otro_postor() con índices en sus tablas temporales.
--
-- Con la historia del OECE en la base (migración 71: adjudicaciones de todos los contratos), _op_aw pasó de unos miles
-- a cientos de miles de filas y el LATERAL que busca "las otras adjudicaciones del mismo proceso" la recorría entera
-- por cada fila: 826 s para 64 casos, más que el límite de Hyperdrive para la corrida diaria. Índice por ocid en
-- _op_aw y por (codigo, ruc) en _op_k, con ANALYZE. Mismo resultado.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/77_otro_postor_indices.sql

CREATE OR REPLACE FUNCTION public.refrescar_cruce_otro_postor()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE n INT;
BEGIN
  DELETE FROM cruces_proveedor WHERE tipo = 'otro_postor';
  DROP TABLE IF EXISTS _op_aw;
  CREATE TEMP TABLE _op_aw ON COMMIT DROP AS
    SELECT c.ocid, c.codigo, a->>'id' AS aid,
           regexp_replace(a->'suppliers'->0->>'id', '^PE-RUC-', '') AS ruc, a->'suppliers'->0->>'name' AS nombre,
           (a->'value'->>'amount')::numeric AS monto, NULLIF(a->>'date', '')::date AS f,
           ARRAY(SELECT i->>'id' FROM jsonb_array_elements(COALESCE(a->'items', '[]'::jsonb)) i) AS items
    FROM convocatorias c, jsonb_array_elements(COALESCE(COALESCE(c.ocds_payload->'awards', c.adjudicaciones), '[]'::jsonb)) a
    WHERE c.ocid NOT LIKE 'ocds-vigia-%' AND jsonb_array_length(COALESCE(COALESCE(c.ocds_payload->'awards', c.adjudicaciones), '[]'::jsonb)) > 1;
  -- Migración 77: con la historia, _op_aw tiene cientos de miles de filas; sin índice el LATERAL de abajo la recorría
  -- entera por cada adjudicación (13,8 min para 64 casos).
  CREATE INDEX ON _op_aw (ocid);
  ANALYZE _op_aw;
  DROP TABLE IF EXISTS _op_k;
  CREATE TEMP TABLE _op_k ON COMMIT DROP AS
    SELECT DISTINCT codigo_convocatoria AS codigo, ruc_proveedor AS ruc FROM conosce_adjudicaciones
    WHERE codigo_convocatoria IN (SELECT DISTINCT codigo FROM _op_aw);
  CREATE INDEX ON _op_k (codigo, ruc);
  ANALYZE _op_k;

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
END $function$;
ALTER FUNCTION refrescar_cruce_otro_postor() OWNER TO vigia_jobs;
