-- 420 · Las banderas de la gente de una entidad (bajo el título de su ficha, en todas las pestañas), sólo desde índices.
--
-- La consulta cuenta, entre sus locadores (persona_entidad) y su planilla (planilla_persona), quiénes tienen cada señal:
-- con el índice GIN de `tipos` encontraba las filas, pero iba al heap ancho de cada una para leer sus tipos. En la entidad
-- más grande, 786 + 1 673 páginas de disco: 1,1 s + 2,0 s en frío (pg_stat_statements del 2026-11-19: 1,9 s de media en
-- cada ficha). Índices parciales con sólo las filas que tienen alguna señal (533 mil y 52 mil) y sus tipos en INCLUDE:
-- 78 y 36 páginas, 2,6 y 1,5 ms, 0 idas al heap; las mismas cifras en 3 entidades.
-- planilla_persona estaba al 72 % visible (sin eso no hay escaneo sólo de índice): autovacuum al 2 %.
--
-- Cómo aplicarla: sentencia por sentencia (CONCURRENTLY).

CREATE INDEX CONCURRENTLY IF NOT EXISTS persona_entidad_senales ON persona_entidad (entidad_ruc) INCLUDE (tipos) WHERE n_senales > 0;
CREATE INDEX CONCURRENTLY IF NOT EXISTS planilla_persona_senales ON planilla_persona (entidad_ruc) INCLUDE (tipos) WHERE n_senales > 0;
ALTER TABLE planilla_persona SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02,
                                  autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE persona_entidad SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02,
                                 autovacuum_analyze_scale_factor = 0.02);
