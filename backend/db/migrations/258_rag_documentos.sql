-- 258 · RAG de documentos: buscar en el TEXTO de bases, actas, contratos, pliegos de consultas y dictámenes (2026-11-06).
--
-- Para «¿qué exigían las bases de este proceso?», «¿por qué descalificaron a los postores?», «¿qué dice el dictamen sobre
-- la marca?» o «¿en qué contratos de Ate se pidió experiencia en eventos?» (GET /documentos/buscar, routes/documentos.ts;
-- lo usan el MCP de Gobserva y el chat del panel). Búsqueda híbrida: texto completo en español (tsv, GIN) y significado
-- (embedding de @cf/baai/bge-m3 por Workers AI, HNSW), fusionadas por rango recíproco en la API (lib/rag.ts).
-- Es aparte del RAG normativo (backend/rag, leyes en Chroma Cloud): aquí sólo hay documentos de los procesos.
--
--   rag_origen        una fila por fuente troceada y la huella con que se troceó (si cambia, se vuelve a trocear):
--     · documento        documentos_texto (texto extraído de los PDF/ZIP del SEACE), origen_id = sha256
--     · lectura          documento_lectura (lo que Claude leyó del acta, las bases, el pliego y el contrato), la más nueva
--                        de cada (ocid, clase) sin las segundas lecturas «-2»; origen_id = ocid:clase
--     · dictamen         alertas.dictamen_markdown de las alertas PUBLICADAS (alerta_publicada y no demo, como
--                        lib/publicacion.ts); origen_id = alertas.id. Si una alerta deja de estar publicada, la siguiente
--                        vuelta borra sus fragmentos (y la búsqueda vuelve a mirar el estado por si acaso).
--     · informe_control  informes_control (título, modalidad y entidad del informe de la Contraloría); origen_id = codigo
--   rag_fragmento     los trozos (~700-900 tokens, con solape, por párrafos y secciones; página cuando la fuente la
--                     tiene). `tsv` se genera con la MISMA expresión que la 255 (español, minúsculas, sin tildes con
--                     translate, que es inmutable; unaccent no lo es): la API arma la consulta igual (lib/rag.ts).
--                     `embedding` NULL = falta calcularlo; `reclamado_at` reparte el trabajo entre llamadas paralelas.
--                     `hash` = md5 de lo que se manda al modelo (título + texto): un trozo igual reusa el embedding.
--   rag_linea_comun   líneas que se repiten en 20 procesos o más (el texto de las bases estándar: ~40 % de los
--                     caracteres de documentos_texto en DEV). El troceo las salta: no aportan a ninguna pregunta y
--                     llenarían los resultados de copias del modelo. Huella = md5 de la línea normalizada (minúsculas,
--                     sin tildes, sólo letras y cifras): la misma cuenta que huellaLinea() de lib/ragTexto.ts.
--   rag_estado        una fila: cuándo se recalcularon las líneas comunes.
--
--   rag_refrescar_lineas(p_minimo, p_dias)  recalcula rag_linea_comun si tiene más de p_dias (0 = siempre): ~75 s en
--                     DEV. Lo llama POST /admin/rag/indexar (una vez al mes, desde el cron de 10 min) y esta migración.
--
-- Permisos: escribe la API desde el panel (vigia_api_admin: POST /admin/rag/indexar y el cron de /admin/asignar); lee
-- la API pública (vigia_api). Ningún otro rol: el texto de los documentos trae nombres y documentos de personas y la API
-- los tapa al publicar (lib/privacidad.ts).
--
-- DEV:  python -X utf8 backend/scripts/aplicar_migracion.py dev backend/db/migrations/258_rag_documentos.sql
-- PROD: python -X utf8 backend/scripts/aplicar_migracion.py prod backend/db/migrations/258_rag_documentos.sql
-- Llenado inicial (trocear y calcular embeddings): backend/scripts/rag_indexar.py (llama al endpoint en paralelo).

SET lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS rag_origen (
  origen         text        NOT NULL CHECK (origen IN ('documento', 'lectura', 'dictamen', 'informe_control')),
  origen_id      text        NOT NULL,
  hash           text        NOT NULL,              -- la huella de la fuente cuando se troceó (+ la versión del troceo)
  fragmentos     int         NOT NULL DEFAULT 0,
  troceado_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (origen, origen_id)
);

