-- 176 · Fuera convocatoria_busqueda (migración 86): la búsqueda de contratos lee convocatoria_texto (migración 173).
--
-- La API desplegada el 2026-10-27 ya no la lee; sus tres triggers seguían copiando el vector en cada carga de
-- convocatorias y la tabla ocupaba ~350 MB de la memoria compartida que necesita la nueva.
--
-- Cómo aplicarla: python infrastructure/dev/dev.py migrar backend/db/migrations/176_sin_busqueda_vieja.sql (DEV); en
-- producción, el mismo archivo con tunel_rds. Sólo después de desplegar la API que lee convocatoria_texto.

DROP TRIGGER IF EXISTS trg_convocatoria_busqueda_ins ON convocatorias;
DROP TRIGGER IF EXISTS trg_convocatoria_busqueda_upd ON convocatorias;
DROP TRIGGER IF EXISTS trg_convocatoria_busqueda_del ON convocatorias;
DROP FUNCTION IF EXISTS convocatoria_busqueda_trg();
DROP TABLE IF EXISTS convocatoria_busqueda;
