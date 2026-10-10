-- Perfil público del aliado, parte 2 (migración 40): teléfono, ubicación y enlaces relevantes.
-- Aditiva y opcional: NULL / '[]' = el aliado no lo publicó y no se muestra. La 30 ya trae descripción,
-- web, correo de contacto, redes (LinkedIn incluido) y portada.

ALTER TABLE financiadores ADD COLUMN IF NOT EXISTS telefono  TEXT;
ALTER TABLE financiadores ADD COLUMN IF NOT EXISTS ubicacion TEXT;
ALTER TABLE financiadores ADD COLUMN IF NOT EXISTS enlaces   JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Teléfono: dígitos, espacios, guiones, paréntesis y un + inicial; entre 6 y 20 caracteres.
ALTER TABLE financiadores DROP CONSTRAINT IF EXISTS financiadores_telefono_check;
ALTER TABLE financiadores ADD CONSTRAINT financiadores_telefono_check
  CHECK (telefono IS NULL OR telefono ~ '^\+?[0-9][0-9 ()-]{5,19}$');

ALTER TABLE financiadores DROP CONSTRAINT IF EXISTS financiadores_ubicacion_check;
ALTER TABLE financiadores ADD CONSTRAINT financiadores_ubicacion_check
  CHECK (ubicacion IS NULL OR char_length(ubicacion) <= 80);

-- Un arreglo de hasta 5 objetos {titulo, url}: título de hasta 60 caracteres, url https.
ALTER TABLE financiadores DROP CONSTRAINT IF EXISTS financiadores_enlaces_check;
ALTER TABLE financiadores ADD CONSTRAINT financiadores_enlaces_check
  CHECK (
    jsonb_typeof(enlaces) = 'array'
    AND jsonb_array_length(enlaces) <= 5
    AND NOT jsonb_path_exists(enlaces, '$[*] ? (@.type() != "object" || !(@.url.type() == "string") || !(@.url starts with "https://") || !(@.titulo.type() == "string") || @.titulo.size() == 0)')
  );

COMMENT ON COLUMN financiadores.telefono  IS 'Perfil público (migración 40): teléfono de contacto que el aliado eligió publicar.';
COMMENT ON COLUMN financiadores.ubicacion IS 'Perfil público (migración 40): ciudad o región, ≤ 80 caracteres.';
COMMENT ON COLUMN financiadores.enlaces   IS 'Perfil público (migración 40): [{titulo, url}] hasta 5 enlaces relevantes, https.';

GRANT UPDATE (telefono, ubicacion, enlaces) ON financiadores TO vigia_api;

-- borrar_cuenta (26/30) también vacía lo nuevo.
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
           telefono = NULL, ubicacion = NULL, enlaces = '[]'::jsonb,
           visible = FALSE, motivo_no_visible = COALESCE(motivo_no_visible, 'cuenta_borrada')
     WHERE id = v_fin;
  END IF;
  UPDATE reportes_indexados SET user_id = NULL WHERE user_id = p_uid;
  DELETE FROM usuarios WHERE firebase_uid = p_uid;
  RETURN v_aportes;
END $$;
