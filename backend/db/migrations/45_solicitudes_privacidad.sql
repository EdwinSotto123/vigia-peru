-- 45 · Solicitudes de privacidad (Ley 29733): "¿Apareces en Vigía? Pide una corrección".
--
-- Quien aparece en un análisis escribe desde /privacidad (POST /privacidad/solicitudes, con captcha y
-- límite por IP); el equipo las atiende en /admin/privacidad. Se guarda lo justo para responderle:
-- nombre, correo, la página donde aparece y su pedido. No se pide DNI. Idempotente.

CREATE TABLE IF NOT EXISTS solicitudes_privacidad (
  id           bigserial PRIMARY KEY,
  -- El número que se le da a la persona: al azar, para que no se pueda recorrer.
  codigo       text NOT NULL UNIQUE DEFAULT ('PRV-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8))),
  tipo         text NOT NULL CHECK (tipo IN ('correccion', 'retiro', 'acceso', 'oposicion', 'otro')),
  nombre       text NOT NULL CHECK (length(nombre) BETWEEN 2 AND 160),
  email        text NOT NULL CHECK (length(email) BETWEEN 5 AND 200),
  enlace       text CHECK (enlace IS NULL OR length(enlace) <= 500),
  mensaje      text NOT NULL CHECK (length(mensaje) BETWEEN 10 AND 4000),
  estado       text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_revision', 'resuelta', 'rechazada')),
  -- Lo que el equipo hizo o le respondió (no sale del panel).
  respuesta    text CHECK (respuesta IS NULL OR length(respuesta) <= 4000),
  atendida_por text,
  atendida_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS solicitudes_privacidad_estado_idx ON solicitudes_privacidad (estado, created_at DESC);

-- La API pública sólo inserta, y lee el código que devuelve (RETURNING necesita SELECT de esa columna).
-- El correo y el pedido los lee sólo el panel. Los privilegios por defecto (migraciones 37, 43 y 44)
-- les dan SELECT de toda tabla nueva a otros roles: acá se les quita.
REVOKE ALL ON solicitudes_privacidad FROM vigia_api;
GRANT INSERT (tipo, nombre, email, enlace, mensaje) ON solicitudes_privacidad TO vigia_api;
GRANT SELECT (codigo) ON solicitudes_privacidad TO vigia_api;
GRANT USAGE ON SEQUENCE solicitudes_privacidad_id_seq TO vigia_api;
GRANT SELECT, UPDATE ON solicitudes_privacidad TO vigia_api_admin;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_mcp', 'vigia_ab', 'vigia_agentes', 'vigia_dispatcher'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON solicitudes_privacidad FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE solicitudes_privacidad_id_seq FROM %I', r);
    END IF;
  END LOOP;
END $$;
