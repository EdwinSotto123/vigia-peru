-- 219 · Agregados del panel, guardados.
--
-- El panel contaba en cada visita sobre tablas grandes: Fuentes, los contratos por año (~830 mil convocatorias, 0.7 s en
-- PROD) y los procesos de CONOSCE por año (count DISTINCT, 2.2 s); Clasificación, tres sumas de ~0.5 s cada una. Desde
-- el Perú, cada pedido ya cuesta ~0.4 s de ida y vuelta (los Workers corren junto a la base, en Chicago): con esas
-- cuentas encima el panel se sentía «demasiado lento» (pedido del usuario, 2026-10-31).
--
-- Ahora el último resultado de cada cuenta vive acá: el cron de cada 10 minutos (POST /admin/asignar) recalcula las que
-- tienen más de 25 minutos, una por una, y las páginas leen la guardada (backend/api/src/lib/agregadosPanel.ts). Una
-- clave que todavía no existe se calcula en vivo la primera vez.

CREATE TABLE IF NOT EXISTS admin_cache (
  clave        TEXT PRIMARY KEY,
  valor        JSONB NOT NULL,
  calculado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE admin_cache IS 'Último resultado de las cuentas pesadas del panel (Fuentes, Clasificación). Lo escribe la API (lib/agregadosPanel.ts), migración 219.';

GRANT SELECT, INSERT, UPDATE ON admin_cache TO vigia_api_admin;
