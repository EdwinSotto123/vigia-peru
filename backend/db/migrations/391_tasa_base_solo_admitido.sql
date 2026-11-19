-- 391 · La tasa base de «sólo admitieron al ganador» sobre su propio universo.
--
-- refrescar_senal_tasa_base() (migración 329) mide cada tipo de cruce sobre un universo; sin una rama propia, el
-- indicador de la 390 caía en «todos los procesos adjudicados» y su frecuencia salía unas dos mil veces más baja de lo que
-- es. Su universo son los procesos con un ítem adjudicado de cuatro o más ofertas cuya admisión se leyó del reporte de
-- evaluación del SEACE (proceso_item). La función es la de la 329 con esa rama; nada más cambia.
--
-- Cómo aplicarla: después de la 390. Luego SELECT refrescar_senal_tasa_base().

CREATE OR REPLACE FUNCTION refrescar_senal_tasa_base() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n int;
  u_todos int; u_visitas int; u_acta int; u_bases int; u_consultas int; u_ofertas int; u_empresas int; u_admision int;
  f_min date; f_max date;
BEGIN
  SELECT min(fecha_visita), max(fecha_visita) INTO f_min, f_max FROM visitas_entidades;
  -- Procesos adjudicados que la base puede enlazar a su ficha, y los de entidades con registro de visitas.
  SELECT count(DISTINCT cv.ocid),
         count(DISTINCT cv.ocid) FILTER (WHERE a.fecha_buenapro BETWEEN f_min AND f_max + 180
                                           AND a.entidad_ruc::text IN (SELECT ruc FROM visita_entidad_ruc))
    INTO u_todos, u_visitas
    FROM conosce_adjudicaciones a
    JOIN (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
           WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid) cv
      ON cv.codigo = a.codigo_convocatoria AND cv.entidad_ruc = a.entidad_ruc;
  SELECT count(DISTINCT ocid) FILTER (WHERE clase = 'buena_pro'), count(DISTINCT ocid) FILTER (WHERE clase = 'bases'),
         count(DISTINCT ocid) FILTER (WHERE clase = 'consultas')
    INTO u_acta, u_bases, u_consultas FROM documento_lectura;
  SELECT count(DISTINCT ocid) INTO u_ofertas
    FROM (SELECT ocid FROM proceso_postor WHERE codigo ~ '^20\d{9}$' AND presento_at IS NOT NULL
           GROUP BY ocid, item HAVING count(DISTINCT codigo) >= 2) z;
  SELECT count(*) INTO u_empresas FROM empresa_resumen WHERE adj_procesos > 0;
  -- Migración 391: sólo admitieron al ganador se mide sobre los procesos que pueden tenerlo (un ítem adjudicado con 4 o
  -- más ofertas y la admisión leída del reporte de evaluación), no sobre todos los adjudicados.
  SELECT count(DISTINCT ocid) INTO u_admision
    FROM proceso_item WHERE resultado = 'adjudicado' AND ofertas >= 4 AND admitidas IS NOT NULL;

  DELETE FROM senal_tasa_base;
  INSERT INTO senal_tasa_base (tipo, casos, universo, universo_que)
  SELECT t.tipo, t.casos,
         CASE WHEN NOT t.por_proceso THEN u_empresas
              WHEN t.tipo ~ '^visita_|^reunion_en_evaluacion$' THEN u_visitas
              WHEN t.tipo LIKE 'acta\_%' THEN u_acta
              WHEN t.tipo LIKE 'bases\_%' THEN u_bases
              WHEN t.tipo LIKE 'consultas\_%' THEN u_consultas
              WHEN t.tipo = 'ofertas_a_la_vez' THEN u_ofertas
              WHEN t.tipo = 'solo_admitido_el_ganador' THEN u_admision
              WHEN t.tipo ~ '^(obra|inversion)_' THEN NULL
              ELSE u_todos END,
         CASE WHEN NOT t.por_proceso THEN 'empresas que ganaron algún proceso'
              WHEN t.tipo ~ '^visita_|^reunion_en_evaluacion$' THEN 'procesos adjudicados en entidades con registro de visitas'
              WHEN t.tipo LIKE 'acta\_%' THEN 'procesos con el acta de buena pro leída'
              WHEN t.tipo LIKE 'bases\_%' THEN 'procesos con las bases leídas'
              WHEN t.tipo LIKE 'consultas\_%' THEN 'procesos con el pliego de consultas leído'
              WHEN t.tipo = 'ofertas_a_la_vez' THEN 'procesos con dos o más ofertas de empresas y su hora de registro'
              WHEN t.tipo = 'solo_admitido_el_ganador' THEN 'procesos con un ítem adjudicado de cuatro o más ofertas y su reporte de evaluación'
              WHEN t.tipo ~ '^(obra|inversion)_' THEN NULL
              ELSE 'procesos adjudicados' END
    FROM (SELECT tipo, bool_or(ocid IS NOT NULL) AS por_proceso,
                 CASE WHEN bool_or(ocid IS NOT NULL) THEN count(DISTINCT ocid) ELSE count(DISTINCT ruc_empresa) END::int AS casos
            FROM cruces_proveedor GROUP BY tipo) t;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.senal_en_observacion OWNER TO vigia_jobs;
    ALTER TABLE public.senal_tasa_base OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_cruce_ofertas_a_la_vez() OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_senal_tasa_base() OWNER TO vigia_jobs;
    ALTER FUNCTION public.visita_motivo_clase(text) OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.senal_en_observacion, public.senal_tasa_base TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.visita_motivo_clase(text) TO %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_cruce_ofertas_a_la_vez() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refrescar_senal_tasa_base() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER FUNCTION public.refrescar_senal_tasa_base() OWNER TO vigia_jobs;
  END IF;
END $$;
