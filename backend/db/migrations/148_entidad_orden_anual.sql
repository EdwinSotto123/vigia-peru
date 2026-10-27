-- 148 · Las órdenes de compra y de servicio de cada entidad, por año (CONOSCE): el número de la vista «Órdenes» de su ficha.
--
-- Auditoría de la ficha de entidad (2026-10-26): la ficha no mostraba sus órdenes. UNA Chupaca decía «1 contrato desde
-- 2015» y tiene 124 órdenes en 2026 por S/ 940 mil; Arahuay, 14 contratos y 504 órdenes. Ahora son una vista de su
-- pestaña Contratos (/entidad/<RUC>?seccion=contratos&vista=ordenes), con su número como las otras dos (Contratos y
-- Menores). Contarlas en vivo no se puede: CONOSCE repite una orden entre archivos mensuales (va una vez, en su versión más
-- nueva) y una entidad grande tiene cientos de miles (EsSalud, ~1 M; ONPE, 44 mil: 9 s en frío). Las tablas que ya hay no
-- alcanzan: empresa_orden_anual (109) sólo trae las de empresas (RUC 20) y persona_orden_anual (91), las de servicio a
-- personas (RUC 10); juntas dejan fuera entre el 5 y el 10 % (órdenes de compra a personas, RUC 15 y 17).
--
-- Las mismas condiciones y el mismo dedup que la lista (GET /ordenes, sqlListaOrdenes): en soles, sin las anuladas, con
-- monto (o con monto dudoso, migración 98), emitidas de 2018 a un mes adelante, una vez cada (entidad, orden, fecha) con
-- la versión del archivo más nuevo. Verificado contra la cuenta exacta en prod: UNA Chupaca 124 (S/ 940,074.71), Arahuay 504.
--
-- Hasta que esta tabla exista y tenga a la entidad, la API (GET /entidades/:ruc/conteos) sólo dice si tiene órdenes y la
-- vista va sin número; nunca un 0 que no es.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/148_entidad_orden_anual.sql
-- luego, una vez, año por año (todos de una recorren las ~29 M órdenes y las ordenan: en DEV pasó de 15 min sólo con
-- 2025-2026 y el túnel la cortó), con backend/scripts/aplicar_148.py, que hace
--   SELECT refrescar_entidad_ordenes('2018-01-01', '2018-12-31'); … SELECT refrescar_entidad_ordenes('2026-01-01');
-- y después de cada carga de conosce_ordenes, el año en curso (y el anterior en enero y febrero, por las órdenes que
-- llegan tarde):   SELECT refrescar_entidad_ordenes(current_date - 62);
-- Ese paso va en el Worker de scrapers (comun.ts, refrescarCasosCruce), junto a refrescar_empresa_ordenes.

CREATE TABLE IF NOT EXISTS entidad_orden_anual (
  entidad_ruc TEXT NOT NULL,
  anio        SMALLINT NOT NULL,          -- de la fecha de emisión
  ordenes     INT NOT NULL,               -- cada orden una vez
  compras     INT NOT NULL,               -- órdenes de compra (bienes); el resto son de servicio
  monto       NUMERIC(18, 2) NOT NULL,    -- sin las de monto dudoso
  dudosas     INT NOT NULL,               -- con monto dudoso (migración 98): su monto no entra en `monto`
  primera     DATE,
  ultima      DATE,
  PRIMARY KEY (entidad_ruc, anio)
);

-- Desde el año de p_desde (sin él, 2018) hasta el de p_hasta (sin él, hasta un mes adelante). Antes tenía un solo
-- argumento: se borra para que la llamada de un argumento no sea ambigua.
DROP FUNCTION IF EXISTS refrescar_entidad_ordenes(date);
CREATE OR REPLACE FUNCTION refrescar_entidad_ordenes(p_desde date DEFAULT NULL, p_hasta date DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_anio INT := greatest(COALESCE(extract(year FROM p_desde)::int, 2018), 2018);
  -- Hasta dónde (exclusive): el 1 de enero que sigue al año de p_hasta, nunca más de un mes adelante.
  v_tope DATE := least(COALESCE(make_date(extract(year FROM p_hasta)::int + 1, 1, 1), current_date + 32), current_date + 32);
  n INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_entidad_ordenes'));
  SET LOCAL work_mem = '256MB';
  DELETE FROM entidad_orden_anual WHERE anio >= v_anio AND anio <= extract(year FROM v_tope - 1);
  INSERT INTO entidad_orden_anual (entidad_ruc, anio, ordenes, compras, monto, dudosas, primera, ultima)
  SELECT entidad_ruc, extract(year FROM fecha_emision)::smallint, count(*),
         count(*) FILTER (WHERE tipo_orden ILIKE '%compra%'),
         COALESCE(sum(monto) FILTER (WHERE monto_dudoso IS NULL), 0),
         count(*) FILTER (WHERE monto_dudoso IS NOT NULL),
         min(fecha_emision), max(fecha_emision)
    FROM (SELECT DISTINCT ON (entidad_ruc, orden, fecha_emision) entidad_ruc, fecha_emision, tipo_orden, monto, monto_dudoso
            FROM conosce_ordenes
           WHERE fecha_emision >= make_date(v_anio, 1, 1) AND fecha_emision < v_tope
             AND estado IS DISTINCT FROM 'Anulada' AND moneda = 'Nuevos Soles' AND entidad_ruc ~ '^\d{11}$'
             AND (monto > 0 OR monto_dudoso IS NOT NULL)
           ORDER BY entidad_ruc, orden, fecha_emision, anio DESC, mes DESC) o
   GROUP BY 1, 2;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE entidad_orden_anual;
  RETURN n;
END $$;

ALTER TABLE entidad_orden_anual OWNER TO vigia_jobs;
GRANT SELECT ON entidad_orden_anual TO vigia_api, vigia_api_admin;
ALTER FUNCTION refrescar_entidad_ordenes(date, date) OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_entidad_ordenes(date, date) FROM PUBLIC;
