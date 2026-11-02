-- 230: Gobserva, cuentas y planes de pago (2026-11-01).
--
-- Pedido del usuario: cobrar los planes de Gobserva Empleo, Licitaciones y Obras con Mercado Pago, con perfiles,
-- configuración y lo que cada plan trae (alertas, guardados, CSV). Una cuenta de Gobserva es una persona de Firebase con
-- su correo real (distinta de las cuentas de Vigía, que usan un usuario y un correo sintético) y sirve para los tres
-- productos; cada producto tiene su plan.
--
--   gobserva_cuentas          la persona: correo, nombre, empresa y datos para el comprobante (RUC, razón social).
--   gobserva_planes_cliente   un plan contratado (producto + plan): con tarjeta es una suscripción de Mercado Pago
--                             (preapproval, cobro automático cada mes); con Yape, Plin o transferencia, meses pagados
--                             que valida el panel. `vigente_hasta` dice hasta cuándo da acceso.
--   gobserva_cobros           cada cobro (un mes de la tarjeta o un pago con QR), con su número de recibo.
--   gobserva_alertas          búsquedas guardadas que se avisan cada día o cada semana.
--   gobserva_envios           lo que se avisó (por correo o, mientras no haya correo, sólo en la web): la bandeja.
--   gobserva_guardados        plazas, oportunidades y proyectos guardados, con su estado (postulé, gané…).
--
-- Una cuenta no se borra: se anonimiza (sus cobros y recibos se guardan por ley); sus alertas y guardados sí se borran.
-- El rol público (vigia_api) lee y edita lo de cada persona siempre filtrando por su uid de Firebase; activar un plan y
-- marcar un cobro como pagado lo hace sólo el rol del panel (vigia_api_admin), desde el webhook o el panel.
--
-- DEV: bash infrastructure/deploy/dev.sh migrar backend/db/migrations/230_gobserva_cuentas.sql
-- PROD: lo mismo por el túnel (tunel_rds).

CREATE TABLE IF NOT EXISTS gobserva_cuentas (
  firebase_uid       TEXT PRIMARY KEY CHECK (length(firebase_uid) BETWEEN 6 AND 128),
  email              TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  email_verificado   BOOLEAN NOT NULL DEFAULT false,
  nombre             TEXT CHECK (length(nombre) <= 120),
  empresa            TEXT CHECK (length(empresa) <= 160),
  -- Para el comprobante: el RUC de quien paga (persona con negocio o empresa) y su razón social y dirección fiscal.
  ruc                TEXT CHECK (ruc ~ '^(10|15|17|20)[0-9]{9}$'),
  razon_social       TEXT CHECK (length(razon_social) <= 200),
  direccion_fiscal   TEXT CHECK (length(direccion_fiscal) <= 240),
  telefono           TEXT CHECK (telefono ~ '^\+?[0-9]{7,15}$'),
  whatsapp           BOOLEAN NOT NULL DEFAULT false,   -- quiere las alertas por WhatsApp cuando estén
  boletin            BOOLEAN NOT NULL DEFAULT true,    -- novedades del producto (una vez al mes como mucho)
  producto_origen    TEXT CHECK (producto_origen IN ('empleo', 'licitaciones', 'obras')),
  creado_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_ingreso_at  TIMESTAMPTZ,
  baja_at            TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS gobserva_cuentas_email ON gobserva_cuentas (lower(email));

CREATE SEQUENCE IF NOT EXISTS gobserva_plan_seq;
CREATE SEQUENCE IF NOT EXISTS gobserva_recibo_seq;

CREATE TABLE IF NOT EXISTS gobserva_planes_cliente (
  id               BIGSERIAL PRIMARY KEY,
  -- GOB-2026-000001: la referencia en Mercado Pago (external_reference) y en el panel.
  codigo           TEXT NOT NULL UNIQUE CHECK (codigo ~ '^GOB-[0-9]{4}-[0-9]{6,8}$'),
  firebase_uid     TEXT NOT NULL REFERENCES gobserva_cuentas (firebase_uid),
  producto         TEXT NOT NULL CHECK (producto IN ('empleo', 'licitaciones', 'obras')),
  plan             TEXT NOT NULL CHECK (plan ~ '^[a-z]{3,15}$'),
  medio            TEXT NOT NULL CHECK (medio IN ('tarjeta', 'yape', 'plin', 'transferencia', 'cortesia')),
  estado           TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'activa', 'cancelada', 'vencida', 'rechazada')),
  monto_pen        NUMERIC(10, 2) NOT NULL CHECK (monto_pen >= 0),        -- lo que se cobra hoy cada mes
  monto_regular    NUMERIC(10, 2) NOT NULL CHECK (monto_regular >= 0),    -- el precio de lista del plan
  fundador         BOOLEAN NOT NULL DEFAULT false,
  meses_fundador   INT CHECK (meses_fundador > 0),                         -- null: el precio de fundador no vence
  cobros           INT NOT NULL DEFAULT 0,
  preapproval_id   TEXT UNIQUE,
  estado_mp        TEXT,
  vigente_hasta    TIMESTAMPTZ,
  renovar          BOOLEAN NOT NULL DEFAULT true,                          -- false: termina al final de lo pagado
  cancelada_at     TIMESTAMPTZ,
  motivo           TEXT CHECK (length(motivo) <= 300),
  creado_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Un solo plan activo por cuenta y producto. Un pago pendiente convive con el activo (un cambio de plan): al activarse
