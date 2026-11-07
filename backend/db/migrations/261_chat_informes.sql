-- 261 · Los informes del chat de investigación quedan guardados en el servidor.
--
-- Antes la conversación vivía sólo en la pestaña (sessionStorage): al cerrarla se perdía, y una respuesta de 4 minutos
-- se cortaba si se cerraba a la mitad. Ahora cada pregunta es un informe: lo corre un Durable Object de la API
-- (backend/api/src/workers/chatInforme.ts), que sigue aunque nadie mire, y al terminar lo guarda acá con todos sus
-- eventos (los mismos del NDJSON: pasos, resultados, respuesta, revisión y fin). El panel los lista en
-- /admin/chat/informes y cada uno tiene su enlace (sólo para el equipo, con la sesión del panel).
--
-- Sólo el panel lo lee y lo escribe (rol vigia_api_admin, por HYPERDRIVE_ADMIN). Lo que guarda es lo mismo que muestra el
-- chat: con las reglas de privacidad del MCP (sin DNI, personas naturales con un apellido tapado).

CREATE TABLE IF NOT EXISTS public.admin_chat_informe (
  id            uuid PRIMARY KEY,
  -- Las preguntas de una misma conversación (las de seguimiento) comparten este id.
  conversacion  uuid,
  creado        timestamptz NOT NULL DEFAULT now(),
  actualizado   timestamptz NOT NULL DEFAULT now(),
  -- Quién preguntó (el correo de la sesión del panel).
  actor         text,
  modelo_pedido text NOT NULL CHECK (modelo_pedido IN ('rapido', 'fino')),
  modelo        text,
  pregunta      text NOT NULL,
  -- Los mensajes anteriores de la conversación (rol y texto), para seguirla desde el informe.
  historial     jsonb NOT NULL DEFAULT '[]'::jsonb,
  estado        text NOT NULL DEFAULT 'corriendo' CHECK (estado IN ('corriendo', 'listo', 'error', 'detenido', 'cortado')),
  texto         text,
  eventos       jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision      jsonb,
  fin           jsonb,
  error         text
);
CREATE INDEX IF NOT EXISTS admin_chat_informe_creado ON public.admin_chat_informe (creado DESC);
CREATE INDEX IF NOT EXISTS admin_chat_informe_conversacion ON public.admin_chat_informe (conversacion, creado);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_chat_informe TO vigia_api_admin;
COMMENT ON TABLE public.admin_chat_informe IS
  'Informes del chat de investigación del panel (migración 261): una fila por pregunta, con sus eventos NDJSON.';
