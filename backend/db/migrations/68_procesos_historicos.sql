-- 68 · Procesos adjudicados antes de 2018 (API OCDS), para los partidos y la historia de cada entidad.
--
-- CONOSCE empieza en 2018: el período de gobierno 2015-2018 sólo tenía su último año y la historia de una entidad
-- arrancaba en 2018. La API OCDS del OECE sí trae 2015-2017 (≈ 250 convocatorias por día). vigia-scrapers
-- (fuente `oece_historico`, src/fuentes/oece_historico.ts) la baja día por día y guarda aquí los procesos
-- adjudicados con lo mismo que trae CONOSCE: entidad, fecha, objeto, valor referencial, lo adjudicado y el ganador.
-- No van a `convocatorias`, que es la base de lo que Vigía puede leer: estos procesos ya cerraron.
--
-- `refrescar_partido_proceso()` los suma a los de CONOSCE (sólo antes de 2018 y si CONOSCE no tiene ese código), y
-- GET /entidades/:ruc/procesos también.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/68_procesos_historicos.sql
-- y después: POST /correr {"fuente":"oece_historico","desde":"2015-01-01","hasta":"2017-12-31"} (por tramos).

CREATE TABLE IF NOT EXISTS procesos_historicos (
  codigo              TEXT PRIMARY KEY,           -- tender.id del OCDS (el código de convocatoria del SEACE)
  ocid                TEXT NOT NULL,
  entidad_ruc         TEXT NOT NULL,
  entidad             TEXT,
  fecha_convocatoria  DATE NOT NULL,
  objeto              TEXT,                       -- como CONOSCE: Bien, Servicio, Obra, Consultoría de Obra
  tipo_proceso        TEXT,
  nomenclatura        TEXT,
  descripcion         TEXT,
  monto_referencial   NUMERIC(18, 2),
  monto_adjudicado    NUMERIC(18, 2),
  moneda              TEXT,
  proveedores         INT,
  proveedor           TEXT,                       -- el de mayor monto adjudicado
  ruc_proveedor       TEXT
);
CREATE INDEX IF NOT EXISTS procesos_historicos_entidad ON procesos_historicos (entidad_ruc, fecha_convocatoria DESC);
CREATE INDEX IF NOT EXISTS procesos_historicos_fecha ON procesos_historicos (fecha_convocatoria);
ALTER TABLE procesos_historicos OWNER TO vigia_jobs;
GRANT SELECT ON procesos_historicos TO vigia_api;

/*
 * La de la migración 65, con los procesos históricos (antes de 2018) sumados a los de CONOSCE. Cada entidad se cruza
 * con su gobierno por su RUC, que es el mismo en las dos fuentes (entidad_gobierno_amplia sale de CONOSCE): una
 * municipalidad que sólo compró antes de 2018 queda sin gobierno, como la que nunca aparece en CONOSCE.
 */
CREATE OR REPLACE FUNCTION refrescar_partido_proceso() RETURNS TABLE (entidades INT, procesos INT)
LANGUAGE plpgsql AS $$
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
  RETURN QUERY SELECT ne, np;
END $$;
ALTER FUNCTION refrescar_partido_proceso() OWNER TO vigia_jobs;
GRANT EXECUTE ON FUNCTION refrescar_partido_proceso() TO vigia_jobs;
