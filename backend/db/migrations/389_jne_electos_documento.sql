-- 389: «¿es una autoridad electa?» sin recorrer las 374 mil candidaturas del JNE.
--
-- esElectoSql (backend/api/src/lib/electos.ts) pregunta `documento IN (SELECT numero_documento FROM jne_candidaturas WHERE
-- resultado = 'electo' …)` en cada lista de visitas, de personas y de rastro. Sin un índice para esa condición, Postgres
-- leía la tabla entera (1,8 s en frío en la lista de visitas de EsSalud; medido el 2026-11-18 al ver que el CSV de sus
-- 22 873 visitas pasaba los 10 s). Índice parcial con los 38 630 electos: se lee sólo el índice.
CREATE INDEX CONCURRENTLY IF NOT EXISTS jne_candidaturas_electos_documento
    ON jne_candidaturas (numero_documento) WHERE resultado = 'electo' AND numero_documento IS NOT NULL;
