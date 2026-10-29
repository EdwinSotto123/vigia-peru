-- 207 · Empresas con órdenes «al borde del tope» (pedido del usuario del 2026-10-28: analítica e IA más allá del proceso
-- de selección, sobre las órdenes y los contratos menores).
--
-- Las órdenes de CONOSCE no traen cantidad ni precio unitario (sólo el monto y una descripción libre: el 2 % dice una
-- cantidad, y muchas veces es el tamaño del envase), así que «precio fuera de mercado» no se puede medir en ellas sin
-- inventar. Lo que sí se mide sin adivinar es el monto frente al tope: en 2025, de 3,1 millones de órdenes directas, el
-- 2,6 % cayó entre el 90 % y el 100 % del tope de 8 UIT, el doble que entre el 80 % y el 90 %, y la mayor parte entre el
-- 95 % y el 100 %. Es la marca de partir una compra para no hacer un proceso de selección.
--
-- La regla es la de las personas (migración 179, «al borde del tope»), para las empresas (RUC 20) y en órdenes de compra
-- o de servicio: la mitad o más de las órdenes que una entidad le dio quedaron entre el 95 % y el 100 % del tope de su año
-- (8 UIT; 9 UIT en 2022 con el D.U. 016-2022, cuando la orden lo dice), con al menos CINCO así (las personas, tres). En
-- producción (2026-10-29): 1,665 pares entidad-empresa. Un indicio para revisar, no una acusación: el precio de mercado de
-- lo que se compró puede caer justo ahí.
--
-- `citadas` guarda cada orden de la franja (fecha, número, monto y tope de su año): la evidencia las cita una por una.
-- refrescar_borde_empresas() la rehace entera (unos 2 minutos en PROD: recorre la franja de montos por su índice parcial);
-- la llama el Worker de scrapers después de la carga de órdenes (fuentes/comun.ts).
--
-- En producción, el índice parcial se crea antes con CONCURRENTLY (no frena las cargas):
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS conosce_ordenes_borde_empresa ON conosce_ordenes (entidad_ruc, ruc_contratista)
--     WHERE monto >= 31540 AND monto < 44000 AND ruc_contratista LIKE '20%';

SET lock_timeout = '5s';

-- La franja de montos donde puede caer el 95-100 % del tope de algún año (de 0,95 × 8 × S/ 4,150 a 8 × S/ 5,500).
CREATE INDEX IF NOT EXISTS conosce_ordenes_borde_empresa ON conosce_ordenes (entidad_ruc, ruc_contratista)
  WHERE monto >= 31540 AND monto < 44000 AND ruc_contratista LIKE '20%';

CREATE TABLE IF NOT EXISTS empresa_borde_tope (
  entidad_ruc  TEXT NOT NULL,
  ruc          TEXT NOT NULL CHECK (ruc LIKE '20%'),
  en_el_borde  INT NOT NULL,              -- órdenes entre el 95 % y el 100 % del tope de su año
  ordenes      INT NOT NULL,              -- todas las que la entidad le dio (empresa_orden_anual)
  monto        NUMERIC(18, 2) NOT NULL,   -- lo que suman las del borde
  citadas      JSONB NOT NULL,            -- [{fecha, numero, monto, tope}], de la más reciente a la más antigua
  desde        DATE,
  hasta        DATE,
  actualizado  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entidad_ruc, ruc)
);
CREATE INDEX IF NOT EXISTS empresa_borde_tope_ruc ON empresa_borde_tope (ruc);
COMMENT ON TABLE empresa_borde_tope IS
  'Empresas (RUC 20) con la mitad o más de las órdenes de una entidad entre el 95 % y el 100 % del tope de su año (al menos '
  'cinco): la regla de «al borde del tope» de las personas (179) para las empresas. La rehace refrescar_borde_empresas(). Migración 207.';
ALTER TABLE empresa_borde_tope OWNER TO vigia_jobs;
GRANT SELECT ON empresa_borde_tope TO vigia_api, vigia_api_admin;

CREATE OR REPLACE FUNCTION refrescar_borde_empresas() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int; t0 timestamptz := clock_timestamp();
BEGIN
  -- Las órdenes a empresas en la franja de montos (por el índice parcial), una vez cada una (la misma orden viene en varios
  -- archivos de CONOSCE: la del archivo más nuevo); después, la franja exacta del tope de su año.
  CREATE TEMP TABLE _xbe ON COMMIT DROP AS
    SELECT o.entidad_ruc, o.ruc, o.fecha_emision, o.nro_orden, o.monto, o.tope
      FROM (SELECT DISTINCT ON (x.entidad_ruc, x.ruc_contratista, x.orden, x.fecha_emision)
                   x.entidad_ruc, x.ruc_contratista AS ruc, x.fecha_emision, x.nro_orden, x.monto,
                   CASE WHEN x.tipo_contratacion ~ 'hasta [0-9]+ UIT'
                          THEN substring(x.tipo_contratacion FROM 'hasta ([0-9]+) UIT')::int * uit_soles(extract(year FROM x.fecha_emision)::int)
                        WHEN extract(year FROM x.fecha_emision) <> 2022 THEN 8 * uit_soles(extract(year FROM x.fecha_emision)::int)
                   END AS tope
              FROM conosce_ordenes x
             WHERE x.monto >= 31540 AND x.monto < 44000 AND x.ruc_contratista LIKE '20%'
               AND x.estado IS DISTINCT FROM 'Anulada' AND x.monto_dudoso IS NULL
               AND x.fecha_emision >= DATE '2018-01-01'
             ORDER BY x.entidad_ruc, x.ruc_contratista, x.orden, x.fecha_emision, x.anio DESC, x.mes DESC) o
     WHERE o.monto >= 0.95 * o.tope AND o.monto < o.tope;
  -- El denominador: todas las órdenes que la entidad le dio (empresa_orden_anual), sólo de los pares con alguna en el borde.
  CREATE TEMP TABLE _xbc ON COMMIT DROP AS
    SELECT a.entidad_ruc, a.ruc, sum(a.ordenes)::int AS ordenes
      FROM empresa_orden_anual a JOIN (SELECT DISTINCT entidad_ruc, ruc FROM _xbe) b ON b.entidad_ruc = a.entidad_ruc AND b.ruc = a.ruc
     GROUP BY a.entidad_ruc, a.ruc;

  DELETE FROM empresa_borde_tope;
  INSERT INTO empresa_borde_tope (entidad_ruc, ruc, en_el_borde, ordenes, monto, citadas, desde, hasta)
  SELECT b.entidad_ruc, b.ruc, count(*)::int, max(c.ordenes), sum(b.monto),
         jsonb_agg(jsonb_build_object('fecha', b.fecha_emision, 'numero', b.nro_orden, 'monto', b.monto, 'tope', b.tope)
                   ORDER BY b.fecha_emision DESC),
         min(b.fecha_emision), max(b.fecha_emision)
    FROM _xbe b JOIN _xbc c ON c.entidad_ruc = b.entidad_ruc AND c.ruc = b.ruc
   GROUP BY b.entidad_ruc, b.ruc
  HAVING count(*) >= 5 AND count(*) >= 0.5 * max(c.ordenes);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'empresas al borde del tope: % pares (% s)', n, round(extract(epoch FROM clock_timestamp() - t0));
  RETURN n;
END $$;
ALTER FUNCTION refrescar_borde_empresas() OWNER TO vigia_jobs;
COMMENT ON FUNCTION refrescar_borde_empresas() IS
  'Rehace empresa_borde_tope (migración 207): las empresas con la mitad o más de las órdenes de una entidad al borde del tope.';
