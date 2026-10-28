-- 187 · Las órdenes de cada entidad y de cada empresa, por mes (CONOSCE): la línea de tiempo de su ficha.
--
-- Fase 3 del plan del 2026-10-27: la pestaña «Historia» de una entidad, de una empresa y de un partido dibuja sus compras
-- mes a mes junto a los cambios de gobierno, las visitas, la planilla, las plazas y los informes de control. Las órdenes
-- (~29 M) no se pueden agrupar por mes en vivo: EsSalud tardó 51 s, la universidad que sigue 21 s (2026-10-28). Dos
-- tablas, con las mismas condiciones y el mismo dedup que entidad_orden_anual (148) y la lista (GET /ordenes): en soles,
-- sin las anuladas, con monto (o con monto dudoso, migración 98), emitidas de 2018 a un mes adelante, una vez cada
-- (entidad, orden, fecha) con la versión del archivo más nuevo.
--   entidad_orden_mes: por entidad y mes: cuántas, cuánto, cuántas a personas naturales (RUC 10: los locadores, la «ola»
--                      que sigue a un cambio de gestión) y a cuántos proveedores distintos.
--   empresa_orden_mes: por empresa (RUC 20) y mes: cuántas, cuánto y a cuántas entidades.
--
-- Cómo aplicarla: backend/scripts/aplicar_187.py (el SQL y el primer refresco, un año por vez: cada año recorre millones
-- de órdenes). Después de cada carga de conosce_ordenes, los dos últimos meses y el que corre (las órdenes llegan con
-- atraso): SELECT refrescar_ordenes_mes(current_date - 62); va en el Worker de scrapers (conosce_ordenes.ts), junto a
-- refrescar_entidad_ordenes.

CREATE TABLE IF NOT EXISTS entidad_orden_mes (
  entidad_ruc     TEXT NOT NULL,
  mes             DATE NOT NULL,              -- el primer día del mes de emisión
  ordenes         INT NOT NULL,               -- cada orden una vez
  compras         INT NOT NULL,               -- órdenes de compra (bienes); el resto son de servicio
  monto           NUMERIC(18, 2) NOT NULL,    -- sin las de monto dudoso
  dudosas         INT NOT NULL,
  a_personas      INT NOT NULL,               -- a personas naturales (RUC 10)
  monto_personas  NUMERIC(18, 2) NOT NULL,
  proveedores     INT NOT NULL,               -- RUC distintos
  PRIMARY KEY (entidad_ruc, mes)
);

CREATE TABLE IF NOT EXISTS empresa_orden_mes (
  ruc        TEXT NOT NULL,                   -- sólo RUC 20
  mes        DATE NOT NULL,
  ordenes    INT NOT NULL,
  monto      NUMERIC(18, 2) NOT NULL,         -- sin las de monto dudoso
  dudosas    INT NOT NULL,
  entidades  INT NOT NULL,                    -- a cuántas entidades distintas
  PRIMARY KEY (ruc, mes)
);

-- Desde el mes de p_desde (sin él, enero de 2018) hasta el de p_hasta (sin él, hasta un mes adelante): borra esos meses
-- en las dos tablas y los vuelve a contar en una sola pasada por conosce_ordenes.
CREATE OR REPLACE FUNCTION refrescar_ordenes_mes(p_desde date DEFAULT NULL, p_hasta date DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_desde DATE := greatest(date_trunc('month', COALESCE(p_desde, DATE '2018-01-01'))::date, DATE '2018-01-01');
  -- Hasta dónde (exclusive): el 1 del mes que sigue al de p_hasta, nunca más de un mes adelante.
  v_tope DATE := least(COALESCE((date_trunc('month', p_hasta) + interval '1 month')::date, current_date + 32), current_date + 32);
  n INT;
  m INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_ordenes_mes'));
  SET LOCAL work_mem = '256MB';
  CREATE TEMP TABLE _om ON COMMIT DROP AS
    SELECT DISTINCT ON (entidad_ruc, orden, fecha_emision)
           entidad_ruc, ruc_contratista AS ruc, fecha_emision, tipo_orden, monto, monto_dudoso
      FROM conosce_ordenes
     WHERE fecha_emision >= v_desde AND fecha_emision < v_tope
       AND estado IS DISTINCT FROM 'Anulada' AND moneda = 'Nuevos Soles' AND entidad_ruc ~ '^\d{11}$'
       AND (monto > 0 OR monto_dudoso IS NOT NULL)
     ORDER BY entidad_ruc, orden, fecha_emision, anio DESC, mes DESC;

  DELETE FROM entidad_orden_mes WHERE mes >= v_desde AND mes < v_tope;
  INSERT INTO entidad_orden_mes (entidad_ruc, mes, ordenes, compras, monto, dudosas, a_personas, monto_personas, proveedores)
  SELECT entidad_ruc, date_trunc('month', fecha_emision)::date, count(*),
         count(*) FILTER (WHERE tipo_orden ILIKE '%compra%'),
         COALESCE(sum(monto) FILTER (WHERE monto_dudoso IS NULL), 0),
         count(*) FILTER (WHERE monto_dudoso IS NOT NULL),
         count(*) FILTER (WHERE ruc LIKE '10%'),
         COALESCE(sum(monto) FILTER (WHERE monto_dudoso IS NULL AND ruc LIKE '10%'), 0),
         count(DISTINCT ruc)
    FROM _om GROUP BY 1, 2;
  GET DIAGNOSTICS n = ROW_COUNT;

  DELETE FROM empresa_orden_mes WHERE mes >= v_desde AND mes < v_tope;
  INSERT INTO empresa_orden_mes (ruc, mes, ordenes, monto, dudosas, entidades)
  SELECT ruc, date_trunc('month', fecha_emision)::date, count(*),
         COALESCE(sum(monto) FILTER (WHERE monto_dudoso IS NULL), 0),
         count(*) FILTER (WHERE monto_dudoso IS NOT NULL),
         count(DISTINCT entidad_ruc)
    FROM _om WHERE ruc ~ '^20\d{9}$' GROUP BY 1, 2;
  GET DIAGNOSTICS m = ROW_COUNT;

  ANALYZE entidad_orden_mes;
  ANALYZE empresa_orden_mes;
  RETURN n + m;
END $$;

ALTER TABLE entidad_orden_mes OWNER TO vigia_jobs;
ALTER TABLE empresa_orden_mes OWNER TO vigia_jobs;
GRANT SELECT ON entidad_orden_mes, empresa_orden_mes TO vigia_api, vigia_api_admin;
ALTER FUNCTION refrescar_ordenes_mes(date, date) OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_ordenes_mes(date, date) FROM PUBLIC;
