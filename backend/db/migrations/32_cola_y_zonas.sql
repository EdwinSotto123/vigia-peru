-- Vigía Perú · Migración 32 — Cola de auditoría y estado por zona en O(N) ─────────────────────────
--
-- Auditoría técnica 2026-09-25: A1, A2, DB-2, DB-3. Medido en producción: count(*) de cola_auditoria
-- 137 ms (una función por fila que lee `ajustes`: 165 M lecturas de una tabla de 4 filas), el SELECT
-- de zona_estado 1,7 s (LIKE z.ubigeo||'%' contra la cola por cada una de las 2.113 zonas) y se
-- refresca cada 10 min aunque nada haya cambiado.
--
-- Qué hace:
--   1. procesamiento_activo() con `SET search_path = public`: un pg_restore corre con search_path
--      vacío y la función (que lee `ajustes` sin esquema) rompía el REFRESH de zona_estado.
--   2. Zona persistida: convocatorias.ubigeo_zona (text) = lo que calculaba la vista
--      convocatoria_zona (ubigeo propio → ubigeo de la entidad → nombre de provincia/departamento).
--      La calcula zona_de_convocatoria(); la mantienen un trigger BEFORE en convocatorias y dos
--      triggers que la recalculan si cambian sus otras entradas (entidades, zonas). Backfill incluido.
--      Índice text_pattern_ops para `ubigeo_zona LIKE '15%'` (la collation de la base es en_US.utf8:
--      el btree por defecto no sirve para LIKE por prefijo).
--   3. convocatoria_zona y cola_auditoria se reescriben sobre esa columna (se mantienen por
--      compatibilidad, mismas columnas; `ubigeo` pasa de bpchar a text, que es lo que ya usaban
--      todos los lectores con `::text`, y deja que `LIKE` por prefijo use el índice).
--      cola_auditoria lee `ajustes` una sola vez (InitPlan) y ya no se une consigo misma.
--   4. zona_estado como rollup O(N): cada contrato/aporte/asignación suma a su departamento
--      (2 dígitos), provincia (4) y distrito (6) con GROUP BY, en vez de un LIKE por zona.
--      Mismas columnas, mismos tipos y mismos valores que la versión de la 22 (verificado con
--      EXCEPT en ambos sentidos en staging, ver DB_LISTO.md).
--   5. Refresco condicional:
--        · derivados_marcas: cola de "algo cambió" que llenan triggers FOR EACH STATEMENT baratos
--          (un INSERT … ON CONFLICT DO NOTHING por transacción). No es un booleano en una fila
--          compartida a propósito: un flag que los escritores ponen en true (a) deja en cola a todas
--          las transacciones que escriben detrás de la primera que lo tomó hasta que haga COMMIT
--          (la ingesta corre en transacciones largas) y (b) pierde cambios: un escritor que ve el
--          flag ya en true no marca nada, y si el refresco lo apaga con una foto tomada antes del
--          COMMIT de ese escritor, el cambio queda fuera hasta el siguiente. Con una fila por
--          transacción que sólo se ve al hacer COMMIT, el refresco borra las marcas que ve y
--          después refresca con una foto más nueva: nada se pierde y nadie espera a nadie.
--        · derivados_refresco: cuándo se refrescó cada grupo y cuánto tardó.
--        · derivados_estado (vista): nombre, sucio, marcado_at, refrescado_at — lo que pide el spec.
--        · refresh_financiamiento_si_hace_falta(): refresca sólo si hay marcas (o si vencieron
--          documentos desde el último refresco: zona_estado.documentos_listos depende del reloj);
--          devuelve si refrescó. work_mem 32 MB sólo durante la función.
--        · refresh_financiamiento(): sigue existiendo y SIEMPRE refresca (la llaman la ingesta, el
--          dispatcher y el panel admin). Ahora también consume las marcas.
--      `procesamientos` NO marca 'financiamiento': ni zona_estado ni ranking_impacto la leen, y el
--      dispatcher la actualiza con cada latido (cada 30 s): la dejaría sucia siempre. En `ajustes` sólo
--      marca la clave 'procesamiento' (la API reescribe 'cache_gen' con cada cambio del panel).
--   6. Las funciones de trigger y de refresco son SECURITY DEFINER con `search_path = public, pg_temp`:
--      así quien escribe (API, jobs, dispatcher con sus roles propios, migración 37) no necesita permisos
--      sobre derivados_marcas ni sobre lo que el trigger recalcula, y REFRESH (que exige ser dueño de la
--      vista materializada) funciona desde cualquier rol con EXECUTE. Ninguna arma SQL con texto de afuera.
--
-- Cómo aplicarla (psql, fuera del lote nocturno de ingesta; NO con -1 ni --single-transaction,
-- porque el índice va CONCURRENTLY):
--     psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/32_cola_y_zonas.sql
-- lock_timeout 5 s: si la ingesta tiene tomada `convocatorias`, el ALTER/CREATE TRIGGER falla en
-- vez de dejar en cola a la API; se reintenta. El backfill toca cada fila de convocatorias una vez
-- (18 k filas: ~2 s en staging) y el índice se crea sin bloquear escrituras.
--
-- Cómo verificar:
--     SELECT count(*) FROM convocatorias WHERE ubigeo_zona IS DISTINCT FROM zona_de_convocatoria(ubigeo, region, entidad_ruc);  -- 0
--     SELECT indisvalid FROM pg_index WHERE indexrelid = 'convocatorias_ubigeo_zona_idx'::regclass;                               -- t
--     EXPLAIN ANALYZE SELECT count(*) FROM cola_auditoria;          -- sin "procesamiento_activo", InitPlan sobre ajustes
--     SELECT refresh_financiamiento_si_hace_falta();                -- t la primera vez, f si nada cambió
--     SELECT * FROM derivados_estado;
--
-- Idempotente: CREATE OR REPLACE / IF NOT EXISTS; las vistas y zona_estado se vuelven a crear
-- (DROP + CREATE en una transacción: los lectores esperan milisegundos).