CREATE TABLE IF NOT EXISTS rag_fragmento (
  id            bigserial   PRIMARY KEY,
  origen        text        NOT NULL,
  origen_id     text        NOT NULL,
  ocid          text,                                -- corto (ocid_corto), como documentos_texto
  entidad_ruc   text,
  anio          smallint,
  tipo          text        NOT NULL,                -- bases | buena_pro | consultas | contrato | evaluacion | … | dictamen | informe_control
  titulo        text,
  url           text,
  pagina        int,
  orden         int         NOT NULL,
  texto         text        NOT NULL,
  tsv           tsvector    GENERATED ALWAYS AS (
                  to_tsvector('spanish'::regconfig,
                              translate(lower(coalesce(titulo, '') || ' ' || texto), 'áéíóúüñ', 'aeiouun'))) STORED,
  embedding     halfvec(1024),
  hash          text        NOT NULL,
  creado_at     timestamptz NOT NULL DEFAULT now(),
  indexado_at   timestamptz,
  reclamado_at  timestamptz,
  FOREIGN KEY (origen, origen_id) REFERENCES rag_origen (origen, origen_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS rag_fragmento_tsv ON rag_fragmento USING gin (tsv);
-- pgvector 0.8 (halfvec desde 0.7): HNSW por coseno. Las búsquedas con filtro usan hnsw.iterative_scan (lib/rag.ts).
CREATE INDEX IF NOT EXISTS rag_fragmento_embedding ON rag_fragmento USING hnsw (embedding halfvec_cosine_ops);
CREATE INDEX IF NOT EXISTS rag_fragmento_ocid ON rag_fragmento (ocid);
CREATE INDEX IF NOT EXISTS rag_fragmento_entidad ON rag_fragmento (entidad_ruc, anio);
CREATE INDEX IF NOT EXISTS rag_fragmento_origen ON rag_fragmento (origen, origen_id);
CREATE INDEX IF NOT EXISTS rag_fragmento_hash ON rag_fragmento (hash);
-- Los que faltan embeber (se vacía a medida que se llenan).
CREATE INDEX IF NOT EXISTS rag_fragmento_pendiente ON rag_fragmento (id) WHERE embedding IS NULL;

CREATE TABLE IF NOT EXISTS rag_linea_comun (
  huella    text PRIMARY KEY,
  procesos  int  NOT NULL
);

CREATE TABLE IF NOT EXISTS rag_estado (
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  lineas_at          timestamptz,
  lineas             int,
  lineas_segundos    numeric
);

-- Las líneas del modelo estándar: una línea que aparece en p_minimo procesos distintos o más (40 caracteres o más ya
-- normalizada: los títulos cortos se quedan, ordenan el texto). Sin SECURITY DEFINER: corre con el rol de la API, que
-- lee documentos_texto (vigia_jobs no).
CREATE OR REPLACE FUNCTION rag_refrescar_lineas(p_minimo int DEFAULT 20, p_dias numeric DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp SET work_mem = '256MB' AS $$
DECLARE
  t0 timestamptz := clock_timestamp();
  v_ultimo timestamptz;
  n int;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('rag_refrescar_lineas')) THEN
    RETURN jsonb_build_object('ocupado', true);
  END IF;
  SELECT lineas_at INTO v_ultimo FROM rag_estado WHERE id;
  IF COALESCE(p_dias, 0) > 0 AND v_ultimo IS NOT NULL AND v_ultimo > now() - make_interval(secs => (p_dias * 86400)::double precision) THEN
    RETURN jsonb_build_object('refrescado', false, 'ultimo', v_ultimo);
  END IF;
  DELETE FROM rag_linea_comun;
  INSERT INTO rag_linea_comun (huella, procesos)
  SELECT md5(x.n), count(DISTINCT x.ocid)
    FROM (SELECT t.ocid,
                 btrim(regexp_replace(translate(lower(l), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun'), '[^a-z0-9]+', ' ', 'g')) AS n
            FROM documentos_texto t, regexp_split_to_table(t.texto, E'\n') l) x
   WHERE length(x.n) >= 40
   GROUP BY 1
  HAVING count(DISTINCT x.ocid) >= p_minimo;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO rag_estado (id, lineas_at, lineas, lineas_segundos)
  VALUES (true, now(), n, round(extract(epoch FROM clock_timestamp() - t0)::numeric, 1))
  ON CONFLICT (id) DO UPDATE SET lineas_at = EXCLUDED.lineas_at, lineas = EXCLUDED.lineas, lineas_segundos = EXCLUDED.lineas_segundos;
  RETURN jsonb_build_object('refrescado', true, 'lineas', n, 'segundos', round(extract(epoch FROM clock_timestamp() - t0)::numeric, 1));
END $$;

-- ─── Permisos ────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Los privilegios por defecto (37, 43, 44) le dan SELECT a otros roles en toda tabla nueva: fuera.
REVOKE ALL ON rag_origen, rag_fragmento, rag_linea_comun, rag_estado FROM PUBLIC;
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_mcp', 'vigia_ab', 'vigia_agentes', 'vigia_jobs'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON rag_origen, rag_fragmento, rag_linea_comun, rag_estado FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE rag_fragmento_id_seq FROM %I', r);
    END IF;
  END LOOP;
END $$;
-- vigia_api_admin es miembro de vigia_api: el SELECT le llega también por ahí.
GRANT SELECT ON rag_fragmento, rag_estado TO vigia_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON rag_origen, rag_fragmento, rag_linea_comun, rag_estado TO vigia_api_admin;
GRANT USAGE, SELECT ON SEQUENCE rag_fragmento_id_seq TO vigia_api_admin;
REVOKE ALL ON FUNCTION rag_refrescar_lineas(int, numeric) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_agentes') THEN
    REVOKE ALL ON FUNCTION rag_refrescar_lineas(int, numeric) FROM vigia_agentes;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION rag_refrescar_lineas(int, numeric) TO vigia_api_admin;

-- Las líneas comunes de una vez (74 s en DEV; la migración entera, 83 s), así el primer troceo ya las salta.
SELECT rag_refrescar_lineas(20, 0);
