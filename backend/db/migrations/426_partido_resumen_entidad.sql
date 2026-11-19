-- 426 · La página de un partido: sus entidades, ya contadas.
--
-- GET /partidos/:clave contaba en vivo, por entidad y por región, los contratos del partido contra contrato_estado
-- (CONTEOS de lib/rankingPartidos.ts). En un partido grande (30 806 contratos de Somos Perú 2022) el plan lee entero
-- contrato_estado (16 mil páginas): 1 s en frío, 750 ms de media en pg_stat_statements el 2026-11-19.
--
-- Por región ya existía el resumen (partido_resumen_vigia, migración 78, con los mismos conteos): la API lo lee desde
-- aquí. Por entidad, esta tabla, que se rehace en el MISMO momento que las otras (refrescar_resumen_vigia, a diario con
-- la cadena de cruces): los totales de la página, sus regiones y sus entidades salen de la misma foto y suman igual.
-- 7 029 filas (partido × período × entidad × gobierno).

CREATE TABLE IF NOT EXISTS partido_resumen_entidad (
  anio_eleccion     smallint NOT NULL,
  org_clave         text NOT NULL,
  entidad_ruc       text NOT NULL,
  nivel             text,
  gobierno_ubigeo   text,
  autoridad         text,
  contratos         int NOT NULL,
  leidos            int NOT NULL,
  con_senales       int NOT NULL,
  en_cola           int NOT NULL,
  documentos_listos int NOT NULL,
  monto_pen         numeric(20, 2) NOT NULL
);
CREATE INDEX IF NOT EXISTS partido_resumen_entidad_partido ON partido_resumen_entidad (org_clave, anio_eleccion);
COMMENT ON TABLE partido_resumen_entidad IS 'Contratos del partido por entidad y gobierno, con los conteos de CONTEOS (lib/rankingPartidos.ts). La rehace refrescar_resumen_vigia(). Migración 426.';

CREATE OR REPLACE FUNCTION refrescar_resumen_vigia() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  DELETE FROM partido_resumen_vigia;
  INSERT INTO partido_resumen_vigia
  SELECT cp.anio_eleccion, cp.org_clave, left(cp.gobierno_ubigeo, 2),
         count(*)::int,
         count(*) FILTER (WHERE ce.estado_proc = 'procesado')::int,
         count(*) FILTER (WHERE ce.riesgo IN ('alto', 'medio'))::int,
         count(*) FILTER (WHERE ce.estado_proc = 'sin_analizar' AND ce.operativo = 'en_cola')::int,
         count(*) FILTER (WHERE ce.estado_proc = 'sin_analizar' AND ce.operativo = 'documentos_listos')::int,
         COALESCE(sum(ce.monto), 0),
         count(DISTINCT cp.nivel || ':' || cp.gobierno_ubigeo)::int
    FROM contrato_partido_tabla cp JOIN contrato_estado ce ON ce.ocid = cp.ocid
   WHERE cp.gobierno_ubigeo IS NOT NULL
   GROUP BY 1, 2, 3;
  GET DIAGNOSTICS n = ROW_COUNT;
  -- Migración 426: lo mismo por entidad y gobierno, para la lista de entidades de la página del partido.
  DELETE FROM partido_resumen_entidad;
  INSERT INTO partido_resumen_entidad
  SELECT cp.anio_eleccion, cp.org_clave, btrim(cp.entidad_ruc::text), cp.nivel, cp.gobierno_ubigeo, cp.autoridad,
         count(*)::int,
         count(*) FILTER (WHERE ce.estado_proc = 'procesado')::int,
         count(*) FILTER (WHERE ce.riesgo IN ('alto', 'medio'))::int,
         count(*) FILTER (WHERE ce.estado_proc = 'sin_analizar' AND ce.operativo = 'en_cola')::int,
         count(*) FILTER (WHERE ce.estado_proc = 'sin_analizar' AND ce.operativo = 'documentos_listos')::int,
         COALESCE(sum(ce.monto), 0)
    FROM contrato_partido_tabla cp JOIN contrato_estado ce ON ce.ocid = cp.ocid
   WHERE cp.org_clave IS NOT NULL
   GROUP BY 1, 2, 3, 4, 5, 6;
  -- Migración 80: lo mismo, mes a mes.
  PERFORM refrescar_resumen_mes_vigia();
  -- Migración 81: por objeto y por gobierno.
  PERFORM refrescar_resumen_gobierno_vigia();
  RETURN n;
END $$;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.partido_resumen_entidad OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_resumen_vigia() OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'dev_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.partido_resumen_entidad TO %I', r);
    END IF;
  END LOOP;
END $$;

SELECT refrescar_resumen_vigia();
