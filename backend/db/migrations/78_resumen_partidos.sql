-- 78 · Resumen por partido, período y región: el ranking de partidos suma cientos de filas, no cientos de miles.
--
-- Con la historia del OECE, GET /partidos/ranking agregaba en cada pedido los ~130 mil procesos de partido_proceso
-- (6,7 s, casi todo leer filas anchas para contarlas) y los ~180 mil contratos de contrato_partido × contrato_estado
-- (3 s): 9,7 s en frío, al borde de los 10 s del rol de la API. Estas dos tablas guardan esos conteos por
-- (período, partido, región = 2 dígitos del ubigeo del gobierno). Cada gobierno es de una sola región, así que sumar
-- "gobiernos con …" por región da el total sin repetir.
--   · partido_resumen_historia: la rehace refrescar_partido_proceso() (la llama conosce y oece_historico).
--   · partido_resumen_vigia: la rehace refrescar_contrato_partido() (la llama la cadena de casos cruzados, a diario).
--     Lo leído y la cola pueden quedar atrasados hasta ese refresco: la lectura está pausada y cambia poco.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/78_resumen_partidos.sql

CREATE TABLE IF NOT EXISTS partido_resumen_historia (
  anio_eleccion   SMALLINT NOT NULL,
  org_clave       TEXT NOT NULL,
  region          TEXT NOT NULL,
  procesos        INT NOT NULL,
  monto_pen       NUMERIC(20, 2) NOT NULL,
  gobiernos       INT NOT NULL,
  PRIMARY KEY (anio_eleccion, org_clave, region)
);
CREATE TABLE IF NOT EXISTS partido_resumen_vigia (
  anio_eleccion     SMALLINT NOT NULL,
  org_clave         TEXT NOT NULL,
  region            TEXT NOT NULL,
  contratos         INT NOT NULL,
  leidos            INT NOT NULL,
  con_senales       INT NOT NULL,
  en_cola           INT NOT NULL,
  documentos_listos INT NOT NULL,
  monto_pen         NUMERIC(20, 2) NOT NULL,
  gobiernos         INT NOT NULL,
  PRIMARY KEY (anio_eleccion, org_clave, region)
);
ALTER TABLE partido_resumen_historia OWNER TO vigia_jobs;
ALTER TABLE partido_resumen_vigia OWNER TO vigia_jobs;
GRANT SELECT ON partido_resumen_historia, partido_resumen_vigia TO vigia_api, vigia_api_admin;

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
  RETURN n;
END $$;
ALTER FUNCTION refrescar_resumen_historia() OWNER TO vigia_jobs;

CREATE OR REPLACE FUNCTION refrescar_resumen_vigia() RETURNS INT
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
  RETURN n;
END $$;
ALTER FUNCTION refrescar_resumen_vigia() OWNER TO vigia_jobs;

-- Los dos refrescos de siempre, con el resumen al final.
CREATE OR REPLACE FUNCTION public.refrescar_partido_proceso()
 RETURNS TABLE(entidades integer, procesos integer)
 LANGUAGE plpgsql
