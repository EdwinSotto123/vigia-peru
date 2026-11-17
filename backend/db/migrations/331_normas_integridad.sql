-- 331 · RAG normativo: las normas de INTEGRIDAD no entran en la búsqueda general (2026-11-17).
--
-- Se suman al corpus (tablas norma y norma_fragmento) la gestión de intereses y el registro de visitas (Ley 28024 y su
-- Reglamento), el Código de Ética de la Función Pública (Ley 27815 y su Reglamento), la declaración jurada de intereses
-- (Ley 31227 y su Reglamento), los impedimentos al dejar el cargo (Ley 27588 hasta el 19-07-2023; desde el 20, Ley 31564
-- y su Reglamento) y los delitos contra la administración pública del Código Penal. Todas con materia 'integridad'.
--
-- Como con empleo público y con los regímenes especiales (migración 287: cargar un régimen especial sin excluirlo bajó
-- la medición de 93,2 % a 89 %), esas normas sólo salen si se piden: buscar_norma(…, p_materias => ARRAY['integridad']).
-- La búsqueda general del analista legal (p_materias NULL) no las trae.
--
-- La función es la de la migración 290 (dos pasadas, candidatos por clase, título a la mitad); sólo cambia la lista de
-- materias excluidas. CREATE OR REPLACE conserva el dueño y los permisos, pero NO el SET de hnsw.ef_search: se repite.

-- Usar un tipo de pgvector carga su biblioteca en la sesión: sin eso, hnsw.ef_search es un parámetro desconocido y el
-- ALTER FUNCTION … SET de abajo se rechaza (migración 290).
SELECT '[1,2,3]'::vector <=> '[1,2,3]'::vector AS pgvector_cargado;

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
       -- Sin materias pedidas: todo menos empleo público (CAS y planillas), los regímenes especiales y la integridad
       -- (gestión de intereses, ética, declaración jurada de intereses, impedimentos y delitos de funcionarios).
       AND CASE WHEN p_materias IS NULL THEN n.materia NOT IN ('empleo_publico', 'especial', 'integridad') ELSE n.materia = ANY (p_materias) END
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
  -- Los candidatos se toman POR CLASE: los 60 mejores artículos y, aparte, los 60 mejores criterios (migr. 289).
  -- En dos pasadas (migr. 290): la pregunta casa por alguna palabra con la mitad del corpus, y puntuar todo con
  -- ts_rank_cd tardaba 1 a 3 s. Primero ts_rank (barato) deja 250 por clase; sólo a esos se les calcula el puntaje fino.
  palabras AS (
    SELECT x.id, x.rango FROM (
      SELECT y.id, row_number() OVER (PARTITION BY y.es_norma
                                      ORDER BY (ts_rank_cd(y.tsv, y.q, 32) + 0.5 * ts_rank_cd(y.tsv_titulo, y.q, 32)) DESC)::int AS rango
        FROM (SELECT f.id, f.tsv, f.tsv_titulo, c.q, (p.aplica = 'norma') AS es_norma,
                     row_number() OVER (PARTITION BY (p.aplica = 'norma') ORDER BY ts_rank(f.tsv, c.q, 32) DESC) AS pre
                FROM norma_fragmento f JOIN permitidas p ON p.slug = f.slug, consulta c
               WHERE c.q IS NOT NULL AND f.tsv @@ c.q) y
       WHERE y.pre <= 250) x
     WHERE x.rango <= 60
  ),
  -- Por vector: los 300 más cercanos por el índice (hnsw.ef_search = 300 en la función) y de ahí 60 por clase.
  cercanos AS MATERIALIZED (
    SELECT f.id, f.slug, f.embedding <=> p_vec AS d
      FROM norma_fragmento f
     WHERE p_vec IS NOT NULL AND f.embedding IS NOT NULL
     ORDER BY f.embedding <=> p_vec LIMIT 300
  ),
  vector AS (
    SELECT x.id, x.rango FROM (
      SELECT k.id, row_number() OVER (PARTITION BY (p.aplica = 'norma') ORDER BY k.d)::int AS rango
        FROM cercanos k JOIN permitidas p ON p.slug = k.slug) x
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
ALTER FUNCTION buscar_norma(TEXT, halfvec, DATE, INT, TEXT[], TEXT[]) SET hnsw.ef_search = 300;
