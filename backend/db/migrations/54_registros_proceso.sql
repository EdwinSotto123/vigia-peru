-- 54 · registros_proceso(ocid): todo lo que la base ya sabe del ganador de un proceso, en una consulta.
--
-- Los scrapers (backend/scrapers-worker) mantienen al día ONPE, JNE, visitas, sanciones, penalidades, RNP y
-- CONOSCE, y refrescar_cruces() los cruza con cada ganador. Los agentes, en vez de buscar en la web o en los
-- portales (perfil OECE, hoja de vida JNE, historial del proveedor), llaman a esta función primero
-- (herramienta `query_registros_proceso`, backend/agent/tools/registros.py) y sólo salen a buscar lo que no está.
--
-- Devuelve un JSON con:
--   ganadores         cada ganador con RUC; un consorcio, abierto en sus integrantes (migración 53)
--   cruces            cruces_proveedor del proceso y de sus ganadores (con DNI: es para los agentes, no la API)
--   socios_rnp        socios, representantes y directivos de cada ganador (RNP)
--   postores          los postores del proceso según CONOSCE, con su razón social
--   historial         lo que cada ganador le ganó antes a la misma entidad (CONOSCE, desde 2018)
--   contratos         el contrato del proceso en CONOSCE: monto, adicionales, prórrogas, URL
--   ordenes_mismo_dia días en que la entidad le emitió órdenes "hasta 8 UIT" que juntas pasan el tope (migración 51)
--   datos_al_dia      la última carga de cada fuente (datasets_cargas)
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/54_registros_proceso.sql