AS $function$
DECLARE ne INT; np INT;
BEGIN
  -- Una a la vez: el relleno histórico corre por tramos en paralelo y cada tramo refresca al final.
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_partido_proceso'));
  -- DELETE y no TRUNCATE: quien lee (la API) sigue viendo lo anterior hasta que esto termina, sin quedar bloqueado.
  DELETE FROM entidad_gobierno_amplia;
  INSERT INTO entidad_gobierno_amplia (ruc, nivel, ubigeo, como)
  WITH e AS (SELECT DISTINCT ON (entidad_ruc) entidad_ruc AS ruc, mef_norm(entidad) AS n, mef_norm(entidad_departamento) AS dep, tipo_entidad
               FROM conosce_adjudicaciones ORDER BY entidad_ruc, anio DESC),
       m AS (SELECT DISTINCT ON (ejecutora) ejecutora AS ubigeo, mef_norm(ejecutora_nombre) AS n, mef_norm(departamento_nombre) AS dep
               FROM mef_ejecutora_anual WHERE nivel_gobierno = 'M' AND ejecutora ~ '^\d{6}$' ORDER BY ejecutora, anio DESC),
       d AS (SELECT ubigeo, mef_norm(nombre) AS dep FROM zonas WHERE length(ubigeo) = 2),
       muni AS (SELECT e.ruc, e.n, e.dep, CASE WHEN e.n ~ '^MUNICIPALIDAD DISTRITAL' THEN 'distrital' ELSE 'provincial' END AS nivel
                  FROM e WHERE e.n ~ '^MUNICIPALIDAD (PROVINCIAL|METROPOLITANA|DISTRITAL)'),
       -- Igual nombre en el mismo departamento; si no, el nombre más largo del MEF que empieza el de CONOSCE.
       cand AS (SELECT u.ruc, u.nivel, m.ubigeo, (m.n = u.n) AS igual, length(m.n) AS largo
                  FROM muni u JOIN m ON m.dep = u.dep AND (m.n = u.n OR left(u.n, length(m.n) + 1) = m.n || ' ')),
       mejor AS (SELECT DISTINCT ON (ruc) ruc, nivel, ubigeo, igual, largo FROM cand ORDER BY ruc, igual DESC, largo DESC),
       -- Sin empate: otro candidato igual de bueno descarta el cruce.
       unico AS (SELECT b.* FROM mejor b
                  WHERE NOT EXISTS (SELECT 1 FROM cand c WHERE c.ruc = b.ruc AND c.ubigeo <> b.ubigeo AND c.igual = b.igual AND c.largo = b.largo))
  SELECT eg.ruc, eg.nivel, eg.ubigeo, 'entidades' FROM entidad_gobierno eg
  UNION ALL
  SELECT x.ruc, x.nivel, CASE WHEN x.nivel = 'provincial' THEN left(x.ubigeo, 4) ELSE x.ubigeo END, 'mef'
    FROM unico x WHERE NOT EXISTS (SELECT 1 FROM entidad_gobierno eg WHERE eg.ruc = x.ruc)
  UNION ALL
  SELECT e.ruc, 'regional', d.ubigeo, 'departamento'
    FROM e JOIN d ON d.dep = e.dep
   WHERE e.tipo_entidad = 'GOBIERNO REGIONAL' AND e.n !~ 'METROPOLITANA'
     AND NOT EXISTS (SELECT 1 FROM entidad_gobierno eg WHERE eg.ruc = e.ruc)
  ON CONFLICT (ruc) DO NOTHING;
  GET DIAGNOSTICS ne = ROW_COUNT;

  DELETE FROM partido_proceso;
  INSERT INTO partido_proceso (codigo_convocatoria, entidad_ruc, entidad, anio, fecha_convocatoria, objeto, tipo_proceso, nomenclatura,
                               descripcion, items, monto_referencial, monto_adjudicado, monto_adjudicado_pen, moneda, proveedores, proveedor,
                               ruc_proveedor, org_clave, anio_eleccion, nivel, gobierno_ubigeo, autoridad, ocid)
  WITH a AS (SELECT DISTINCT ON (x.codigo_convocatoria, x.entidad_ruc, x.n_item) x.*
               FROM conosce_adjudicaciones x JOIN entidad_gobierno_amplia g ON g.ruc = x.entidad_ruc
              ORDER BY x.codigo_convocatoria, x.entidad_ruc, x.n_item, x.anio DESC),
       p AS (SELECT a.codigo_convocatoria, a.entidad_ruc, max(a.entidad) AS entidad, min(a.anio) AS anio, min(a.fecha_convocatoria) AS fecha,
                    max(a.objeto) AS objeto, max(a.tipo_proceso) AS tipo_proceso, max(a.nomenclatura) AS nomenclatura,
                    max(a.descripcion_proceso) AS descripcion, count(*)::int AS items, sum(a.monto_referencial) AS referencial,
                    sum(a.monto_adjudicado) AS adjudicado,
                    sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS adjudicado_pen,
                    max(a.moneda) AS moneda, count(DISTINCT a.ruc_proveedor)::int AS proveedores,
                    (array_agg(a.proveedor ORDER BY a.monto_adjudicado DESC NULLS LAST))[1] AS proveedor,
                    (array_agg(a.ruc_proveedor ORDER BY a.monto_adjudicado DESC NULLS LAST))[1] AS ruc_proveedor
               FROM a GROUP BY 1, 2),
       -- Antes de 2018 (CONOSCE empieza ese año): los procesos de la API OCDS (migración 68), si CONOSCE no los tiene.
       h AS (SELECT ph.codigo AS codigo_convocatoria, ph.entidad_ruc, ph.entidad, extract(year FROM ph.fecha_convocatoria)::smallint AS anio,
                    ph.fecha_convocatoria AS fecha, ph.objeto, ph.tipo_proceso, ph.nomenclatura, ph.descripcion, 1 AS items,
                    ph.monto_referencial AS referencial, ph.monto_adjudicado AS adjudicado,
                    CASE WHEN ph.moneda IS NULL OR ph.moneda = 'PEN' THEN ph.monto_adjudicado END AS adjudicado_pen,
                    CASE COALESCE(ph.moneda, 'PEN') WHEN 'PEN' THEN 'Soles' WHEN 'USD' THEN 'Dólar Norteamericano' WHEN 'EUR' THEN 'Euro'
                         ELSE ph.moneda END AS moneda,
                    ph.proveedores, ph.proveedor, ph.ruc_proveedor
               FROM procesos_historicos ph JOIN entidad_gobierno_amplia g ON g.ruc = ph.entidad_ruc
              WHERE ph.fecha_convocatoria < DATE '2018-01-01'
                AND NOT EXISTS (SELECT 1 FROM conosce_adjudicaciones c WHERE c.codigo_convocatoria = ph.codigo)),
       todo AS (SELECT * FROM p UNION ALL SELECT * FROM h)
  SELECT p.codigo_convocatoria, p.entidad_ruc, p.entidad, p.anio, p.fecha, p.objeto, p.tipo_proceso, p.nomenclatura, p.descripcion, p.items,
         p.referencial, p.adjudicado, p.adjudicado_pen, p.moneda, p.proveedores, p.proveedor, p.ruc_proveedor,
         gp.org_clave, gp.anio_eleccion, gp.nivel, gp.ubigeo, gp.autoridad, c.ocid
    FROM todo p
    JOIN entidad_gobierno_amplia eg ON eg.ruc = p.entidad_ruc
    JOIN gobierno_periodo gp ON gp.nivel = eg.nivel AND gp.ubigeo = eg.ubigeo AND p.fecha BETWEEN gp.desde AND gp.hasta
    LEFT JOIN convocatorias c ON c.ocid = p.codigo_convocatoria
  ON CONFLICT (codigo_convocatoria, entidad_ruc) DO NOTHING;
  GET DIAGNOSTICS np = ROW_COUNT;
  -- Migración 78: el resumen por partido, período y región que lee el ranking.
  PERFORM refrescar_resumen_historia();
  RETURN QUERY SELECT ne, np;
