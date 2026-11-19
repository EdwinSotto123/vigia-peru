-- 418 · «Lo más grave de cada año» de una entidad o una empresa (pestaña Historia), en dos pasos.
--
-- routes/historia.ts numeraba por año TODAS las filas de casos_cruce de la entidad (8 690 en la más grande, con su JSON
-- de cruces: se derramaba a disco) para quedarse con 14 por año (155 ms de media, hasta 9,2 s en frío). Ahora el orden
-- sale de un índice que trae lo necesario para ordenar y del heap sólo se leen las filas que se muestran, por la clave
-- (ocid, ruc). 50 → 32 ms en caliente en la entidad más grande; mismas filas en 4 casos con el desempate completo (ocid,
-- ruc): un contrato aparece una vez por integrante de consorcio y sin él el orden cambiaba entre dos consultas.
-- Reemplaza el índice de la 416 (mismas claves, más columnas).
--
-- Cómo aplicarla: sentencia por sentencia (CONCURRENTLY).

CREATE INDEX CONCURRENTLY IF NOT EXISTS casos_cruce_entidad_fecha2 ON casos_cruce (entidad_ruc, fecha_buena_pro)
    INCLUDE (severidad, n_alta, monto, ocid, ruc);
DROP INDEX CONCURRENTLY IF EXISTS casos_cruce_entidad_fecha;
CREATE INDEX CONCURRENTLY IF NOT EXISTS casos_cruce_ruc_cubre ON casos_cruce (ruc, fecha_buena_pro DESC)
    INCLUDE (severidad, n_alta, monto, ocid);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS casos_cruce_ocid_ruc ON casos_cruce (ocid, ruc);
