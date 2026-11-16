-- 300 · Métricas y transparencia: lo que la página pública /metricas necesita y la base no tenía a mano (2026-11-16).
--
-- La página muestra la precisión de los agentes (golden_*), el RAG normativo (norma*, golden_corrida de rag_normas), la
-- verificación de cada dictamen y lo que cuesta (alertas.analisis_full, documento_lectura, menor_lectura,
-- agente_masivo*, costos_mes). Casi todo ya está en tablas chicas. Faltaban dos cosas:
--
--   transparencia_analisis   los hechos de cada análisis publicado en una fila angosta: red, modelo, costo y lo que dejó
--                            la verificación del dictamen (`verificacion_dictamen`, `self_evals`, `descartes`). Hoy
--                            viven dentro de alertas.analisis_full, un JSON de ~190 KB por contrato: sumarlos en vivo
--                            tarda ~45 s con 8 mil contratos (medido en PROD) y el rol de la API corta a los 10 s.
--                            La llena refrescar_transparencia_analisis() cada hora desde pg_cron, sólo con lo analizado
--                            desde la última vez (con dos horas de solape). Sin nombres, RUC, OCID ni textos: sólo
--                            conteos y el id de la alerta.
--   transparencia_costo      lo que se paga FUERA de la base (facturas de AWS y Cloudflare, dominios, horas de personas)
--                            y que nadie puede medir desde aquí. La llena el dueño a mano; TODO lo que se escriba ahí
--                            se publica tal cual en /metricas, con su fuente. Ejemplo:
--                              INSERT INTO transparencia_costo (mes, concepto, categoria, monto, moneda, fuente, nota)
--                              VALUES ('2026-11-01', 'Cloudflare Business (gobserva.cloud)', 'infraestructura', 200, 'USD',
--                                      'Factura de Cloudflare de noviembre de 2026', NULL);
--
-- La primera carga de transparencia_analisis recorre todas las alertas (cerca de un minuto): correr esta migración sin
-- statement_timeout corto. Para rehacerla entera: SELECT refrescar_transparencia_analisis(true);

CREATE TABLE IF NOT EXISTS public.transparencia_costo (
  id             bigserial PRIMARY KEY,
  mes            date NOT NULL CHECK (mes = date_trunc('month', mes)::date),   -- el primer día del mes
  concepto       text NOT NULL CHECK (length(concepto) BETWEEN 3 AND 160),
  categoria      text NOT NULL DEFAULT 'otros'
                 CHECK (categoria IN ('infraestructura', 'ia', 'validacion', 'almacenamiento', 'personas', 'otros')),
  monto          numeric(12, 2) NOT NULL CHECK (monto >= 0),
  moneda         text NOT NULL DEFAULT 'USD' CHECK (moneda IN ('USD', 'PEN')),
  fuente         text NOT NULL CHECK (length(fuente) BETWEEN 3 AND 240),      -- «Factura de AWS de octubre», «Estimado»…
  nota           text,
  registrado_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mes, concepto)
);
COMMENT ON TABLE public.transparencia_costo IS
  'Costos que no se miden en la base (facturas, personas), escritos a mano por el dueño. Todo se publica en /metricas (migración 300).';

