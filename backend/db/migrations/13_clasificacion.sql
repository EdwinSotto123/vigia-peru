-- ─────────────────────────────────────────────────────────────────────────────
-- 13 · Clasificación tipo × etapa de cada convocatoria y qué agentes le aplican.
--
-- La escribe `backend/core/clasificacion.py` (al ingerir en oece_ocds / batch y con
-- `python -m backend.core.clasificacion --reclasificar`). La lee el dispatcher: si
-- `procesable = false` el contrato queda `pendiente_de_procesamiento` sin llamar al
-- orquestador; si es procesable, le manda `agentes_aplicables` + `validaciones_pendientes`.
-- Matriz y reglas: docs/design/MATRIZ_TIPO_ETAPA.md
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS tipo_contratacion      TEXT;        -- bienes|servicios|consultoria|obras|convenio|directa|otro
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS etapa                  TEXT;        -- planificacion|convocada|adjudicada|contratada|en_ejecucion|finalizada|desierta|cancelada|nula|desconocida
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS modalidad              TEXT;        -- tender.procurementMethodDetails tal cual
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS procesable             BOOLEAN;     -- NULL = aún sin clasificar (se trata como procesable)
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS motivo_no_procesable   TEXT;        -- tipo_no_soportado|etapa_desconocida|etapa_planificacion
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS agentes_aplicables     TEXT[];
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS validaciones_pendientes TEXT[];
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS proveedor_ruc          CHAR(11);    -- del award/contract, si el record lo trae
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS clasificado_at         TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS convocatorias_tipo_etapa_idx ON convocatorias (tipo_contratacion, etapa);
CREATE INDEX IF NOT EXISTS convocatorias_procesable_idx ON convocatorias (procesable);
CREATE INDEX IF NOT EXISTS convocatorias_proveedor_idx  ON convocatorias (proveedor_ruc) WHERE proveedor_ruc IS NOT NULL;

-- procesamientos.estado admite además 'pendiente_de_procesamiento' (el dispatcher lo fija
-- cuando la convocatoria reclamada no es procesable; no consume intento ni llama al orquestador).
ALTER TABLE procesamientos DROP CONSTRAINT IF EXISTS procesamientos_estado_check;
ALTER TABLE procesamientos ADD CONSTRAINT procesamientos_estado_check
  CHECK (estado IN ('encolado','procesando','procesado','error','pendiente_de_procesamiento'));

-- La cola financiable excluye lo no procesable: no se cobra por lo que no se puede analizar.
-- (Misma lista de columnas que en 09/11: zona_estado y asignar_contribucion siguen funcionando.)
CREATE OR REPLACE VIEW cola_auditoria AS
SELECT cz.ocid, cz.ubigeo, cz.fecha_convocatoria
FROM convocatoria_zona cz
JOIN convocatorias c ON c.ocid = cz.ocid
WHERE cz.ubigeo IS NOT NULL
  AND c.procesable IS DISTINCT FROM false
  AND NOT EXISTS (SELECT 1 FROM alertas a WHERE a.ocid = cz.ocid)
  AND NOT EXISTS (SELECT 1 FROM asignaciones s WHERE s.ocid = cz.ocid);
