-- RAG normativo: versiones por fecha, materia, estado de verificación y las reglas de cumplimiento (2026-11-15).
--
-- Une el diseño de la 284 con el paquete docs/rag_legal_peru (catálogo de 86 normas y 48 reglas) y con lo descargado en
-- rag-legal-pe:
--   norma.version_de    una norma con DOS textos según la fecha es dos filas: la original con `vigencia_hasta` y la
--                       modificada con `vigencia_desde`, las dos con el mismo `version_de`. El Reglamento de la Ley 32069
--                       cambió 123 artículos el 14-01-2026 (D.S. 001-2026-EF): un contrato convocado en 2025 debe leer
--                       el texto anterior. `buscar_norma` ya filtra por vigencia de la fila, así que no cambia.
--   norma.materia       contrataciones | control | presupuesto | administrativo | empleo_publico | inversion. La búsqueda
--                       del analista legal no trae empleo público salvo que se pida (p_materias).
--   norma.estado        vigente | vigente_modificada | derogada | ultraactiva | condicionada | historica.
--   norma.verificacion  C confirmado en fuente oficial · S fuente secundaria · PV por verificar.
--   norma_regla         las reglas de cumplimiento que se verifican contra el corpus (48 del paquete), con su fundamento,
--                       cómo se verifican (determinista, dato externo, documental, RAG) y su estado de verificación.

ALTER TABLE norma ADD COLUMN IF NOT EXISTS version_de TEXT;
ALTER TABLE norma ADD COLUMN IF NOT EXISTS materia TEXT NOT NULL DEFAULT 'contrataciones';
ALTER TABLE norma ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'vigente';
ALTER TABLE norma ADD COLUMN IF NOT EXISTS verificacion TEXT;
ALTER TABLE norma ADD COLUMN IF NOT EXISTS catalogo_id TEXT;
ALTER TABLE norma ADD COLUMN IF NOT EXISTS sha256 TEXT;
CREATE INDEX IF NOT EXISTS norma_version_de ON norma (version_de) WHERE version_de IS NOT NULL;

UPDATE norma SET materia = 'control' WHERE materia = 'contrataciones'
   AND (tipo = 'control' OR slug IN ('ley-31288', 'ley-31358') OR slug LIKE 'directiva-%-cg-%');
UPDATE norma SET materia = 'presupuesto' WHERE materia = 'contrataciones' AND slug LIKE 'ley-%presupuesto%';
UPDATE norma SET materia = 'administrativo' WHERE materia = 'contrataciones' AND slug LIKE 'tuo-ley-27444%';
UPDATE norma SET estado = 'derogada' WHERE estado = 'vigente' AND vigencia_hasta IS NOT NULL AND vigencia_hasta < CURRENT_DATE AND tipo IN ('ley', 'reglamento');

