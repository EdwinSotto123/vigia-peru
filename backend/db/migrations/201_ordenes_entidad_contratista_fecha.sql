-- 201 · Lo que la entidad le dio a un proveedor desde una fecha, sin leer todas sus órdenes.
--
-- La pestaña Visitas dice, de cada organización que visitó, lo primero que la entidad le dio después y cuánto suma
-- (min(fecha_emision) y sum(monto) de conosce_ordenes desde su primera visita). Con el índice (entidad_ruc,
-- ruc_contratista) cada una de las 300 organizaciones leía todas sus órdenes en la tabla (28,9 M filas): en EsSalud la
-- consulta pasaba los 90 s y la API daba 500 (el INS y el CENARES, 14 y 17 s). Con la fecha en el índice y lo que se suma
-- incluido, se lee sólo el tramo desde la visita, sin ir a la tabla.
--
-- Cómo aplicarla: fuera de una transacción (CONCURRENTLY no bloquea las cargas de órdenes); tarda minutos.

CREATE INDEX CONCURRENTLY IF NOT EXISTS conosce_ordenes_ent_contr_fecha
    ON conosce_ordenes (entidad_ruc, ruc_contratista, fecha_emision)
    INCLUDE (monto, monto_dudoso, estado);
