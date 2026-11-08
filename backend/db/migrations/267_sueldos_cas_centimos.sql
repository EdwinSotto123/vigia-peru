-- 267: sueldos de plazas CAS con los céntimos leídos como soles (2026-11-08).
--
-- SERVIR publica algunos sueldos en un formato que el lector todavía no reconocía: «S/ 8,364.19» quedaba como 836419 y la
-- plaza encabezaba «Las mejor pagadas» con S/ 836,419 al mes. Un sueldo CAS mensual no pasa de ~S/ 20 mil (el tope es
-- S/ 15,600): lo de 100 mil o más que entre 100 da un sueldo posible se divide entre 100. El lector (servir_convocatorias.ts,
-- monto) ya lo corrige al leer. Idempotente: lo ya corregido queda fuera del filtro.
UPDATE servir_convocatoria
   SET remuneracion = round(remuneracion / 100, 2)
 WHERE remuneracion >= 100000 AND remuneracion / 100 <= 30000;

-- Las señales y los resúmenes que dependen del sueldo.
SELECT refrescar_plazas();
