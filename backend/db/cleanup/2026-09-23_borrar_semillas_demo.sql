-- ─────────────────────────────────────────────────────────────────────────────
-- 2026-09-23 · Borrar las SEMILLAS DE DEMO de la base de producción
--
-- NO SE CORRIÓ. Pedir confirmación a la persona responsable antes de ejecutarlo.
--
-- Qué borra (todo lo que backend/scripts/seed/seed_db.py sembró desde mocks.json y la API
-- mostraba como hechos reales):
--   · 10 alertas ALT-2026-0001..0010 (RUC y montos inventados sobre municipalidades reales)
--     + sus banderas, network_expansions y persona_flags (y desliga documentos.alerta_id).
--   · 3 convergencias CNV-2026-001..003.
--   · 6 denuncias RPT-2026-0042/0058/0061/0073/0080/0085 (fotos de banco de imágenes). Se listan
--     una por una: las denuncias reales también se numeran RPT-2026-…
--   · Claves *_mock de entidades.metadata (alertas_mock, reportes_mock, monto_mock, serie_mock,
--     score_promedio, contratos, contratos_vigilados). Ninguna otra ruta/script escribe esas claves
--     (ingest_oece_one.py solo escribe sunat_full / direccion_fiscal).
--   · Las 10 empresas "proveedoras" inventadas de esas alertas, SOLO si nada más las referencia y su
--     metadata es únicamente {"edad_ruc_dias_mock": …}; si no, se les quita esa clave y quedan.
-- Y además (punto 5 de la auditoría):
--   · contribuciones.mensaje_publico = NULL donde decía "Procesado desde el panel admin por <admin>…":
--     publicaba el nombre de quien operó el panel. Quién lo hizo sigue en contribuciones.validada_por
--     (columna interna) y en admin_log.
--
-- Qué NO toca (decisión aparte, ver bloque OPCIONAL al final):
--   · El "expediente Chira Piura" sembrado por seed_expediente(): convocatoria con OCID sintético
--     ocds-vigia-01/2026-GRP-PECHP-406000 + ítems/postores/ofertas/documentos inventados. La API ya
--     lo excluye (lib/publicacion.ts · convocatoriaNoDemo), pero sigue en la base.
--   · Las columnas nombre/tipo/region/provincia/distrito que seed_entidades() sobrescribió en 25
--     entidades reales (ON CONFLICT DO UPDATE): no hay de dónde restaurarlas acá.
--
-- Cómo correrlo:
--   psql "<conexión>" -v ON_ERROR_STOP=1 -f backend/db/cleanup/2026-09-23_borrar_semillas_demo.sql
--   Ensayo sin efecto: cambiar el COMMIT del final por ROLLBACK y leer los conteos ANTES/DESPUÉS.
--   Todo va en UNA transacción: si cualquier sentencia falla, no se aplica nada.
--   Después del COMMIT la API sigue filtrando las semillas (inocuo); se puede retirar el filtro luego.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Identificadores de demo (copiados de backend/scripts/seed/mocks.json) ────────────────────
CREATE TEMP TABLE _demo_alertas ON COMMIT DROP AS
  SELECT id, codigo FROM alertas
   WHERE codigo = ANY (ARRAY['ALT-2026-0001','ALT-2026-0002','ALT-2026-0003','ALT-2026-0004','ALT-2026-0005',
                             'ALT-2026-0006','ALT-2026-0007','ALT-2026-0008','ALT-2026-0009','ALT-2026-0010']);

