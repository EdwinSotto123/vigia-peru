-- 233: Gobserva, avisos en el celular y la computadora (notificaciones push del navegador, 2026-11-01).
--
-- Pedido del usuario: «coloca alertas por correo o mediante APP» (WhatsApp todavía no: pide ser empresa). Cada producto
-- se puede instalar como app desde el navegador (manifiesto + service worker) y, con permiso de la persona, recibe una
-- notificación cuando una alerta trae algo nuevo, cuando cierra pronto algo que guardó o cuando se confirma un pago.
--
--   gobserva_push    una suscripción de un navegador (Web Push, RFC 8030): a dónde mandar (endpoint del servicio de
--                    push del navegador) y las llaves para cifrar (p256dh, auth). Un dispositivo por fila; si el servicio
--                    dice que ya no existe (404/410), se borra. Sin datos personales más allá del uid.
--   gobserva_envios  suma `push`: a cuántos dispositivos llegó el aviso.
--
-- DEV: bash infrastructure/deploy/dev.sh migrar backend/db/migrations/233_gobserva_push.sql
-- PROD: lo mismo por el túnel (tunel_rds).

CREATE TABLE IF NOT EXISTS gobserva_push (
  id            BIGSERIAL PRIMARY KEY,
  firebase_uid  TEXT NOT NULL REFERENCES gobserva_cuentas (firebase_uid) ON DELETE CASCADE,
  producto      TEXT NOT NULL CHECK (producto IN ('empleo', 'licitaciones', 'obras')),
  endpoint      TEXT NOT NULL UNIQUE CHECK (endpoint ~ '^https://' AND length(endpoint) <= 1000),
  p256dh        TEXT NOT NULL CHECK (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth          TEXT NOT NULL CHECK (auth ~ '^[A-Za-z0-9_-]{16,30}$'),
  dispositivo   TEXT CHECK (length(dispositivo) <= 120),
  creado_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_ok_at  TIMESTAMPTZ,
  fallos        INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS gobserva_push_uid ON gobserva_push (firebase_uid, producto);

ALTER TABLE gobserva_envios ADD COLUMN IF NOT EXISTS push INT NOT NULL DEFAULT 0;

-- ─── Permisos (como la 230) ───────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  ALTER TABLE public.gobserva_push OWNER TO vigia_jobs;
  REVOKE ALL ON public.gobserva_push FROM PUBLIC;
  FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'gobserva_push'
              AND grantee NOT IN ('vigia_jobs', 'postgres', 'rds_pgaudit')
  LOOP
    EXECUTE format('REVOKE ALL ON public.gobserva_push FROM %I', r.grantee);
  END LOOP;
  ALTER SEQUENCE public.gobserva_push_id_seq OWNER TO vigia_jobs;
  REVOKE ALL ON SEQUENCE public.gobserva_push_id_seq FROM PUBLIC;
END $$;

-- El rol público: los dispositivos de cada persona (siempre por su uid en el WHERE).
GRANT SELECT, INSERT, UPDATE, DELETE ON gobserva_push TO vigia_api;
GRANT USAGE ON SEQUENCE gobserva_push_id_seq TO vigia_api;
-- El envío de alertas (cron y panel): manda, marca el último envío y borra los que ya no existen.
GRANT SELECT, INSERT, UPDATE, DELETE ON gobserva_push TO vigia_api_admin;
GRANT USAGE ON SEQUENCE gobserva_push_id_seq TO vigia_api_admin;
