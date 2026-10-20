-- 88 · La cola financiable (`cola_auditoria`) lee por el índice de fecha y trae la entidad.
--
-- Con `cola_desde` = 2026-01-01 la cola son ~15 mil contratos de 828 mil, pero la condición de fecha de la 69
-- (`(SELECT procesamiento_cola_desde()) IS NULL OR … OR fecha >= (SELECT …)`) no dejaba usar `convocatorias_fecha_idx`
-- y cada lectura recorría `convocatorias` entera. Además casi todo uso la juntaba otra vez con `convocatorias` sólo para
-- sacar `entidad_ruc` (otro recorrido entero): la lista de entidades para financiar tardaba 1,8 s (2026-10-20).
--
--   · La fecha, escrita para el índice: sin `cola_desde` el piso es -infinity (entran todas, como antes); un contrato sin
--     fecha sigue adentro. Mismas filas que la 69 (comparado por md5 de los ocid: 15,444 = 15,444).
--   · `entidad_ruc` al final de la vista (CREATE OR REPLACE sólo deja agregar columnas al final).
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/88_cola_por_indice.sql

CREATE OR REPLACE VIEW cola_auditoria AS
SELECT c.ocid, c.ubigeo_zona AS ubigeo, c.fecha_convocatoria, c.entidad_ruc
FROM convocatorias c
WHERE c.ubigeo_zona IS NOT NULL
  AND c.procesable IS DISTINCT FROM false
  AND (    (SELECT procesamiento_tipos_activos()) IS NULL
        OR c.tipo_contratacion = ANY ((SELECT procesamiento_tipos_activos())::text[])
        OR (c.tipo_contratacion IS NULL AND '' = ANY ((SELECT procesamiento_tipos_activos())::text[])))
  AND (    (SELECT procesamiento_etapas_activas()) IS NULL
        OR c.etapa = ANY ((SELECT procesamiento_etapas_activas())::text[])
        OR (c.etapa IS NULL AND '' = ANY ((SELECT procesamiento_etapas_activas())::text[])))
  -- Ventana de fechas (migración 69), por el índice: un contrato sin fecha queda adentro, como antes.
  AND (c.fecha_convocatoria IS NULL
       OR c.fecha_convocatoria >= COALESCE((SELECT procesamiento_cola_desde()), '-infinity'::date))
  AND NOT EXISTS (SELECT 1 FROM alertas a WHERE a.ocid = c.ocid)
  AND NOT EXISTS (SELECT 1 FROM asignaciones s WHERE s.ocid = c.ocid);
