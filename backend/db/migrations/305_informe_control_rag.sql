-- 305 · El buscador de lo que encontró la Contraloría: RAG de los objetivos y las observaciones de sus informes (2026-11-16).
--
-- Con las fichas leídas (migración 304), cada informe de control tiene su objetivo y sus observaciones en texto: los
-- «motivos» por los que la Contraloría señala responsabilidad. Aquí se vuelven buscables, por palabras y por significado,
-- para la API (GET /informes-control/buscar), el MCP (buscar_informes_control) y el redactor de informes en formato de
-- control (que busca observaciones parecidas a las que escribe).
--
--   informe_control_fragmento   un trozo por objetivo (orden 0) y por observación (orden n), con el tema que le dio la
--                               lectura de IA (lista cerrada, NULL mientras no se lea), el título del informe como
--                               `contexto` (pesa en las palabras con peso C y va al modelo delante del texto), el índice
--                               de palabras (español, sin tildes: la misma expresión que norma_fragmento) y el vector de
--                               bge-m3 (1 024, halfvec), como norma_fragmento y rag_fragmento. `hash` = md5(contexto,
--                               texto): si no cambia, el vector se conserva.
--   refrescar_informe_control_fragmento()   arma los trozos desde informe_control_ficha.campos (inserta lo nuevo,
--                               cambia lo distinto, borra lo que ya no está y pone el tema). Lo llama el script de carga
--                               tras `cargar` y tras `leer`; los vectores los calcula su paso `indexar`.
--   buscar_informe_control(p_q, p_vec, p_entidad, p_desde, p_n)   búsqueda HÍBRIDA (palabras + vector, fusionadas por
--                               rango recíproco, como buscar_norma), con filtro por entidad (RUC de 11 dígitos o palabras
--                               de su nombre) y por fecha de emisión. Devuelve hasta p_n trozos, a lo más 3 por informe,
--                               con los datos del informe. `observacion` es el texto del trozo y `tema`, el de la
--                               observación ('objetivo' si el trozo es el objetivo del informe). ESTA FIRMA ES UN CONTRATO:
--                               la llaman la API y el redactor de informes.
--
-- La responsabilidad que señala un informe es PRESUNTA. Los textos pueden nombrar a alguien: quien publica pasa todo por
-- publicar() (backend/api/src/lib/privacidad.ts).

SET lock_timeout = '10s';

-- Usar un tipo de pgvector carga su biblioteca en la sesión: sin eso, hnsw.ef_search es un parámetro desconocido y el
-- ALTER FUNCTION … SET de abajo se rechaza (migración 290).
SELECT '[1,2,3]'::vector <=> '[1,2,3]'::vector AS pgvector_cargado;

CREATE TABLE IF NOT EXISTS informe_control_fragmento (
  id          BIGSERIAL   PRIMARY KEY,
  codigo      TEXT        NOT NULL REFERENCES informes_control (codigo) ON DELETE CASCADE,
  orden       INT         NOT NULL,                 -- 0 el objetivo; n la observación n de la ficha
  tipo        TEXT        NOT NULL CHECK (tipo IN ('objetivo', 'observacion')),
  tema        TEXT        CHECK (tema IN ('seleccion_contratacion', 'ejecucion_contractual', 'pagos_adelantos', 'personal_planillas',
                                          'bienes_almacen', 'presupuesto_tesoreria', 'otros')),
  contexto    TEXT,
  texto       TEXT        NOT NULL,
  tsv         TSVECTOR GENERATED ALWAYS AS (
                setweight(to_tsvector('spanish'::regconfig, translate(lower(texto), 'áéíóúüñ', 'aeiouun')), 'A') ||
                setweight(to_tsvector('spanish'::regconfig, translate(lower(coalesce(contexto, '')), 'áéíóúüñ', 'aeiouun')), 'C')) STORED,
  embedding   halfvec(1024),
  hash        TEXT        NOT NULL,
  indexado_at TIMESTAMPTZ,
  UNIQUE (codigo, orden)
);
COMMENT ON TABLE informe_control_fragmento IS
  'Trozos buscables de las fichas de los informes de control (objetivo y cada observación), con tema (IA), palabras y vector '
  'bge-m3. Los arma refrescar_informe_control_fragmento(); los busca buscar_informe_control(). Responsabilidad PRESUNTA.';
