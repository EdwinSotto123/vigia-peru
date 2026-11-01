-- 228: sueldos de SERVIR leídos ×100 (2026-11-01).
--
-- monto() del scraper tomaba «S/. 8,364,19» (la coma de los decimales) como 836419: seis plazas abiertas encabezaban
-- «Las mejor pagadas» de Gobserva Empleo con S/ 386,419 a S/ 936,419 al mes. El parser ya lo lee bien
-- (scrapers-worker/src/fuentes/servir_convocatorias.ts y scripts/cargar_servir_convocatorias.py); esto arregla lo
-- guardado con la misma regla: sólo montos de S/ 100,000 o más que, entre cien, dan un sueldo posible del Estado. La
-- próxima lectura de SERVIR los vuelve a escribir desde el aviso. Después, las señales de las plazas otra vez, en el
-- orden del scraper (refrescar_plazas rehace todas; refrescar_plazas_extra va después, migración 183).
--
-- DEV: bash infrastructure/deploy/dev.sh migrar backend/db/migrations/228_servir_sueldo_coma_decimal.sql
-- PROD: lo mismo por el túnel (tunel_rds).

UPDATE servir_convocatoria
   SET remuneracion = round(remuneracion / 100, 2)
 WHERE remuneracion >= 100000 AND remuneracion / 100 BETWEEN 1025 AND 40000;

SELECT refrescar_plazas();

DO $$
BEGIN
  IF to_regprocedure('refrescar_plazas_extra()') IS NOT NULL THEN
    PERFORM refrescar_plazas_extra();
  END IF;
END $$;
