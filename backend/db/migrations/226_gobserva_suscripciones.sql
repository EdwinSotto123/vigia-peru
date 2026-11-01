-- 226 · Gobserva: las suscripciones a sus productos (empleo.gobserva.cloud y licitaciones.gobserva.cloud) y el MCP.
--
-- Pedido del usuario (2026-11-01): ganar plata con lo que Vigía ya captura, con productos de marca Gobserva aparte de
-- Vigía (que sigue gratis). Primero se valida la demanda: quien se anota elige un plan y deja sus intereses (lista de
-- espera con precio de fundador); todavía no se cobra ni se envían alertas. El administrador ve la lista en el panel.
--
-- Datos personales: el correo (obligatorio), y si quiere, su nombre, su teléfono para WhatsApp y su empresa. De RUC, sólo
-- el de una empresa (20…): un RUC 10 lleva el DNI adentro. El rol público (vigia_api) NO lee ni escribe la tabla: sólo
-- llama a gobserva_suscribir(), que inserta o actualiza la suscripción del mismo correo y producto. El panel la lee con
-- vigia_api_admin.
--
-- Además, el rol del MCP (vigia_mcp) puede leer las plazas CAS y las entidades: las herramientas nuevas del MCP
-- (buscar_plazas_cas y buscar_licitaciones, backend/mcp-worker) responden con lo mismo que las páginas.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/226_gobserva_suscripciones.sql

CREATE TABLE IF NOT EXISTS gobserva_suscripciones (
  id              BIGSERIAL PRIMARY KEY,
  producto        TEXT NOT NULL CHECK (producto IN ('empleo', 'licitaciones', 'mcp')),
  email           TEXT NOT NULL CHECK (length(email) BETWEEN 6 AND 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  nombre          TEXT CHECK (length(nombre) <= 120),
  empresa         TEXT CHECK (length(empresa) <= 160),
  ruc             TEXT CHECK (ruc ~ '^20[0-9]{9}$'),
  telefono        TEXT CHECK (length(telefono) <= 24),
  plan            TEXT NOT NULL DEFAULT 'gratis'
                  CHECK (plan IN ('gratis', 'alertas', 'pro', 'empresa', 'institucional', 'mcp')),
  intereses       JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (length(intereses::text) <= 4000),
  origen          TEXT CHECK (length(origen) <= 200),
  acepta          BOOLEAN NOT NULL DEFAULT false,
  creado_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  baja_at         TIMESTAMPTZ,
  UNIQUE (producto, email)
);
CREATE INDEX IF NOT EXISTS gobserva_suscripciones_fecha ON gobserva_suscripciones (creado_at DESC);
ALTER TABLE gobserva_suscripciones OWNER TO vigia_jobs;
REVOKE ALL ON gobserva_suscripciones FROM PUBLIC;
-- Los permisos por defecto del esquema le dan SELECT a otros roles (vigia_api entre ellos) al crear la tabla: se los
-- quita a todos menos al dueño y al panel. Los correos sólo los lee el panel.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'gobserva_suscripciones'
              AND grantee NOT IN ('vigia_jobs', 'vigia_api_admin', 'postgres', 'rds_pgaudit')
  LOOP
    EXECUTE format('REVOKE ALL ON public.gobserva_suscripciones FROM %I', r.grantee);
  END LOOP;
  FOR r IN SELECT DISTINCT grantee FROM information_schema.role_usage_grants
            WHERE object_schema = 'public' AND object_name = 'gobserva_suscripciones_id_seq'
              AND grantee NOT IN ('vigia_jobs', 'postgres')
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE public.gobserva_suscripciones_id_seq FROM %I', r.grantee);
  END LOOP;
  -- Datos personales: sus lecturas quedan en el registro de pgaudit (migración 213), como las demás tablas con personas.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rds_pgaudit') THEN
    GRANT SELECT ON public.gobserva_suscripciones TO rds_pgaudit;
  END IF;
END $$;
GRANT SELECT, UPDATE ON gobserva_suscripciones TO vigia_api_admin;

-- Inserta o actualiza (mismo correo y producto) y dice si era nueva. SECURITY DEFINER: el rol público no toca la tabla.
CREATE OR REPLACE FUNCTION gobserva_suscribir(
  p_producto text, p_email text, p_nombre text, p_empresa text, p_ruc text, p_telefono text,
  p_plan text, p_intereses jsonb, p_origen text, p_acepta boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE nueva boolean;
BEGIN
  INSERT INTO gobserva_suscripciones AS s (producto, email, nombre, empresa, ruc, telefono, plan, intereses, origen, acepta)
  VALUES (p_producto, lower(btrim(p_email)), NULLIF(btrim(p_nombre), ''), NULLIF(btrim(p_empresa), ''), NULLIF(btrim(p_ruc), ''),
          NULLIF(btrim(p_telefono), ''), COALESCE(p_plan, 'gratis'), COALESCE(p_intereses, '{}'::jsonb), p_origen, COALESCE(p_acepta, false))
  ON CONFLICT (producto, email) DO UPDATE
    SET nombre = COALESCE(EXCLUDED.nombre, s.nombre),
        empresa = COALESCE(EXCLUDED.empresa, s.empresa),
        ruc = COALESCE(EXCLUDED.ruc, s.ruc),
        telefono = COALESCE(EXCLUDED.telefono, s.telefono),
        plan = EXCLUDED.plan,
        intereses = EXCLUDED.intereses,
        origen = COALESCE(EXCLUDED.origen, s.origen),
        acepta = EXCLUDED.acepta OR s.acepta,
        actualizado_at = now(),
        baja_at = NULL
  RETURNING (xmax = 0) INTO nueva;
  RETURN nueva;
END $$;
ALTER FUNCTION gobserva_suscribir(text, text, text, text, text, text, text, jsonb, text, boolean) OWNER TO vigia_jobs;
REVOKE ALL ON FUNCTION gobserva_suscribir(text, text, text, text, text, text, text, jsonb, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gobserva_suscribir(text, text, text, text, text, text, text, jsonb, text, boolean) TO vigia_api, vigia_api_admin;

-- El MCP: plazas CAS y entidades (convocatorias ya las leía).
GRANT SELECT ON servir_convocatoria, entidades TO vigia_mcp;
