-- 358 · Dos refrescos no podían leer lo que necesitan.
--
-- La cola de refrescos y el Worker de scrapers corren como vigia_jobs. Tres relaciones que sus funciones leen son de
-- postgres y nunca se le concedieron a ese rol:
--
--   alertas, banderas   refrescar_patron_agentes() (migración 276). Desde que entró a la cadena de la carga diaria de
--                       contratos, la corrida de oece_ocds cerraba con «refrescos con error: refrescar_patron_agentes
--                       (permission denied for table alertas)» (2026-11-15, 16 y 17): la carga entraba, pero el panel la
--                       marcaba como fallida y los patrones no se rehacían.
--   entidad_stats       la misma función y refrescar_funcionario_resumen() (migraciones 319 y 357), que hasta hoy sólo
--                       había corrido a mano: en la cadena de la planilla del día 20 habría fallado.
--
-- Revisión del 2026-11-17: de las 456 funciones de la base, éstas son las únicas que nombran una relación que vigia_jobs no
-- puede leer (las demás coincidencias eran palabras del texto). Sólo lectura.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_jobs', 'dev_jobs'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.alertas, public.banderas, public.entidad_stats TO %I', r);
    END IF;
  END LOOP;
END $$;
