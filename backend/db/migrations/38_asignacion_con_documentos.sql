-- 38_asignacion_con_documentos.sql — un aporte solo toma contratos con documentos listos (y, si se pide,
-- solo de ciertos tipos).
--
-- Problema: `asignar_contribucion()` tomaba de `cola_auditoria` por antigüedad sin mirar los documentos.
-- Los contratos sin documentos en GCS quedaban `esperando_documentos` hasta que el batch nocturno (una PC
-- en Lima, única salida que el OECE acepta) los bajara: el 29/09/2026 había 47 así, todos de aportes
-- institucionales, mientras 1.359 contratos de la cola ya tenían sus documentos.
--
-- Qué hace:
--   1. `contribuciones.solo_con_documentos` (por defecto true, también para los aportes ciudadanos) y
--      `contribuciones.tipos` (NULL = los tipos activos de `ajustes.procesamiento`, como antes).
--   2. `documentos_listos(ocid)`: el mismo criterio que usa el dispatcher (`documentos_vigentes`): al
--      menos un documento en GCS sin borrar ni vencer.
--   3. `asignar_contribucion()` respeta las dos columnas, sigue siendo FIFO dentro de lo elegible
--      ("nadie elige contratos") y, si no alcanzan los contratos listos, pide la descarga de los
--      siguientes de la fila SIN asignarlos: el batch los baja y el cron de asignación (cada 10 min)
--      completa el aporte cuando ya tengan documentos.
--
-- Verificación:
--   SELECT solo_con_documentos, tipos FROM contribuciones ORDER BY id DESC LIMIT 3;
--   SELECT count(*) FROM asignaciones a JOIN contribuciones c ON c.id = a.contribucion_id
--    WHERE c.solo_con_documentos AND NOT documentos_listos(a.ocid) AND a.created_at > '<fecha de la 38>';  → 0
-- Idempotente: ADD COLUMN IF NOT EXISTS y CREATE OR REPLACE.

ALTER TABLE contribuciones ADD COLUMN IF NOT EXISTS solo_con_documentos BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE contribuciones ADD COLUMN IF NOT EXISTS tipos TEXT[];

COMMENT ON COLUMN contribuciones.solo_con_documentos IS
  'Solo asignar contratos con documentos vigentes en GCS (documentos_listos). Los que faltan se piden al batch.';
COMMENT ON COLUMN contribuciones.tipos IS
  'Tipos de contratación elegibles (p. ej. {bienes}). NULL: los tipos activos de ajustes.procesamiento.';

CREATE OR REPLACE FUNCTION documentos_listos(p_ocid TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM documentos_gcs d
                  WHERE ocid_corto(d.ocid) = ocid_corto(p_ocid) AND d.borrado_at IS NULL AND d.expira_at > now())
$$;

CREATE OR REPLACE FUNCTION asignar_contribucion(p_contribucion_id BIGINT) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ubigeo     TEXT;
  v_total      INT;
  v_solo       BOOLEAN;
  v_tipos      TEXT[];
  v_ya         INT;
  v_insertados INT;
  v_faltan     INT;
BEGIN
  SELECT ubigeo, contratos, solo_con_documentos, tipos INTO v_ubigeo, v_total, v_solo, v_tipos
  FROM contribuciones WHERE id = p_contribucion_id AND estado IN ('pagada','en_proceso');
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT count(*) INTO v_ya FROM asignaciones WHERE contribucion_id = p_contribucion_id;
  IF v_ya >= v_total THEN RETURN 0; END IF;

  INSERT INTO asignaciones (contribucion_id, ocid)
  SELECT p_contribucion_id, q.ocid
  FROM cola_auditoria q
  JOIN convocatorias c ON c.ocid = q.ocid
  WHERE q.ubigeo LIKE v_ubigeo || '%'
    AND (v_tipos IS NULL OR c.tipo_contratacion = ANY (v_tipos))
    AND (NOT v_solo OR documentos_listos(q.ocid))
  ORDER BY q.fecha_convocatoria NULLS LAST, q.ocid
  LIMIT (v_total - v_ya)
  ON CONFLICT (ocid) DO NOTHING;
  GET DIAGNOSTICS v_insertados = ROW_COUNT;

  -- No alcanzaron los contratos listos: pedir los siguientes de la fila al batch, sin asignarlos.
  -- pedir_descarga() no duplica pedidos abiertos, así que repetirlo en cada corrida del cron no suma.
  v_faltan := v_total - v_ya - v_insertados;
  IF v_solo AND v_faltan > 0 THEN
    PERFORM pedir_descarga(s.ocid, 'financiado')
    FROM (SELECT q.ocid
          FROM cola_auditoria q
          JOIN convocatorias c ON c.ocid = q.ocid
          WHERE q.ubigeo LIKE v_ubigeo || '%'
            AND (v_tipos IS NULL OR c.tipo_contratacion = ANY (v_tipos))
            AND NOT documentos_listos(q.ocid)
          ORDER BY q.fecha_convocatoria NULLS LAST, q.ocid
          LIMIT v_faltan) s;
  END IF;

  IF v_insertados > 0 THEN
    UPDATE contribuciones SET estado = 'en_proceso' WHERE id = p_contribucion_id AND estado = 'pagada';
  END IF;
  RETURN v_insertados;
END $$;

-- Mismos permisos que antes (CREATE OR REPLACE los conserva; esto es por si se crea de cero).
REVOKE ALL ON FUNCTION asignar_contribucion(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION asignar_contribucion(BIGINT) TO vigia_api_admin;
GRANT EXECUTE ON FUNCTION documentos_listos(TEXT) TO vigia_api, vigia_api_admin, vigia_dispatcher;