\set ON_ERROR_STOP on
SET lock_timeout = '5s';

-- ── 1 · procesamiento_activo con search_path fijo ──────────────────────────────────────────────
BEGIN;

CREATE OR REPLACE FUNCTION procesamiento_activo(p_tipo TEXT, p_etapa TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT (valor->'tipos_activos')  ? COALESCE(p_tipo, '')
        AND (valor->'etapas_activas') ? COALESCE(p_etapa, '')
     FROM ajustes WHERE clave = 'procesamiento'),
    true)
$$;

-- ── 2 · Zona persistida ──────────────────────────────────────────────────────────────────────────
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS ubigeo_zona TEXT;
COMMENT ON COLUMN convocatorias.ubigeo_zona IS
  'Zona del contrato (2/4/6 dígitos INEI): ubigeo propio → ubigeo de la entidad → provincia/departamento por nombre. '
  'Igual a la vista convocatoria_zona de la 11. La mantienen triggers (migración 32): no escribirla a mano.';

-- Misma regla que la vista convocatoria_zona de la migración 11, con nombres calificados: se usa en
-- triggers y en un pg_restore (search_path vacío). unaccent con diccionario explícito = unaccent(x).
CREATE OR REPLACE FUNCTION zona_de_convocatoria(p_ubigeo TEXT, p_region TEXT, p_entidad_ruc CHAR(11))
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT (COALESCE(
    p_ubigeo::bpchar,
    NULLIF((SELECT e.ubigeo FROM public.entidades e WHERE e.ruc = p_entidad_ruc), ''::bpchar),
    (SELECT z.ubigeo FROM public.zonas z
      WHERE z.nivel IN ('provincia', 'departamento')
        AND upper(public.unaccent('public.unaccent'::regdictionary, z.nombre))
          = upper(public.unaccent('public.unaccent'::regdictionary, COALESCE(
              NULLIF(p_region, ''),
              (SELECT e.region FROM public.entidades e WHERE e.ruc = p_entidad_ruc),
              (SELECT e.provincia FROM public.entidades e WHERE e.ruc = p_entidad_ruc),
              '')))
      ORDER BY CASE z.nivel WHEN 'provincia' THEN 0 ELSE 1 END
      LIMIT 1)::bpchar
  ))::text
$$;

-- BEFORE: la fila se escribe ya con su zona. Si ninguna entrada cambió, no recalcula.
CREATE OR REPLACE FUNCTION convocatorias_ubigeo_zona_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.ubigeo IS NOT DISTINCT FROM OLD.ubigeo
     AND NEW.region IS NOT DISTINCT FROM OLD.region
     AND NEW.entidad_ruc IS NOT DISTINCT FROM OLD.entidad_ruc
     AND NEW.ubigeo_zona IS NOT DISTINCT FROM OLD.ubigeo_zona THEN
    RETURN NEW;
  END IF;
  NEW.ubigeo_zona := zona_de_convocatoria(NEW.ubigeo, NEW.region, NEW.entidad_ruc);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_convocatorias_ubigeo_zona ON convocatorias;
