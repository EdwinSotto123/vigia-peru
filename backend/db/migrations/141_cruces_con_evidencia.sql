-- 141 · Cruces que dicen con quién, dónde y desde cuándo.
--
-- El usuario (2026-10-26), sobre «Mismo domicilio fiscal que otro postor»: «falta más explicación». El cruce decía
-- «comparte su domicilio fiscal con otro postor de este proceso (en esa dirección hay 2 empresas)» sin decir cuál era el
-- otro postor, cuál la dirección ni qué empresas están ahí: la consulta lo tenía y lo reducía a dos conteos.
--
-- 1) refrescar_cruce_domicilio_compartido() guarda además, en `detalle`:
--      domicilio        la dirección fiscal de la SUNAT (pública para una empresa RUC 20: también va en su ficha);
--      postores         los otros postores de ESTE proceso con esa dirección, [{ruc, nombre}];
--      empresas         todas las empresas RUC 20 de esa dirección, [{ruc, nombre}];
--      procesos_juntas  en cuántos OTROS procesos se presentaron juntos el ganador y esos postores (conosce_postores;
--                       0 también cuando CONOSCE no trae el proceso: la ficha sólo lo dice si es más de 0).
--    `otros_postores` sigue siendo el conteo (lo lee la ficha de antes). Sólo RUC 20: nunca la dirección de una persona
--    natural (las de RUC 10 ni entran: `dom` y `emp` son de empresas).
-- 2) cruce_es_antecedente(): las bandas de la sanción (migración 121: sancion_definitiva, sancion_temporal,
--    sancion_multa) se juzgan por su fecha, como `sancion`. Caían en ELSE true: una sanción posterior a la convocatoria
--    contaba como antecedente en la lista («Antecedentes») mientras la ficha la mostraba como «Sancionada después».
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/141_cruces_con_evidencia.sql
-- y después: SELECT refrescar_cruce_domicilio_compartido(); SELECT dedup_cruces_proveedor();
--            SELECT refrescar_casos_cruce_base();   (la lista vuelve a contar sólo los antecedentes reales)

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
             WHERE e2.domicilio_fiscal = w.domicilio_fiscal AND e2.ruc <> w.ruc) AS otros
      FROM win w JOIN cv ON cv.codigo = w.codigo
     WHERE w.f IS NOT NULL AND w.monto >= 44000
  )
  SELECT 'domicilio_compartido', hit.ruc, hit.ocid,
         CASE WHEN hit.n_empresas = 2 THEN 'alta' ELSE 'media' END,
         hit.f, hit.monto,
         jsonb_build_object(
           'domicilio', hit.domicilio_fiscal,
           'empresas_en_domicilio', hit.n_empresas,
           'otros_postores', jsonb_array_length(hit.otros),
           'postores', hit.otros,
           'empresas', (SELECT jsonb_agg(jsonb_build_object('ruc', e3.ruc, 'nombre', e3.razon_social) ORDER BY e3.razon_social)
                          FROM emp e3 WHERE e3.domicilio_fiscal = hit.domicilio_fiscal),
           'procesos_juntas', (SELECT count(DISTINCT a.codigo_convocatoria)
                                 FROM conosce_postores a
                                 JOIN conosce_postores b ON b.codigo_convocatoria = a.codigo_convocatoria
                                WHERE a.ruc_postor = hit.ruc
                                  AND b.ruc_postor IN (SELECT x->>'ruc' FROM jsonb_array_elements(hit.otros) x)
                                  AND a.codigo_convocatoria IS DISTINCT FROM hit.codigo)),
         'sunat', 'https://e-consultaruc.sunat.gob.pe/'
    FROM hit WHERE hit.otros IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_cruce_domicilio_compartido() OWNER TO vigia_jobs;

CREATE OR REPLACE FUNCTION cruce_es_antecedente(p_tipo TEXT, p_fecha DATE, p_detalle JSONB, p_proceso DATE) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_proceso IS NULL THEN true
    WHEN p_tipo = 'penalidad' THEN COALESCE(NULLIF(p_detalle->>'desde', '')::date, p_fecha) < p_proceso
    WHEN p_tipo IN ('aporte', 'aporte_empresa') THEN COALESCE(NULLIF(p_detalle->>'desde', '')::int, extract(year FROM p_fecha)::int)
                                                      <= extract(year FROM p_proceso)::int
    -- Las bandas de la sanción (migración 121), por su fecha como la sanción de siempre.
    WHEN p_tipo IN ('sancion', 'sancion_definitiva', 'sancion_temporal', 'sancion_multa', 'autoridad')
      THEN p_fecha IS NULL OR p_fecha < p_proceso
    WHEN p_tipo IN ('candidato', 'proveedor_campana') THEN COALESCE(substring(p_detalle->>'proceso' FROM '(\d{4})')::int, 0)
                                                           <= extract(year FROM p_proceso)::int
    ELSE true
  END
$$;
ALTER FUNCTION cruce_es_antecedente(TEXT, DATE, JSONB, DATE) OWNER TO vigia_jobs;
GRANT EXECUTE ON FUNCTION cruce_es_antecedente(TEXT, DATE, JSONB, DATE) TO vigia_api, vigia_api_admin;
