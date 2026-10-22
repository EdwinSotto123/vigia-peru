-- 103 · Buscador en las listas de personas contratadas y de planilla (pedido del usuario, 2026-10-21: "un buscador en
--       cada lista").
--
-- Se busca por la entidad y el tipo de servicio (órdenes) y por el cargo, la dependencia y la entidad (planilla); nunca
-- por el nombre de la persona (docs/PRIVACIDAD.md: un RUC 10 no se busca por nombre). Sin índice, un ILIKE sobre los
-- 3,2 M de persona_entidad tardaba 4,4 s y sobre los 640 mil de planilla_persona 2,2 s: índices de trigramas sobre el
-- texto normalizado (mef_norm: sin tildes, mayúsculas, sólo letras y cifras), que es lo que compara la API.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/103_busqueda_personas.sql (después de la 102).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS persona_entidad_busqueda ON persona_entidad
  USING gin ((mef_norm(COALESCE(entidad, '') || ' ' || COALESCE(servicio, ''))) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS planilla_persona_busqueda ON planilla_persona
  USING gin ((mef_norm(COALESCE(cargo, '') || ' ' || COALESCE(dependencia, '') || ' ' || COALESCE(entidad, ''))) gin_trgm_ops);

ANALYZE persona_entidad;
ANALYZE planilla_persona;
