-- Vigía Perú · Extensiones ─────────────────────────────────────────
-- Habilita PostGIS (geo) y pgvector (embeddings) en la BD `vigia`.
-- Se corre primero, antes que cualquier tabla con tipos GEOGRAPHY o VECTOR.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;       -- para LIKE con índices GIN
CREATE EXTENSION IF NOT EXISTS unaccent;      -- búsquedas con/sin tilde

-- Función helper para texto-busqueda sin tildes
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
  RETURNS text AS $$ SELECT unaccent('public.unaccent'::regdictionary, $1) $$
  LANGUAGE sql IMMUTABLE PARALLEL SAFE;
