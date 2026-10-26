-- 147 · «Mismo domicilio»: la historia de ofertar juntas también pesa.
--
-- Con la 145, que la otra empresa no ofertara en ESTE proceso bajaba el cruce a «baja». Pero OQ PHARMA y PHARMAGEN
-- (misma dirección en Chacarilla) se presentaron juntas a 80 procesos más: es un patrón, no un registro suelto. Ahora:
--   alta   la otra también ofertó (o CONOSCE no trae el proceso) y en la dirección hay sólo 2 empresas;
--   media  ofertó (o no se sabe) con 3 a 5 empresas en la dirección, o no ofertó aquí pero ya se presentaron juntas a
--          3 procesos o más;
--   baja   no ofertó aquí y casi no tienen historia juntas (menos de 3 procesos).
-- `procesos_juntas` se calcula antes de la gravedad; el resto, como la 145.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/147_domicilio_historia_juntas.sql
-- y después: SELECT refrescar_cruce_domicilio_compartido(); SELECT dedup_cruces_proveedor();
--            SELECT refrescar_casos_cruce_base();

CREATE OR REPLACE FUNCTION refrescar_cruce_domicilio_compartido() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  DELETE FROM cruces_proveedor WHERE tipo = 'domicilio_compartido';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  -- Eficiencia: se parte de los GANADORES que ya tienen domicilio compartido (un subconjunto chico) y sólo para SUS
  -- procesos se abren los postores del OCDS; abrir los tenderers de los 750k procesos sería inviable.
  WITH dom AS (
    SELECT domicilio_fiscal, count(*) AS n_empresas
      FROM empresas WHERE ruc LIKE '20%' AND domicilio_fiscal IS NOT NULL AND length(domicilio_fiscal) > 12
      GROUP BY 1 HAVING count(*) BETWEEN 2 AND 5
  ), emp AS (
    SELECT e.ruc, e.razon_social, e.domicilio_fiscal, d.n_empresas
      FROM empresas e JOIN dom d ON d.domicilio_fiscal = e.domicilio_fiscal WHERE e.ruc LIKE '20%'
  ), win AS (
    SELECT a.codigo_convocatoria AS codigo, a.ruc_proveedor AS ruc, ew.domicilio_fiscal, ew.n_empresas,
           max(a.fecha_buenapro) AS f,
           sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS monto
      FROM conosce_adjudicaciones a
      JOIN emp ew ON ew.ruc = a.ruc_proveedor
     GROUP BY 1, 2, 3, 4
  ), cv AS (
    SELECT DISTINCT ON (c.codigo) c.codigo, c.ocid, c.ocds_payload
      FROM convocatorias c
     WHERE c.ocid NOT LIKE 'ocds-vigia-%' AND c.codigo IN (SELECT codigo FROM win)
       AND jsonb_typeof(c.ocds_payload->'tender'->'tenderers') = 'array'
     ORDER BY c.codigo, c.ocid
  ), hit AS (
    SELECT cv.ocid, w.codigo, w.ruc, w.domicilio_fiscal, w.n_empresas, w.f, w.monto,
           (SELECT jsonb_agg(DISTINCT jsonb_build_object('ruc', e2.ruc, 'nombre', e2.razon_social))
              FROM jsonb_array_elements(cv.ocds_payload->'tender'->'tenderers') t
              JOIN emp e2 ON e2.ruc = regexp_replace(t->>'id', '^PE-RUC-', '')
             WHERE e2.domicilio_fiscal = w.domicilio_fiscal AND e2.ruc <> w.ruc) AS otros,
           EXISTS (SELECT 1 FROM conosce_postores p WHERE p.codigo_convocatoria = w.codigo) AS conosce
      FROM win w JOIN cv ON cv.codigo = w.codigo
     WHERE w.f IS NOT NULL AND w.monto >= 44000
  ), con AS (
    SELECT hit.*,
           CASE WHEN hit.conosce THEN
             (SELECT count(DISTINCT p.ruc_postor) FROM conosce_postores p
               WHERE p.codigo_convocatoria = hit.codigo
                 AND p.ruc_postor IN (SELECT x->>'ruc' FROM jsonb_array_elements(hit.otros) x)) END AS ofertaron,
           (SELECT count(DISTINCT a.codigo_convocatoria)
              FROM conosce_postores a
              JOIN conosce_postores b ON b.codigo_convocatoria = a.codigo_convocatoria
             WHERE a.ruc_postor = hit.ruc
               AND b.ruc_postor IN (SELECT x->>'ruc' FROM jsonb_array_elements(hit.otros) x)
               AND a.codigo_convocatoria IS DISTINCT FROM hit.codigo) AS juntas
      FROM hit WHERE hit.otros IS NOT NULL
  )
  SELECT 'domicilio_compartido', con.ruc, con.ocid,
         CASE WHEN con.ofertaron = 0 AND con.juntas < 3 THEN 'baja'
              WHEN con.ofertaron = 0 THEN 'media'
              WHEN con.n_empresas = 2 THEN 'alta'
              ELSE 'media' END,
         con.f, con.monto,
         jsonb_build_object(
           'domicilio', con.domicilio_fiscal,
           'empresas_en_domicilio', con.n_empresas,
           'otros_postores', jsonb_array_length(con.otros),
           'postores', con.otros,
           'ofertaron', con.ofertaron,
           'empresas', (SELECT jsonb_agg(jsonb_build_object('ruc', e3.ruc, 'nombre', e3.razon_social) ORDER BY e3.razon_social)
                          FROM emp e3 WHERE e3.domicilio_fiscal = con.domicilio_fiscal),
           'procesos_juntas', con.juntas),
         'sunat', 'https://e-consultaruc.sunat.gob.pe/'
    FROM con;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_cruce_domicilio_compartido() OWNER TO vigia_jobs;
