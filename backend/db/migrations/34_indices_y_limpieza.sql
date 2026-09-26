-- Vigía Perú · Migración 34 — Índices de FK, índices redundantes y triggers de alertas ─────────────
--
-- Auditoría técnica 2026-09-25: DB-10, DB-11, DB-12, DB-13 (y M6).
--
-- Qué hace:
--   1. Índices para dos FK que se recorren sin índice (DB-12):
--        · alertas (ocid)          → cola_auditoria (NOT EXISTS … a.ocid = c.ocid), borrado de convocatorias.
--        · asignaciones (alerta_id) → joins del ranking, /aliados, /impacto, borrado de alertas.
--   2. cerrar_procesamiento_por_alerta() (trigger AFTER INSERT de alertas, DB-10): comparaba
--      `ocid_corto(ocid) = ocid_corto(NEW.ocid)` contra procesamientos y asignaciones; asignaciones no
--      tiene índice para esa expresión (96 k seq scans en producción) y el UPDATE de contribuciones
--      recorría TODAS las 'en_proceso' con un count correlacionado. Ahora:
--        · busca por las formas posibles del OCID con `ocid = ANY(ARRAY[largo, corto, …])` (usa la PK
--          de procesamientos y el UNIQUE de asignaciones) y conserva `ocid_corto(ocid) = ocid_corto(NEW.ocid)`
--          como filtro, así el conjunto de filas es EXACTAMENTE el de antes;
--        · es SECURITY DEFINER (search_path = public, pg_temp): la API admin inserta alertas con su rol
--          propio (migración 37) sin UPDATE sobre procesamientos/asignaciones/contribuciones;
--        · cierra sólo las contribuciones de ese contrato. Único cambio de comportamiento: ya no "barre"
--          otras contribuciones 'en_proceso' que hubieran alcanzado su cupo por otra vía. Hoy no hay otra
--          vía (sólo este trigger escribe asignaciones.procesada_at) y en staging no hay ninguna en esa
--          situación (ver DB_LISTO.md).
--   3. Trigger duplicado (DB-13 / M6): trg_alertas_cerrar_asignacion (migración 09) hace un subconjunto
--      exacto de trg_alertas_cerrar_procesamiento: el mismo UPDATE de asignaciones (su WHERE
--      `ocid = NEW.ocid OR regexp_replace(ocid,'^ocds-dgv273-seacev3-','') = regexp_replace(NEW.ocid, …)`
--      selecciona las mismas filas que `ocid_corto(ocid) = ocid_corto(NEW.ocid)`: quitar ese prefijo de 20
--      caracteres es lo que hace ocid_corto) con los mismos valores (COALESCE: idempotente), y el mismo
--      UPDATE de contribuciones. Los dos son AFTER INSERT FOR EACH ROW; asignaciones y contribuciones no
--      tienen triggers que dependan de cuántas veces se escriben. Se borra el trigger (la función queda
--      por si hubiera que volver atrás:  CREATE TRIGGER trg_alertas_cerrar_asignacion AFTER INSERT ON
--      alertas FOR EACH ROW EXECUTE FUNCTION cerrar_asignacion_por_alerta();). Probado en staging dentro
--      de una transacción con ROLLBACK: mismo estado final con y sin el trigger.
--   4. Índices duplicados o prefijos redundantes (DB-11): cada uno se borra SÓLO si en esta base existe
--      el índice que lo cubre (mismo método, mismas columnas iniciales con el mismo opclass, orden y
--      collation, válido y sin WHERE). Si no, se deja y se avisa. Tamaños en producción (2026-09-25):
--        onpe_apt_nombre_trgm        11 MB  = idx_onpe_nombre_trgm (duplicado exacto)
--        visitas_visitante_trgm      18 MB  = idx_visitas_visitante_trgm (duplicado exacto)
--        idx_rnp_numdoc              28 MB  ⊂ idx_rnp_pe (numero_documento, ruc_empresa)
--        idx_visitas_doc            2,5 MB  ⊂ visitas_doc_fecha_idx (numero_documento, fecha_visita)
--        idx_visitas_entidad_norm   1,2 MB  ⊂ visitas_entidad_fecha_idx (entidad_visitada_norm, fecha_visita)
--        idx_sanc_ruc               584 kB  ⊂ osce_sancionados_ruc_res_uq (ruc, resolucion)
--        documentos_gcs_ocid_idx    280 kB  ⊂ documentos_gcs_ocid_sha256_key (ocid, sha256)
--        idx_items_ocid, idx_docs_ocid, idx_emppers_empresa (chicos) ⊂ sus UNIQUE compuestos
--        idx_reportes_fecha                 ⊂ reportes_fecha_created_idx (migración 33)
--      ≈ 62 MB menos que mantener en cada escritura. Se CONSERVA idx_banderas_alerta (alerta_id): lo
--      "cubre" el UNIQUE (alerta_id, regla, md5(evidencia)) de la 27, pero es el índice más usado de
--      banderas (≈1 M scans), pesa 16 kB y backend/agent/main_queries.py lo volvería a crear con otro nombre.
--   5. idx_conv_fechabp e idx_conv_region: 0 usos en producción desde el último reset de estadísticas.
--
-- Cómo aplicarla: psql (usa \gset / \if), fuera de una transacción y del lote nocturno:
--     psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/34_indices_y_limpieza.sql
-- CREATE/DROP INDEX CONCURRENTLY no bloquean lecturas ni escrituras (esperan a las transacciones
-- abiertas). lock_timeout 5 s para el bloque de triggers.
--
-- Cómo verificar:
--     SELECT indexrelid::regclass, indisvalid FROM pg_index
--      WHERE indexrelid IN ('alertas_ocid_idx'::regclass, 'asignaciones_alerta_idx'::regclass);
--     SELECT tgname FROM pg_trigger WHERE tgrelid = 'alertas'::regclass AND NOT tgisinternal;   -- sin trg_alertas_cerrar_asignacion
--     EXPLAIN UPDATE asignaciones SET procesada_at = procesada_at WHERE ocid = ANY(ARRAY['1','1']) AND ocid_corto(ocid) = '1';  -- Index Scan

