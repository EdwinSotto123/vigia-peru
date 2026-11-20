-- 430 · La inteligencia de una entidad en la app de Licitaciones (routes/licitaciones.ts, inteligenciaEntidad): lo que
-- adjudicó en los últimos 12 meses, por entidad y fecha de buena pro. El índice que había era por fecha de CONVOCATORIA:
-- la consulta traía todas las adjudicaciones de la entidad y descartaba por buena pro, leyendo cada página del montón en
-- frío (1,45 s en una entidad con 24 adjudicaciones en el año; 117 ms de media en 3 360 llamadas, 2026-11-20).
-- Con este índice, que cubre las columnas que la consulta usa, es un recorrido sólo por índice. La tabla se recarga con
-- CONOSCE pocas veces: autovacuum al 2 % para que el mapa de visibilidad quede al día después de cada carga.

CREATE INDEX IF NOT EXISTS conosce_adj_entidad_buenapro_cubre ON conosce_adjudicaciones (entidad_ruc, fecha_buenapro)
  INCLUDE (anio, codigo_convocatoria, ruc_proveedor, proveedor, monto_adjudicado, monto_referencial);
ALTER TABLE conosce_adjudicaciones SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
