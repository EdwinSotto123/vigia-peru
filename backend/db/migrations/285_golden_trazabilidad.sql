-- Trazabilidad de las pruebas de oro en la base, para el panel de administración (2026-11-15).
--
-- Las pruebas de oro (contratos leídos a mano, con las señales que DEBEN salir y las que no) viven en una carpeta fuera
-- del repositorio, y el resultado de cada corrida, en archivos sueltos de quien la lanzó. No se podía ver en el panel
-- qué imagen pasó qué prueba, qué regla falla ni en qué contrato. Aquí:
--   golden_conjunto   un conjunto: bienes, servicios, consultoria, obras, directas, legal (lo que debe decir el analista
--                     legal y con qué norma) y rag_normas (preguntas con el artículo que el RAG debe traer).
--   golden_caso       cada contrato (o pregunta) del conjunto con lo esperado por regla y su evidencia.
--   golden_corrida    cada corrida: conjunto, imagen del agente, cuándo, cuántos contratos, precisión, exhaustividad,
--                     F1, costo y tiempo medios, y el resumen por regla (aciertos, falsas alarmas, omisiones).
--   golden_resultado  por contrato de la corrida: qué acertó, qué falsas alarmas dio, qué omitió, tiempo, costo y, para
--                     el analista legal, las normas que citó y si existen y rigen en la fecha del contrato.
-- Las sube backend/scripts/golden_subir.py después de cada corrida. Sólo lectura para el panel (vigia_api_admin).

CREATE TABLE IF NOT EXISTS golden_conjunto (
  clave           TEXT PRIMARY KEY,
  nombre          TEXT NOT NULL,
  descripcion     TEXT,
  que_mide        TEXT,                    -- banderas | citas_legales | recuperacion
  casos           INT NOT NULL DEFAULT 0,
  actualizado_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS golden_caso (
  conjunto        TEXT NOT NULL REFERENCES golden_conjunto (clave) ON DELETE CASCADE,
  caso            TEXT NOT NULL,           -- OCID corto del contrato, o el id de la pregunta
  titulo          TEXT,
  perfil          TEXT,
  fecha           DATE,                    -- fecha de la convocatoria (decide el régimen)
  regimen         TEXT,
  esperado        JSONB NOT NULL,          -- {regla: {estado, severidad, evidencia}} o, en rag_normas, {pregunta, esperado[]}
  nota            TEXT,
  PRIMARY KEY (conjunto, caso)
);

CREATE TABLE IF NOT EXISTS golden_corrida (
  id              BIGSERIAL PRIMARY KEY,
  conjunto        TEXT NOT NULL REFERENCES golden_conjunto (clave) ON DELETE CASCADE,
  corrida         TEXT NOT NULL,           -- carpeta de la corrida (ab_out/<fecha-hora>) o nombre de la evaluación
  variante        TEXT NOT NULL DEFAULT '',
  imagen          TEXT,                    -- etiqueta de la imagen del agente (o el sistema evaluado: chroma, vigia_normas)
  ejecutada_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  contratos       INT NOT NULL,
  errores         INT NOT NULL DEFAULT 0,
  precision_pct   NUMERIC(5, 1),
  exhaustividad_pct NUMERIC(5, 1),
  f1              NUMERIC(4, 3),
  usd_medio       NUMERIC(8, 4),
  segundos_medio  NUMERIC(8, 1),
  por_regla       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {regla: [aciertos, falsas, omisiones]}
  metricas        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- lo propio del conjunto (citas legales, acierto@8, MRR…)
  nota            TEXT,
  UNIQUE (conjunto, corrida, variante)
);
CREATE INDEX IF NOT EXISTS golden_corrida_conjunto ON golden_corrida (conjunto, ejecutada_at DESC);

CREATE TABLE IF NOT EXISTS golden_resultado (
  corrida_id      BIGINT NOT NULL REFERENCES golden_corrida (id) ON DELETE CASCADE,
  caso            TEXT NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'ok',     -- ok | error
  aciertos        TEXT[] NOT NULL DEFAULT '{}',
  falsas_alarmas  TEXT[] NOT NULL DEFAULT '{}',
  omisiones       TEXT[] NOT NULL DEFAULT '{}',
  segundos        NUMERIC(8, 1),
  usd             NUMERIC(8, 4),
  detalle         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- evidencia emitida por regla, citas legales y su validez
  PRIMARY KEY (corrida_id, caso)
);

ALTER TABLE golden_conjunto OWNER TO vigia_jobs;
ALTER TABLE golden_caso OWNER TO vigia_jobs;
ALTER TABLE golden_corrida OWNER TO vigia_jobs;
ALTER TABLE golden_resultado OWNER TO vigia_jobs;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.golden_conjunto, public.golden_caso, public.golden_corrida, public.golden_resultado TO %I', r);
      EXECUTE format('GRANT SELECT ON public.norma, public.norma_fragmento TO %I', r);
    END IF;
  END LOOP;
END $$;

INSERT INTO golden_conjunto (clave, nombre, descripcion, que_mide) VALUES
  ('bienes', 'Bienes', 'Contratos de bienes leídos a mano: qué señales deben salir y cuáles no.', 'banderas'),
  ('servicios', 'Servicios', 'Contratos de servicios leídos a mano.', 'banderas'),
  ('consultoria', 'Consultoría', 'Consultorías (de obra y generales) leídas a mano.', 'banderas'),
  ('obras', 'Obras', 'Obras leídas a mano, con su ejecución en INFOBRAS.', 'banderas'),
  ('directas', 'Contrataciones directas', 'Directas y regímenes especiales leídos a mano.', 'banderas'),
  ('legal', 'Analista legal', 'Lo que debe decir el analista legal en cada contrato de las otras pruebas, y si las normas que cita existen y regían en la fecha del proceso.', 'citas_legales'),
  ('rag_normas', 'RAG normativo', 'Preguntas con el artículo que el buscador de normas debe traer según la fecha: mide acierto, orden y si mezcla la ley anterior con la vigente.', 'recuperacion')
ON CONFLICT (clave) DO UPDATE SET nombre = EXCLUDED.nombre, descripcion = EXCLUDED.descripcion, que_mide = EXCLUDED.que_mide;