CREATE TABLE IF NOT EXISTS public.transparencia_analisis (
  alerta_id          uuid PRIMARY KEY,
  analizado_en       timestamptz NOT NULL,
  publicado          boolean NOT NULL DEFAULT false,   -- alerta_publicada(estado): «En revisión» no se publica
  red                text,                             -- analisis_full.perfil: bienes, servicios, consultoria, obras, otros
  modelo             text,                             -- llm_metrics.modelos.agentes
  usd                numeric(10, 4),                   -- llm_metrics.cost_usd
  con_verificacion   boolean NOT NULL DEFAULT false,   -- trae verificacion_dictamen
  degradado          boolean NOT NULL DEFAULT false,   -- verificacion_dictamen.degradado
  reglas_citadas     int NOT NULL DEFAULT 0,           -- reglas que el texto del dictamen nombra
  reglas_sin_senal   int NOT NULL DEFAULT 0,           -- de esas, las que no quedaron guardadas como señal
  urls_sin_respaldo  int NOT NULL DEFAULT 0,
  urls_quitadas      int NOT NULL DEFAULT 0,
  rucs_sin_respaldo  int NOT NULL DEFAULT 0,
  rucs_sustituidos   int NOT NULL DEFAULT 0,
  cita_n             int,                              -- self_evals.cita: señales revisadas / con norma y fuente
  cita_ok            int,
  respaldo_n         int,                              -- self_evals.respaldo: señales juzgadas / respaldadas por datos
  respaldo_ok        int,
  precio_n           int,                              -- self_evals.precio: sobreprecios juzgados / que se sostienen
  precio_ok          int,
  descartes          int NOT NULL DEFAULT 0            -- piezas que un agente entregó y el código descartó por inválidas
);
CREATE INDEX IF NOT EXISTS transparencia_analisis_fecha ON public.transparencia_analisis (analizado_en);
COMMENT ON TABLE public.transparencia_analisis IS
  'Hechos de cada análisis (red, costo, verificación del dictamen) fuera del JSON de alertas, para /metricas (migración 300).';

