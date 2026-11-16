-- 304 · La «Ficha Resumen» de cada informe de control de la Contraloría, leída (2026-11-16).
--
-- `informes_control` (migración 90) trae del buscador de la Contraloría el número, el título, la entidad, la modalidad
-- y los TIPOS de responsabilidad, pero no QUÉ encontró el control. Eso está en la Ficha Resumen de cada informe
-- (url_resumen, SPIC TIPOARCHIVO=RE): un PDF de texto de 2 o 3 páginas, el mismo formulario de 2015 a 2026, con
--   I.   información general: objetivo, entidad, monto auditado y examinado (o el monto objeto del servicio en un
--        servicio de control específico), ubigeo, fecha de emisión y la unidad que emite el informe;
--   II.  el tipo de servicio de control (auditoría de cumplimiento, financiera, de desempeño, servicio de control
--        específico a hechos con presunta irregularidad o acción de oficio posterior);
--   III. los resultados: las observaciones (en un control específico, «argumentos de hecho»), las recomendaciones y los
--        funcionarios comprendidos, con su DNI y el tipo de responsabilidad PRESUNTA de cada uno.
-- El informe entero (url_pdf) es un escaneo de 50 a 150 MB: no se baja.
--
--   informe_control_ficha   una fila por informe con su ficha bajada:
--     texto          el texto entero de la ficha (PyMuPDF). TRAE NOMBRES Y DNI de los funcionarios comprendidos: no lo
--                    leen los roles que publican (ver permisos); lo lee quien carga a los implicados.
--     campos         el formulario leído por un lector DETERMINISTA (backend/scripts/cargar_contraloria_fichas.py), SIN
--                    nombres ni DNI: version, numero, titulo, objetivo, entidad, monto_auditado, monto_examinado,
--                    monto_objeto, ubigeo {region, provincia, distrito}, fecha_emision, unidad_emisora, tipo_servicio
--                    (+ tipo_servicio_texto), observaciones_rotulo, observaciones [{n, texto}], recomendaciones
--                    [{n, texto, destinatario?}], avisos (lo que el lector no encontró) y, cuando la hay, la lectura de
--                    IA en `ia` {modelo, version, leido_at, tokens_in, tokens_out, costo_usd, huella, observaciones
--                    [{n, tema, perjuicio, moneda, normas, obras [{nombre, cui}], contratos, procesos, empresas
--                    [{ruc, razon_social}]}]} (GLM 5.3 flash por Workers AI; `huella` = md5 de las observaciones que
--                    leyó: si cambian, se vuelve a leer).
--
-- Responsabilidad PRESUNTA: la Contraloría la identifica y la deriva; no es una condena. Lo que se publica (API, web,
-- MCP) sale de `campos` y pasa por publicar() (backend/api/src/lib/privacidad.ts).
--
-- Carga (desde una PC en el Perú: el servidor de la Contraloría no responde a IPs de afuera):
--   python -P -X utf8 backend/scripts/cargar_contraloria_fichas.py lista  --entorno prod --salida lista.json
--   python -P -X utf8 backend/scripts/cargar_contraloria_fichas.py bajar  --lista lista.json --carpeta <dir>
--   python -P -X utf8 backend/scripts/cargar_contraloria_fichas.py cargar --entorno prod --carpeta <dir>
--   python -P -X utf8 backend/scripts/cargar_contraloria_fichas.py leer   --entorno prod

SET lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS informe_control_ficha (
  codigo          TEXT        PRIMARY KEY REFERENCES informes_control (codigo) ON DELETE CASCADE,
  texto           TEXT        NOT NULL,
  paginas         SMALLINT    NOT NULL,
  bytes           INT         NOT NULL,
  sha256          CHAR(64)    NOT NULL,
  descargado_at   TIMESTAMPTZ NOT NULL,
  campos          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  actualizado_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE informe_control_ficha IS
  'La Ficha Resumen (PDF de texto, TIPOARCHIVO=RE) de cada informe de control: texto entero (con nombres y DNI: no se '
  'publica) y `campos`, el formulario leído sin personas (objetivo, montos, tipo de servicio, observaciones, '
  'recomendaciones) más la lectura de IA de cada observación en campos.ia. Carga: backend/scripts/cargar_contraloria_fichas.py.';
COMMENT ON COLUMN informe_control_ficha.texto IS
  'Texto entero de la ficha. Incluye la sección «Funcionarios comprendidos» con nombres y DNI: sólo para quien carga a los '
  'implicados; los roles que publican no pueden leer esta columna.';
COMMENT ON COLUMN informe_control_ficha.campos IS
  'El formulario leído (lector determinista, sin nombres ni DNI) y, en `ia`, la lectura de cada observación (tema, '
  'perjuicio, normas, obras, contratos, procesos, empresas). Responsabilidad PRESUNTA.';

-- Lo que falta leer con IA y los informes por tipo de servicio.
CREATE INDEX IF NOT EXISTS informe_control_ficha_sin_ia ON informe_control_ficha (codigo) WHERE NOT (campos ? 'ia');
CREATE INDEX IF NOT EXISTS informe_control_ficha_tipo ON informe_control_ficha ((campos ->> 'tipo_servicio'));

ALTER TABLE informe_control_ficha OWNER TO vigia_jobs;

-- ─── Permisos ────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Los privilegios por defecto (37, 43, 44) dan a vigia_api, vigia_agentes y vigia_ab toda la tabla nueva (y a
-- vigia_agentes, escritura): fuera. Los que publican leen todo MENOS `texto` (la sección de funcionarios trae nombres y
-- DNI). Escribe sólo vigia_jobs (dueño): el script de carga entra como postgres o como vigia_ci (miembro de vigia_jobs).
REVOKE ALL ON informe_control_ficha FROM PUBLIC;
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON informe_control_ficha FROM %I', r);
      EXECUTE format('GRANT SELECT (codigo, paginas, bytes, sha256, descargado_at, campos, actualizado_at) ON informe_control_ficha TO %I', r);
    END IF;
  END LOOP;
END $$;
