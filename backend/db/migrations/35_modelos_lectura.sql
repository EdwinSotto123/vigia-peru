-- Vigía Perú · Migración 35 — Modelos de lectura de contratos, entidades y señales (fase 2) ───────
--
-- Auditoría técnica 2026-09-25: C9, DB-1, DB-7. Hoy /contratos, /contratos/resumen, /contratos/geo,
-- /entidades y /buscar recorren las ~18 k convocatorias en cada request (count(*) OVER(), CASE por
-- fila, GROUP BY de toda la tabla, seq scan por código). A 1 M de contratos son segundos por request.
-- Principio: un request público cuesta según el tamaño de la página, no según el total de filas.
--
-- Qué crea (detalle de columnas y SQL de referencia para la API: DB_LISTO.md):
--   1. contrato_estado (1:1 con convocatorias). Estado derivado con la MISMA semántica que las CASE de
--      backend/api/src/routes/contratos.ts (riesgo, estadoProc, operativo, score público) + la alerta
--      elegida + columnas espejo de convocatorias (zona, tipo, etapa, entidad, fecha, alta, monto) para
--      que la paginación por score y los agregados lean una tabla angosta y no el heap de convocatorias
--      (≈1,7 GB a 1 M de filas por el ocds_payload). La verdad está en la vista
--      contrato_estado_calculado; la tabla la mantienen triggers:
--        · convocatorias (por sentencia, con tablas de transición: la ingesta escribe de a 500 filas),
--        · alertas y procesamientos (por fila, sólo si cambia una columna que influye),
--        · documentos_gcs (por sentencia), ajustes 'procesamiento' (recalcula todo: cambia el alcance),
--        · y el reloj: un documento que vence cambia `operativo` sin que nadie escriba. Lo barre
--          contrato_estado_vencidos(), que corre dentro de refresh_financiamiento[_si_hace_falta]().
--      banderas y pedidos_descarga NO influyen en esas columnas (no llevan trigger).
--   2. contratos_agregado (matview): n, n_revision y monto por (zona, tipo, etapa, mes, riesgo,
--      estado_proc, operativo). Sirve total, /resumen y /geo en O(grupos).
--   3. entidad_stats (matview): una fila por entidad con contratos, alertas activas/publicadas, monto
--      y score, más nombre normalizado con índice trigram. Sirve /entidades y /buscar.
--   4. Índices keyset en convocatorias (fecha y monto), prefijo de código (upper(codigo)) y de OCID
--      corto (text_pattern_ops: la collation es en_US.utf8), y los de contrato_estado.
--   5. senales_publicas (vista): una fila por bandera de alerta publicada (misma regla que
--      lib/publicacion.ts) con todo lo que hoy arma frontend/lib/revision.ts.
--   6. Refresco: grupo de derivados 'contratos' (contratos_agregado + entidad_stats) dentro de
--      refresh_financiamiento() (siempre) y refresh_financiamiento_si_hace_falta() (si hay marcas).
--   7. immutable_unaccent() llama a public.unaccent: con el search_path vacío de un pg_restore, el
--      REFRESH de entidad_stats fallaba (mismo problema que procesamiento_activo en la 32).
--   Las funciones de trigger y de refresco son SECURITY DEFINER (search_path = public, pg_temp), como en la
--   32: los roles de la 37 escriben convocatorias/alertas/… sin permisos sobre contrato_estado ni derivados_*.
--
-- Cómo aplicarla (psql, fuera del lote nocturno; NO en una sola transacción: hay CONCURRENTLY):
--     psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/35_modelos_lectura.sql
-- Requiere la 28 (convocatorias_ocid_corto_idx) y la 32 (ubigeo_zona, derivados_*).
-- lock_timeout 5 s. El bloque de triggers + backfill de contrato_estado toma SHARE ROW EXCLUSIVE sobre
-- convocatorias/alertas/procesamientos/documentos_gcs/ajustes (bloquea escrituras, no lecturas) lo
-- que tarda el backfill (18 k filas: ~1 s en staging).
--
-- Cómo verificar (todo debe dar 0):
--     SELECT count(*) FROM (SELECT * FROM contrato_estado_calculado EXCEPT
--                           SELECT ocid, riesgo, score, estado_proc, operativo, alerta_id, alerta_codigo, alerta_estado,
--                                  ubigeo_zona, tipo, etapa, entidad_ruc, fecha_convocatoria, created_at, monto
--                             FROM contrato_estado) x;
--     SELECT (SELECT count(*) FROM convocatorias) - (SELECT count(*) FROM contrato_estado);
--     SELECT (SELECT count(*) FROM convocatorias WHERE ocid NOT LIKE 'ocds-vigia-%') - (SELECT sum(n) FROM contratos_agregado);
--     SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;