COMMENT ON COLUMN informe_control_fragmento.tema IS
  'Tema de la observación según la lectura de IA: seleccion_contratacion, ejecucion_contractual (u obra), pagos_adelantos, '
  'personal_planillas, bienes_almacen, presupuesto_tesoreria u otros. NULL en el objetivo y mientras no se lea.';
CREATE INDEX IF NOT EXISTS informe_control_fragmento_tsv ON informe_control_fragmento USING gin (tsv);
CREATE INDEX IF NOT EXISTS informe_control_fragmento_embedding ON informe_control_fragmento USING hnsw (embedding halfvec_cosine_ops);
CREATE INDEX IF NOT EXISTS informe_control_fragmento_pendiente ON informe_control_fragmento (id) WHERE embedding IS NULL;
ALTER TABLE informe_control_fragmento OWNER TO vigia_jobs;

/*
 * Los trozos desde las fichas leídas: el objetivo (orden 0) y cada observación (orden n), con el título del informe como
 * contexto y el tema de la lectura de IA. Inserta lo nuevo, cambia lo distinto (si cambia el texto o el contexto, el
 * vector se borra para recalcularlo), borra lo que ya no está. ~40 mil trozos: segundos.
 */
CREATE OR REPLACE FUNCTION refrescar_informe_control_fragmento()
RETURNS TABLE (trozos INT, nuevos_o_cambiados INT, borrados INT, sin_vector INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_cambios INT;
  v_borrados INT;
BEGIN
  DROP TABLE IF EXISTS _icf_deseado;
  CREATE TEMP TABLE _icf_deseado ON COMMIT DROP AS
  SELECT d.codigo, d.orden, d.tipo, d.tema, d.contexto, d.texto,
         md5(coalesce(d.contexto, '') || E'\n\n' || d.texto) AS hash
    FROM (
      SELECT f.codigo, 0 AS orden, 'objetivo'::text AS tipo, NULL::text AS tema,
             nullif(btrim(coalesce(i.titulo, f.campos ->> 'titulo')), '') AS contexto, btrim(f.campos ->> 'objetivo') AS texto
        FROM informe_control_ficha f JOIN informes_control i ON i.codigo = f.codigo
       WHERE length(coalesce(f.campos ->> 'objetivo', '')) >= 20
      UNION ALL
      SELECT f.codigo, (o ->> 'n')::int, 'observacion',
             CASE WHEN ia.tema IN ('seleccion_contratacion', 'ejecucion_contractual', 'pagos_adelantos', 'personal_planillas',
                                   'bienes_almacen', 'presupuesto_tesoreria', 'otros') THEN ia.tema
                  WHEN ia.tema IS NOT NULL THEN 'otros' END,
             nullif(btrim(coalesce(i.titulo, f.campos ->> 'titulo')), ''), btrim(o ->> 'texto')
        FROM informe_control_ficha f
        JOIN informes_control i ON i.codigo = f.codigo
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(f.campos -> 'observaciones') = 'array'
                                                     THEN f.campos -> 'observaciones' ELSE '[]'::jsonb END) o
        LEFT JOIN LATERAL (
          SELECT x ->> 'tema' AS tema
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f.campos -> 'ia' -> 'observaciones') = 'array'
                                           THEN f.campos -> 'ia' -> 'observaciones' ELSE '[]'::jsonb END) x
           WHERE x ->> 'n' = o ->> 'n' LIMIT 1) ia ON true
       WHERE (o ->> 'n') ~ '^\d{1,3}$' AND length(coalesce(o ->> 'texto', '')) >= 20
    ) d;
  ANALYZE _icf_deseado;

  DELETE FROM informe_control_fragmento f
   WHERE NOT EXISTS (SELECT 1 FROM _icf_deseado d WHERE d.codigo = f.codigo AND d.orden = f.orden);
  GET DIAGNOSTICS v_borrados = ROW_COUNT;

  INSERT INTO informe_control_fragmento AS f (codigo, orden, tipo, tema, contexto, texto, hash)
  SELECT codigo, orden, tipo, tema, contexto, texto, hash FROM _icf_deseado
  ON CONFLICT (codigo, orden) DO UPDATE
     SET tipo = EXCLUDED.tipo, tema = EXCLUDED.tema, contexto = EXCLUDED.contexto, texto = EXCLUDED.texto, hash = EXCLUDED.hash,
         embedding = CASE WHEN f.hash = EXCLUDED.hash THEN f.embedding END,
         indexado_at = CASE WHEN f.hash = EXCLUDED.hash THEN f.indexado_at END
   WHERE (f.tipo, f.tema, f.hash) IS DISTINCT FROM (EXCLUDED.tipo, EXCLUDED.tema, EXCLUDED.hash);
  GET DIAGNOSTICS v_cambios = ROW_COUNT;

  RETURN QUERY
  SELECT count(*)::int, v_cambios, v_borrados, count(*) FILTER (WHERE embedding IS NULL)::int FROM informe_control_fragmento;
