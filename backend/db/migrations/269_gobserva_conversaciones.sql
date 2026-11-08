-- 269: el historial del asistente de cada app de Gobserva (2026-11-08, el usuario: «falta historial de chats»).
--
-- Cada conversación es de una cuenta y de una app (empleo, licitaciones): su título (la primera pregunta, editable) y sus
-- turnos en `mensajes` (jsonb: rol, texto, modo, créditos, consultas, fecha). Sólo se guardan las preguntas con
-- respuesta. Es de quien la tuvo: se lee, se renombra y se borra desde su cuenta, y se borra con ella. El panel no la lee.
CREATE TABLE IF NOT EXISTS public.gobserva_conversaciones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid   text NOT NULL REFERENCES public.gobserva_cuentas (firebase_uid) ON DELETE CASCADE,
  app            text NOT NULL CHECK (app IN ('empleo', 'licitaciones')),
  titulo         text NOT NULL CHECK (length(titulo) BETWEEN 1 AND 120),
  mensajes       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(mensajes) = 'array'),
  creditos       integer NOT NULL DEFAULT 0 CHECK (creditos >= 0),
  creado_at      timestamptz NOT NULL DEFAULT now(),
  actualizado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gobserva_conversaciones_cuenta ON public.gobserva_conversaciones (firebase_uid, app, actualizado_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gobserva_conversaciones TO vigia_api;
-- Para borrar el consumo de una cuenta que pide su baja (migración 268 sólo daba lectura y escritura).
GRANT DELETE ON public.gobserva_consumo TO vigia_api;