CREATE TABLE IF NOT EXISTS norma_regla (
  id                 TEXT PRIMARY KEY,          -- REG-01, SEL-21…
  categoria          TEXT NOT NULL,             -- transversal, contratos_menores, contrataciones_mayores, ejecucion, obras, cas, planillas
  fase               TEXT,
  descripcion        TEXT NOT NULL,
  fundamento         TEXT,                      -- «Ley art. 55», «Regl. art. 120»
  normas             TEXT[] NOT NULL DEFAULT '{}',   -- ids del catálogo
  tipo_verificacion  TEXT,                      -- determinista | dato_externo | documental | rag_llm
  parametro          TEXT,
  valor_referencia   TEXT,
  severidad          TEXT,
  regimen            TEXT[] NOT NULL DEFAULT '{}',
  verificacion       TEXT,                      -- C | S | PV
  regla_vigia        TEXT,                      -- la regla del agente que ya la cubre, si existe
  nota               TEXT,
  actualizado_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP FUNCTION IF EXISTS buscar_norma(TEXT, halfvec, DATE, INT, TEXT[]);

CREATE OR REPLACE FUNCTION buscar_norma(p_q TEXT, p_vec halfvec, p_fecha DATE, p_n INT DEFAULT 40, p_tipos TEXT[] DEFAULT NULL,
                                        p_materias TEXT[] DEFAULT NULL)
RETURNS TABLE (id BIGINT, slug TEXT, documento TEXT, numero TEXT, tipo TEXT, jerarquia SMALLINT, regimen TEXT, aplica TEXT,
               fecha_emision DATE, vigencia_desde DATE, vigencia_hasta DATE, articulo TEXT, epigrafe TEXT, pagina INT,
               texto TEXT, url_oficial TEXT, rango_palabras INT, rango_vector INT, puntaje DOUBLE PRECISION)
LANGUAGE sql STABLE AS $$
  WITH reg AS (SELECT regimen_de(p_fecha) AS r, COALESCE(p_fecha, CURRENT_DATE) AS f),
  permitidas AS (
    SELECT n.*,
           CASE WHEN n.tipo IN ('ley', 'reglamento', 'directiva', 'bases_estandar', 'control', 'otra') THEN 'norma'
                WHEN n.regimen IN ((SELECT r FROM reg), 'ambos') THEN 'criterio'
                ELSE 'criterio_anterior' END AS aplica
      FROM norma n, reg
     WHERE (p_tipos IS NULL OR n.tipo = ANY (p_tipos))
       -- Sin materias pedidas: todo menos empleo público (CAS y planillas), que no es norma de contrataciones.
       AND CASE WHEN p_materias IS NULL THEN n.materia <> 'empleo_publico' ELSE n.materia = ANY (p_materias) END
       AND CASE WHEN n.tipo IN ('ley', 'reglamento', 'directiva', 'bases_estandar', 'control', 'otra')
                -- Una norma sólo si es del régimen de la fecha y regía ese día.
                THEN n.regimen IN (reg.r, 'ambos') AND COALESCE(n.vigencia_desde, DATE '1900-01-01') <= reg.f
                     AND (n.vigencia_hasta IS NULL OR n.vigencia_hasta >= reg.f)
                -- Un criterio, si ya existía ese día (uno posterior a la convocatoria no pudo guiarla).
                ELSE COALESCE(n.fecha_emision, n.vigencia_desde, DATE '1900-01-01') <= reg.f END
  ),
  consulta AS (
    SELECT to_tsquery('spanish', string_agg(l, ' | ')) AS q
      FROM unnest(tsvector_to_array(to_tsvector('spanish', translate(lower(p_q), 'áéíóúüñ', 'aeiouun')))) l
  ),
  palabras AS (
    SELECT f.id, row_number() OVER (ORDER BY ts_rank_cd(f.tsv, c.q, 32) DESC)::int AS rango
      FROM norma_fragmento f JOIN permitidas p ON p.slug = f.slug, consulta c
     WHERE c.q IS NOT NULL AND f.tsv @@ c.q
     ORDER BY ts_rank_cd(f.tsv, c.q, 32) DESC LIMIT 60
  ),
  vector AS (
    SELECT f.id, row_number() OVER (ORDER BY f.embedding <=> p_vec)::int AS rango
      FROM norma_fragmento f JOIN permitidas p ON p.slug = f.slug
     WHERE p_vec IS NOT NULL AND f.embedding IS NOT NULL
     ORDER BY f.embedding <=> p_vec LIMIT 60
  ),
  fusion AS (
    SELECT COALESCE(a.id, v.id) AS id, a.rango AS rp, v.rango AS rv,
           COALESCE(1.0 / (60 + a.rango), 0) + COALESCE(1.0 / (60 + v.rango), 0) AS rrf
      FROM palabras a FULL JOIN vector v ON v.id = a.id
  )
  SELECT f.id, p.slug, p.documento, p.numero, p.tipo, p.jerarquia, p.regimen, p.aplica, p.fecha_emision, p.vigencia_desde,
         p.vigencia_hasta, f.articulo, f.epigrafe, f.pagina, f.texto, p.url_oficial, x.rp, x.rv,
         -- La jerarquía pondera: ley y reglamento arriba; un criterio del otro régimen, a la mitad.
         x.rrf * (CASE p.jerarquia WHEN 1 THEN 1.30 WHEN 2 THEN 1.25 WHEN 3 THEN 0.90 WHEN 4 THEN 1.10 WHEN 5 THEN 1.00 ELSE 0.80 END)
               * (CASE p.aplica WHEN 'criterio_anterior' THEN 0.5 ELSE 1 END) AS puntaje
    FROM fusion x JOIN norma_fragmento f ON f.id = x.id JOIN permitidas p ON p.slug = f.slug
   ORDER BY puntaje DESC LIMIT p_n
$$;

ALTER TABLE norma_regla OWNER TO vigia_jobs;
ALTER FUNCTION buscar_norma(TEXT, halfvec, DATE, INT, TEXT[], TEXT[]) OWNER TO vigia_jobs;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.norma_regla TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.buscar_norma(TEXT, halfvec, DATE, INT, TEXT[], TEXT[]) TO %I', r);
    END IF;
  END LOOP;
END $$;
