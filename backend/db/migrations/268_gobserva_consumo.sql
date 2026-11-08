-- 268: consumo del asistente y del MCP de Gobserva por día y por cuenta (2026-11-08).
--
-- Los créditos se cuentan en el Durable Object `Limitador` (sumas por cuenta, para cortar a tiempo); esta tabla guarda
-- lo mismo para mirarlo desde el panel: cuántas llamadas y preguntas, cuántos créditos y cuánto costó el modelo (sólo el
-- asistente: en el MCP el modelo lo paga la IA de quien pregunta). Una fila por día, cuenta, canal y detalle (la
-- herramienta del MCP o el modo del asistente), que se suma con cada uso (INSERT … ON CONFLICT … DO UPDATE).
-- Sin datos personales: la cuenta va por su uid; el panel la une con gobserva_cuentas.
CREATE TABLE IF NOT EXISTS public.gobserva_consumo (
  dia            date NOT NULL,
  firebase_uid   text NOT NULL CHECK (length(firebase_uid) BETWEEN 6 AND 128),
  canal          text NOT NULL CHECK (canal IN ('mcp', 'asistente')),
  detalle        text NOT NULL CHECK (length(detalle) BETWEEN 1 AND 60),
  -- La app desde la que se usó (empleo, licitaciones) o la dirección del MCP (empleo, licitaciones, todo).
  app            text NOT NULL DEFAULT '' CHECK (length(app) <= 20),
  llamadas       integer NOT NULL DEFAULT 0 CHECK (llamadas >= 0),
  creditos       integer NOT NULL DEFAULT 0 CHECK (creditos >= 0),
  costo_usd      numeric(12, 6) NOT NULL DEFAULT 0 CHECK (costo_usd >= 0),
  actualizado_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dia, firebase_uid, canal, detalle, app)
);
CREATE INDEX IF NOT EXISTS gobserva_consumo_cuenta ON public.gobserva_consumo (firebase_uid, dia);

GRANT SELECT, INSERT, UPDATE ON public.gobserva_consumo TO vigia_api;
GRANT SELECT ON public.gobserva_consumo TO vigia_api_admin;
