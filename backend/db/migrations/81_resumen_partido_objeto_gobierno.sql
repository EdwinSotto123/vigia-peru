-- 81 · Por objeto y por gobierno, ya calculados: lo último lento de la ficha de un partido.
--
-- En frío, "por objeto" (bienes, servicios, obras…) tardaba 7,5–11 s en un partido grande y la lista de sus gobiernos
-- 2–5,5 s: las dos leían las filas anchas de partido_proceso (cada proceso con su descripción) para contarlas. Van por
-- (período, partido, objeto) y (período, partido, nivel, ubigeo del gobierno); los rehacen los mismos refrescos de las
-- migraciones 78-80. En el de gobiernos, la mitad de los procesos la pone refrescar_resumen_historia() y la de la base
-- de Vigía, refrescar_resumen_vigia().
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/81_resumen_partido_objeto_gobierno.sql

CREATE TABLE IF NOT EXISTS partido_resumen_objeto (
  anio_eleccion   SMALLINT NOT NULL,
  org_clave       TEXT NOT NULL,
  objeto          TEXT NOT NULL,
  procesos        INT NOT NULL,
  monto_pen       NUMERIC(20, 2) NOT NULL,
  PRIMARY KEY (anio_eleccion, org_clave, objeto)
);
CREATE TABLE IF NOT EXISTS partido_resumen_gobierno (
  anio_eleccion   SMALLINT NOT NULL,
  org_clave       TEXT NOT NULL,
  nivel           TEXT NOT NULL,
  ubigeo          TEXT NOT NULL,
  procesos        INT NOT NULL DEFAULT 0,
  monto_pen       NUMERIC(20, 2) NOT NULL DEFAULT 0,
  ruc_principal   TEXT,                      -- la entidad con más procesos de ese gobierno (casi siempre la sede)
  contratos       INT NOT NULL DEFAULT 0,
  leidos          INT NOT NULL DEFAULT 0,
  con_senales     INT NOT NULL DEFAULT 0,
  PRIMARY KEY (anio_eleccion, org_clave, nivel, ubigeo)
);
ALTER TABLE partido_resumen_objeto OWNER TO vigia_jobs;
ALTER TABLE partido_resumen_gobierno OWNER TO vigia_jobs;
GRANT SELECT ON partido_resumen_objeto, partido_resumen_gobierno TO vigia_api, vigia_api_admin;

CREATE OR REPLACE FUNCTION refrescar_resumen_objeto_gobierno_historia() RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM partido_resumen_objeto;
  INSERT INTO partido_resumen_objeto
  SELECT anio_eleccion, org_clave, COALESCE(objeto, 'Sin dato'), count(*)::int, COALESCE(sum(monto_adjudicado_pen), 0)
    FROM partido_proceso WHERE org_clave IS NOT NULL GROUP BY 1, 2, 3;

  UPDATE partido_resumen_gobierno SET procesos = 0, monto_pen = 0, ruc_principal = NULL WHERE procesos <> 0 OR ruc_principal IS NOT NULL;
  INSERT INTO partido_resumen_gobierno (anio_eleccion, org_clave, nivel, ubigeo, procesos, monto_pen, ruc_principal)
  SELECT g.anio_eleccion, g.org_clave, g.nivel, g.ubigeo, g.procesos, g.monto, e.ruc
    FROM (SELECT anio_eleccion, org_clave, nivel, gobierno_ubigeo AS ubigeo, count(*)::int AS procesos,
                 COALESCE(sum(monto_adjudicado_pen), 0) AS monto
            FROM partido_proceso WHERE org_clave IS NOT NULL AND gobierno_ubigeo IS NOT NULL GROUP BY 1, 2, 3, 4) g
    LEFT JOIN (SELECT DISTINCT ON (anio_eleccion, org_clave, nivel, gobierno_ubigeo) anio_eleccion, org_clave, nivel,
                      gobierno_ubigeo AS ubigeo, entidad_ruc AS ruc
                 FROM partido_proceso WHERE org_clave IS NOT NULL AND gobierno_ubigeo IS NOT NULL
                GROUP BY anio_eleccion, org_clave, nivel, gobierno_ubigeo, entidad_ruc
                ORDER BY anio_eleccion, org_clave, nivel, gobierno_ubigeo, count(*) DESC) e
      ON e.anio_eleccion = g.anio_eleccion AND e.org_clave = g.org_clave AND e.nivel = g.nivel AND e.ubigeo = g.ubigeo
  ON CONFLICT (anio_eleccion, org_clave, nivel, ubigeo) DO UPDATE
    SET procesos = EXCLUDED.procesos, monto_pen = EXCLUDED.monto_pen, ruc_principal = EXCLUDED.ruc_principal;
  DELETE FROM partido_resumen_gobierno WHERE procesos = 0 AND contratos = 0;
END $$;
ALTER FUNCTION refrescar_resumen_objeto_gobierno_historia() OWNER TO vigia_jobs;

CREATE OR REPLACE FUNCTION refrescar_resumen_gobierno_vigia() RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE partido_resumen_gobierno SET contratos = 0, leidos = 0, con_senales = 0 WHERE contratos <> 0 OR leidos <> 0 OR con_senales <> 0;
  INSERT INTO partido_resumen_gobierno (anio_eleccion, org_clave, nivel, ubigeo, contratos, leidos, con_senales)
  SELECT cp.anio_eleccion, cp.org_clave, cp.nivel, cp.gobierno_ubigeo, count(*)::int,
         count(*) FILTER (WHERE ce.estado_proc = 'procesado')::int, count(*) FILTER (WHERE ce.riesgo IN ('alto', 'medio'))::int
    FROM contrato_partido_tabla cp JOIN contrato_estado ce ON ce.ocid = cp.ocid
   WHERE cp.gobierno_ubigeo IS NOT NULL
   GROUP BY 1, 2, 3, 4
  ON CONFLICT (anio_eleccion, org_clave, nivel, ubigeo) DO UPDATE
    SET contratos = EXCLUDED.contratos, leidos = EXCLUDED.leidos, con_senales = EXCLUDED.con_senales;
  DELETE FROM partido_resumen_gobierno WHERE procesos = 0 AND contratos = 0;
END $$;
ALTER FUNCTION refrescar_resumen_gobierno_vigia() OWNER TO vigia_jobs;

-- Los resúmenes de las migraciones 78-80, con estos dos al final.
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
  -- Migración 81: por objeto y por gobierno.
  PERFORM refrescar_resumen_objeto_gobierno_historia();
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
  -- Migración 81: por objeto y por gobierno.
  PERFORM refrescar_resumen_gobierno_vigia();
  RETURN n;
END $function$;
ALTER FUNCTION refrescar_resumen_vigia() OWNER TO vigia_jobs;

SELECT refrescar_resumen_objeto_gobierno_historia();
SELECT refrescar_resumen_gobierno_vigia();