CREATE TRIGGER trg_convocatorias_ubigeo_zona
  BEFORE INSERT OR UPDATE OF ubigeo, region, entidad_ruc, ubigeo_zona ON convocatorias
  FOR EACH ROW EXECUTE FUNCTION convocatorias_ubigeo_zona_trg();

-- La zona depende también de la entidad (ubigeo, región, provincia) cuando el contrato no trae ubigeo.
CREATE OR REPLACE FUNCTION entidades_ubigeo_zona_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE convocatorias c SET ubigeo_zona = zona_de_convocatoria(c.ubigeo, c.region, c.entidad_ruc)
   WHERE c.entidad_ruc = NEW.ruc AND c.ubigeo IS NULL
     AND c.ubigeo_zona IS DISTINCT FROM zona_de_convocatoria(c.ubigeo, c.region, c.entidad_ruc);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_entidades_ubigeo_zona ON entidades;
CREATE TRIGGER trg_entidades_ubigeo_zona
  AFTER UPDATE OF ubigeo, region, provincia ON entidades
  FOR EACH ROW WHEN (OLD.ubigeo IS DISTINCT FROM NEW.ubigeo OR OLD.region IS DISTINCT FROM NEW.region
                     OR OLD.provincia IS DISTINCT FROM NEW.provincia)
  EXECUTE FUNCTION entidades_ubigeo_zona_trg();

-- ... y de los nombres de `zonas` (sólo para los contratos sin ubigeo propio). Tabla casi estática.
CREATE OR REPLACE FUNCTION zonas_ubigeo_zona_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE convocatorias c SET ubigeo_zona = zona_de_convocatoria(c.ubigeo, c.region, c.entidad_ruc)
   WHERE c.ubigeo IS NULL
     AND c.ubigeo_zona IS DISTINCT FROM zona_de_convocatoria(c.ubigeo, c.region, c.entidad_ruc);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_zonas_ubigeo_zona ON zonas;
CREATE TRIGGER trg_zonas_ubigeo_zona
  AFTER INSERT OR UPDATE OR DELETE ON zonas
  FOR EACH STATEMENT EXECUTE FUNCTION zonas_ubigeo_zona_trg();

COMMIT;

-- Backfill (una sentencia; sólo escribe las filas cuya zona difiere).
UPDATE convocatorias SET ubigeo_zona = zona_de_convocatoria(ubigeo, region, entidad_ruc)
 WHERE ubigeo_zona IS DISTINCT FROM zona_de_convocatoria(ubigeo, region, entidad_ruc);

CREATE INDEX CONCURRENTLY IF NOT EXISTS convocatorias_ubigeo_zona_idx
  ON convocatorias (ubigeo_zona text_pattern_ops);

-- ── 3 · Vistas de compatibilidad, cola y zona_estado ─────────────────────────────────────────────
BEGIN;

DROP MATERIALIZED VIEW IF EXISTS zona_estado;
DROP VIEW IF EXISTS cola_auditoria;
DROP VIEW IF EXISTS convocatoria_zona;

-- Compatibilidad: la API y los scripts la leen con `cz.ubigeo::text` o `LIKE $1 || '%'`.
CREATE VIEW convocatoria_zona AS
SELECT c.ocid, c.fecha_convocatoria, c.ubigeo_zona AS ubigeo
FROM convocatorias c;

