-- 337 · Las sanciones del Tribunal, conciliadas con la ficha del proveedor en el OECE.
--
-- Caso que lo destapó (pedido del usuario, 2026-11-17): A & G INDUSTRIES S.A.C. ganó el proceso 1219505 el 25-06-2026 y
-- Vigía marcó «sanción vigente» (alta) por su inhabilitación DEFINITIVA de 2016 (Res. 1621-2016-TCE-S1). El Tribunal la
-- había sustituido por una temporal de 24 meses el 11-12-2025 (Res. 8608-2025-TCP-S3, retroactividad benigna): ya estaba
-- cumplida y la empresa estaba habilitada. Los datos abiertos de sancionados (`osce_sancionados`) no reflejan esas
-- sustituciones: la definitiva sigue ahí sin fecha de fin (y con el estado vacío). La ficha del proveedor en el OECE
-- (eap.oece.gob.pe, la que muestra «apto para contratar») sí: ya no la lista y dice «habilitado».
--
--   oece_ficha_proveedor        lo que dice HOY la ficha de cada empresa consultada (scripts/oece_fichas.py, desde una IP
--                               peruana): apto, habilitado y sus sanciones con fecha de fin y si están vigentes.
--   sancion_segun_ficha         cada sanción del Tribunal de una empresa con ficha: si la ficha la lista vigente, no vigente
--                               (con su fin) o ya no la lista (sustituida, reducida o anulada).
--   ajustar_sanciones_con_ficha()  corrige las señales del contrato tras los cruces (antes de dedup):
--       · «sanción vigente» y «socio de inhabilitada»: si la sanción ya no figura y la buena pro es desde la Ley 32069
--         (22-04-2025, desde cuando se sustituyen definitivas por retroactividad benigna), se quita: no se sabe que
--         estuviera vigente ese día. Si la buena pro es anterior, se queda (lo estaba) y lleva la nota de que después ya
--         no figura. Si la ficha da una fecha de fin anterior a la buena pro, se quita.
--       · «sanción definitiva» (antecedente de la empresa): sigue siendo un hecho (hubo una sanción), pero baja a media y
--         dice «sustituida o levantada: ya no figura en el OECE».
--   ajustar_empresas_con_ficha()   «inhabilitada hoy» de la ficha de empresa según el OECE, si se consultó.
--
-- Lo que NO afirma: la fecha exacta de la sustitución (está en la resolución del Tribunal, que la ficha no trae).

CREATE TABLE IF NOT EXISTS oece_ficha_proveedor (
  ruc           TEXT PRIMARY KEY,
  consultado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  apto          BOOLEAN,
  habilitado    BOOLEAN,
  sanciones     JSONB NOT NULL DEFAULT '[]'::jsonb,
  error         TEXT
);

