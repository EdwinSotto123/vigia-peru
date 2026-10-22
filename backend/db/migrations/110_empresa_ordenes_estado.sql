-- 110 · Las órdenes de cada empresa por estado (emitida, comprometida, devengada), para los filtros de su ficha.
--
-- Pedido del usuario (2026-10-22): «faltan más filtros». La pestaña Órdenes de /empresa/<RUC> filtra por estado y por
-- tipo con su conteo; contarlos en cada visita recorría todas las órdenes de la empresa (54 mil en un gran proveedor: más
-- de los 10 s del rol con la caché fría). Ahora salen de empresa_orden_anual, como los años, las entidades y las regiones.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/110_empresa_ordenes_estado.sql
-- luego: SELECT refrescar_empresa_ordenes();

ALTER TABLE empresa_orden_anual
  ADD COLUMN IF NOT EXISTS emitidas      INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comprometidas INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS devengadas    INT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION refrescar_empresa_ordenes() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_empresas'));
  SET LOCAL work_mem = '256MB';
  -- Una vez cada orden (un mismo archivo mensual puede repetirla; vale la del archivo más nuevo), como las personas.
  CREATE TEMP TABLE _eo ON COMMIT DROP AS
    SELECT DISTINCT ON (entidad_ruc, orden, fecha_emision)
           entidad_ruc, ruc_contratista AS ruc, entidad, contratista, departamento, fecha_emision, tipo_orden, estado, monto, monto_dudoso
      FROM conosce_ordenes
     WHERE ruc_contratista ~ '^20\d{9}$' AND fecha_emision >= DATE '2018-01-01' AND fecha_emision <= current_date + 31
       AND estado IS DISTINCT FROM 'Anulada' AND moneda = 'Nuevos Soles' AND entidad_ruc ~ '^\d{11}$'
       AND (monto > 0 OR monto_dudoso IS NOT NULL)
     ORDER BY entidad_ruc, orden, fecha_emision, anio DESC, mes DESC;

  DELETE FROM empresa_orden_anual;
  INSERT INTO empresa_orden_anual (ruc, entidad_ruc, anio, entidad, nombre, departamento, ordenes, monto, compras, dudosas,
                                   monto_dudoso, primera, ultima, emitidas, comprometidas, devengadas)
  SELECT ruc, entidad_ruc, extract(year FROM fecha_emision)::smallint, max(entidad), max(replace(contratista, '¿', 'Ñ')),
         max(departamento), count(*), COALESCE(sum(monto) FILTER (WHERE monto_dudoso IS NULL), 0),
         count(*) FILTER (WHERE tipo_orden ILIKE '%compra%'), count(*) FILTER (WHERE monto_dudoso IS NOT NULL),
         COALESCE(sum(monto_dudoso), 0), min(fecha_emision), max(fecha_emision),
         count(*) FILTER (WHERE estado = 'Emitida'), count(*) FILTER (WHERE estado = 'Comprometida'),
         count(*) FILTER (WHERE estado = 'Devengada')
    FROM _eo GROUP BY 1, 2, 3;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE empresa_orden_anual;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_empresa_ordenes() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_empresa_ordenes() FROM PUBLIC;
