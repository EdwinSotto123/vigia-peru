-- 71 · Las adjudicaciones del OCDS en cada convocatoria, aunque el payload esté recortado.
--
-- oece_ocds guarda un `ocds_payload` recortado (ocid, id, date, tag, buyer, tender): sin `awards`, la ficha de un
-- contrato que no tiene su record completo (casi todos los que no pasaron por la cola, y toda la historia desde
-- 2015) decía "Sin adjudicar todavía" aunque tuviera ganador. `adjudicaciones` guarda las adjudicaciones
-- recortadas (id, fecha, estado, monto, proveedores, ids de ítems) y la API las usa cuando el payload no las trae.
-- Los cruces siguen leyendo `ocds_payload->'awards'` (el record completo de los contratos de la cola): así no se
-- multiplica su costo con la historia.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/71_convocatorias_adjudicaciones.sql

ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS adjudicaciones JSONB;
COMMENT ON COLUMN convocatorias.adjudicaciones IS
  'Adjudicaciones del release OCDS, recortadas (id, date, status, value, suppliers{id,name}, items{id}); oece_ocds. '
  'La API las usa si ocds_payload no trae awards.';