-- `j ? x` expresado como `x = ANY(jsonb_claves_texto(j))`: mismas respuestas (cadenas de un arreglo, claves
-- de un objeto, el propio texto si j es una cadena; NULL si j es NULL), pero con una forma que el
-- planificador sabe estimar. `?` se estima en 0,1 % por fila: con dos, la cola "tenía 2 filas" y elegía
-- nested loops contra alertas y asignaciones (78 ms en staging; crece con N × alertas).
CREATE OR REPLACE FUNCTION jsonb_claves_texto(j JSONB) RETURNS TEXT[]
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT CASE jsonb_typeof(j)
           WHEN 'array'  THEN ARRAY(SELECT e #>> '{}' FROM jsonb_array_elements(j) e WHERE jsonb_typeof(e) = 'string')
           WHEN 'object' THEN ARRAY(SELECT jsonb_object_keys(j))
           WHEN 'string' THEN ARRAY[j #>> '{}']
           ELSE ARRAY[]::text[] END
$$;
-- ajustes.procesamiento como text[] (NULL si no hay fila o no hay clave: "todo activo").
CREATE OR REPLACE FUNCTION procesamiento_tipos_activos() RETURNS TEXT[]
LANGUAGE sql STABLE AS $$
  SELECT public.jsonb_claves_texto(a.valor->'tipos_activos') FROM public.ajustes a WHERE a.clave = 'procesamiento'
$$;
CREATE OR REPLACE FUNCTION procesamiento_etapas_activas() RETURNS TEXT[]
LANGUAGE sql STABLE AS $$
  SELECT public.jsonb_claves_texto(a.valor->'etapas_activas') FROM public.ajustes a WHERE a.clave = 'procesamiento'
$$;

-- Cola financiable. `ajustes` se lee una vez por consulta ((SELECT f()) = InitPlan), no una por fila, y sin
-- unirse consigo misma. Equivale a COALESCE(procesamiento_activo(tipo, etapa), true):
--   procesamiento_activo = (tipos ? COALESCE(tipo,'')) AND (etapas ? COALESCE(etapa,'')), NULL sin configuración;
--   "IS NOT FALSE" de un AND = ninguno de los dos es FALSE = para cada uno: sin arreglo, o el valor está en él.
CREATE VIEW cola_auditoria AS
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
  AND NOT EXISTS (SELECT 1 FROM alertas a WHERE a.ocid = c.ocid)
  AND NOT EXISTS (SELECT 1 FROM asignaciones s WHERE s.ocid = c.ocid);

-- Estado por zona. Cada conteo se agrega primero por el ubigeo propio (2, 4 o 6 dígitos) y después
-- se reparte a sus prefijos de 2, 4 y 6 dígitos: `u LIKE z || '%'` con z de 2/4/6 dígitos
-- ≡ z ∈ {left(u,2), left(u,4) si length(u) ≥ 4, left(u,6) si length(u) ≥ 6}.
CREATE MATERIALIZED VIEW zona_estado AS
WITH alcance AS MATERIALIZED (
  SELECT (SELECT valor->'tipos_activos'  FROM ajustes WHERE clave = 'procesamiento') AS tipos,
         (SELECT valor->'etapas_activas' FROM ajustes WHERE clave = 'procesamiento') AS etapas
),
cola AS (
  SELECT q.ubigeo, count(*)::int AS n FROM cola_auditoria q GROUP BY 1
),
docs AS (
  -- Tipos/etapas fuera del alcance activo (NOT procesamiento_activo ≡ … IS FALSE), con documentos
  -- vigentes en GCS y sin alerta.
  SELECT c.ubigeo_zona AS ubigeo, count(*)::int AS n
  FROM convocatorias c CROSS JOIN alcance al
  WHERE c.ubigeo_zona IS NOT NULL
    AND ((al.tipos ? COALESCE(c.tipo_contratacion, '')) AND (al.etapas ? COALESCE(c.etapa, ''))) IS FALSE
    AND EXISTS (SELECT 1 FROM documentos_gcs d
                 WHERE ocid_corto(d.ocid) = ocid_corto(c.ocid) AND d.borrado_at IS NULL AND d.expira_at > now())
    AND NOT EXISTS (SELECT 1 FROM alertas a WHERE ocid_corto(a.ocid) = ocid_corto(c.ocid))
  GROUP BY 1
),
aportes AS (
  SELECT c.ubigeo, sum(c.contratos) AS contratos, count(*) AS n
  FROM contribuciones c WHERE c.estado IN ('pagada', 'en_proceso', 'procesada')
  GROUP BY 1
),
asig AS (
  SELECT c.ubigeo,
         count(*)                                                                  AS asignados,
         count(*) FILTER (WHERE s.procesada_at IS NOT NULL)                        AS procesados,
         count(*) FILTER (WHERE a.id IS NOT NULL AND alerta_publicada(a.estado)
                            AND EXISTS (SELECT 1 FROM banderas b WHERE b.alerta_id = a.id)) AS senales,
         count(*) FILTER (WHERE a.estado = 'revision')                             AS en_revision
  FROM asignaciones s
  JOIN contribuciones c ON c.id = s.contribucion_id
  LEFT JOIN alertas a ON a.id = s.alerta_id
  GROUP BY 1
),
cola_z AS (
  SELECT p.z AS ubigeo, sum(x.n) AS n
  FROM cola x CROSS JOIN LATERAL (VALUES (left(x.ubigeo, 2)),
                                         (CASE WHEN length(x.ubigeo) >= 4 THEN left(x.ubigeo, 4) END),
                                         (CASE WHEN length(x.ubigeo) >= 6 THEN left(x.ubigeo, 6) END)) p(z)
  WHERE p.z IS NOT NULL GROUP BY 1
),
docs_z AS (
  SELECT p.z AS ubigeo, sum(x.n) AS n
  FROM docs x CROSS JOIN LATERAL (VALUES (left(x.ubigeo, 2)),
                                         (CASE WHEN length(x.ubigeo) >= 4 THEN left(x.ubigeo, 4) END),
                                         (CASE WHEN length(x.ubigeo) >= 6 THEN left(x.ubigeo, 6) END)) p(z)
  WHERE p.z IS NOT NULL GROUP BY 1
),
aportes_z AS (
  SELECT p.z AS ubigeo, sum(x.contratos) AS contratos, sum(x.n) AS n
  FROM aportes x CROSS JOIN LATERAL (VALUES (left(x.ubigeo, 2)),
                                            (CASE WHEN length(x.ubigeo) >= 4 THEN left(x.ubigeo, 4) END),
                                            (CASE WHEN length(x.ubigeo) >= 6 THEN left(x.ubigeo, 6) END)) p(z)
  WHERE p.z IS NOT NULL GROUP BY 1
),
asig_z AS (
  SELECT p.z AS ubigeo, sum(x.asignados) AS asignados, sum(x.procesados) AS procesados,
         sum(x.senales) AS senales, sum(x.en_revision) AS en_revision
  FROM asig x CROSS JOIN LATERAL (VALUES (left(x.ubigeo, 2)),
                                         (CASE WHEN length(x.ubigeo) >= 4 THEN left(x.ubigeo, 4) END),
                                         (CASE WHEN length(x.ubigeo) >= 6 THEN left(x.ubigeo, 6) END)) p(z)
  WHERE p.z IS NOT NULL GROUP BY 1
),
tarifa AS (SELECT precio_pen, precio_usd FROM tarifas ORDER BY vigente_desde DESC LIMIT 1),
base AS (
  SELECT z.ubigeo, z.nivel, z.nombre, z.padre_ubigeo, z.lat, z.lon, t.precio_pen, t.precio_usd,
         COALESCE(q.n, 0)::int            AS pendientes,
         COALESCE(f.contratos, 0)::int    AS financiados,
         COALESCE(f.n, 0)::int            AS contribuciones,
         COALESCE(p.asignados, 0)::int    AS asignados,
         COALESCE(p.procesados, 0)::int   AS procesados,
         COALESCE(p.senales, 0)::int      AS senales,
         COALESCE(p.en_revision, 0)::int  AS en_revision,
         COALESCE(d.n, 0)::int            AS documentos_listos
  FROM zonas z
  CROSS JOIN tarifa t
  LEFT JOIN cola_z    q ON q.ubigeo = z.ubigeo
  LEFT JOIN docs_z    d ON d.ubigeo = z.ubigeo
  LEFT JOIN aportes_z f ON f.ubigeo = z.ubigeo
  LEFT JOIN asig_z    p ON p.ubigeo = z.ubigeo
)
SELECT ubigeo, nivel, nombre, padre_ubigeo, lat, lon,
       precio_pen, precio_usd,
       pendientes,
       financiados,
       contribuciones,
       asignados,
       procesados,
       senales,
       (pendientes + asignados)                        AS total_cola,   -- en cola + ya asignados (procesados o no)
       CASE
         WHEN pendientes + asignados = 0               THEN 'sin_datos'
         WHEN procesados >= pendientes + asignados     THEN 'procesada'
         WHEN financiados >= pendientes + asignados    THEN 'financiada'
         WHEN financiados > 0                          THEN 'parcial'
         ELSE 'pendiente'
       END AS estado,
       en_revision,
       documentos_listos
FROM base;

CREATE UNIQUE INDEX IF NOT EXISTS zona_estado_ubigeo_idx ON zona_estado (ubigeo);
CREATE INDEX IF NOT EXISTS zona_estado_nivel_idx ON zona_estado (nivel);
CREATE INDEX IF NOT EXISTS zona_estado_padre_idx ON zona_estado (padre_ubigeo);

-- ── 4 · Refresco condicional ─────────────────────────────────────────────────────────────────────
-- Una marca por (grupo de derivados, transacción que escribió). Se ve recién al COMMIT.
CREATE TABLE IF NOT EXISTS derivados_marcas (
  nombre      TEXT        NOT NULL,
  tx          XID8        NOT NULL DEFAULT pg_current_xact_id(),
  marcado_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (nombre, tx)
);
COMMENT ON TABLE derivados_marcas IS
  'Cambios pendientes de refrescar por grupo de vistas derivadas (una fila por transacción que escribió). '
  'La llenan triggers FOR EACH STATEMENT (marcar_derivados*) y la vacía el refresco (migración 32).';

CREATE TABLE IF NOT EXISTS derivados_refresco (
  nombre        TEXT PRIMARY KEY,
  refrescado_at TIMESTAMPTZ,
  duracion_ms   INT,
  refrescos     BIGINT NOT NULL DEFAULT 0
);
COMMENT ON TABLE derivados_refresco IS
  'Último refresco de cada grupo de vistas derivadas: financiamiento = zona_estado + ranking_impacto (migración 32).';
INSERT INTO derivados_refresco (nombre) VALUES ('financiamiento') ON CONFLICT DO NOTHING;

CREATE OR REPLACE VIEW derivados_estado AS
SELECT r.nombre,
       EXISTS (SELECT 1 FROM derivados_marcas m WHERE m.nombre = r.nombre) AS sucio,
       (SELECT max(m.marcado_at) FROM derivados_marcas m WHERE m.nombre = r.nombre) AS marcado_at,
       r.refrescado_at, r.duracion_ms, r.refrescos
FROM derivados_refresco r;
COMMENT ON VIEW derivados_estado IS
  'nombre, sucio (hay cambios sin refrescar), marcado_at (último cambio), refrescado_at, duracion_ms, refrescos.';

-- Trigger FOR EACH STATEMENT sin tablas de transición (tablas de escritura masiva). Argumentos: grupos.
CREATE OR REPLACE FUNCTION marcar_derivados() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO derivados_marcas (nombre) SELECT unnest(TG_ARGV) ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;

-- Igual, pero sólo marca si la sentencia tocó filas (tablas chicas donde abundan sentencias que no
-- tocan nada, p. ej. asignar_contribucion() sobre una zona sin cola). Requiere un trigger por evento
-- con REFERENCING NEW TABLE AS nuevas (INSERT/UPDATE) u OLD TABLE AS viejas (DELETE).
CREATE OR REPLACE FUNCTION marcar_derivados_si_filas() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM viejas) THEN RETURN NULL; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM nuevas) THEN RETURN NULL; END IF;
  END IF;
  INSERT INTO derivados_marcas (nombre) SELECT unnest(TG_ARGV) ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;