CREATE OR REPLACE FUNCTION registros_proceso(p_ocid TEXT) RETURNS JSONB LANGUAGE sql STABLE AS $$
  WITH c AS (
    SELECT ocid, entidad_ruc::text AS entidad_ruc, ocds_payload FROM convocatorias
    WHERE ocid_corto(ocid) = ocid_corto(p_ocid) LIMIT 1
  ), g AS (
    SELECT DISTINCT regexp_replace(s->>'id', '^PE-RUC-', '') AS sup, s->>'name' AS nombre,
           NULLIF(aw->>'date', '')::date AS fecha, (aw->'value'->>'amount')::numeric AS monto
    FROM c, jsonb_array_elements(COALESCE(c.ocds_payload->'awards', '[]'::jsonb)) aw,
         jsonb_array_elements(COALESCE(aw->'suppliers', '[]'::jsonb)) s
  ), gm AS (
    SELECT g.*, COALESCE(m.ruc_miembro, g.sup) AS ruc, COALESCE(m.miembro, g.nombre) AS razon_social,
           CASE WHEN m.ruc_miembro IS NOT NULL THEN g.nombre END AS consorcio
    FROM g LEFT JOIN (
      SELECT DISTINCT ON (ruc_consorcio, ruc_miembro) ruc_consorcio, ruc_miembro, miembro FROM conosce_consorcios
      WHERE ruc_miembro ~ '^(10|20)\d{9}$' ORDER BY ruc_consorcio, ruc_miembro, anio DESC
    ) m ON m.ruc_consorcio = g.sup AND g.sup !~ '^(10|20)\d{9}$'
  ), r AS (SELECT DISTINCT ruc FROM gm WHERE ruc ~ '^(10|20)\d{9}$')
  SELECT jsonb_build_object(
    'ocid', (SELECT ocid FROM c),
    'entidad_ruc', (SELECT entidad_ruc FROM c),
    'ganadores', (SELECT jsonb_agg(jsonb_build_object('ruc', ruc, 'razon_social', razon_social, 'consorcio', consorcio,
                                                       'codigo_consorcio', CASE WHEN consorcio IS NOT NULL THEN sup END,
                                                       'fecha_buena_pro', fecha, 'monto', monto)) FROM gm),
    'cruces', (SELECT jsonb_agg(jsonb_build_object('tipo', k.tipo, 'severidad', k.severidad, 'ruc', k.ruc_empresa, 'fecha', k.fecha,
                                                    'monto', k.monto, 'persona', k.persona_nombre, 'dni', k.persona_doc,
                                                    'rol', k.persona_rol, 'detalle', k.detalle, 'fuente', k.fuente,
                                                    'fuente_url', k.fuente_url)
                                 ORDER BY CASE k.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, k.tipo)
               FROM cruces_proveedor k
               WHERE k.ruc_empresa IN (SELECT ruc FROM r) AND (k.ocid IS NULL OR ocid_corto(k.ocid) = ocid_corto(p_ocid))),
    'socios_rnp', (SELECT jsonb_agg(jsonb_build_object('ruc', x.ruc_empresa, 'nombre', x.nombre, 'tipo_documento', x.tipo_documento,
                                                        'documento', x.numero_documento, 'rol', x.tipo_rol,
                                                        'desde', x.fecha_inicio_vigencia))
                   FROM (SELECT * FROM rnp_conformacion_juridica WHERE ruc_empresa::text IN (SELECT ruc FROM r) LIMIT 80) x),
    'postores', (SELECT jsonb_agg(DISTINCT jsonb_build_object('ruc', p.ruc_postor, 'nombre', p.postor))
                 FROM conosce_postores p WHERE p.codigo_convocatoria = ocid_corto(p_ocid)),
    'historial', (SELECT jsonb_agg(h) FROM (
                    SELECT a.ruc_proveedor AS ruc, count(DISTINCT a.codigo_convocatoria) AS procesos, sum(a.monto_adjudicado) AS monto,
                           min(a.fecha_buenapro) AS desde, max(a.fecha_buenapro) AS hasta,
                           (SELECT jsonb_agg(u) FROM (SELECT DISTINCT ON (b.codigo_convocatoria) b.codigo_convocatoria, b.fecha_buenapro,
                                                             left(b.descripcion_proceso, 160) AS objeto, b.monto_adjudicado
                                                      FROM conosce_adjudicaciones b
                                                      WHERE b.ruc_proveedor = a.ruc_proveedor AND b.entidad_ruc = a.entidad_ruc
                                                      ORDER BY b.codigo_convocatoria, b.fecha_buenapro DESC LIMIT 10) u) AS ultimos
                    FROM conosce_adjudicaciones a
                    WHERE a.entidad_ruc = (SELECT entidad_ruc FROM c) AND a.ruc_proveedor IN (SELECT ruc FROM r UNION SELECT sup FROM gm)
                      AND a.codigo_convocatoria <> ocid_corto(p_ocid)
                    GROUP BY a.ruc_proveedor, a.entidad_ruc) h),
    'contratos', (SELECT jsonb_agg(jsonb_build_object('contrato', k.num_contrato, 'ruc', k.ruc_contratista,
                                                       'monto_total', k.monto_contratado_total, 'adicional', k.monto_adicional,
                                                       'reduccion', k.monto_reduccion, 'prorroga', k.monto_prorroga,
                                                       'suscripcion', k.fecha_suscripcion, 'vigencia_fin', k.fecha_vigencia_fin_actualizada,
                                                       'url', k.url_contrato))
                  FROM conosce_contratos k WHERE k.codigo_convocatoria = ocid_corto(p_ocid)),
    'ordenes_mismo_dia', (SELECT jsonb_agg(o) FROM (
                            SELECT f.ruc_contratista AS ruc, f.fecha, f.objeto, f.ordenes, f.total, f.tope, f.misma_descripcion, f.detalle
                            FROM ordenes_fraccionadas f
                            WHERE f.entidad_ruc = (SELECT entidad_ruc FROM c) AND f.ruc_contratista IN (SELECT ruc FROM r)
                            ORDER BY f.fecha DESC LIMIT 15) o),
    'datos_al_dia', (SELECT jsonb_object_agg(fuente, ultima) FROM (
                       SELECT fuente, max(descargado_at)::date AS ultima FROM datasets_cargas GROUP BY fuente) d)
  )
$$;
ALTER FUNCTION registros_proceso(TEXT) OWNER TO vigia_jobs;
GRANT SELECT ON cruces_proveedor, conosce_adjudicaciones, conosce_postores, conosce_contratos, conosce_consorcios,
                ordenes_fraccionadas, datasets_cargas TO vigia_agentes;
GRANT EXECUTE ON FUNCTION registros_proceso(TEXT) TO vigia_agentes;
