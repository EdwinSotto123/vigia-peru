-- 144 · Dos índices de persona_entidad para los tramos nuevos de la lista de personas contratadas en todo el país
-- (GET /personas?meses=…&monto=…, 2026-10-26). La API funciona sin ellos (mismos resultados): la página sale por el
-- índice del orden (persona_entidad_orden) en 1-2 ms, pero el TOTAL de la lista filtrada recorre las 3,2 millones de
-- contrataciones: «24 meses o más», 0,8 s con la caché caliente y 4-12 s en frío (seq scan); «más de S/ 300 mil» junto a
-- un partido, 0,2 s caliente y 8 s en frío (el monto es la tercera columna de persona_entidad_orden: se lee el índice
-- entero). Con éstos (angostos, de una columna), el total de un tramo lee sólo su rango. Mientras no estén, la API cuenta
-- con plazo propio (25 s) para no cortar en los 10 s del rol.
--
-- OJO en producción: la tabla la reescriben los refrescos de personas (refrescar_personas_ordenes/_senales), así que en
-- la base EN VIVO cada índice se crea con
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS persona_entidad_meses ON persona_entidad (meses);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS persona_entidad_monto ON persona_entidad (monto);
-- ejecutados de a uno en AUTOCOMMIT (CONCURRENTLY no puede ir en una transacción, y el runner de migraciones abre una;
-- tampoco con `dev.sh migrar`), y no mientras corre un refresco de personas. Esta versión no-concurrente queda para
-- montar la base desde cero. No hay que refrescar nada.
CREATE INDEX IF NOT EXISTS persona_entidad_meses ON persona_entidad (meses);
CREATE INDEX IF NOT EXISTS persona_entidad_monto ON persona_entidad (monto);
