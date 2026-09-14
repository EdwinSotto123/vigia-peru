-- ─────────────────────────────────────────────────────────────────────────────
-- 10 · Configuración editable desde el panel admin + campos de moderación.
-- `ajustes` es un key/value JSONB: la clave 'pagos' guarda Yape/Plin/cuentas/QR
-- que ve el financiador al aportar (antes venía de variables de entorno).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ajustes (
  clave       TEXT PRIMARY KEY,
  valor       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT
);

INSERT INTO ajustes (clave, valor)
VALUES ('pagos', '{
  "yape":   { "numero": "", "titular": "", "qr_url": "" },
  "plin":   { "numero": "", "titular": "", "qr_url": "" },
  "cuentas": [],
  "instrucciones": "Transfiere el monto exacto indicando el código de tu aporte como concepto y sube el comprobante. Validamos en menos de 48 h.",
  "contacto_email": ""
}'::jsonb)
ON CONFLICT (clave) DO NOTHING;

ALTER TABLE contribuciones ADD COLUMN IF NOT EXISTS nota_admin TEXT;
ALTER TABLE contribuciones ADD COLUMN IF NOT EXISTS rechazada_motivo TEXT;

-- Bitácora mínima de acciones admin (quién validó/rechazó/ocultó qué).
CREATE TABLE IF NOT EXISTS admin_log (
  id          BIGSERIAL PRIMARY KEY,
  actor       TEXT NOT NULL,
  accion      TEXT NOT NULL,
  objeto      TEXT NOT NULL,          -- 'contribucion:VIG-2026-00001' | 'financiador:12' | 'ajustes:pagos'
  detalle     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_log_created_idx ON admin_log (created_at DESC);
