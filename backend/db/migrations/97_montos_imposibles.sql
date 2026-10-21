-- 97 · Órdenes de CONOSCE con un monto imposible: la entidad escribió el RUC del proveedor (o el número de la orden) en
--      el campo del monto. ~310 órdenes de 2018-2021 (20600293461, 10410913866…) y alguna suelta después; sumadas,
--      las personas contratadas daban S/ 1,5 billones desde 2018 y aparecían 11 "fraccionamientos" de más de S/ 100 M.
--
-- El monto queda NULL (todo lo que suma pide monto > 0) cuando:
--   · es igual al RUC del contratista o al número de la orden (y pasa de S/ 1 M: un número de orden chico puede
--     coincidir con un monto chico de verdad), o
--   · pasa de S/ 100 M: ninguna orden de compra o de servicio llega ahí.
-- limpiar_montos_ordenes(anio, mes) lo hace para un mes (lo llama conosce_ordenes tras cargarlo); sin argumentos, todo.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/97_montos_imposibles.sql
-- y después, fuera de Hyperdrive: refrescar_fraccionamiento(NULL), refrescar_personas_ordenes(NULL),
-- refrescar_personas_senales(NULL), refrescar_personas_resumen() y la cadena de los cruces.

CREATE OR REPLACE FUNCTION limpiar_montos_ordenes(p_anio int DEFAULT NULL, p_mes int DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  UPDATE conosce_ordenes SET monto = NULL
   WHERE monto IS NOT NULL
     AND (p_anio IS NULL OR anio = p_anio) AND (p_mes IS NULL OR mes = p_mes)
     AND (monto > 100000000
          OR (monto > 1000000 AND ruc_contratista ~ '^\d{11}$' AND monto = ruc_contratista::numeric)
          OR (monto > 1000000 AND nro_orden ~ '^\d{1,15}$' AND monto = nro_orden::numeric));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION limpiar_montos_ordenes(int, int) OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION limpiar_montos_ordenes(int, int) FROM PUBLIC;

SELECT limpiar_montos_ordenes() AS montos_anulados;
