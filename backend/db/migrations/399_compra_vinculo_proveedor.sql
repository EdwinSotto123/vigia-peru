-- 399 · Las compras de un proveedor sin recorrer todos los vínculos de compra.
--
-- El resumen de compras de la ficha de una empresa (routes/compras.ts, sqlResumenProveedor) quita las órdenes que ya
-- cuentan como parte de un proceso o del catálogo (compra_vinculo, migración 240). Sin un índice por proveedor, la base
-- recorría los 1,56 millones de vínculos en cada empresa grande: 2,1 s en la que más órdenes tiene (75 mil), medido el
-- 2026-11-19. `proveedor_ruc` es siempre el contratista de la orden (0 diferencias en una muestra de 30 880 vínculos y
-- en las dos empresas con más órdenes): la consulta filtra por él y lee sólo los vínculos de esa empresa.
CREATE INDEX CONCURRENTLY IF NOT EXISTS compra_vinculo_proveedor
    ON compra_vinculo (proveedor_ruc, entidad_ruc, orden, fecha_emision);
