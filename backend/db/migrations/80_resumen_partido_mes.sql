-- 80 · Los conteos de cada partido mes a mes, ya calculados (la pestaña "Por mes" y su gráfico).
--
-- En frío, los dos "por mes" de la ficha de un partido eran lo más lento de sus nueve consultas (2,3 s el de los
-- procesos y 1,1 s el de la base de Vigía) y, en un partido grande, alargaban el pedido hasta casi 10 s. Van por
-- (período, partido, mes); los rehacen los refrescos de la migración 78.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/80_resumen_partido_mes.sql

CREATE TABLE IF NOT EXISTS partido_resumen_mes (
  anio_eleccion   SMALLINT NOT NULL,
  org_clave       TEXT NOT NULL,
  mes             TEXT NOT NULL,           -- 'AAAA-MM'
  procesos        INT NOT NULL DEFAULT 0,  -- partido_proceso
  monto_pen       NUMERIC(20, 2) NOT NULL DEFAULT 0,
  contratos       INT NOT NULL DEFAULT 0,  -- base de Vigía (contrato_partido × contrato_estado)
  leidos          INT NOT NULL DEFAULT 0,
  con_senales     INT NOT NULL DEFAULT 0,
  PRIMARY KEY (anio_eleccion, org_clave, mes)
);
ALTER TABLE partido_resumen_mes OWNER TO vigia_jobs;
GRANT SELECT ON partido_resumen_mes TO vigia_api, vigia_api_admin;

-- Cada refresco rehace su mitad de la tabla: los procesos (historia) o la base de Vigía.
CREATE OR REPLACE FUNCTION refrescar_resumen_mes_historia() RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE partido_resumen_mes SET procesos = 0, monto_pen = 0 WHERE procesos <> 0 OR monto_pen <> 0;
  INSERT INTO partido_resumen_mes (anio_eleccion, org_clave, mes, procesos, monto_pen)
  SELECT anio_eleccion, org_clave, to_char(date_trunc('month', fecha_convocatoria), 'YYYY-MM'), count(*)::int,
         COALESCE(sum(monto_adjudicado_pen), 0)
    FROM partido_proceso WHERE org_clave IS NOT NULL AND fecha_convocatoria IS NOT NULL
   GROUP BY 1, 2, 3
  ON CONFLICT (anio_eleccion, org_clave, mes) DO UPDATE SET procesos = EXCLUDED.procesos, monto_pen = EXCLUDED.monto_pen;
  DELETE FROM partido_resumen_mes WHERE procesos = 0 AND contratos = 0;
END $$;
ALTER FUNCTION refrescar_resumen_mes_historia() OWNER TO vigia_jobs;

CREATE OR REPLACE FUNCTION refrescar_resumen_mes_vigia() RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE partido_resumen_mes SET contratos = 0, leidos = 0, con_senales = 0 WHERE contratos <> 0 OR leidos <> 0 OR con_senales <> 0;
  INSERT INTO partido_resumen_mes (anio_eleccion, org_clave, mes, contratos, leidos, con_senales)
  SELECT cp.anio_eleccion, cp.org_clave, to_char(date_trunc('month', cp.fecha_convocatoria), 'YYYY-MM'), count(*)::int,
         count(*) FILTER (WHERE ce.estado_proc = 'procesado')::int, count(*) FILTER (WHERE ce.riesgo IN ('alto', 'medio'))::int
    FROM contrato_partido_tabla cp JOIN contrato_estado ce ON ce.ocid = cp.ocid
   WHERE cp.fecha_convocatoria IS NOT NULL
   GROUP BY 1, 2, 3
  ON CONFLICT (anio_eleccion, org_clave, mes) DO UPDATE SET contratos = EXCLUDED.contratos, leidos = EXCLUDED.leidos, con_senales = EXCLUDED.con_senales;
  DELETE FROM partido_resumen_mes WHERE procesos = 0 AND contratos = 0;
END $$;
ALTER FUNCTION refrescar_resumen_mes_vigia() OWNER TO vigia_jobs;

-- Los resúmenes de la migración 78 (y 79), con el mes a mes al final.
CREATE OR REPLACE FUNCTION public.refrescar_resumen_historia()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE n INT;
BEGIN
  DELETE FROM partido_resumen_historia;
  INSERT INTO partido_resumen_historia
  SELECT anio_eleccion, org_clave, left(gobierno_ubigeo, 2), count(*)::int, COALESCE(sum(monto_adjudicado_pen), 0),
         count(DISTINCT nivel || ':' || gobierno_ubigeo)::int
    FROM partido_proceso WHERE org_clave IS NOT NULL AND gobierno_ubigeo IS NOT NULL
   GROUP BY 1, 2, 3;
  GET DIAGNOSTICS n = ROW_COUNT;
  -- Migración 79: los totales con distintos, por período y partido.
  DELETE FROM partido_resumen_total;
  INSERT INTO partido_resumen_total
  SELECT anio_eleccion, org_clave, count(*)::int, COALESCE(sum(monto_adjudicado_pen), 0),
         count(DISTINCT entidad_ruc)::int, count(DISTINCT ruc_proveedor)::int,
         count(DISTINCT nivel || ':' || gobierno_ubigeo)::int, min(fecha_convocatoria), max(fecha_convocatoria)
    FROM partido_proceso WHERE org_clave IS NOT NULL
   GROUP BY 1, 2;
  -- Migración 80: lo mismo, mes a mes.
  PERFORM refrescar_resumen_mes_historia();
  RETURN n;
END $function$;
ALTER FUNCTION refrescar_resumen_historia() OWNER TO vigia_jobs;

CREATE OR REPLACE FUNCTION public.refrescar_resumen_vigia()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
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
  -- Migración 80: lo mismo, mes a mes.
  PERFORM refrescar_resumen_mes_vigia();
  RETURN n;
END $function$;
ALTER FUNCTION refrescar_resumen_vigia() OWNER TO vigia_jobs;

SELECT refrescar_resumen_mes_historia();
SELECT refrescar_resumen_mes_vigia();