-- Número de resolución comparable: «1621-2016-TCE-S1» y «Res. N° 1621-2016-TCE-S1» → «1621-2016-TCE-S1».
CREATE OR REPLACE FUNCTION resolucion_norm(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(upper(regexp_replace(substring(COALESCE(t, '') FROM '\d+-\d{4}-[A-Za-z]+(?:-[A-Za-z0-9]+)?'), '\s+', '', 'g')), '')
$$;

-- «18/02/2026» → 2026-02-18.
CREATE OR REPLACE FUNCTION fecha_ddmmyyyy(t text) RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN t ~ '^\d{2}/\d{2}/\d{4}$' THEN to_date(t, 'DD/MM/YYYY') END
$$;

CREATE OR REPLACE VIEW sancion_segun_ficha AS
  SELECT s.ruc, s.resolucion, s.tipo, s.fecha_desde, s.fecha_hasta, f.consultado_at,
         CASE WHEN x.e IS NULL THEN 'no_figura'
              WHEN (x.e->>'vigente') = 'true' THEN 'vigente'
              ELSE 'no_vigente' END AS estado_ficha,
         fecha_ddmmyyyy(x.e->>'fechaFin') AS fin_ficha,
         x.e->>'descripcion' AS tipo_ficha, x.e->>'periodo' AS periodo_ficha
    FROM osce_sancionados s
    JOIN oece_ficha_proveedor f ON f.ruc = s.ruc AND f.error IS NULL
    LEFT JOIN LATERAL (SELECT e FROM jsonb_array_elements(f.sanciones) e
                        WHERE resolucion_norm(e->>'nroRes') = resolucion_norm(s.resolucion) LIMIT 1) x ON true
   WHERE s.tipo IN ('temporal', 'definitivo') AND s.ruc ~ '^20\d{9}$';

CREATE OR REPLACE FUNCTION ajustar_sanciones_con_ficha() RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  n_quitadas int; n_nota int; n_socio int; n_def int;
  ley32069 constant date := DATE '2025-04-22';
BEGIN
  CREATE TEMP TABLE _sf ON COMMIT DROP AS SELECT * FROM sancion_segun_ficha;
  CREATE INDEX ON _sf (ruc, resolucion);
  ANALYZE _sf;

  -- «Sanción vigente» el día de la buena pro: fuera si la sanción ya no figura y la buena pro es desde la Ley 32069, o si
  -- la ficha da un fin anterior a la buena pro.
  DELETE FROM cruces_proveedor c USING _sf f
   WHERE c.tipo = 'sancion_vigente' AND f.ruc = c.ruc_empresa AND resolucion_norm(f.resolucion) = resolucion_norm(c.detalle->>'resolucion')
     AND ((f.estado_ficha = 'no_figura' AND c.fecha >= ley32069) OR (f.fin_ficha IS NOT NULL AND c.fecha > f.fin_ficha));
  GET DIAGNOSTICS n_quitadas = ROW_COUNT;
  -- La que se queda (buena pro anterior): lo estaba ese día, pero después ya no figura.
  UPDATE cruces_proveedor c
     SET detalle = c.detalle || jsonb_build_object('despues', 'ya no figura en la ficha del OECE (sustituida, reducida o anulada)',
                                                   'ficha_consultada', to_char(f.consultado_at, 'YYYY-MM-DD'))
    FROM _sf f
   WHERE c.tipo = 'sancion_vigente' AND f.ruc = c.ruc_empresa AND resolucion_norm(f.resolucion) = resolucion_norm(c.detalle->>'resolucion')
     AND f.estado_ficha = 'no_figura';
  GET DIAGNOSTICS n_nota = ROW_COUNT;

  -- «Socio de una empresa inhabilitada»: la misma regla con la sanción de la empresa sancionada.
  DELETE FROM cruces_proveedor c USING _sf f
   WHERE c.tipo = 'socio_de_inhabilitada' AND f.ruc = c.detalle->>'sancionada_ruc'
     AND resolucion_norm(f.resolucion) = resolucion_norm(c.detalle->>'resolucion')
     AND ((f.estado_ficha = 'no_figura' AND c.fecha >= ley32069) OR (f.fin_ficha IS NOT NULL AND c.fecha > f.fin_ficha));
  GET DIAGNOSTICS n_socio = ROW_COUNT;

  -- El antecedente de la empresa: hubo una sanción definitiva, pero ya no figura (o la ficha le pone fin).
  UPDATE cruces_proveedor c
     SET severidad = 'media',
         detalle = c.detalle || jsonb_build_object(
           'estado', CASE WHEN f.estado_ficha = 'no_figura' THEN 'sustituida o levantada' ELSE 'no vigente' END,
           'segun_ficha', CASE WHEN f.estado_ficha = 'no_figura' THEN 'ya no figura en la ficha del OECE' ELSE 'la ficha del OECE la da por terminada' END,
           'hasta', COALESCE(c.detalle->>'hasta', to_char(f.fin_ficha, 'YYYY-MM-DD')),
           'ficha_consultada', to_char(f.consultado_at, 'YYYY-MM-DD'))
    FROM _sf f
   WHERE c.tipo = 'sancion_definitiva' AND f.ruc = c.ruc_empresa AND resolucion_norm(f.resolucion) = resolucion_norm(c.detalle->>'resolucion')
     AND (f.estado_ficha = 'no_figura' OR (f.estado_ficha = 'no_vigente' AND f.fin_ficha IS NOT NULL));
  GET DIAGNOSTICS n_def = ROW_COUNT;

  RETURN jsonb_build_object('sancion_vigente_quitadas', n_quitadas, 'sancion_vigente_con_nota', n_nota,
                            'socio_de_inhabilitada_quitadas', n_socio, 'definitivas_ajustadas', n_def);
END $$;

-- «Inhabilitada hoy» en la ficha de empresa: lo que dice el OECE si se consultó en los últimos 45 días.
CREATE OR REPLACE FUNCTION ajustar_empresas_con_ficha() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  UPDATE empresa_resumen r
     SET inhabilitada = v.inhabilitada, inhabilitada_hasta = v.hasta
    FROM (SELECT f.ruc,
                 CASE WHEN bool_or((e->>'vigente') = 'true' AND e->>'descripcion' ILIKE 'DEFINITIV%') THEN 'definitiva'
                      WHEN bool_or((e->>'vigente') = 'true') THEN 'temporal' END AS inhabilitada,
                 max(fecha_ddmmyyyy(e->>'fechaFin')) FILTER (WHERE (e->>'vigente') = 'true' AND e->>'descripcion' NOT ILIKE 'DEFINITIV%') AS hasta
            FROM oece_ficha_proveedor f LEFT JOIN LATERAL jsonb_array_elements(f.sanciones) e ON true
           WHERE f.error IS NULL AND f.consultado_at > now() - interval '45 days'
           GROUP BY f.ruc) v
   WHERE r.ruc = v.ruc AND (r.inhabilitada IS DISTINCT FROM v.inhabilitada OR r.inhabilitada_hasta IS DISTINCT FROM v.hasta);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.oece_ficha_proveedor OWNER TO vigia_jobs;
    ALTER FUNCTION public.ajustar_sanciones_con_ficha() OWNER TO vigia_jobs;
    ALTER FUNCTION public.ajustar_empresas_con_ficha() OWNER TO vigia_jobs;
    ALTER VIEW public.sancion_segun_ficha OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab', 'dev_api', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.oece_ficha_proveedor, public.sancion_segun_ficha TO %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION ajustar_sanciones_con_ficha(), ajustar_empresas_con_ficha() FROM PUBLIC;
