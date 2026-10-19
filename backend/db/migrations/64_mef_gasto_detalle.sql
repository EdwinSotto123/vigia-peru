-- 64 · El desglose del gasto con detalle: específica de gasto, fuente y rubro, mes a mes, programas y productos.
--
-- La 63 dejó tres miradas por unidad ejecutora (partida, función, proyecto). Con eso la ficha decía "Bienes y servicios
-- S/ 985 M" pero no en qué exactamente, ni de dónde salía la plata, ni cuándo se gastó. vigia-scrapers
-- (src/mef_agregado.ts, MIRADAS_POR_PASO) agrega ahora cinco más, en dos lecturas extra del ZIP del MEF:
--   · especifica: "3.1.1.1.1" ALIMENTOS Y BEBIDAS PARA CONSUMO HUMANO, con `grupo` = el código de su partida ("3.1.1")
--   · rubro:      "18" CANON Y SOBRECANON, REGALIAS, RENTA DE ADUANAS Y PARTICIPACIONES, `grupo` = su fuente
--   · mes:        "1".."12", sólo el devengado del mes
--   · programa:   "0068" REDUCCION DE VULNERABILIDAD Y ATENCION DE EMERGENCIAS POR DESASTRES
--   · producto:   "0068.3000001" ACCIONES COMUNES, `grupo` = el código de su programa
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/64_mef_gasto_detalle.sql
-- y después recargar el MEF del año (POST /correr de vigia-scrapers, fuente mef_presupuesto, forzar).

ALTER TABLE mef_ejecutora_gasto DROP CONSTRAINT IF EXISTS mef_ejecutora_gasto_tipo_check;
ALTER TABLE mef_ejecutora_gasto ADD CONSTRAINT mef_ejecutora_gasto_tipo_check
  CHECK (tipo IN ('partida', 'funcion', 'proyecto', 'especifica', 'rubro', 'mes', 'programa', 'producto'));