\set ON_ERROR_STOP on
SET lock_timeout = '5s';

-- ── 1 · Índices de FK ────────────────────────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS alertas_ocid_idx ON alertas (ocid);
CREATE INDEX CONCURRENTLY IF NOT EXISTS asignaciones_alerta_idx ON asignaciones (alerta_id);

-- ── 2 y 3 · Trigger de cierre por alerta ─────────────────────────────────────────────────────────
BEGIN;

CREATE OR REPLACE FUNCTION cerrar_procesamiento_por_alerta() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_corto TEXT := ocid_corto(NEW.ocid);
  -- Formas posibles del OCID (como OCID_CANDIDATOS de la API): la del alerta, la corta y la larga.
  v_formas TEXT[] := ARRAY[NEW.ocid, v_corto, 'ocds-dgv273-seacev3-' || v_corto];
BEGIN
  IF NEW.ocid IS NULL THEN
    RETURN NEW;   -- antes tampoco cerraba nada: ocid_corto(NULL) no iguala a ninguna fila
  END IF;
  -- La alerta se persiste en el checkpoint (antes del dictamen): con worker vivo el cierre lo hace el
  -- dispatcher al recibir `final` (migración 20).
  UPDATE procesamientos SET estado = 'procesado', finalizado_at = now(), fase_actual = 'final', fase_index = 10, error = NULL
   WHERE ocid = ANY(v_formas) AND ocid_corto(ocid) = v_corto AND estado <> 'procesado'
     AND NOT (estado = 'procesando' AND worker IS NOT NULL AND latido_at >= now() - interval '2 minutes');
  UPDATE asignaciones SET procesada_at = COALESCE(procesada_at, now()), alerta_id = COALESCE(alerta_id, NEW.id)
   WHERE ocid = ANY(v_formas) AND ocid_corto(ocid) = v_corto;
  -- Sólo las contribuciones de este contrato (antes: todas las 'en_proceso', con un count por cada una).
  UPDATE contribuciones c SET estado = 'procesada'
   WHERE c.estado = 'en_proceso'
     AND c.id IN (SELECT s.contribucion_id FROM asignaciones s
                   WHERE s.ocid = ANY(v_formas) AND ocid_corto(s.ocid) = v_corto)
     AND (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = c.id AND s.procesada_at IS NOT NULL) >= c.contratos;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_alertas_cerrar_asignacion ON alertas;

DO $$
BEGIN
  IF to_regprocedure('cerrar_asignacion_por_alerta()') IS NOT NULL THEN
    EXECUTE $c$COMMENT ON FUNCTION cerrar_asignacion_por_alerta() IS
      'Sin trigger desde la migración 34: trg_alertas_cerrar_procesamiento hace lo mismo. Se conserva para poder volver atrás.'$c$;
  END IF;
END $$;

COMMIT;

-- ── 4 · Índices duplicados / prefijos redundantes (sólo si el que los cubre existe aquí) ──────────
CREATE OR REPLACE FUNCTION pg_temp.indice_cubierto(p_redundante TEXT, p_cubre TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
      FROM pg_index a
      JOIN pg_class ca ON ca.oid = a.indexrelid
      JOIN pg_am am    ON am.oid = ca.relam
      JOIN pg_index b  ON b.indrelid = a.indrelid AND b.indexrelid <> a.indexrelid
      JOIN pg_class cb ON cb.oid = b.indexrelid
     WHERE ca.relname = p_redundante AND ca.relnamespace = 'public'::regnamespace
       AND cb.relname = p_cubre      AND cb.relnamespace = 'public'::regnamespace
       AND cb.relam = ca.relam
       AND b.indisvalid AND b.indpred IS NULL AND a.indpred IS NULL AND a.indexprs IS NULL
       AND NOT a.indisunique
       AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = a.indexrelid)
       AND (am.amname = 'btree' OR a.indnkeyatts = b.indnkeyatts)
       AND a.indnkeyatts <= b.indnkeyatts
       AND (a.indkey::int2[])[0:a.indnkeyatts - 1]         = (b.indkey::int2[])[0:a.indnkeyatts - 1]
       AND (a.indclass::oid[])[0:a.indnkeyatts - 1]        = (b.indclass::oid[])[0:a.indnkeyatts - 1]
       AND (a.indoption::int2[])[0:a.indnkeyatts - 1]      = (b.indoption::int2[])[0:a.indnkeyatts - 1]
       AND (a.indcollation::oid[])[0:a.indnkeyatts - 1]    = (b.indcollation::oid[])[0:a.indnkeyatts - 1])