CREATE TEMP TABLE _demo_reportes (id TEXT PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _demo_reportes (id) VALUES
  ('RPT-2026-0042'), ('RPT-2026-0058'), ('RPT-2026-0061'), ('RPT-2026-0073'), ('RPT-2026-0080'), ('RPT-2026-0085');

CREATE TEMP TABLE _demo_convergencias (id TEXT PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _demo_convergencias (id) VALUES ('CNV-2026-001'), ('CNV-2026-002'), ('CNV-2026-003');

-- RUC de los "proveedores" de las alertas de demo (mocks.json → alertas[].rucProveedor).
CREATE TEMP TABLE _demo_empresas (ruc CHAR(11) PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _demo_empresas (ruc) VALUES
  ('20602345678'), ('20611239402'), ('20603127480'), ('20602995118'), ('20612478819'),
  ('20612998001'), ('20613789012'), ('20614921770'), ('20614102983'), ('20602874119');

-- ── Conteos ANTES ────────────────────────────────────────────────────────────────────────────
SELECT 'ANTES' AS momento,
  (SELECT count(*) FROM _demo_alertas)                                                        AS alertas_demo,
  (SELECT count(*) FROM alertas WHERE codigo LIKE 'ALT-%')                                    AS alertas_prefijo_alt,
  (SELECT count(*) FROM banderas WHERE alerta_id IN (SELECT id FROM _demo_alertas))           AS banderas_demo,
  (SELECT count(*) FROM network_expansions WHERE alerta_id IN (SELECT id FROM _demo_alertas)) AS network_demo,
  (SELECT count(*) FROM persona_flags WHERE alerta_id IN (SELECT id FROM _demo_alertas))      AS persona_flags_demo,
  (SELECT count(*) FROM documentos WHERE alerta_id IN (SELECT id FROM _demo_alertas))         AS documentos_ligados_demo,
  (SELECT count(*) FROM asignaciones WHERE alerta_id IN (SELECT id FROM _demo_alertas))       AS asignaciones_ligadas_demo,
  (SELECT count(*) FROM convergencias
     WHERE id IN (SELECT id FROM _demo_convergencias)
        OR alerta_id IN (SELECT id FROM _demo_alertas))                                       AS convergencias_demo,
  (SELECT count(*) FROM reportes_indexados WHERE id IN (SELECT id FROM _demo_reportes))       AS reportes_demo,
  (SELECT count(*) FROM reportes_indexados
     WHERE convergencia_id IN (SELECT id FROM _demo_convergencias)
       AND id NOT IN (SELECT id FROM _demo_reportes))                                         AS reportes_reales_ligados_a_demo,
  (SELECT count(*) FROM entidades
     WHERE metadata ?| ARRAY['alertas_mock','reportes_mock','monto_mock','serie_mock',
                             'score_promedio','contratos','contratos_vigilados'])              AS entidades_con_claves_mock,
  (SELECT count(*) FROM empresas WHERE ruc IN (SELECT ruc FROM _demo_empresas))               AS empresas_demo,
  (SELECT count(*) FROM empresas WHERE metadata ? 'edad_ruc_dias_mock')                       AS empresas_con_clave_mock,
  (SELECT count(*) FROM contribuciones WHERE mensaje_publico LIKE 'Procesado desde el panel admin%') AS mensajes_admin_publicos,
  (SELECT count(*) FROM convocatorias WHERE ocid LIKE 'ocds-vigia-%')                         AS convocatorias_demo_no_se_tocan;

-- Detalle de lo que se va a borrar, para leerlo antes del COMMIT.
SELECT codigo, estado, score, entidad_ruc, proveedor_ruc FROM alertas
 WHERE id IN (SELECT id FROM _demo_alertas) ORDER BY codigo;
SELECT id, categoria, region, fecha, moderacion_estado FROM reportes_indexados
 WHERE id IN (SELECT id FROM _demo_reportes) ORDER BY id;

-- ── Salvaguardas: si algo no calza con lo esperado, se aborta todo ─────────────────────────────
DO $$
BEGIN
  IF (SELECT count(*) FROM _demo_alertas) > 10 THEN
    RAISE EXCEPTION 'Más de 10 alertas demo: revisar a mano antes de borrar';
  END IF;
  -- Una asignación de un aporte REAL apuntando a una alerta demo sería un dato real mezclado: no se
  -- decide acá (asignaciones.alerta_id no tiene ON DELETE, el DELETE fallaría igual).
  IF EXISTS (SELECT 1 FROM asignaciones WHERE alerta_id IN (SELECT id FROM _demo_alertas)) THEN
    RAISE EXCEPTION 'Hay asignaciones que apuntan a alertas demo: revisar a mano';
  END IF;
  IF EXISTS (SELECT 1 FROM alertas WHERE codigo LIKE 'ALT-%' AND id NOT IN (SELECT id FROM _demo_alertas)) THEN
    RAISE NOTICE 'Hay alertas ALT-%% fuera de la lista de demo: NO se borran (la API igual las oculta)';
  END IF;
END $$;

-- ── 1. Convergencias y denuncias de demo ─────────────────────────────────────────────────────
-- Una denuncia real que hubiera quedado ligada a una convergencia demo se desliga (no se borra).
UPDATE reportes_indexados SET convergencia_id = NULL
 WHERE convergencia_id IN (SELECT id FROM _demo_convergencias)
   AND id NOT IN (SELECT id FROM _demo_reportes);

DELETE FROM convergencias
 WHERE id IN (SELECT id FROM _demo_convergencias)
    OR alerta_id IN (SELECT id FROM _demo_alertas);

DELETE FROM reportes_indexados WHERE id IN (SELECT id FROM _demo_reportes);

-- ── 2. Dependientes de las alertas de demo (explícito, aunque varias FK tengan ON DELETE CASCADE) ──
DELETE FROM banderas           WHERE alerta_id IN (SELECT id FROM _demo_alertas);
DELETE FROM network_expansions WHERE alerta_id IN (SELECT id FROM _demo_alertas);
DELETE FROM persona_flags      WHERE alerta_id IN (SELECT id FROM _demo_alertas);
UPDATE documentos SET alerta_id = NULL WHERE alerta_id IN (SELECT id FROM _demo_alertas);  -- FK es ON DELETE SET NULL

-- ── 3. Las alertas de demo ────────────────────────────────────────────────────────────────────
DELETE FROM alertas WHERE id IN (SELECT id FROM _demo_alertas);

-- ── 4. Claves *_mock en entidades.metadata ────────────────────────────────────────────────────
UPDATE entidades
   SET metadata = metadata - ARRAY['alertas_mock','reportes_mock','monto_mock','serie_mock',
                                   'score_promedio','contratos','contratos_vigilados']::text[],
       updated_at = NOW()
 WHERE metadata ?| ARRAY['alertas_mock','reportes_mock','monto_mock','serie_mock',
                         'score_promedio','contratos','contratos_vigilados'];

-- ── 5. Empresas proveedoras inventadas ────────────────────────────────────────────────────────
-- Solo si su metadata es ÚNICAMENTE la clave mock (un RUC inventado podría coincidir con una empresa
-- real que otro proceso completó después) y nada las referencia. Va en un sub-bloque con EXCEPTION:
-- si alguna FK no prevista lo impide, se deja constancia y la transacción sigue sin borrarlas.
DO $$
DECLARE n INT;
BEGIN
  DELETE FROM empresas em
   WHERE em.ruc IN (SELECT ruc FROM _demo_empresas)
     AND em.metadata ? 'edad_ruc_dias_mock'
     AND (em.metadata - 'edad_ruc_dias_mock') = '{}'::jsonb
     AND NOT EXISTS (SELECT 1 FROM alertas a           WHERE a.proveedor_ruc = em.ruc)
     AND NOT EXISTS (SELECT 1 FROM postores p          WHERE p.empresa_ruc   = em.ruc)
     AND NOT EXISTS (SELECT 1 FROM empresa_personas ep WHERE ep.empresa_ruc  = em.ruc)
     AND NOT EXISTS (SELECT 1 FROM persona_flags pf    WHERE pf.empresa_ruc  = em.ruc)
     AND NOT EXISTS (SELECT 1 FROM penalidades pe      WHERE pe.empresa_ruc  = em.ruc);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Empresas demo borradas: %', n;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'Empresas demo NO borradas (otra tabla las referencia): %', SQLERRM;
END $$;

-- Las que quedan (reales o referenciadas) pierden la clave inventada.
UPDATE empresas SET metadata = metadata - 'edad_ruc_dias_mock'
 WHERE metadata ? 'edad_ruc_dias_mock';

-- ── 6. Mensaje público de los aportes procesados desde el panel admin ─────────────────────────
UPDATE contribuciones SET mensaje_publico = NULL
 WHERE mensaje_publico LIKE 'Procesado desde el panel admin%';

-- ── Conteos DESPUÉS (todo en 0 salvo alertas_prefijo_alt si hubo ALT-% fuera de la lista,
--    empresas_demo si alguna quedó referenciada, y las convocatorias demo que no se tocan) ─────
SELECT 'DESPUÉS' AS momento,
  (SELECT count(*) FROM alertas WHERE id IN (SELECT id FROM _demo_alertas))                   AS alertas_demo,
  (SELECT count(*) FROM alertas WHERE codigo LIKE 'ALT-%')                                    AS alertas_prefijo_alt,
  (SELECT count(*) FROM banderas WHERE alerta_id IN (SELECT id FROM _demo_alertas))           AS banderas_demo,
  (SELECT count(*) FROM network_expansions WHERE alerta_id IN (SELECT id FROM _demo_alertas)) AS network_demo,
  (SELECT count(*) FROM persona_flags WHERE alerta_id IN (SELECT id FROM _demo_alertas))      AS persona_flags_demo,
  (SELECT count(*) FROM documentos WHERE alerta_id IN (SELECT id FROM _demo_alertas))         AS documentos_ligados_demo,
  (SELECT count(*) FROM convergencias
     WHERE id IN (SELECT id FROM _demo_convergencias)
        OR alerta_id IN (SELECT id FROM _demo_alertas))                                       AS convergencias_demo,
  (SELECT count(*) FROM reportes_indexados WHERE id IN (SELECT id FROM _demo_reportes))       AS reportes_demo,
  (SELECT count(*) FROM reportes_indexados
     WHERE convergencia_id IN (SELECT id FROM _demo_convergencias))                           AS reportes_ligados_a_demo,
  (SELECT count(*) FROM entidades
     WHERE metadata ?| ARRAY['alertas_mock','reportes_mock','monto_mock','serie_mock',
                             'score_promedio','contratos','contratos_vigilados'])              AS entidades_con_claves_mock,
  (SELECT count(*) FROM empresas WHERE ruc IN (SELECT ruc FROM _demo_empresas))               AS empresas_demo,
  (SELECT count(*) FROM empresas WHERE metadata ? 'edad_ruc_dias_mock')                       AS empresas_con_clave_mock,
  (SELECT count(*) FROM contribuciones WHERE mensaje_publico LIKE 'Procesado desde el panel admin%') AS mensajes_admin_publicos,
  (SELECT count(*) FROM convocatorias WHERE ocid LIKE 'ocds-vigia-%')                         AS convocatorias_demo_no_se_tocan;

-- Ensayo: cambiar por ROLLBACK;
COMMIT;


-- ─────────────────────────────────────────────────────────────────────────────
-- OPCIONAL (no se ejecuta: está comentado) · la convocatoria sembrada "expediente Chira Piura"
-- (ocds-vigia-01/2026-GRP-PECHP-406000). Ítems, postores (→ ofertas) y documentos caen por
-- ON DELETE CASCADE. alertas.ocid, asignaciones.ocid y procesamientos.ocid NO tienen cascade: si
-- alguna apunta a ella, el DELETE falla y no se borra nada (revisar a mano en ese caso).
-- ─────────────────────────────────────────────────────────────────────────────
-- BEGIN;
-- SELECT ocid, codigo, objeto FROM convocatorias WHERE ocid LIKE 'ocds-vigia-%';
-- SELECT
--   (SELECT count(*) FROM convocatoria_items WHERE ocid LIKE 'ocds-vigia-%') AS items,
--   (SELECT count(*) FROM postores           WHERE ocid LIKE 'ocds-vigia-%') AS postores,
--   (SELECT count(*) FROM documentos         WHERE ocid LIKE 'ocds-vigia-%') AS documentos,
--   (SELECT count(*) FROM alertas            WHERE ocid LIKE 'ocds-vigia-%') AS alertas,
--   (SELECT count(*) FROM asignaciones       WHERE ocid LIKE 'ocds-vigia-%') AS asignaciones,
--   (SELECT count(*) FROM procesamientos     WHERE ocid LIKE 'ocds-vigia-%') AS procesamientos;
-- DELETE FROM convocatorias WHERE ocid LIKE 'ocds-vigia-%';
-- COMMIT;   -- o ROLLBACK para ensayar
