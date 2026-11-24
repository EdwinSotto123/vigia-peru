-- 444 · La lectura previa de cada contrato: si sus documentos ya se leyeron ENTEROS antes de analizarlo (2026-11-24).
--
-- El OCR y la extracción corrían dentro del análisis y, con el límite de uso de Workers AI lleno, se perdían: en 7 días,
-- 4 143 de 4 684 análisis perdieron parte de sus documentos y 3 387 quedaron con uno o ningún ítem. Ahora
-- backend/scripts/lectura_previa.py lee todo antes (OCR abierto con vigia-ocr, extracción guardada en caché) y deja aquí
-- el resultado; el análisis masivo (backend/scripts/masivo_agentes.py) sólo toma los contratos con `completo`.
--
--   completo    todos sus documentos leídos sin páginas pendientes, extracción fallida ni descargas faltantes
--   faltas      lo que falta, para la próxima pasada: [«descarga:Bases Integradas [rar]: descarga_fallida», …]
--   costo_usd   lo que costó la extracción con el modelo (el OCR abierto se paga aparte, en Cloudflare)

CREATE TABLE IF NOT EXISTS lectura_previa (
  ocid            text PRIMARY KEY,
  completo        boolean NOT NULL,
  documentos      integer,
  omitidos        integer,
  items           integer,
  faltas          jsonb NOT NULL DEFAULT '[]'::jsonb,
  costo_usd       numeric,
  segundos        integer,
  actualizado_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lectura_previa_completo_idx ON lectura_previa (completo, actualizado_at);

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE lectura_previa OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_ci'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON lectura_previa TO %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_ci') THEN
    GRANT INSERT, UPDATE ON lectura_previa TO vigia_ci;
  END IF;
END $$;
