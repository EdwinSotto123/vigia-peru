-- Vigía Perú · Migración 26 — Cuentas de usuario (perfil + configuración) ─────────────
-- Plan: docs/superpowers/plans/2026-09-16-mejoras-ux-datasets-rag.md · § U3
-- Diseño: docs/design/CUENTAS.md
--
-- Principio: SIN cuenta todo sigue funcionando (mapa, financiar como invitado, denunciar
-- anónimo). La cuenta solo agrega "Mi impacto" (aportes, denuncias, zonas seguidas) y
-- "Configuración" (perfil público de aliado, visibilidad, notificaciones, exportar/borrar).
--
-- `usuarios` es 1:1 con Firebase Auth (uid). `financiador_id` enlaza con el perfil público
-- de aliado (financiadores) para que un aporte con sesión no vuelva a pedir nombre/logo.
-- El correo es OPCIONAL y solo sirve para las notificaciones que el usuario active
-- (el envío de correos queda fuera de esta iteración: solo se guardan preferencias).

CREATE TABLE IF NOT EXISTS usuarios (
  firebase_uid        TEXT PRIMARY KEY,
  financiador_id      BIGINT REFERENCES financiadores (id) ON DELETE SET NULL,
  nombre_publico      TEXT,                                  -- NULL = anónimo en el muro
  visible             BOOLEAN NOT NULL DEFAULT FALSE,        -- ¿aparecer en el muro de aliados?
  zonas_seguidas      TEXT[] NOT NULL DEFAULT '{}',          -- ubigeos (2/4/6 dígitos)
  entidades_seguidas  TEXT[] NOT NULL DEFAULT '{}',          -- RUC de entidades
  notificaciones      JSONB NOT NULL DEFAULT '{"contrato_financiado_procesado": true, "senales_en_mi_zona": false}'::jsonb,
  correo              TEXT,                                  -- opcional, privado
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usuarios_financiador_idx ON usuarios (financiador_id);
CREATE INDEX IF NOT EXISTS usuarios_zonas_idx ON usuarios USING GIN (zonas_seguidas);
CREATE INDEX IF NOT EXISTS usuarios_entidades_idx ON usuarios USING GIN (entidades_seguidas);

-- Las denuncias ya guardan `user_id` (reportes_indexados.user_id = firebase uid cuando hubo sesión).
CREATE INDEX IF NOT EXISTS reportes_indexados_user_idx ON reportes_indexados (user_id) WHERE user_id IS NOT NULL;

-- Borrar cuenta: anonimiza el perfil de aliado (conserva los aportes y sus asignaciones,
-- que son públicos por diseño) y elimina la fila de usuarios. Devuelve cuántos aportes quedaron.
CREATE OR REPLACE FUNCTION borrar_cuenta(p_uid TEXT) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_fin BIGINT;
  v_aportes INT := 0;
BEGIN
  SELECT financiador_id INTO v_fin FROM usuarios WHERE firebase_uid = p_uid;
  IF v_fin IS NULL THEN
    SELECT id INTO v_fin FROM financiadores WHERE firebase_uid = p_uid;
  END IF;
  IF v_fin IS NOT NULL THEN
    SELECT count(*) INTO v_aportes FROM contribuciones WHERE financiador_id = v_fin;
    UPDATE financiadores
       SET nombre_publico = NULL, slug = NULL, logo_url = NULL, firebase_uid = NULL,
           visible = FALSE, motivo_no_visible = COALESCE(motivo_no_visible, 'cuenta_borrada')
     WHERE id = v_fin;
  END IF;
  UPDATE reportes_indexados SET user_id = NULL WHERE user_id = p_uid;
  DELETE FROM usuarios WHERE firebase_uid = p_uid;
  RETURN v_aportes;
END $$;
