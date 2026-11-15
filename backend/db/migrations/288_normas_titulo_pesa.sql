-- RAG normativo: las palabras del TÍTULO del artículo pesan aparte en la búsqueda (2026-11-15).
--
-- «Artículo 34. Contratos menores» no salía entre los 8 primeros al preguntar por contratos menores de hasta 8 UIT: el
-- título se indexaba junto con el texto y un artículo largo que repite «UIT» le ganaba. Medido con las 91 preguntas de
-- backend/rag (evalset.jsonl y evalset_fechas.jsonl), sumando el rango del título con distintos pesos:
--
--     peso 0    94,5 % de acierto, MRR 0,741        peso 2    91,2 %, 0,760
--     peso 0,5  95,6 %, 0,780                       peso 4    85,7 %, 0,742
--     peso 1    95,6 %, 0,778
--
-- Con más peso pierden las opiniones y las directivas, que no tienen un título por fragmento. Queda en 0,5.

ALTER TABLE norma_fragmento ADD COLUMN IF NOT EXISTS tsv_titulo TSVECTOR GENERATED ALWAYS AS (
  to_tsvector('spanish'::regconfig, translate(lower(coalesce(epigrafe, '')), 'áéíóúüñ', 'aeiouun'))) STORED;

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
       -- Sin materias pedidas: todo menos empleo público (CAS y planillas) y los regímenes especiales.
       AND CASE WHEN p_materias IS NULL THEN n.materia NOT IN ('empleo_publico', 'especial') ELSE n.materia = ANY (p_materias) END
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
  -- El título del artículo cuenta aparte, con la mitad del peso del texto (medido: migración 288).
  palabras AS (
    SELECT f.id, row_number() OVER (ORDER BY (ts_rank_cd(f.tsv, c.q, 32) + 0.5 * ts_rank_cd(f.tsv_titulo, c.q, 32)) DESC)::int AS rango
      FROM norma_fragmento f JOIN permitidas p ON p.slug = f.slug, consulta c
     WHERE c.q IS NOT NULL AND f.tsv @@ c.q
     ORDER BY (ts_rank_cd(f.tsv, c.q, 32) + 0.5 * ts_rank_cd(f.tsv_titulo, c.q, 32)) DESC LIMIT 60
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

ALTER FUNCTION buscar_norma(TEXT, halfvec, DATE, INT, TEXT[], TEXT[]) OWNER TO vigia_jobs;