END $$;
ALTER FUNCTION refrescar_informe_control_fragmento() OWNER TO vigia_jobs;

/*
 * Búsqueda híbrida en lo que encontró la Contraloría. `p_vec` puede ser NULL (sólo palabras); `p_entidad`, un RUC de 11
 * dígitos o palabras del nombre de la entidad (todas deben estar); `p_desde`, la fecha de emisión mínima.
 *   · palabras: las de la pregunta con O sobre el texto sin tildes (el título del informe cuenta con peso C); ts_rank
 *     (barato) deja 250 candidatos y ts_rank_cd ordena los 60 mejores (migración 290);
 *   · vector: los 300 más cercanos por el índice HNSW (hnsw.ef_search = 300) y, si hay un filtro que deja pocos
 *     informes (≤ 3 000), además la distancia exacta a todos los trozos de esos informes; de ahí los 60 mejores;
 *   · fusión por rango recíproco (k = 60); el objetivo pesa 0,8 frente a una observación; a lo más 3 trozos por informe.
 */
CREATE OR REPLACE FUNCTION buscar_informe_control(p_q TEXT, p_vec halfvec, p_entidad TEXT DEFAULT NULL, p_desde DATE DEFAULT NULL,
                                                  p_n INT DEFAULT 10)
RETURNS TABLE (codigo TEXT, numero TEXT, titulo TEXT, entidad_nombre TEXT, entidad_ruc TEXT, fecha_emision DATE, modalidad TEXT,
               responsabilidades TEXT[], observacion TEXT, tema TEXT, score DOUBLE PRECISION)