-- el nuevo, el anterior se cierra en la misma transacción (lib/gobservaCobros.ts).
DROP INDEX IF EXISTS gobserva_planes_cliente_vivo;
CREATE UNIQUE INDEX IF NOT EXISTS gobserva_planes_cliente_activo
  ON gobserva_planes_cliente (firebase_uid, producto) WHERE estado = 'activa';
CREATE INDEX IF NOT EXISTS gobserva_planes_cliente_uid ON gobserva_planes_cliente (firebase_uid);
CREATE INDEX IF NOT EXISTS gobserva_planes_cliente_estado ON gobserva_planes_cliente (estado, vigente_hasta);

CREATE TABLE IF NOT EXISTS gobserva_cobros (
  id            BIGSERIAL PRIMARY KEY,
  numero        TEXT NOT NULL UNIQUE CHECK (numero ~ '^GR-[0-9]{4}-[0-9]{6,8}$'),   -- el recibo
  plan_id       BIGINT NOT NULL REFERENCES gobserva_planes_cliente (id),
  firebase_uid  TEXT NOT NULL,
  medio         TEXT NOT NULL CHECK (medio IN ('tarjeta', 'yape', 'plin', 'transferencia', 'cortesia')),
  monto_pen     NUMERIC(10, 2) NOT NULL CHECK (monto_pen >= 0),
  meses         INT NOT NULL DEFAULT 1 CHECK (meses BETWEEN 1 AND 24),
  estado        TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagado', 'rechazado', 'reembolsado')),
  pasarela_ref  TEXT UNIQUE,                                   -- el id del pago en Mercado Pago
  operacion     TEXT CHECK (length(operacion) <= 40),          -- el n.º de operación de Yape, Plin o la transferencia
  validado_por  TEXT CHECK (length(validado_por) <= 120),
  motivo        TEXT CHECK (length(motivo) <= 300),
  creado_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  pagado_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS gobserva_cobros_plan ON gobserva_cobros (plan_id);
CREATE INDEX IF NOT EXISTS gobserva_cobros_uid ON gobserva_cobros (firebase_uid, creado_at DESC);
CREATE INDEX IF NOT EXISTS gobserva_cobros_pendientes ON gobserva_cobros (creado_at) WHERE estado = 'pendiente';

CREATE TABLE IF NOT EXISTS gobserva_alertas (
  id               BIGSERIAL PRIMARY KEY,
  firebase_uid     TEXT NOT NULL REFERENCES gobserva_cuentas (firebase_uid),
  producto         TEXT NOT NULL CHECK (producto IN ('empleo', 'licitaciones', 'obras')),
  nombre           TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 80),
  -- Los mismos parámetros de la lista del producto (q, region, tipo, min…): la alerta es esa búsqueda, con lo nuevo.
  filtros          JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filtros) = 'object' AND length(filtros::text) <= 2000),
  frecuencia       TEXT NOT NULL DEFAULT 'semanal' CHECK (frecuencia IN ('diaria', 'semanal')),
  activa           BOOLEAN NOT NULL DEFAULT true,
  token_pausa      TEXT NOT NULL UNIQUE CHECK (token_pausa ~ '^[a-f0-9]{32,64}$'),   -- el enlace de un clic del correo
  ultimo_envio_at  TIMESTAMPTZ,
  ultimo_conteo    INT,
  creado_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gobserva_alertas_uid ON gobserva_alertas (firebase_uid, producto);
CREATE INDEX IF NOT EXISTS gobserva_alertas_activas ON gobserva_alertas (frecuencia, ultimo_envio_at) WHERE activa;

