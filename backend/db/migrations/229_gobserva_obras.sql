-- 229: Gobserva Obras (obras.gobserva.cloud, 2026-11-01), el tercer producto de pago: la lista de espera también lo acepta.
--
-- DEV: bash infrastructure/deploy/dev.sh migrar backend/db/migrations/229_gobserva_obras.sql
-- PROD: lo mismo por el túnel (tunel_rds).

ALTER TABLE gobserva_suscripciones DROP CONSTRAINT IF EXISTS gobserva_suscripciones_producto_check;
ALTER TABLE gobserva_suscripciones
  ADD CONSTRAINT gobserva_suscripciones_producto_check CHECK (producto IN ('empleo', 'licitaciones', 'obras', 'mcp'));