LANGUAGE sql STABLE AS $$
  WITH ent AS (
    SELECT nullif(btrim(coalesce(p_entidad, '')), '') AS e
  ),
  palabras_entidad AS (
    SELECT coalesce(array_agg('%' || w || '%'), '{}') AS ws
      FROM ent, unnest(regexp_split_to_array(upper(public.immutable_unaccent(coalesce(ent.e, ''))), '[^A-Z0-9]+')) w
     WHERE ent.e IS NOT NULL AND ent.e !~ '^\d{11}$' AND length(w) >= 3 AND w NOT IN ('DEL', 'LOS', 'LAS', 'SAC', 'SAA')
  ),
  hay AS (
    SELECT (ent.e IS NOT NULL OR p_desde IS NOT NULL) AS f FROM ent
  ),
  filtro AS MATERIALIZED (
    SELECT i.codigo
      FROM informes_control i, ent, palabras_entidad pe, hay
     WHERE hay.f
       AND (ent.e IS NULL
            OR (ent.e ~ '^\d{11}$' AND i.entidad_ruc = ent.e)
            OR (ent.e !~ '^\d{11}$' AND cardinality(pe.ws) > 0 AND upper(public.immutable_unaccent(i.entidad_nombre)) LIKE ALL (pe.ws)))
       AND (p_desde IS NULL OR coalesce(i.fecha_emision, i.fecha_publicacion) >= p_desde)
  ),
  consulta AS (
    SELECT (SELECT string_agg(quote_literal(l), ' | ')
              FROM unnest(tsvector_to_array(to_tsvector('spanish', translate(lower(coalesce(p_q, '')), 'áéíóúüñ', 'aeiouun')))) l)::tsquery AS q
  ),
  palabras AS (
    SELECT x.id, x.rango FROM (
      SELECT y.id, row_number() OVER (ORDER BY ts_rank_cd(y.tsv, y.q, 32) DESC, y.id)::int AS rango
        FROM (SELECT f.id, f.tsv, c.q
                FROM informe_control_fragmento f, consulta c, hay
               WHERE c.q IS NOT NULL AND f.tsv @@ c.q
                 AND (NOT hay.f OR f.codigo IN (SELECT fl.codigo FROM filtro fl))
               ORDER BY ts_rank(f.tsv, c.q, 32) DESC, f.id LIMIT 250) y) x
     WHERE x.rango <= 60
  ),
  cercanos AS MATERIALIZED (
    SELECT f.id, f.codigo, f.embedding <=> p_vec AS d
      FROM informe_control_fragmento f
     WHERE p_vec IS NOT NULL AND f.embedding IS NOT NULL
     ORDER BY f.embedding <=> p_vec LIMIT 300
  ),
  acotados AS MATERIALIZED (
    SELECT f.id, f.embedding <=> p_vec AS d
      FROM informe_control_fragmento f
     WHERE p_vec IS NOT NULL AND f.embedding IS NOT NULL
       AND (SELECT h.f FROM hay h) AND (SELECT count(*) FROM filtro) <= 3000
       AND f.codigo IN (SELECT fl.codigo FROM filtro fl)
     ORDER BY (f.embedding <=> p_vec) + 0.0 LIMIT 300
  ),
  vector AS (
    SELECT v.id, row_number() OVER (ORDER BY v.d, v.id)::int AS rango
      FROM (SELECT u.id, min(u.d) AS d
              FROM (SELECT k.id, k.d FROM cercanos k, hay
                     WHERE NOT hay.f OR k.codigo IN (SELECT fl.codigo FROM filtro fl)
                    UNION ALL
                    SELECT a.id, a.d FROM acotados a) u
             GROUP BY u.id) v
     ORDER BY v.d, v.id LIMIT 60
  ),
  fusion AS (
    SELECT coalesce(a.id, v.id) AS id,
           coalesce(1.0 / (60 + a.rango), 0) + coalesce(1.0 / (60 + v.rango), 0) AS rrf
      FROM palabras a FULL JOIN vector v ON v.id = a.id
  ),
  puntuados AS (
    SELECT f.codigo, f.orden, f.tipo, f.tema, f.texto,
           (x.rrf * CASE f.tipo WHEN 'objetivo' THEN 0.8 ELSE 1.0 END)::double precision AS score
      FROM fusion x JOIN informe_control_fragmento f ON f.id = x.id
  ),
  por_informe AS (
    SELECT p.*, row_number() OVER (PARTITION BY p.codigo ORDER BY p.score DESC, p.orden) AS puesto FROM puntuados p
  )
  SELECT p.codigo, i.numero, i.titulo, i.entidad_nombre, btrim(i.entidad_ruc)::text, coalesce(i.fecha_emision, i.fecha_publicacion),
         i.modalidad, i.responsabilidades, p.texto,
         CASE WHEN p.tipo = 'objetivo' THEN 'objetivo' ELSE p.tema END,
         round(p.score::numeric, 6)::double precision
    FROM por_informe p JOIN informes_control i ON i.codigo = p.codigo
   WHERE p.puesto <= 3
   ORDER BY p.score DESC, p.codigo, p.orden
   LIMIT least(greatest(coalesce(p_n, 10), 1), 100)
$$;
ALTER FUNCTION buscar_informe_control(TEXT, halfvec, TEXT, DATE, INT) OWNER TO vigia_jobs;
ALTER FUNCTION buscar_informe_control(TEXT, halfvec, TEXT, DATE, INT) SET hnsw.ef_search = 300;

-- ─── Permisos ────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Datos públicos (lo que la Contraloría publica en sus fichas): leen la API, el panel, el MCP y los agentes (el redactor
-- de informes). Escribe sólo vigia_jobs (dueño); los privilegios por defecto de la 43 darían escritura a vigia_agentes.
REVOKE ALL ON informe_control_fragmento FROM PUBLIC;
REVOKE ALL ON FUNCTION refrescar_informe_control_fragmento() FROM PUBLIC;
-- En DEV la API entra como dev_api y el panel como dev_api_admin (migraciones 213 y 302): también para la ficha (304).
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab', 'dev_api', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON informe_control_fragmento FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION refrescar_informe_control_fragmento() FROM %I', r);
      EXECUTE format('GRANT SELECT ON informe_control_fragmento TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION buscar_informe_control(TEXT, halfvec, TEXT, DATE, INT) TO %I', r);
      -- La ficha: todo menos el texto entero (trae nombres y DNI).
      EXECUTE format('REVOKE ALL ON informe_control_ficha FROM %I', r);
      EXECUTE format('GRANT SELECT (codigo, paginas, bytes, sha256, descargado_at, campos, actualizado_at) ON informe_control_ficha TO %I', r);
    END IF;
  END LOOP;
END $$;
