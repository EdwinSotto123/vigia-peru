-- 273: el equipo usa Gobserva con todo (2026-11-11).
--
-- El usuario: «todos los correos con simplia.store deben tener un plan activo o pueden usar el MCP», y el administrador
-- tampoco entraba (sus cortesías estaban en sus cuentas de Vigía, no en la de Licitaciones o Empleo con la que conectó).
-- Una cuenta con correo VERIFICADO que calza con esta tabla tiene, sin fila en gobserva_planes_cliente, el plan más alto
-- de cada producto (lib/gobservaPlanes.ts → planVigente: Empleo institucional, Licitaciones y Obras Pro). Vale para las
-- cuentas de las apps (Cognito), las de Vigía con correo real y el MCP, que lee los planes de la API.
--   patron = un dominio entero con @ adelante («@simplia.store») o un correo exacto.
-- Los administradores del panel (tabla equipo, rol admin y activos) también cuentan.
-- Los correos personales se agregan con un INSERT en la base, no aquí: el repositorio es público.

CREATE TABLE IF NOT EXISTS public.gobserva_equipo (
  patron     text PRIMARY KEY CHECK (patron = lower(btrim(patron)) AND (patron ~ '^@[a-z0-9.-]+\.[a-z]{2,}$' OR patron ~ '^[^@\s]+@[a-z0-9.-]+\.[a-z]{2,}$')),
  nota       text,
  creado_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.gobserva_equipo IS 'Correos (exactos o «@dominio») con el plan más alto de cada producto de Gobserva sin pagar (planVigente).';

INSERT INTO public.gobserva_equipo (patron, nota) VALUES ('@simplia.store', 'todo el dominio de Simplia')
ON CONFLICT (patron) DO NOTHING;

GRANT SELECT ON public.gobserva_equipo TO vigia_api, vigia_api_admin;
GRANT SELECT (correo, rol, activo) ON public.equipo TO vigia_api;
