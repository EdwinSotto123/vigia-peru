-- Vigía Perú · Migración 30 — Perfil público del aliado ──────────────────────────────────────────
--
-- Un aliado que financia auditorías puede mostrar en su página (/aliado/<slug>) quién es y cómo
-- contactarlo, como un perfil de red social: una descripción corta, su web, un correo de CONTACTO,
-- sus redes y una imagen de portada. Diseño: frontend/DESIGN_SYSTEM.md §14.6.
--
--   · descripcion    hasta 280 caracteres (lo que cabe en la cabecera del perfil).
--   · sitio_web      https://… (la API rechaza http y otros esquemas).
--   · email_publico  el correo que el aliado ELIGE publicar. `financiadores.email` sigue siendo
--                    privado (sólo sirve para el pago) y nunca sale en la API pública.
--   · redes          {"facebook": "https://…", …}: sólo facebook, instagram, linkedin, x, tiktok y
--                    youtube, cada una un enlace https (la API además exige el dominio de esa red).
--   · portada_url    imagen de portada; sin ella la portada es la franja textil.
--
-- NULL (o redes = '{}') = el aliado no publicó ese dato: la página no muestra nada en su lugar.
-- Quién escribe: PATCH /admin/financiadores/:id (sólo el perfil admin, frontend/lib/permisos.ts),
-- con cada cambio en la bitácora (admin_log, accion 'editar_financiador').
-- Quién lee: GET /financiamiento/aliados/:slug y GET /admin/financiadores. La API detecta si estas
-- columnas existen: desplegada antes que esta migración, el perfil sale sin estos campos y el panel
-- avisa que falta aplicarla (en vez de un 500).
--
-- Cómo aplicarla: A MANO con psql (apply_all.py llega sólo hasta la 21), fuera del lote nocturno:
--     psql "$DSN" -v ON_ERROR_STOP=1 -1 -f backend/db/migrations/30_perfil_aliado.sql
-- Idempotente: las columnas llevan IF NOT EXISTS y los CHECK se quitan y se vuelven a poner (como
-- 13/15/18). `financiadores` tiene pocas filas: el ALTER toma el bloqueo exclusivo un instante y
-- los DEFAULT no reescriben la tabla (Postgres ≥ 11).
--
-- lock_timeout: si algo tiene tomada `financiadores` más de 5 s, falla en vez de dejar en cola a las
-- lecturas públicas (ranking, muro, perfiles) detrás del ALTER. Se reintenta más tarde.

SET lock_timeout = '5s';

ALTER TABLE financiadores
  ADD COLUMN IF NOT EXISTS descripcion   TEXT,
  ADD COLUMN IF NOT EXISTS sitio_web     TEXT,
  ADD COLUMN IF NOT EXISTS email_publico TEXT,
  ADD COLUMN IF NOT EXISTS redes         JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS portada_url   TEXT;

ALTER TABLE financiadores DROP CONSTRAINT IF EXISTS financiadores_descripcion_check;
ALTER TABLE financiadores ADD CONSTRAINT financiadores_descripcion_check
  CHECK (descripcion IS NULL OR char_length(descripcion) <= 280);

-- La API ya valida esto; el CHECK cierra la puerta a un enlace javascript:/http: escrito por otra vía.
ALTER TABLE financiadores DROP CONSTRAINT IF EXISTS financiadores_sitio_web_check;
ALTER TABLE financiadores ADD CONSTRAINT financiadores_sitio_web_check
  CHECK (sitio_web IS NULL OR sitio_web ~ '^https://\S+$');

ALTER TABLE financiadores DROP CONSTRAINT IF EXISTS financiadores_portada_url_check;
ALTER TABLE financiadores ADD CONSTRAINT financiadores_portada_url_check
  CHECK (portada_url IS NULL OR portada_url ~ '^https://\S+$');

ALTER TABLE financiadores DROP CONSTRAINT IF EXISTS financiadores_email_publico_check;
ALTER TABLE financiadores ADD CONSTRAINT financiadores_email_publico_check
  CHECK (email_publico IS NULL OR email_publico ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- Un objeto; sólo las seis claves; cada valor, un texto https.
ALTER TABLE financiadores DROP CONSTRAINT IF EXISTS financiadores_redes_check;
ALTER TABLE financiadores ADD CONSTRAINT financiadores_redes_check
  CHECK (
    jsonb_typeof(redes) = 'object'
    AND redes - ARRAY['facebook', 'instagram', 'linkedin', 'x', 'tiktok', 'youtube'] = '{}'::jsonb
    AND NOT jsonb_path_exists(redes, '$.* ? (@.type() != "string" || !(@ starts with "https://"))')
  );

COMMENT ON COLUMN financiadores.descripcion   IS 'Perfil público (migración 30): quién es el aliado, ≤ 280 caracteres.';
COMMENT ON COLUMN financiadores.sitio_web     IS 'Perfil público (migración 30): web del aliado, https.';
COMMENT ON COLUMN financiadores.email_publico IS 'Perfil público (migración 30): correo de CONTACTO que el aliado eligió publicar. El de pago es `email` (privado).';
COMMENT ON COLUMN financiadores.redes         IS 'Perfil público (migración 30): {facebook|instagram|linkedin|x|tiktok|youtube: "https://…"}.';
COMMENT ON COLUMN financiadores.portada_url   IS 'Perfil público (migración 30): imagen de portada, https.';

-- Borrar cuenta (migración 26) anonimiza el perfil de aliado: ahora también borra lo que el aliado
-- publicó en él. Mismo cuerpo que en la 26 más las columnas nuevas (si la 26 se volviera a correr
-- después de esta, hay que volver a correr esta).
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
           descripcion = NULL, sitio_web = NULL, email_publico = NULL, redes = '{}'::jsonb, portada_url = NULL,
           visible = FALSE, motivo_no_visible = COALESCE(motivo_no_visible, 'cuenta_borrada')
     WHERE id = v_fin;
  END IF;
  UPDATE reportes_indexados SET user_id = NULL WHERE user_id = p_uid;
  DELETE FROM usuarios WHERE firebase_uid = p_uid;
  RETURN v_aportes;
END $$;
