-- 354 · Índice por el nombre normalizado de la organización en los gastos de campaña (ONPE).
--
-- Auditoría de consultas del 2026-11-17 (pg_stat_statements, rol vigia_api): «SELECT proceso, count(*)… FROM
-- onpe_gastos_proveedores WHERE mef_norm(organizacion) = mef_norm($1)» corría 2 030 veces con 2,5 s de media (37 % de
-- sus bloques desde el disco: recorría las 189 mil filas). Con el índice, 138 ms por el túnel.
-- Fuera de una transacción (CONCURRENTLY).
CREATE INDEX CONCURRENTLY IF NOT EXISTS onpe_gastos_proveedores_org_norm ON onpe_gastos_proveedores (mef_norm(organizacion));
