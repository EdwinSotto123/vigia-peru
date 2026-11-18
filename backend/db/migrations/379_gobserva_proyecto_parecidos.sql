-- 379: índice para los «proyectos parecidos» de la ficha de una obra (gobserva_obras_ficha).
--
-- La ficha busca, del mismo sector, proyectos que se vienen o están en ejecución o paralizados con un costo entre un
-- tercio y el triple. Sin índice por sector y costo recorría los 150 mil proyectos: 23-58 ms de los 28-79 ms de la
-- función (medido el 2026-11-18; en pg_stat_statements, 317 ms de media con la base fría, 106 llamadas en hora y media).
-- Parcial, con las mismas condiciones de la función.
--
-- CONCURRENTLY: fuera de una transacción (aplicar sola, sin BEGIN).
CREATE INDEX CONCURRENTLY IF NOT EXISTS gobserva_proyecto_parecidos
  ON gobserva_proyecto (sector, costo)
  WHERE costo > 0 AND (se_viene OR fase IN ('ejecucion', 'paralizada'));