-- Tablas masivas: convocatorias (ingesta), documentos_gcs (ingesta de documentos).
DROP TRIGGER IF EXISTS trg_derivados_convocatorias ON convocatorias;
CREATE TRIGGER trg_derivados_convocatorias AFTER INSERT OR UPDATE OR DELETE ON convocatorias
  FOR EACH STATEMENT EXECUTE FUNCTION marcar_derivados('financiamiento');
DROP TRIGGER IF EXISTS trg_derivados_documentos_gcs ON documentos_gcs;
CREATE TRIGGER trg_derivados_documentos_gcs AFTER INSERT OR UPDATE OR DELETE ON documentos_gcs
  FOR EACH STATEMENT EXECUTE FUNCTION marcar_derivados('financiamiento');

-- Tablas chicas: tres triggers por tabla (las tablas de transición no admiten varios eventos).
-- alertas marca también 'contratos' (entidad_stats, migración 35): así re-correr esta migración no
-- le quita esa marca. Sin la 35, las marcas de 'contratos' no se usan (las borra su primer refresco).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('asignaciones',   '''financiamiento'''),
                                 ('contribuciones', '''financiamiento'''),
                                 ('alertas',        '''financiamiento'', ''contratos'''),
                                 ('banderas',       '''financiamiento'''),
                                 ('tarifas',        '''financiamiento'''),
                                 ('zonas',          '''financiamiento'''),
                                 ('financiadores',  '''financiamiento''')) t(tabla, grupos) LOOP
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