\set ON_ERROR_STOP on
SET lock_timeout = '5s';

BEGIN;

-- ── 7 · unaccent calificado (misma salida; IMMUTABLE PARALLEL SAFE como antes) ────────────────────
CREATE OR REPLACE FUNCTION immutable_unaccent(TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- ── 1 · contrato_estado ──────────────────────────────────────────────────────────────────────────
-- Alcance activo con la semántica de alcanceActivo() de contratos.ts: si `ajustes.procesamiento` trae
-- tipos_activos y etapas_activas como arreglos, se toman sus textos que estén en las listas blancas
-- TIPOS_OK / ETAPAS_OK; si no (o no hay fila), todo lo de las listas blancas.
CREATE OR REPLACE FUNCTION alcance_contratos(OUT tipos TEXT[], OUT etapas TEXT[])
LANGUAGE sql STABLE AS $$
  WITH v AS (SELECT (SELECT a.valor FROM public.ajustes a WHERE a.clave = 'procesamiento') AS valor),
  ok AS (SELECT ARRAY['bienes','servicios','consultoria','obras','convenio','directa','otro']::text[] AS tipos,
                ARRAY['planificacion','convocada','adjudicada','contratada','en_ejecucion','finalizada',
                      'desierta','cancelada','nula','desconocida']::text[] AS etapas)
  SELECT CASE WHEN jsonb_typeof(v.valor->'tipos_activos') = 'array' AND jsonb_typeof(v.valor->'etapas_activas') = 'array'
              THEN ARRAY(SELECT x #>> '{}' FROM jsonb_array_elements(v.valor->'tipos_activos') x
                          WHERE jsonb_typeof(x) = 'string' AND (x #>> '{}') = ANY(ok.tipos))
              ELSE ok.tipos END,
         CASE WHEN jsonb_typeof(v.valor->'tipos_activos') = 'array' AND jsonb_typeof(v.valor->'etapas_activas') = 'array'
              THEN ARRAY(SELECT x #>> '{}' FROM jsonb_array_elements(v.valor->'etapas_activas') x
                          WHERE jsonb_typeof(x) = 'string' AND (x #>> '{}') = ANY(ok.etapas))
              ELSE ok.etapas END
  FROM v, ok
$$;

CREATE TABLE IF NOT EXISTS contrato_estado (
  ocid               TEXT PRIMARY KEY REFERENCES convocatorias (ocid) ON DELETE CASCADE ON UPDATE CASCADE,
  riesgo             TEXT NOT NULL,          -- alto | medio | bajo | sin_analizar | en_revision | descartado
  score              INT,                    -- score PÚBLICO: sólo si la alerta está publicada
  estado_proc        TEXT NOT NULL,          -- procesamientos.estado | procesado | pendiente_de_procesamiento | sin_analizar
  operativo          TEXT NOT NULL,          -- en_cola | documentos_listos | sin_documentos
  alerta_id          UUID,                   -- alerta elegida (la más reciente, no demo); sin FK a propósito
  alerta_codigo      TEXT,
  alerta_estado      TEXT,                   -- activa | confirmada | revision | descartada | …
  -- Espejo de convocatorias (lo mantiene el trigger; no escribir a mano)
  ubigeo_zona        TEXT,
  tipo               TEXT,                   -- COALESCE(tipo_contratacion, categoria → bienes/servicios/obras)
  etapa              TEXT,
  entidad_ruc        CHAR(11),
  fecha_convocatoria DATE,
  created_at         TIMESTAMPTZ,
  monto              NUMERIC,                -- cuantia_referencial
  actualizado_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE contrato_estado IS
  'Estado derivado de cada convocatoria (riesgo, score público, estado de procesamiento, estado operativo) + espejo '
  'de columnas para listar y agregar. Semántica = contratos.ts. La mantienen triggers (migración 35); la verdad es '
  'la vista contrato_estado_calculado.';

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
       CASE WHEN c.tipo_contratacion = ANY(al.tipos) AND c.etapa = ANY(al.etapas) THEN 'en_cola'
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
CROSS JOIN alcance_contratos() al
-- La alerta de cada convocatoria: la más reciente, sin semillas de demo (ALERTA_LATERAL de contratos.ts).
LEFT JOIN LATERAL (
  SELECT a.id, a.codigo, a.score, a.estado FROM alertas a
   WHERE a.ocid IS NOT NULL AND ocid_corto(a.ocid) = ocid_corto(c.ocid) AND a.codigo NOT LIKE 'ALT-%'
   ORDER BY a.analizado_en DESC NULLS LAST, a.created_at DESC, a.id
   LIMIT 1) a ON TRUE
LEFT JOIN procesamientos p ON p.ocid = c.ocid;

-- Recalcula las convocatorias dadas; sólo escribe las filas que cambian. Devuelve cuántas escribió.
CREATE OR REPLACE FUNCTION contrato_estado_recalcular(p_ocids TEXT[]) RETURNS INT
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE n INT;
BEGIN
  IF p_ocids IS NULL OR cardinality(p_ocids) = 0 THEN
    RETURN 0;
  END IF;
  INSERT INTO contrato_estado AS ce (ocid, riesgo, score, estado_proc, operativo, alerta_id, alerta_codigo, alerta_estado,
                                     ubigeo_zona, tipo, etapa, entidad_ruc, fecha_convocatoria, created_at, monto)
  SELECT v.ocid, v.riesgo, v.score, v.estado_proc, v.operativo, v.alerta_id, v.alerta_codigo, v.alerta_estado,
         v.ubigeo_zona, v.tipo, v.etapa, v.entidad_ruc, v.fecha_convocatoria, v.created_at, v.monto
    FROM contrato_estado_calculado v
   WHERE v.ocid = ANY(p_ocids)
  ON CONFLICT (ocid) DO UPDATE SET
    riesgo = EXCLUDED.riesgo, score = EXCLUDED.score, estado_proc = EXCLUDED.estado_proc, operativo = EXCLUDED.operativo,
    alerta_id = EXCLUDED.alerta_id, alerta_codigo = EXCLUDED.alerta_codigo, alerta_estado = EXCLUDED.alerta_estado,
    ubigeo_zona = EXCLUDED.ubigeo_zona, tipo = EXCLUDED.tipo, etapa = EXCLUDED.etapa, entidad_ruc = EXCLUDED.entidad_ruc,
    fecha_convocatoria = EXCLUDED.fecha_convocatoria, created_at = EXCLUDED.created_at, monto = EXCLUDED.monto,
    actualizado_at = now()
  WHERE (ce.riesgo, ce.score, ce.estado_proc, ce.operativo, ce.alerta_id, ce.alerta_codigo, ce.alerta_estado,
         ce.ubigeo_zona, ce.tipo, ce.etapa, ce.entidad_ruc, ce.fecha_convocatoria, ce.created_at, ce.monto)
        IS DISTINCT FROM
        (EXCLUDED.riesgo, EXCLUDED.score, EXCLUDED.estado_proc, EXCLUDED.operativo, EXCLUDED.alerta_id,
         EXCLUDED.alerta_codigo, EXCLUDED.alerta_estado, EXCLUDED.ubigeo_zona, EXCLUDED.tipo, EXCLUDED.etapa,
         EXCLUDED.entidad_ruc, EXCLUDED.fecha_convocatoria, EXCLUDED.created_at, EXCLUDED.monto);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Todo (backfill y cambio de alcance). Mismo cuerpo sin filtro: una sentencia con su propio plan.
CREATE OR REPLACE FUNCTION contrato_estado_recalcular_todo() RETURNS INT
LANGUAGE plpgsql SET search_path = public SET work_mem = '32MB' AS $$
DECLARE n INT;
BEGIN
  INSERT INTO contrato_estado AS ce (ocid, riesgo, score, estado_proc, operativo, alerta_id, alerta_codigo, alerta_estado,
                                     ubigeo_zona, tipo, etapa, entidad_ruc, fecha_convocatoria, created_at, monto)
  SELECT v.ocid, v.riesgo, v.score, v.estado_proc, v.operativo, v.alerta_id, v.alerta_codigo, v.alerta_estado,
         v.ubigeo_zona, v.tipo, v.etapa, v.entidad_ruc, v.fecha_convocatoria, v.created_at, v.monto
    FROM contrato_estado_calculado v
  ON CONFLICT (ocid) DO UPDATE SET
    riesgo = EXCLUDED.riesgo, score = EXCLUDED.score, estado_proc = EXCLUDED.estado_proc, operativo = EXCLUDED.operativo,
    alerta_id = EXCLUDED.alerta_id, alerta_codigo = EXCLUDED.alerta_codigo, alerta_estado = EXCLUDED.alerta_estado,
    ubigeo_zona = EXCLUDED.ubigeo_zona, tipo = EXCLUDED.tipo, etapa = EXCLUDED.etapa, entidad_ruc = EXCLUDED.entidad_ruc,
    fecha_convocatoria = EXCLUDED.fecha_convocatoria, created_at = EXCLUDED.created_at, monto = EXCLUDED.monto,
    actualizado_at = now()
  WHERE (ce.riesgo, ce.score, ce.estado_proc, ce.operativo, ce.alerta_id, ce.alerta_codigo, ce.alerta_estado,
         ce.ubigeo_zona, ce.tipo, ce.etapa, ce.entidad_ruc, ce.fecha_convocatoria, ce.created_at, ce.monto)
        IS DISTINCT FROM
        (EXCLUDED.riesgo, EXCLUDED.score, EXCLUDED.estado_proc, EXCLUDED.operativo, EXCLUDED.alerta_id,
         EXCLUDED.alerta_codigo, EXCLUDED.alerta_estado, EXCLUDED.ubigeo_zona, EXCLUDED.tipo, EXCLUDED.etapa,
         EXCLUDED.entidad_ruc, EXCLUDED.fecha_convocatoria, EXCLUDED.created_at, EXCLUDED.monto);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- convocatorias: por sentencia (la ingesta escribe de a 500 con execute_values).
CREATE OR REPLACE FUNCTION contrato_estado_convocatorias_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM contrato_estado_recalcular(ARRAY(SELECT n.ocid FROM nuevas n));
  ELSE
    PERFORM contrato_estado_recalcular(ARRAY(
      SELECT n.ocid FROM nuevas n LEFT JOIN viejas o ON o.ocid = n.ocid
       WHERE o.ocid IS NULL
          OR (n.procesable, n.tipo_contratacion, n.categoria, n.etapa, n.ubigeo_zona, n.entidad_ruc,
              n.fecha_convocatoria, n.created_at, n.cuantia_referencial)
             IS DISTINCT FROM
             (o.procesable, o.tipo_contratacion, o.categoria, o.etapa, o.ubigeo_zona, o.entidad_ruc,
              o.fecha_convocatoria, o.created_at, o.cuantia_referencial)));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_contrato_estado_conv_ins ON convocatorias;
CREATE TRIGGER trg_contrato_estado_conv_ins AFTER INSERT ON convocatorias
  REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION contrato_estado_convocatorias_trg();
DROP TRIGGER IF EXISTS trg_contrato_estado_conv_upd ON convocatorias;
CREATE TRIGGER trg_contrato_estado_conv_upd AFTER UPDATE ON convocatorias
  REFERENCING OLD TABLE AS viejas NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION contrato_estado_convocatorias_trg();

-- alertas: por fila. La alerta se une por OCID corto (índice de la 28 sobre convocatorias).
CREATE OR REPLACE FUNCTION contrato_estado_alertas_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v TEXT[] := ARRAY[]::text[];
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.ocid IS NOT NULL THEN v := v || ocid_corto(NEW.ocid); END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.ocid IS NOT NULL THEN v := v || ocid_corto(OLD.ocid); END IF;
  IF cardinality(v) > 0 THEN
    PERFORM contrato_estado_recalcular(ARRAY(SELECT c.ocid FROM convocatorias c WHERE ocid_corto(c.ocid) = ANY(v)));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_contrato_estado_alertas ON alertas;
CREATE TRIGGER trg_contrato_estado_alertas AFTER INSERT OR DELETE ON alertas
  FOR EACH ROW EXECUTE FUNCTION contrato_estado_alertas_trg();
DROP TRIGGER IF EXISTS trg_contrato_estado_alertas_upd ON alertas;
CREATE TRIGGER trg_contrato_estado_alertas_upd AFTER UPDATE OF ocid, codigo, estado, score, analizado_en, created_at ON alertas
  FOR EACH ROW WHEN (OLD.ocid IS DISTINCT FROM NEW.ocid OR OLD.codigo IS DISTINCT FROM NEW.codigo
                     OR OLD.estado IS DISTINCT FROM NEW.estado OR OLD.score IS DISTINCT FROM NEW.score
                     OR OLD.analizado_en IS DISTINCT FROM NEW.analizado_en OR OLD.created_at IS DISTINCT FROM NEW.created_at)
  EXECUTE FUNCTION contrato_estado_alertas_trg();

-- procesamientos: por fila, sólo cuando cambia el estado (el latido de cada 30 s no dispara nada).
CREATE OR REPLACE FUNCTION contrato_estado_procesamientos_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v TEXT[] := ARRAY[]::text[];
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v := v || NEW.ocid; END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v := v || OLD.ocid; END IF;
  PERFORM contrato_estado_recalcular(v);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_contrato_estado_proc ON procesamientos;
CREATE TRIGGER trg_contrato_estado_proc AFTER INSERT OR DELETE ON procesamientos
  FOR EACH ROW EXECUTE FUNCTION contrato_estado_procesamientos_trg();
DROP TRIGGER IF EXISTS trg_contrato_estado_proc_upd ON procesamientos;
CREATE TRIGGER trg_contrato_estado_proc_upd AFTER UPDATE OF estado, ocid ON procesamientos
  FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado OR OLD.ocid IS DISTINCT FROM NEW.ocid)
  EXECUTE FUNCTION contrato_estado_procesamientos_trg();

-- documentos_gcs: por sentencia (la ingesta de documentos escribe de a 500).
CREATE OR REPLACE FUNCTION contrato_estado_documentos_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM contrato_estado_recalcular(ARRAY(SELECT DISTINCT n.ocid FROM nuevas n));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM contrato_estado_recalcular(ARRAY(SELECT DISTINCT o.ocid FROM viejas o));
  ELSE
    PERFORM contrato_estado_recalcular(ARRAY(
      SELECT x.ocid FROM (
        SELECT n.ocid, o.ocid AS ocid_viejo FROM nuevas n JOIN viejas o ON o.id = n.id
         WHERE (n.ocid, n.borrado_at, n.expira_at) IS DISTINCT FROM (o.ocid, o.borrado_at, o.expira_at)) d
      CROSS JOIN LATERAL (VALUES (d.ocid), (d.ocid_viejo)) x(ocid)
      GROUP BY x.ocid));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_contrato_estado_docs_ins ON documentos_gcs;
CREATE TRIGGER trg_contrato_estado_docs_ins AFTER INSERT ON documentos_gcs
  REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION contrato_estado_documentos_trg();
DROP TRIGGER IF EXISTS trg_contrato_estado_docs_upd ON documentos_gcs;
CREATE TRIGGER trg_contrato_estado_docs_upd AFTER UPDATE ON documentos_gcs
  REFERENCING OLD TABLE AS viejas NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION contrato_estado_documentos_trg();
DROP TRIGGER IF EXISTS trg_contrato_estado_docs_del ON documentos_gcs;
CREATE TRIGGER trg_contrato_estado_docs_del AFTER DELETE ON documentos_gcs
  REFERENCING OLD TABLE AS viejas FOR EACH STATEMENT EXECUTE FUNCTION contrato_estado_documentos_trg();

-- ajustes 'procesamiento': cambia el alcance activo → `operativo` de todas las filas.
CREATE OR REPLACE FUNCTION contrato_estado_ajustes_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM contrato_estado_recalcular_todo();
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_contrato_estado_ajustes ON ajustes;
CREATE TRIGGER trg_contrato_estado_ajustes AFTER INSERT OR UPDATE ON ajustes
  FOR EACH ROW WHEN (NEW.clave = 'procesamiento') EXECUTE FUNCTION contrato_estado_ajustes_trg();
DROP TRIGGER IF EXISTS trg_contrato_estado_ajustes_del ON ajustes;
CREATE TRIGGER trg_contrato_estado_ajustes_del AFTER DELETE ON ajustes
  FOR EACH ROW WHEN (OLD.clave = 'procesamiento') EXECUTE FUNCTION contrato_estado_ajustes_trg();

-- Backfill (los triggers ya están: nada que entre ahora queda afuera).
SELECT contrato_estado_recalcular_todo();

CREATE INDEX IF NOT EXISTS contrato_estado_riesgo_idx    ON contrato_estado (riesgo)      WHERE riesgo <> 'sin_analizar';
CREATE INDEX IF NOT EXISTS contrato_estado_estado_idx    ON contrato_estado (estado_proc) WHERE estado_proc <> 'sin_analizar';
CREATE INDEX IF NOT EXISTS contrato_estado_operativo_idx ON contrato_estado (operativo)   WHERE operativo <> 'sin_documentos';
-- orden=score: score DESC NULLS LAST, fecha DESC NULLS LAST, alta DESC, ocid DESC (keyset en una tabla).
CREATE INDEX IF NOT EXISTS contrato_estado_keyset_score_idx ON contrato_estado
  ((COALESCE(score, -1)) DESC, (COALESCE(fecha_convocatoria, '-infinity'::date)) DESC, created_at DESC, ocid DESC);
-- filtro por tipo con orden por fecha (tipos raros: directa, convenio) sin recorrer toda la tabla.
CREATE INDEX IF NOT EXISTS contrato_estado_tipo_fecha_idx ON contrato_estado
  (tipo, (COALESCE(fecha_convocatoria, '-infinity'::date)) DESC, created_at DESC, ocid DESC);
CREATE INDEX IF NOT EXISTS contrato_estado_entidad_idx ON contrato_estado (entidad_ruc);

-- Marcas del grupo 'contratos' (contratos_agregado + entidad_stats): contrato_estado y entidades
-- (alertas ya marca 'financiamiento' y 'contratos' desde la 32).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('contrato_estado', '''contratos'''),
                                 ('entidades',       '''contratos''')) t(tabla, grupos) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_derivados_' || r.tabla || '_ins', r.tabla);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON %I REFERENCING NEW TABLE AS nuevas '
                   'FOR EACH STATEMENT EXECUTE FUNCTION marcar_derivados_si_filas(%s)',
                   'trg_derivados_' || r.tabla || '_ins', r.tabla, r.grupos);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_derivados_' || r.tabla || '_upd', r.tabla);
    EXECUTE format('CREATE TRIGGER %I AFTER UPDATE ON %I REFERENCING NEW TABLE AS nuevas '
                   'FOR EACH STATEMENT EXECUTE FUNCTION marcar_derivados_si_filas(%s)',
                   'trg_derivados_' || r.tabla || '_upd', r.tabla, r.grupos);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_derivados_' || r.tabla || '_del', r.tabla);
    EXECUTE format('CREATE TRIGGER %I AFTER DELETE ON %I REFERENCING OLD TABLE AS viejas '
                   'FOR EACH STATEMENT EXECUTE FUNCTION marcar_derivados_si_filas(%s)',
                   'trg_derivados_' || r.tabla || '_del', r.tabla, r.grupos);
  END LOOP;
END $$;

INSERT INTO derivados_refresco (nombre, refrescado_at) VALUES ('vencimientos', now()) ON CONFLICT DO NOTHING;
INSERT INTO derivados_refresco (nombre) VALUES ('contratos') ON CONFLICT DO NOTHING;
COMMENT ON TABLE derivados_refresco IS
  'Último refresco de cada grupo: financiamiento = zona_estado + ranking_impacto (32); contratos = contratos_agregado + '
  'entidad_stats (35); vencimientos = último barrido de documentos vencidos sobre contrato_estado (35).';

COMMIT;

-- ── 4 · Índices en convocatorias (CONCURRENTLY) ──────────────────────────────────────────────────
-- /contratos orden=fecha: fecha DESC NULLS LAST (vía COALESCE), alta DESC, ocid DESC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS convocatorias_keyset_fecha_idx ON convocatorias
  ((COALESCE(fecha_convocatoria, '-infinity'::date)) DESC, created_at DESC, ocid DESC);
-- /contratos orden=monto.
CREATE INDEX CONCURRENTLY IF NOT EXISTS convocatorias_keyset_monto_idx ON convocatorias
  (cuantia_referencial DESC NULLS LAST, ocid DESC);
-- /buscar y /contratos?q=<código>: prefijo del código y del OCID corto.
CREATE INDEX CONCURRENTLY IF NOT EXISTS convocatorias_codigo_prefijo_idx ON convocatorias
  (upper(codigo) text_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS convocatorias_ocid_corto_prefijo_idx ON convocatorias
  (ocid_corto(ocid) text_pattern_ops);

-- ── 2, 3, 5, 6 · Agregados, entidades, señales y refresco ───────────────────────────────────────
BEGIN;

DROP MATERIALIZED VIEW IF EXISTS contratos_agregado;
CREATE MATERIALIZED VIEW contratos_agregado AS
SELECT ce.ubigeo_zona                                           AS ubigeo,
       ce.tipo, ce.etapa,
       date_trunc('month', ce.fecha_convocatoria::timestamp)::date AS mes,
       ce.riesgo, ce.estado_proc, ce.operativo,
       count(*)::int                                            AS n,
       count(*) FILTER (WHERE ce.alerta_estado = 'revision')::int AS n_revision,
       COALESCE(sum(ce.monto), 0)                               AS monto
FROM contrato_estado ce
WHERE ce.ocid NOT LIKE 'ocds-vigia-%'
GROUP BY 1, 2, 3, 4, 5, 6, 7;
CREATE UNIQUE INDEX IF NOT EXISTS contratos_agregado_uidx ON contratos_agregado
  (ubigeo, tipo, etapa, mes, riesgo, estado_proc, operativo) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS contratos_agregado_ubigeo_idx ON contratos_agregado (ubigeo text_pattern_ops);
COMMENT ON MATERIALIZED VIEW contratos_agregado IS
  'Conteos de contratos (sin la semilla de demo) por zona × tipo × etapa × mes × riesgo × estado_proc × operativo. '
  'n = contratos, n_revision = con alerta en revisión, monto = suma de cuantia_referencial. Migración 35.';

DROP MATERIALIZED VIEW IF EXISTS entidad_stats;
CREATE MATERIALIZED VIEW entidad_stats AS
SELECT e.ruc, e.nombre, public.immutable_unaccent(lower(e.nombre)) AS nombre_norm,
       e.tipo, e.region, e.provincia, e.distrito, e.ubigeo, e.pliego_nombre_mef,
       COALESCE(cv.contratos, 0)::int         AS contratos,
       COALESCE(cv.monto, 0)                  AS monto_contratos,
       COALESCE(al.activas, 0)::int           AS alertas_activas,
       COALESCE(al.monto_activas, 0)          AS monto_alertas_activas,
       al.score_prom_activas,
       COALESCE(al.publicadas, 0)::int        AS alertas_publicadas,
       al.score_max
FROM entidades e
LEFT JOIN (SELECT ce.entidad_ruc, count(*) AS contratos, sum(ce.monto) AS monto
             FROM contrato_estado ce
            WHERE ce.ocid NOT LIKE 'ocds-vigia-%' AND ce.entidad_ruc IS NOT NULL
            GROUP BY 1) cv ON cv.entidad_ruc = e.ruc
LEFT JOIN (SELECT a.entidad_ruc,
                  count(*) FILTER (WHERE a.estado = 'activa')                AS activas,
                  sum(a.monto_adjudicado) FILTER (WHERE a.estado = 'activa') AS monto_activas,
                  (avg(a.score) FILTER (WHERE a.estado = 'activa'))::int     AS score_prom_activas,
                  count(*) FILTER (WHERE alerta_publicada(a.estado))         AS publicadas,
                  max(a.score) FILTER (WHERE alerta_publicada(a.estado))     AS score_max
             FROM alertas a
            WHERE a.codigo NOT LIKE 'ALT-%' AND a.entidad_ruc IS NOT NULL
            GROUP BY 1) al ON al.entidad_ruc = e.ruc;
CREATE UNIQUE INDEX IF NOT EXISTS entidad_stats_ruc_idx ON entidad_stats (ruc);
CREATE INDEX IF NOT EXISTS entidad_stats_alertas_idx   ON entidad_stats (alertas_activas DESC, nombre, ruc);
CREATE INDEX IF NOT EXISTS entidad_stats_contratos_idx ON entidad_stats (contratos DESC, nombre, ruc);
CREATE INDEX IF NOT EXISTS entidad_stats_nombre_trgm   ON entidad_stats USING gin (nombre_norm gin_trgm_ops);
COMMENT ON MATERIALIZED VIEW entidad_stats IS
  'Una fila por entidad: contratos (sin demo), alertas activas (lo que cuenta /entidades), alertas publicadas '
  '(activa|confirmada), montos y scores. nombre_norm = immutable_unaccent(lower(nombre)). Migración 35.';

-- Señales públicas: una fila por bandera de una alerta PUBLICADA y no demo (lib/publicacion.ts §1-2).
CREATE OR REPLACE VIEW senales_publicas AS
SELECT b.id                                     AS bandera_id,
       b.alerta_id,
       a.codigo                                 AS alerta_codigo,
       a.ocid,
       a.codigo_convocatoria,
       b.regla,
       b.severidad,
       CASE b.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END AS severidad_orden,
       b.evidencia,
       b.norma,
       b.opinion_oece,
       b.fuente_url,
       b.agente_origen                          AS agente,
       CASE WHEN b.verificacion->>'ok' IN ('true', 'false') THEN (b.verificacion->>'ok')::boolean END AS verificada,
       b.verificacion,
       b.created_at,
       -- La misma señal guardada dos veces (misma regla y evidencia salvo espacios/mayúsculas): la
       -- segunda copia no es una señal más (frontend/lib/revision.ts · claveSenal).
       EXISTS (SELECT 1 FROM banderas b2
                WHERE b2.alerta_id = b.alerta_id AND b2.regla = b.regla AND b2.id < b.id
                  AND lower(btrim(regexp_replace(COALESCE(b2.evidencia, ''), '\s+', ' ', 'g')))
                    = lower(btrim(regexp_replace(COALESCE(b.evidencia, ''), '\s+', ' ', 'g'))))  AS repetida,
       (SELECT count(DISTINCT (b3.regla, lower(btrim(regexp_replace(COALESCE(b3.evidencia, ''), '\s+', ' ', 'g')))))
          FROM banderas b3 WHERE b3.alerta_id = b.alerta_id)::int                               AS senales_del_contrato,
       COALESCE(a.score, 0)                     AS score,
       a.estado                                 AS alerta_estado,
       a.objeto,
       a.monto_adjudicado,
       a.fecha_buena_pro,
       a.region, a.provincia, a.distrito,
       a.analizado_en,
       a.entidad_ruc,
       COALESCE(e.nombre, '—')                  AS entidad,
       a.proveedor_ruc,
       COALESCE(emp.razon_social, '—')          AS proveedor
FROM banderas b
JOIN alertas a ON a.id = b.alerta_id
LEFT JOIN entidades e  ON e.ruc = a.entidad_ruc
LEFT JOIN empresas emp ON emp.ruc = a.proveedor_ruc
WHERE alerta_publicada(a.estado) AND a.codigo NOT LIKE 'ALT-%';
COMMENT ON VIEW senales_publicas IS
  'Una fila por bandera de alerta publicada (activa|confirmada, no demo). Orden público: severidad_orden, score DESC, '
  'entidad, bandera_id. repetida = copia de otra bandera de la misma alerta. Migración 35.';

-- Filtros de GET /senales (ya existen desde la 04; IF NOT EXISTS por si una base no los tiene).
CREATE INDEX IF NOT EXISTS idx_banderas_regla     ON banderas (regla);
CREATE INDEX IF NOT EXISTS idx_banderas_severidad ON banderas (severidad);

-- ── 6 · Refresco ─────────────────────────────────────────────────────────────────────────────────
-- Barre los documentos que vencieron desde el último barrido: su contrato puede pasar de
-- documentos_listos a sin_documentos sin que nadie escriba. Devuelve cuántas filas cambió.
CREATE OR REPLACE FUNCTION contrato_estado_vencidos() RETURNS INT
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_desde TIMESTAMPTZ; n INT;
BEGIN
  SELECT refrescado_at INTO v_desde FROM derivados_refresco WHERE nombre = 'vencimientos' FOR UPDATE;
  n := contrato_estado_recalcular(ARRAY(
         SELECT DISTINCT d.ocid FROM documentos_gcs d
          WHERE d.borrado_at IS NULL AND d.expira_at <= now()
            AND (v_desde IS NULL OR d.expira_at > v_desde)));
  UPDATE derivados_refresco SET refrescado_at = now(), refrescos = refrescos + 1 WHERE nombre = 'vencimientos';
  RETURN n;
END $$;

-- Refresca un grupo: consume sus marcas y después refresca (lo que se confirme en el medio queda marcado).
CREATE OR REPLACE FUNCTION refrescar_derivados(p_nombre TEXT) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET work_mem = '32MB' AS $$
DECLARE t0 TIMESTAMPTZ := clock_timestamp();
BEGIN
  DELETE FROM derivados_marcas WHERE nombre = p_nombre;
  IF p_nombre = 'financiamiento' THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY zona_estado;
    REFRESH MATERIALIZED VIEW CONCURRENTLY ranking_impacto;
  ELSIF p_nombre = 'contratos' THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY contratos_agregado;
    REFRESH MATERIALIZED VIEW CONCURRENTLY entidad_stats;
  ELSE
    RAISE EXCEPTION 'grupo de derivados desconocido: %', p_nombre;
  END IF;
  UPDATE derivados_refresco
     SET refrescado_at = now(), refrescos = refrescos + 1,
         duracion_ms = (extract(epoch FROM clock_timestamp() - t0) * 1000)::int
   WHERE nombre = p_nombre;
END $$;

-- Siempre refresca todo (ingesta, dispatcher, panel admin).
CREATE OR REPLACE FUNCTION refresh_financiamiento() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET work_mem = '32MB' AS $$
BEGIN
  PERFORM contrato_estado_vencidos();
  PERFORM refrescar_derivados('financiamiento');
  PERFORM refrescar_derivados('contratos');
END $$;

-- Refresca sólo los grupos con cambios. true = refrescó algo. No espera a otro refresco en curso.
CREATE OR REPLACE FUNCTION refresh_financiamiento_si_hace_falta() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET work_mem = '32MB' AS $$
DECLARE
  v_fin_at TIMESTAMPTZ;
  v_con_at TIMESTAMPTZ;
  v_fin BOOLEAN;
  v_con BOOLEAN;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('vigia:refresh_financiamiento')) THEN
    RETURN false;
  END IF;
  PERFORM contrato_estado_vencidos();   -- si cambia algo, deja su propia marca en 'contratos'
  SELECT refrescado_at INTO v_fin_at FROM derivados_refresco WHERE nombre = 'financiamiento';
  SELECT refrescado_at INTO v_con_at FROM derivados_refresco WHERE nombre = 'contratos';
  v_fin := v_fin_at IS NULL
        OR EXISTS (SELECT 1 FROM derivados_marcas WHERE nombre = 'financiamiento')
        -- zona_estado.documentos_listos depende del reloj.
        OR EXISTS (SELECT 1 FROM documentos_gcs d
                    WHERE d.borrado_at IS NULL AND d.expira_at > v_fin_at AND d.expira_at <= now());
  v_con := v_con_at IS NULL
        OR EXISTS (SELECT 1 FROM derivados_marcas WHERE nombre = 'contratos');
  IF v_fin THEN PERFORM refrescar_derivados('financiamiento'); END IF;
  IF v_con THEN PERFORM refrescar_derivados('contratos'); END IF;
  RETURN v_fin OR v_con;
END $$;

COMMIT;

SELECT refresh_financiamiento();

ANALYZE contrato_estado;
ANALYZE convocatorias;
