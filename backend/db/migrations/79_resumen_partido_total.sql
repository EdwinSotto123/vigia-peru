-- 79 · Totales de cada partido por período (procesos, monto, entidades, proveedores, gobiernos, fechas) ya calculados.
--
-- La ficha de un partido (GET /partidos/:clave) hacía nueve consultas a la vez con un pool de tres conexiones por
-- pedido; la de los totales de su historia (count DISTINCT sobre las filas anchas de partido_proceso) tardaba 4,6 s
-- en un partido grande y las últimas esperaban conexión más de 5 s: "timeout exceeded when trying to connect", 500.
-- Los distintos no se pueden sumar por región (migración 78), así que van por (período, partido). Los rehace
-- refrescar_resumen_historia(), que corre al final de refrescar_partido_proceso().
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/79_resumen_partido_total.sql

CREATE TABLE IF NOT EXISTS partido_resumen_total (
  anio_eleccion   SMALLINT NOT NULL,
  org_clave       TEXT NOT NULL,
  procesos        INT NOT NULL,
  monto_pen       NUMERIC(20, 2) NOT NULL,
  entidades       INT NOT NULL,
  proveedores     INT NOT NULL,
  gobiernos       INT NOT NULL,
  desde           DATE,
  hasta           DATE,
  PRIMARY KEY (anio_eleccion, org_clave)
);
ALTER TABLE partido_resumen_total OWNER TO vigia_jobs;
GRANT SELECT ON partido_resumen_total TO vigia_api, vigia_api_admin;

CREATE OR REPLACE FUNCTION refrescar_resumen_historia() RETURNS INT
LANGUAGE plpgsql AS $$
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
  RETURN n;
END $$;
ALTER FUNCTION refrescar_resumen_historia() OWNER TO vigia_jobs;

SELECT refrescar_resumen_historia();