CREATE TABLE IF NOT EXISTS gobserva_envios (
  id            BIGSERIAL PRIMARY KEY,
  alerta_id     BIGINT REFERENCES gobserva_alertas (id) ON DELETE SET NULL,
  firebase_uid  TEXT NOT NULL,
  producto      TEXT NOT NULL CHECK (producto IN ('empleo', 'licitaciones', 'obras')),
  tipo          TEXT NOT NULL CHECK (tipo IN ('alerta', 'recordatorio', 'recibo', 'aviso')),
  asunto        TEXT CHECK (length(asunto) <= 200),
  items         JSONB NOT NULL DEFAULT '[]'::jsonb,   -- lo avisado, para verlo en la web: [{ref, titulo, …}]
  n_items       INT NOT NULL DEFAULT 0,
  estado        TEXT NOT NULL CHECK (estado IN ('enviado', 'en_la_web', 'fallido')),
  error         TEXT CHECK (length(error) <= 500),
  mensaje_id    TEXT,
  creado_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gobserva_envios_uid ON gobserva_envios (firebase_uid, creado_at DESC);

CREATE TABLE IF NOT EXISTS gobserva_guardados (
  firebase_uid    TEXT NOT NULL REFERENCES gobserva_cuentas (firebase_uid),
  producto        TEXT NOT NULL CHECK (producto IN ('empleo', 'licitaciones', 'obras')),
  tipo            TEXT NOT NULL CHECK (tipo IN ('plaza', 'oportunidad', 'proyecto', 'empresa', 'entidad')),
  ref             TEXT NOT NULL CHECK (length(ref) BETWEEN 1 AND 80),
  titulo          TEXT CHECK (length(titulo) <= 300),
  datos           JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(datos) = 'object' AND length(datos::text) <= 2000),
  estado          TEXT NOT NULL DEFAULT 'guardada'
                  CHECK (estado IN ('guardada', 'postule', 'entrevista', 'descartada', 'preparando', 'presentada', 'ganada', 'perdida')),
  nota            TEXT CHECK (length(nota) <= 1000),
  recordar        BOOLEAN NOT NULL DEFAULT true,   -- aviso 2 días antes del cierre (plazas y oportunidades)
  recordado_at    TIMESTAMPTZ,
  creado_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (firebase_uid, producto, tipo, ref)
);

-- ─── Permisos ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Las tablas son del rol de los trabajos; los permisos por defecto del esquema se quitan a todos menos a los que siguen.
DO $$
DECLARE
  t text;
  r record;
BEGIN
  FOREACH t IN ARRAY ARRAY['gobserva_cuentas', 'gobserva_planes_cliente', 'gobserva_cobros', 'gobserva_alertas', 'gobserva_envios', 'gobserva_guardados'] LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO vigia_jobs', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
              WHERE table_schema = 'public' AND table_name = t
                AND grantee NOT IN ('vigia_jobs', 'postgres', 'rds_pgaudit')
    LOOP
      EXECUTE format('REVOKE ALL ON public.%I FROM %I', t, r.grantee);
    END LOOP;
  END LOOP;
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'S'
              AND c.relname IN ('gobserva_plan_seq', 'gobserva_recibo_seq', 'gobserva_planes_cliente_id_seq', 'gobserva_cobros_id_seq',
                                'gobserva_alertas_id_seq', 'gobserva_envios_id_seq')
  LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO vigia_jobs', r.relname);
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM PUBLIC', r.relname);
  END LOOP;
  -- Datos personales: sus lecturas quedan en el registro de pgaudit (migración 213).
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rds_pgaudit') THEN
    GRANT SELECT ON public.gobserva_cuentas, public.gobserva_planes_cliente, public.gobserva_cobros TO rds_pgaudit;
  END IF;
END $$;

-- El rol público: lo de cada persona (siempre por su uid en el WHERE). No activa planes ni marca cobros.
GRANT SELECT, INSERT, UPDATE ON gobserva_cuentas TO vigia_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON gobserva_alertas, gobserva_guardados TO vigia_api;
GRANT SELECT ON gobserva_planes_cliente, gobserva_cobros, gobserva_envios TO vigia_api;
GRANT USAGE ON SEQUENCE gobserva_alertas_id_seq TO vigia_api;
-- El panel, el webhook y el envío de alertas.
GRANT SELECT, INSERT, UPDATE, DELETE ON gobserva_cuentas, gobserva_planes_cliente, gobserva_cobros, gobserva_alertas,
  gobserva_envios, gobserva_guardados TO vigia_api_admin;
GRANT USAGE ON SEQUENCE gobserva_plan_seq, gobserva_recibo_seq, gobserva_planes_cliente_id_seq, gobserva_cobros_id_seq,
  gobserva_alertas_id_seq, gobserva_envios_id_seq TO vigia_api_admin;
