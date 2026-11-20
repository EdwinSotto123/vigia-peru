-- 433 · Los ítems «parecidos» de una oportunidad en la app de Licitaciones (routes/licitaciones.ts): los 10 adjudicados
-- más recientes con sus mismos CUBSO (hasta 20). El índice que había era (cubso, unidad, anio), sin la fecha: la base
-- traía TODOS los ítems de esos CUBSO, leía su montón y los ordenaba (1,97 s en frío con un CUBSO de 4 237 ítems; 77 ms
-- de media en 54 380 llamadas, 2026-11-20). Con este índice, la consulta toma por CUBSO sus 10 más recientes ya en
-- orden (LATERAL) y junta a lo sumo 200 filas.

CREATE INDEX IF NOT EXISTS precio_item_cubso_fecha ON precio_item (cubso, fecha DESC NULLS LAST) WHERE adjudicado > 0;
ANALYZE precio_item;