$$;

SELECT pg_temp.indice_cubierto('onpe_apt_nombre_trgm',     'idx_onpe_nombre_trgm')                      AS d01,
       pg_temp.indice_cubierto('visitas_visitante_trgm',   'idx_visitas_visitante_trgm')                AS d02,
       pg_temp.indice_cubierto('idx_rnp_numdoc',           'idx_rnp_pe')                                AS d03,
       pg_temp.indice_cubierto('idx_visitas_doc',          'visitas_doc_fecha_idx')                     AS d04,
       pg_temp.indice_cubierto('idx_visitas_entidad_norm', 'visitas_entidad_fecha_idx')                 AS d05,
       pg_temp.indice_cubierto('idx_sanc_ruc',             'osce_sancionados_ruc_res_uq')               AS d06,
       pg_temp.indice_cubierto('documentos_gcs_ocid_idx',  'documentos_gcs_ocid_sha256_key')            AS d07,
       pg_temp.indice_cubierto('idx_items_ocid',           'convocatoria_items_ocid_numero_item_key')   AS d08,
       pg_temp.indice_cubierto('idx_docs_ocid',            'documentos_ocid_blob_url_idx')              AS d09,
       pg_temp.indice_cubierto('idx_emppers_empresa',      'empresa_personas_empresa_ruc_persona_dni_rol_fecha_desde_key') AS d10,
       pg_temp.indice_cubierto('idx_reportes_fecha',       'reportes_fecha_created_idx')                AS d11
\gset

\if :d01
DROP INDEX CONCURRENTLY IF EXISTS onpe_apt_nombre_trgm;
\else
\echo 'Se conserva onpe_apt_nombre_trgm (no está o no lo cubre idx_onpe_nombre_trgm en esta base)'
\endif
\if :d02
DROP INDEX CONCURRENTLY IF EXISTS visitas_visitante_trgm;
\else
\echo 'Se conserva visitas_visitante_trgm (no está o no lo cubre idx_visitas_visitante_trgm en esta base)'
\endif
\if :d03
DROP INDEX CONCURRENTLY IF EXISTS idx_rnp_numdoc;
\else
\echo 'Se conserva idx_rnp_numdoc (no está o no lo cubre idx_rnp_pe en esta base)'
\endif
\if :d04
DROP INDEX CONCURRENTLY IF EXISTS idx_visitas_doc;
\else
\echo 'Se conserva idx_visitas_doc (no está o no lo cubre visitas_doc_fecha_idx en esta base)'
\endif
\if :d05
DROP INDEX CONCURRENTLY IF EXISTS idx_visitas_entidad_norm;
\else
\echo 'Se conserva idx_visitas_entidad_norm (no está o no lo cubre visitas_entidad_fecha_idx en esta base)'
\endif
\if :d06
DROP INDEX CONCURRENTLY IF EXISTS idx_sanc_ruc;
\else
\echo 'Se conserva idx_sanc_ruc (no está o no lo cubre osce_sancionados_ruc_res_uq en esta base)'
\endif
\if :d07
DROP INDEX CONCURRENTLY IF EXISTS documentos_gcs_ocid_idx;
\else
\echo 'Se conserva documentos_gcs_ocid_idx (no está o no lo cubre documentos_gcs_ocid_sha256_key en esta base)'
\endif
\if :d08
DROP INDEX CONCURRENTLY IF EXISTS idx_items_ocid;
\else
\echo 'Se conserva idx_items_ocid (no está o no lo cubre convocatoria_items_ocid_numero_item_key en esta base)'
\endif
\if :d09
DROP INDEX CONCURRENTLY IF EXISTS idx_docs_ocid;
\else
\echo 'Se conserva idx_docs_ocid (no está o no lo cubre documentos_ocid_blob_url_idx en esta base)'
\endif
\if :d10
DROP INDEX CONCURRENTLY IF EXISTS idx_emppers_empresa;
\else
\echo 'Se conserva idx_emppers_empresa (no está o no lo cubre su UNIQUE compuesto en esta base)'
\endif
\if :d11
DROP INDEX CONCURRENTLY IF EXISTS idx_reportes_fecha;
\else
\echo 'Se conserva idx_reportes_fecha (falta reportes_fecha_created_idx: aplicar antes la 33)'
\endif

-- ── 5 · Índices sin uso en convocatorias ─────────────────────────────────────────────────────────
DROP INDEX CONCURRENTLY IF EXISTS idx_conv_fechabp;
DROP INDEX CONCURRENTLY IF EXISTS idx_conv_region;

ANALYZE alertas;
ANALYZE asignaciones;
