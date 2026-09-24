-- Vigía Perú · Migración 29 — Equipo del panel (perfiles admin y revisor) ─────────────────────────
--
-- Quién entra al panel y con qué perfil. Se entra con una cuenta de Firebase con el correo
-- VERIFICADO (frontend/lib/admin-sesion.ts); este correo decide el perfil:
--   · los correos del secreto `admin-emails` son administradores principales y no viven acá (no
--     se pueden quitar desde el panel: nadie queda afuera por un clic);
--   · el resto del equipo vive en esta tabla, y lo gestiona un administrador desde /admin/equipo.
-- Qué puede cada perfil: frontend/lib/permisos.ts (lo aplica el proxy del servidor).
--
-- Sin filas, todo sigue como antes: sólo entran los administradores principales.

CREATE TABLE IF NOT EXISTS equipo (
  correo          text PRIMARY KEY CHECK (correo = lower(btrim(correo)) AND correo LIKE '%_@_%'),
  rol             text NOT NULL CHECK (rol IN ('admin', 'revisor')),
  nombre          text,
  activo          boolean NOT NULL DEFAULT true,
  creado_por      text,
  creado_at       timestamptz NOT NULL DEFAULT now(),
  actualizado_por text,
  actualizado_at  timestamptz NOT NULL DEFAULT now(),
  ultimo_ingreso  timestamptz
);

COMMENT ON TABLE equipo IS 'Miembros del panel admin (fuera de los principales del secreto admin-emails). Permisos por rol en frontend/lib/permisos.ts.';
