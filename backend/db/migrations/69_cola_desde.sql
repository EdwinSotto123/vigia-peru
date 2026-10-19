-- 69 · Ventana de fechas de la cola: los contratos históricos se ven, pero no entran solos a la cola.
--
-- La base de Vigía pasa a tener los contratos del OECE desde 2015 (fuente oece_ocds en modo relleno). La cola
-- financiable (`cola_auditoria`) es una vista sobre `convocatorias`: sin esto, todo contrato de bienes adjudicado
-- desde 2015 entraría a la cola, el aporte por zona (que toma los más antiguos primero) se iría a 2015 y se pedirían
-- sus documentos. `ajustes.procesamiento.cola_desde` (AAAA-MM-DD) fija desde qué fecha de convocatoria entra un
-- contrato a la cola; sin el campo, todos (lo de antes). Se edita en /admin/clasificacion.
--
-- Lo mismo para `contrato_estado.operativo = 'en_cola'` (los conteos "esperando lectura", el mapa, los partidos).
-- El valor inicial, 2025-01-01, es anterior a todos los contratos que había: la cola queda igual que antes.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/69_cola_desde.sql

CREATE OR REPLACE FUNCTION procesamiento_cola_desde() RETURNS DATE
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN a.valor->>'cola_desde' ~ '^\d{4}-\d{2}-\d{2}$' THEN (a.valor->>'cola_desde')::date END
    FROM public.ajustes a WHERE a.clave = 'procesamiento'
$$;

CREATE OR REPLACE VIEW cola_auditoria AS
SELECT c.ocid, c.ubigeo_zona AS ubigeo, c.fecha_convocatoria
FROM convocatorias c
WHERE c.ubigeo_zona IS NOT NULL
  AND c.procesable IS DISTINCT FROM false
  AND (    (SELECT procesamiento_tipos_activos()) IS NULL
        OR c.tipo_contratacion = ANY ((SELECT procesamiento_tipos_activos())::text[])
        OR (c.tipo_contratacion IS NULL AND '' = ANY ((SELECT procesamiento_tipos_activos())::text[])))
  AND (    (SELECT procesamiento_etapas_activas()) IS NULL
        OR c.etapa = ANY ((SELECT procesamiento_etapas_activas())::text[])
        OR (c.etapa IS NULL AND '' = ANY ((SELECT procesamiento_etapas_activas())::text[])))
  -- Ventana de fechas (migración 69): sin `cola_desde`, todas; un contrato sin fecha queda adentro, como antes.
  AND (    (SELECT procesamiento_cola_desde()) IS NULL OR c.fecha_convocatoria IS NULL
        OR c.fecha_convocatoria >= (SELECT procesamiento_cola_desde()))
  AND NOT EXISTS (SELECT 1 FROM alertas a WHERE a.ocid = c.ocid)
  AND NOT EXISTS (SELECT 1 FROM asignaciones s WHERE s.ocid = c.ocid);

-- La de la migración 35, con la ventana en `operativo`.
CREATE OR REPLACE VIEW contrato_estado_calculado AS
SELECT c.ocid,
       CASE WHEN a.score IS NULL THEN 'sin_analizar'
            WHEN a.estado = 'revision' THEN 'en_revision'
            WHEN NOT alerta_publicada(a.estado) THEN 'descartado'
            WHEN a.score >= 70 THEN 'alto' WHEN a.score >= 40 THEN 'medio' ELSE 'bajo' END      AS riesgo,
       CASE WHEN alerta_publicada(a.estado) THEN a.score END                                    AS score,
       CASE WHEN p.estado IS NOT NULL THEN p.estado
            WHEN a.id IS NOT NULL THEN 'procesado'
            WHEN c.procesable = false THEN 'pendiente_de_procesamiento'
            ELSE 'sin_analizar' END                                                             AS estado_proc,
       CASE WHEN c.tipo_contratacion = ANY(al.tipos) AND c.etapa = ANY(al.etapas)
                 AND (al.desde IS NULL OR c.fecha_convocatoria IS NULL OR c.fecha_convocatoria >= al.desde) THEN 'en_cola'
            WHEN EXISTS (SELECT 1 FROM documentos_gcs d
                          WHERE d.ocid = c.ocid AND d.borrado_at IS NULL AND d.expira_at > now()) THEN 'documentos_listos'
            ELSE 'sin_documentos' END                                                           AS operativo,
       a.id AS alerta_id, a.codigo AS alerta_codigo, a.estado AS alerta_estado,
       c.ubigeo_zona,
       COALESCE(c.tipo_contratacion,
                CASE c.categoria WHEN 'goods' THEN 'bienes' WHEN 'services' THEN 'servicios'
                                 WHEN 'works' THEN 'obras' ELSE NULL END)                       AS tipo,
       c.etapa, c.entidad_ruc, c.fecha_convocatoria, c.created_at,
       c.cuantia_referencial                                                                    AS monto
FROM convocatorias c
CROSS JOIN LATERAL (SELECT ac.tipos, ac.etapas, procesamiento_cola_desde() AS desde FROM alcance_contratos() ac) al
-- La alerta de cada convocatoria: la más reciente, sin semillas de demo (ALERTA_LATERAL de contratos.ts).
LEFT JOIN LATERAL (
  SELECT a.id, a.codigo, a.score, a.estado FROM alertas a
   WHERE a.ocid IS NOT NULL AND ocid_corto(a.ocid) = ocid_corto(c.ocid) AND a.codigo NOT LIKE 'ALT-%'
   ORDER BY a.analizado_en DESC NULLS LAST, a.created_at DESC, a.id
   LIMIT 1) a ON TRUE
LEFT JOIN procesamientos p ON p.ocid = c.ocid;

-- El valor inicial. El trigger de ajustes (migración 35) recalcula contrato_estado con la vista nueva.
UPDATE ajustes SET valor = valor || jsonb_build_object('cola_desde', '2025-01-01'), updated_at = now(), updated_by = 'migracion-69'
 WHERE clave = 'procesamiento' AND NOT (valor ? 'cola_desde');

SELECT refresh_financiamiento();