-- Un entero de un JSON que puede traer nulo, texto o un decimal: nunca falla.
CREATE OR REPLACE FUNCTION public._transp_entero(j jsonb) RETURNS int
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof(j) = 'number' THEN round((j #>> '{}')::numeric)::int END
$$;
-- El largo de una lista de un JSON (0 si no es una lista).
CREATE OR REPLACE FUNCTION public._transp_largo(j jsonb) RETURNS int
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof(j) = 'array' THEN jsonb_array_length(j) ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION public.refrescar_transparencia_analisis(p_todo boolean DEFAULT false) RETURNS int
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_desde timestamptz;
  v_n int;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('refrescar_transparencia_analisis')) THEN
    RETURN 0;                       -- ya hay otra corriendo
  END IF;
  -- Dos horas de solape: un análisis que se guardó mientras corría la vez anterior no se pierde.
  SELECT CASE WHEN p_todo THEN NULL ELSE max(analizado_en) - interval '2 hours' END INTO v_desde FROM transparencia_analisis;

  INSERT INTO transparencia_analisis AS t
    (alerta_id, analizado_en, publicado, red, modelo, usd, con_verificacion, degradado, reglas_citadas, reglas_sin_senal,
     urls_sin_respaldo, urls_quitadas, rucs_sin_respaldo, rucs_sustituidos, cita_n, cita_ok, respaldo_n, respaldo_ok,
     precio_n, precio_ok, descartes)
  SELECT a.id, a.analizado_en, alerta_publicada(a.estado),
         NULLIF(left(x.perfil, 40), ''),
         NULLIF(left(x.llm_metrics -> 'modelos' ->> 'agentes', 80), ''),
         CASE WHEN jsonb_typeof(x.llm_metrics -> 'cost_usd') = 'number' THEN (x.llm_metrics ->> 'cost_usd')::numeric(10, 4) END,
         x.verificacion_dictamen IS NOT NULL AND jsonb_typeof(x.verificacion_dictamen) = 'object',
         COALESCE(x.verificacion_dictamen ->> 'degradado', '') = 'true',
         _transp_largo(x.verificacion_dictamen -> 'banderas_citadas'),
         _transp_largo(x.verificacion_dictamen -> 'banderas_no_existentes'),
         _transp_largo(x.verificacion_dictamen -> 'urls_no_respaldadas'),
         _transp_largo(x.verificacion_dictamen -> 'sanitizacion' -> 'urls_eliminadas'),
         _transp_largo(x.verificacion_dictamen -> 'rucs_no_respaldados'),
         _transp_largo(x.verificacion_dictamen -> 'sanitizacion' -> 'rucs_sustituidos'),
         _transp_entero(x.self_evals -> 'cita' -> 'n'), _transp_entero(x.self_evals -> 'cita' -> 'ok'),
         _transp_entero(x.self_evals -> 'respaldo' -> 'n'), _transp_entero(x.self_evals -> 'respaldo' -> 'ok'),
         _transp_entero(x.self_evals -> 'precio' -> 'n'), _transp_entero(x.self_evals -> 'precio' -> 'ok'),
         _transp_largo(x.descartes)
    FROM alertas a
   -- Una sola lectura del JSON por fila (cada `analisis_full -> …` suelto lo volvería a descomprimir entero).
   CROSS JOIN LATERAL jsonb_to_record(a.analisis_full)
        AS x(perfil text, llm_metrics jsonb, verificacion_dictamen jsonb, self_evals jsonb, descartes jsonb)
   WHERE a.analisis_full IS NOT NULL AND jsonb_typeof(a.analisis_full) = 'object' AND a.analizado_en IS NOT NULL
     AND a.codigo NOT LIKE 'ALT-%'                       -- las alertas de demostración no cuentan
     AND (v_desde IS NULL OR a.analizado_en > v_desde)
  ON CONFLICT (alerta_id) DO UPDATE SET
     analizado_en = EXCLUDED.analizado_en, publicado = EXCLUDED.publicado, red = EXCLUDED.red, modelo = EXCLUDED.modelo,
     usd = EXCLUDED.usd, con_verificacion = EXCLUDED.con_verificacion, degradado = EXCLUDED.degradado,
     reglas_citadas = EXCLUDED.reglas_citadas, reglas_sin_senal = EXCLUDED.reglas_sin_senal,
     urls_sin_respaldo = EXCLUDED.urls_sin_respaldo, urls_quitadas = EXCLUDED.urls_quitadas,
     rucs_sin_respaldo = EXCLUDED.rucs_sin_respaldo, rucs_sustituidos = EXCLUDED.rucs_sustituidos,
     cita_n = EXCLUDED.cita_n, cita_ok = EXCLUDED.cita_ok, respaldo_n = EXCLUDED.respaldo_n, respaldo_ok = EXCLUDED.respaldo_ok,
     precio_n = EXCLUDED.precio_n, precio_ok = EXCLUDED.precio_ok, descartes = EXCLUDED.descartes;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Lo que ya no existe o pasó a no publicarse se pone al día sin leer el JSON.
  DELETE FROM transparencia_analisis t WHERE NOT EXISTS (SELECT 1 FROM alertas a WHERE a.id = t.alerta_id);
  UPDATE transparencia_analisis t SET publicado = alerta_publicada(a.estado)
    FROM alertas a WHERE a.id = t.alerta_id AND t.publicado IS DISTINCT FROM alerta_publicada(a.estado);
  RETURN v_n;
END $$;

-- Sin cambio de dueño: vigia_jobs NO lee alertas (comprobado en PROD), así que las tablas, la función y el trabajo de
-- pg_cron quedan a nombre de quien corre la migración (el mismo que ya corre «vigia-cron-limpieza»). No se le da a
-- ningún rol un permiso nuevo sobre alertas.

-- La API pública lee (vigia_api); el panel también. Las demás tablas de /metricas ya las lee vigia_api en PROD
-- (comprobado el 2026-11-16 con has_table_privilege), pero se dejan dichas aquí para que DEV y una base nueva queden igual.
DO $$
DECLARE r text;
DECLARE t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.transparencia_costo, public.transparencia_analisis TO %I', r);
      FOREACH t IN ARRAY ARRAY['golden_conjunto', 'golden_corrida', 'golden_resultado', 'norma', 'norma_fragmento', 'norma_regla',
                               'agente_masivo', 'agente_masivo_tanda', 'documento_lectura', 'menor_lectura', 'documentos_gcs',
                               'refresco_cola', 'corridas_fuente', 'costos_mes', 'tipo_cambio_mes'] LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
          EXECUTE format('GRANT SELECT ON public.%I TO %I', t, r);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- Primera carga (todas las alertas) y, si hay pg_cron (migración 260), el refresco de cada hora.
SELECT public.refrescar_transparencia_analisis(true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('vigia-transparencia', '7 * * * *', 'SELECT public.refrescar_transparencia_analisis()');
  ELSE
    RAISE NOTICE 'Sin pg_cron: llama a refrescar_transparencia_analisis() desde donde corran los refrescos.';
  END IF;
END $$;
