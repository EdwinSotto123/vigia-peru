-- RAG normativo en la base propia, con FECHA y JERARQUÍA (2026-11-15).
--
-- Auditoría del RAG normativo que usa el agente legal (Chroma Cloud, 7 465 trozos en 4 colecciones), con 12 preguntas
-- típicas y el régimen vigente (Ley 32069):
--   · 45 de 96 resultados eran opiniones y acuerdos, y 37 de esos 45 se emitieron bajo la ley ANTERIOR (2020-2024):
--     llegan sin decir que interpretan la Ley 30225 y con su numeración de artículos; el agente los cita como vigentes.
--   · en varios temas las opiniones viejas desplazan al artículo vigente (impedimentos: 4 opiniones de 2022 y ningún
--     artículo de la ley; contratación directa por emergencia: sólo opiniones);
--   · la búsqueda es sólo por vectores (sin palabras exactas: «artículo 45», «fraccionamiento») y sin jerarquía;
--   · el catálogo trae régimen y vigencia por documento, pero la consulta no los usa para los criterios.
--
-- Aquí:
--   norma            el catálogo: una fila por norma o criterio, con su tipo, su JERARQUÍA (1 ley … 6 control), su
--                    RÉGIMEN (32069 | 30225 | ambos), cuándo se emitió y entre qué fechas rige.
--   norma_fragmento  los trozos (un artículo, una conclusión de opinión, un numeral de directiva) con su artículo, el
--                    texto, el índice de palabras (español, sin tildes) y el vector (bge-m3, 1 024, como rag_fragmento).
--   buscar_norma()   búsqueda HÍBRIDA (palabras + vector, fusionadas por rango recíproco) que recibe la FECHA de la
--                    convocatoria y devuelve, por cada trozo, su `aplica`:
--                      'norma'              ley, reglamento, directiva o bases estándar que regían en esa fecha;
--                      'criterio'           acuerdo, precedente u opinión del MISMO régimen (o de ambos);
--                      'criterio_anterior'  opinión o acuerdo del OTRO régimen: sirve por analogía y hay que decirlo;
--                    las normas del otro régimen NO salen. La jerarquía pondera el orden (una ley pesa más que una opinión).
--
-- La carga (backend/scripts/cargar_normas.py) trae lo que ya había en Chroma y lo que se descargue después.

CREATE TABLE IF NOT EXISTS norma (
  slug            TEXT PRIMARY KEY,
  documento       TEXT NOT NULL,           -- nombre corto para citar
  numero          TEXT,
  emisor          TEXT,
  tipo            TEXT NOT NULL CHECK (tipo IN ('ley', 'reglamento', 'directiva', 'bases_estandar', 'acuerdo_sala_plena',
                                                'precedente', 'opinion', 'resolucion_tribunal', 'control', 'otra')),
  jerarquia       SMALLINT NOT NULL,       -- 1 ley, 2 reglamento, 3 directiva y bases estándar, 4 acuerdo o precedente, 5 opinión, 6 control
  regimen         TEXT NOT NULL CHECK (regimen IN ('32069', '30225', 'ambos')),
  fecha_emision   DATE,
  vigencia_desde  DATE,
  vigencia_hasta  DATE,                    -- NULL = sigue vigente
  url_oficial     TEXT,
  url_pdf         TEXT,
  origen          TEXT,                    -- chroma | descarga | manual
  nota            TEXT,
  actualizado_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS norma_fragmento (
  id            BIGSERIAL PRIMARY KEY,
  slug          TEXT NOT NULL REFERENCES norma (slug) ON DELETE CASCADE,
  orden         INT NOT NULL,
  articulo      TEXT,                      -- «45», «45.2»; NULL si el trozo no es de un artículo
  epigrafe      TEXT,                      -- título del artículo o de la sección
  pagina        INT,
  texto         TEXT NOT NULL,
  temas         TEXT[] NOT NULL DEFAULT '{}',
  tsv           TSVECTOR GENERATED ALWAYS AS (
                  to_tsvector('spanish'::regconfig,
                              translate(lower(coalesce(epigrafe, '') || ' ' || texto), 'áéíóúüñ', 'aeiouun'))) STORED,
  embedding     halfvec(1024),
  hash          TEXT NOT NULL,
  UNIQUE (slug, orden)
);
CREATE INDEX IF NOT EXISTS norma_fragmento_tsv ON norma_fragmento USING gin (tsv);
CREATE INDEX IF NOT EXISTS norma_fragmento_embedding ON norma_fragmento USING hnsw (embedding halfvec_cosine_ops);
CREATE INDEX IF NOT EXISTS norma_fragmento_articulo ON norma_fragmento (slug, articulo);
CREATE INDEX IF NOT EXISTS norma_fragmento_pendiente ON norma_fragmento (id) WHERE embedding IS NULL;

-- El régimen que rige una convocatoria por su fecha (Ley 32069 desde el 22-04-2025).
CREATE OR REPLACE FUNCTION regimen_de(p_fecha DATE) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN COALESCE(p_fecha, CURRENT_DATE) >= DATE '2025-04-22' THEN '32069' ELSE '30225' END $$;

/**
 * Búsqueda híbrida con fecha. `p_vec` puede ser NULL (sólo palabras). Devuelve hasta `p_n` trozos, ya con su `aplica`.
 * Las palabras van con O (un trozo que tiene tres de las cinco pesa más que uno con una), sobre el texto sin tildes.
 */
CREATE OR REPLACE FUNCTION buscar_norma(p_q TEXT, p_vec halfvec, p_fecha DATE, p_n INT DEFAULT 40, p_tipos TEXT[] DEFAULT NULL)
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

ALTER TABLE norma OWNER TO vigia_jobs;
ALTER TABLE norma_fragmento OWNER TO vigia_jobs;
ALTER FUNCTION buscar_norma(TEXT, halfvec, DATE, INT, TEXT[]) OWNER TO vigia_jobs;
ALTER FUNCTION regimen_de(DATE) OWNER TO vigia_jobs;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.norma, public.norma_fragmento TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.buscar_norma(TEXT, halfvec, DATE, INT, TEXT[]) TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.regimen_de(DATE) TO %I', r);
    END IF;
  END LOOP;
END $$;
