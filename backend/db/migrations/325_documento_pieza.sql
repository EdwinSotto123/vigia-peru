-- 325 · documento_pieza y pieza_lectura: cada PDF de un proceso con su TIPO, y lo que se lee de él.
--
-- Fase 1 del plan de extracción por tipo de documento (2026-11-16). Hasta hoy un «documento» era un archivo del SEACE con
-- su casillero (documentos_gcs.titulo), y los lectores leían varios juntos. Pero el casillero no es el tipo:
--   · el ZIP de «otorgamiento de buena pro» trae el reporte que genera el SEACE y, aparte, el acta firmada por el comité;
--   · el de «calificación y evaluación», el reporte de evaluación técnica y el cuadro firmado;
--   · en «declaratoria de desierto» hay informes y también actas; en «nulidad» aparecen informes de adelantos.
-- Una PIEZA es un PDF (suelto o dentro de un ZIP). Se registra con su tipo, de una lista cerrada, y con cómo se decidió ese
-- tipo (backend/lector/tipos.py): por la plantilla, por el nombre del archivo, por su título o, lo último, por el casillero.
--
-- pieza_lectura guarda lo leído de cada pieza. Empieza con los cinco reportes que genera el propio SEACE, que tienen
-- plantilla fija y se leen SIN modelo (backend/lector/plantillas.py; medidos contra el registro oficial: cuantía por ítem
-- 99,96 %, ganador 99,1 %, monto 99,1 %): quién presentó oferta y a qué hora, admisión, calificación y puntaje técnico por
-- postor, y lo adjudicado por ítem con los integrantes de cada consorcio. Los lectores con modelo pasan a escribir aquí,
-- una lectura por pieza, en la fase 2.
--
-- La llena backend/lector/piezas.py desde documentos_texto (no baja archivos ni llama a un modelo).
--
-- Privacidad: `salida` puede traer nombres de postores que son personas (RUC 10), como documento_lectura: la API tapa al
-- publicar. El DNI del usuario del SEACE que figura al pie de cada reporte no se lee ni se guarda.

SET lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.documento_pieza (
  id                 BIGSERIAL PRIMARY KEY,
  ocid               TEXT NOT NULL,
  sha256             TEXT NOT NULL,            -- del archivo guardado (documentos_gcs.sha256, documentos_texto.sha256)
  archivo            TEXT NOT NULL DEFAULT '', -- el nombre del archivo interno si el guardado es un ZIP; '' si es el documento
  doc_id             BIGINT,                   -- documentos_gcs.id
  casillero          TEXT,                     -- el título del SEACE, en mayúsculas
  tipo_documento     TEXT NOT NULL CHECK (tipo_documento IN (
                       'reporte_presentacion', 'reporte_evaluacion', 'reporte_otorgamiento', 'reporte_desempate',
                       'acta_no_formulacion', 'bases', 'bases_integradas', 'pliego_absolucion', 'acta_buena_pro',
                       'cuadro_evaluacion', 'contrato', 'orden', 'adenda', 'garantia', 'adicional', 'reduccion',
                       'ampliacion_plazo', 'resolucion_contrato', 'nulidad', 'informe_desierto', 'resumen_ejecutivo',
                       'presupuesto', 'ficha_tecnica', 'otro')),
  origen             TEXT NOT NULL CHECK (origen IN ('generado', 'firmado', 'anexo')),
  clasificado_por    TEXT NOT NULL CHECK (clasificado_por IN ('plantilla', 'nombre', 'titulo', 'casillero', 'modelo')),
  pag_ini            INT,                      -- sus páginas dentro de documentos_texto.paginas (numeración del documento)
  pag_fin            INT,
  paginas            INT,
  paginas_con_texto  INT,                      -- las demás son escaneos sin transcribir
  regimen            TEXT CHECK (regimen IN ('ley_32069', 'ley_30225')),
  nomenclatura       TEXT,                     -- la del procedimiento, como la dice el propio documento
  actualizado_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ocid, sha256, archivo)
);
COMMENT ON TABLE public.documento_pieza IS
  'Cada PDF de un proceso (suelto o dentro de un ZIP) con su tipo de documento, de una lista cerrada, y cómo se decidió. '
  'La llena backend/lector/piezas.py desde documentos_texto (migración 325).';
CREATE INDEX IF NOT EXISTS documento_pieza_ocid ON public.documento_pieza (ocid);
CREATE INDEX IF NOT EXISTS documento_pieza_tipo ON public.documento_pieza (tipo_documento);
CREATE INDEX IF NOT EXISTS documento_pieza_sha ON public.documento_pieza (sha256);

CREATE TABLE IF NOT EXISTS public.pieza_lectura (
  pieza_id    BIGINT NOT NULL REFERENCES public.documento_pieza (id) ON DELETE CASCADE,
  lector      TEXT NOT NULL,                   -- reporte_evaluacion, reporte_otorgamiento… (después: garantia, modificacion…)
  version     TEXT NOT NULL,
  modelo      TEXT NOT NULL,                   -- 'plantilla' cuando no hubo modelo
  estado      TEXT NOT NULL,                   -- ok | parcial (quedaron líneas sin calzar o páginas sin leer) | error…
  salida      JSONB,
  sobrante    INT NOT NULL DEFAULT 0,          -- líneas del documento que no calzaron con la plantilla
  tokens_in   INT,
  tokens_out  INT,
  costo_usd   NUMERIC(10, 6) NOT NULL DEFAULT 0,
  detalle     TEXT,
  leido_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pieza_id, lector, version)
);
COMMENT ON TABLE public.pieza_lectura IS
  'Lo leído de cada pieza (documento_pieza): con plantilla, sin modelo, los reportes que genera el SEACE; con modelo, los '
  'demás tipos. Sólo las lecturas en estado ok dan hechos comprobados (migración 325).';
CREATE INDEX IF NOT EXISTS pieza_lectura_lector ON public.pieza_lectura (lector, estado);

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.documento_pieza OWNER TO vigia_jobs;
    ALTER TABLE public.pieza_lectura OWNER TO vigia_jobs;
    ALTER SEQUENCE public.documento_pieza_id_seq OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.documento_pieza, public.pieza_lectura TO %I', r);
    END IF;
  END LOOP;
END $$;
