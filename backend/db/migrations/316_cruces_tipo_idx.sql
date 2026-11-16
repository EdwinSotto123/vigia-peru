-- 316 · cruces_proveedor por tipo (2026-11-16).
--
-- La tabla de banderas (399 mil filas, 260 MB) sólo tenía índice por empresa y por contrato. Todo lo que pregunta por un
-- TIPO la recorría entera (27 mil páginas; 1,6 s en frío por consulta, medido con EXPLAIN en PROD):
--   · los patrones (/patrones/inhabilitadas, /control, /observados), que agrupan las banderas de un tipo;
--   · las banderas de la ficha de una entidad que cuentan contratos de un tipo (empresa espejo y, desde hoy, los procesos
--     que observó la Contraloría y los adjudicados después);
--   · el `DELETE … WHERE tipo = …` con que cada refresco rehace lo suyo.
-- Recién rehecha la tabla de casos (la base queda fría), varias de esas rutas pasaban el plazo de 10 s y daban 500.
--
-- (tipo, ocid): filtra por tipo y da el contrato sin ir a la tabla (la unión con convocatorias y el count(DISTINCT ocid)).

SET lock_timeout = '10s';
CREATE INDEX IF NOT EXISTS cruces_proveedor_tipo ON cruces_proveedor (tipo, ocid);
ANALYZE cruces_proveedor;
