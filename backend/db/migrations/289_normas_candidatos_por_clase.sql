-- RAG normativo: los candidatos se eligen por clase (artículos aparte de criterios) (2026-11-15).
--
-- Al cargar las 1 005 opiniones de la DTN de 2019 a 2026 completas, la medición de 91 preguntas bajó de 96,7 % a 94,5 % y en
-- 5 preguntas lo primero dejó de ser un artículo: los 60 mejores candidatos «entre todos» eran sólo fragmentos de
-- opiniones y la respuesta salía sin la ley ni el reglamento. Ahora se toman los 60 mejores artículos y, aparte, los 60
-- mejores criterios, y la respuesta trae hasta p_n/2 de cada clase (norma, criterio, criterio_anterior).

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
  -- Los candidatos se toman POR CLASE: los 60 mejores artículos y, aparte, los 60 mejores criterios. Con mil opiniones
  -- en el corpus, los 60 mejores «entre todos» eran sólo opiniones y la respuesta salía sin ningún artículo (migr. 289).
  palabras AS (
    SELECT x.id, x.rango FROM (
      SELECT f.id, row_number() OVER (PARTITION BY (p.aplica = 'norma') ORDER BY (ts_rank_cd(f.tsv, c.q, 32) + 0.5 * ts_rank_cd(f.tsv_titulo, c.q, 32)) DESC)::int AS rango
        FROM norma_fragmento f JOIN permitidas p ON p.slug = f.slug, consulta c
       WHERE c.q IS NOT NULL AND f.tsv @@ c.q) x
     WHERE x.rango <= 60
  ),
  vector AS (
    SELECT x.id, x.rango FROM (
      SELECT f.id, row_number() OVER (PARTITION BY (p.aplica = 'norma') ORDER BY f.embedding <=> p_vec)::int AS rango
        FROM norma_fragmento f JOIN permitidas p ON p.slug = f.slug
       WHERE p_vec IS NOT NULL AND f.embedding IS NOT NULL) x
     WHERE x.rango <= 60
  ),
  fusion AS (
    SELECT COALESCE(a.id, v.id) AS id, a.rango AS rp, v.rango AS rv,
           COALESCE(1.0 / (60 + a.rango), 0) + COALESCE(1.0 / (60 + v.rango), 0) AS rrf
      FROM palabras a FULL JOIN vector v ON v.id = a.id
  )
  SELECT y.id, y.slug, y.documento, y.numero, y.tipo, y.jerarquia, y.regimen, y.aplica, y.fecha_emision, y.vigencia_desde,
         y.vigencia_hasta, y.articulo, y.epigrafe, y.pagina, y.texto, y.url_oficial, y.rp, y.rv, y.puntaje
    FROM (SELECT z.*, row_number() OVER (PARTITION BY z.aplica ORDER BY z.puntaje DESC) AS puesto FROM (
    SELECT f.id, p.slug, p.documento, p.numero, p.tipo, p.jerarquia, p.regimen, p.aplica, p.fecha_emision, p.vigencia_desde,
         p.vigencia_hasta, f.articulo, f.epigrafe, f.pagina, f.texto, p.url_oficial, x.rp, x.rv,
         -- La jerarquía pondera: ley y reglamento arriba; un criterio del otro régimen, a la mitad.
         x.rrf * (CASE p.jerarquia WHEN 1 THEN 1.30 WHEN 2 THEN 1.25 WHEN 3 THEN 0.90 WHEN 4 THEN 1.10 WHEN 5 THEN 1.00 ELSE 0.80 END)
               * (CASE p.aplica WHEN 'criterio_anterior' THEN 0.5 ELSE 1 END) AS puntaje
    FROM fusion x JOIN norma_fragmento f ON f.id = x.id JOIN permitidas p ON p.slug = f.slug
    ) z) y
   WHERE y.puesto <= GREATEST(p_n / 2, 10)
   ORDER BY y.puntaje DESC
$$;

ALTER FUNCTION buscar_norma(TEXT, halfvec, DATE, INT, TEXT[], TEXT[]) OWNER TO vigia_jobs;
