-- 431 · «Cuántos postores distintos tuvo cada proceso» se cuenta en varios lados: la inteligencia de una entidad en la
-- app de Licitaciones, la validación contra el Tribunal (404, 423) y la comparación por entidad (422). El índice por
-- proceso no traía el RUC del postor y cada proceso leía sus filas del montón: en EsSalud, 954 procesos, 2 s en frío y
-- 29 ms en caliente (2026-11-20). Con el RUC incluido es un recorrido sólo por índice. La tabla se recarga con CONOSCE
-- pocas veces: autovacuum al 2 % para que el mapa de visibilidad quede al día.

CREATE INDEX IF NOT EXISTS conosce_postores_convocatoria_cubre ON conosce_postores (codigo_convocatoria) INCLUDE (ruc_postor);
ALTER TABLE conosce_postores SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
