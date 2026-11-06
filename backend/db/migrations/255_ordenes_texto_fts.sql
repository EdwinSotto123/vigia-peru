-- 255: búsqueda de texto en las descripciones de las órdenes de compra y servicio (2026-11-06).
--
-- Para «¿cuánto gastó tal entidad en parlantes, sonido o bocaditos?» (GET /gasto/concepto, herramienta gasto_por_concepto
-- del MCP y chat del panel). Sin índice, filtrar por palabras dentro de una entidad grande leía todas sus órdenes
-- repartidas en los 29 M de filas: 37 s con la caché fría (Ejército). Con este índice GIN, el filtro por palabras se
-- resuelve antes de leer filas y se cruza con el índice por entidad o proveedor (BitmapAnd).
--
-- La expresión tiene que coincidir AL CARÁCTER con la de backend/api/src/routes/gasto.ts (TSV): español, minúsculas, sin
-- tildes (translate, que es inmutable; unaccent no lo es).
--
-- CONCURRENTLY: no bloquea las cargas de órdenes. No corre dentro de una transacción: aplicar con autocommit (en DEV
-- tardó lo que diga el registro de la sesión; en PROD, unos minutos por cada millón de filas).
CREATE INDEX CONCURRENTLY IF NOT EXISTS conosce_ordenes_texto_fts ON conosce_ordenes
  USING gin (to_tsvector('spanish'::regconfig, translate(lower(coalesce(descripcion, '')), 'áéíóúüñ', 'aeiouun')));