-- ajustes: sólo la clave 'procesamiento' (el alcance) influye en los derivados. La API escribe
-- 'cache_gen' con cada cambio del panel: por fila y con WHEN, para no ensuciar por eso.
DROP TRIGGER IF EXISTS trg_derivados_ajustes_ins ON ajustes;
DROP TRIGGER IF EXISTS trg_derivados_ajustes_upd ON ajustes;
DROP TRIGGER IF EXISTS trg_derivados_ajustes_del ON ajustes;
DROP TRIGGER IF EXISTS trg_derivados_ajustes ON ajustes;
CREATE TRIGGER trg_derivados_ajustes AFTER INSERT OR UPDATE ON ajustes
  FOR EACH ROW WHEN (NEW.clave = 'procesamiento') EXECUTE FUNCTION marcar_derivados('financiamiento');
CREATE TRIGGER trg_derivados_ajustes_del AFTER DELETE ON ajustes
  FOR EACH ROW WHEN (OLD.clave = 'procesamiento') EXECUTE FUNCTION marcar_derivados('financiamiento');

-- La 35 reemplaza estas dos funciones (suma contratos_agregado y entidad_stats): si ya está aplicada, re-correr
-- esta migración no las pisa con la versión corta.
DO $do$
BEGIN
  IF to_regprocedure('refrescar_derivados(text)') IS NOT NULL THEN
    RAISE NOTICE 'migración 35 presente: se conservan sus refresh_financiamiento*()';
    RETURN;
  END IF;

  -- Siempre refresca. Consume las marcas ANTES de refrescar: lo que se confirme después queda marcado.
  EXECUTE $f$
  CREATE OR REPLACE FUNCTION refresh_financiamiento() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET work_mem = '32MB' AS $cuerpo$
  DECLARE t0 TIMESTAMPTZ := clock_timestamp();
  BEGIN
    DELETE FROM derivados_marcas WHERE nombre = 'financiamiento';
    REFRESH MATERIALIZED VIEW CONCURRENTLY zona_estado;
    REFRESH MATERIALIZED VIEW CONCURRENTLY ranking_impacto;
    UPDATE derivados_refresco
       SET refrescado_at = now(), refrescos = refrescos + 1,
           duracion_ms = (extract(epoch FROM clock_timestamp() - t0) * 1000)::int
     WHERE nombre = 'financiamiento';
  END $cuerpo$;
  $f$;

  -- Refresca sólo si hace falta. true = refrescó. Si otro refresco está corriendo, no espera: false
  -- (las marcas que ese no alcance a ver quedan para la próxima llamada).
  EXECUTE $f$
  CREATE OR REPLACE FUNCTION refresh_financiamiento_si_hace_falta() RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET work_mem = '32MB' AS $cuerpo$
  DECLARE v_ultimo TIMESTAMPTZ;
  BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtext('vigia:refresh_financiamiento')) THEN
      RETURN false;
    END IF;
    SELECT refrescado_at INTO v_ultimo FROM derivados_refresco WHERE nombre = 'financiamiento';
    IF v_ultimo IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM derivados_marcas WHERE nombre = 'financiamiento')
       -- documentos_listos depende del reloj: un documento que venció desde el último refresco cuenta.
       AND NOT EXISTS (SELECT 1 FROM documentos_gcs d
                        WHERE d.borrado_at IS NULL AND d.expira_at > v_ultimo AND d.expira_at <= now()) THEN
      RETURN false;
    END IF;
    PERFORM refresh_financiamiento();
    RETURN true;
  END $cuerpo$;
  $f$;
END $do$;

COMMIT;

-- Vencimientos de documentos (lo consulta refresh_financiamiento_si_hace_falta).
CREATE INDEX CONCURRENTLY IF NOT EXISTS documentos_gcs_expira_idx
  ON documentos_gcs (expira_at) WHERE borrado_at IS NULL;

-- El primer refresco deja la línea base (refrescado_at) y vacía las marcas del backfill.
SELECT refresh_financiamiento();

ANALYZE convocatorias;