END $function$;
ALTER FUNCTION refrescar_partido_proceso() OWNER TO vigia_jobs;

CREATE OR REPLACE FUNCTION public.refrescar_contrato_partido()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE n INT;
BEGIN
  -- DELETE y no TRUNCATE: quien lee (la API) sigue viendo lo anterior hasta que esto termina, sin quedar bloqueado.
  DELETE FROM contrato_partido_tabla;
  INSERT INTO contrato_partido_tabla
  SELECT DISTINCT ON (org_clave, anio_eleccion, ocid) * FROM contrato_partido_calculado WHERE org_clave IS NOT NULL
  ORDER BY org_clave, anio_eleccion, ocid;
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM contrato_partido_idx;
  INSERT INTO contrato_partido_idx (ocid, org_clave) SELECT DISTINCT ocid, org_clave FROM contrato_partido_tabla;
  ANALYZE contrato_partido_tabla;
  ANALYZE contrato_partido_idx;
  -- Migración 78: el resumen por partido, período y región que lee el ranking.
  PERFORM refrescar_resumen_vigia();
  RETURN n;
END $function$;
ALTER FUNCTION refrescar_contrato_partido() OWNER TO vigia_jobs;

SELECT refrescar_resumen_historia();
SELECT refrescar_resumen_vigia();
