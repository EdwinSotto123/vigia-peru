-- 234: vacantes de SERVIR que en realidad eran el sueldo (2026-11-02).
--
-- Tres avisos abiertos traían en «Cantidad de vacantes» el mismo número que su sueldo («Secretario judicial» del Poder
-- Judicial: 6,620 vacantes y S/ 6,620; también 5,660 y 3,600): Gobserva Empleo sumaba 20,716 vacantes cuando eran
-- 4,836. El parser ya no los toma (vacantesDe en scrapers-worker/src/fuentes/servir_convocatorias.ts y vacantes_de en
-- scripts/cargar_servir_convocatorias.py); esto arregla lo guardado con la misma regla: más de 50 vacantes y el mismo
-- número que el sueldo. Sin dato, la plaza no suma vacantes. Después, las señales de las plazas otra vez, como en 228.
--
-- DEV: bash infrastructure/deploy/dev.sh migrar backend/db/migrations/234_servir_vacantes_sueldo.sql
-- PROD: lo mismo por el túnel (tunel_rds).

UPDATE servir_convocatoria
   SET vacantes = NULL
 WHERE vacantes > 50 AND remuneracion IS NOT NULL AND vacantes = round(remuneracion)::int;

SELECT refrescar_plazas();

DO $$
BEGIN
  IF to_regprocedure('refrescar_plazas_extra()') IS NOT NULL THEN
    PERFORM refrescar_plazas_extra();
  END IF;
END $$;
