-- 105 · La planilla se busca también por el nombre (pedido del usuario, 2026-10-22: buscó «arturo», el rector de la
--       UNI, y no salía).
--
-- La planilla es de servidores públicos y el Portal de Transparencia la publica con su nombre: se busca por el apellido
-- paterno y los nombres. Nunca por el materno, que la API tapa: buscarlo diría quién lo lleva. Las personas que sólo
-- reciben órdenes de servicio (RUC 10, privadas) siguen sin buscarse por nombre (docs/PRIVACIDAD.md).
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/105_planilla_por_nombre.sql (después de la 104).

CREATE INDEX IF NOT EXISTS planilla_persona_nombre_busqueda ON planilla_persona
  USING gin ((mef_norm(COALESCE(paterno, '') || ' ' || COALESCE(nombres, ''))) gin_trgm_ops);
ANALYZE planilla_persona;
