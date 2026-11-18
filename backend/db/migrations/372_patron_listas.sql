-- 372: las listas de patrones que se agrupaban al vuelo, precalculadas (inhabilitadas, control, observados).
--
-- Medido el 2026-11-18: eran las tres consultas más caras de la API (248, 170 y 139 ms; 293 pedidos cada una en 20
-- minutos, de los índices de patrones de cada ficha de entidad y empresa). Un primer arreglo (la lista entera una vez por
-- instancia de la API) bajó el tiempo de base un 58 %, pero cada instancia nueva del Worker la rehacía (2 s, 23 veces en 45
-- minutos). Ahora la base las tiene armadas y las refresca cada 30 minutos; la API las lee enteras (unos miles de filas).
--
-- Las mismas columnas y el mismo orden que la API (routes/patrones.ts), salvo la clave de cada caso, que lleva la sal
-- secreta de la API y se calcula al leer. La de control guarda el documento de la persona (para agrupar y para esa clave):
-- sólo la lee vigia_api, que ya lee cruces_proveedor; nunca sale en una respuesta.
-- Dueño postgres y pg_cron con postgres, como refrescar_transparencia_analisis (migración 300).

CREATE MATERIALIZED VIEW IF NOT EXISTS patron_lista_inhabilitada AS
WITH x AS (
  SELECT c.ruc_empresa AS ruc, c.detalle->>'sancionada_ruc' AS sancionada_ruc, max(c.detalle->>'sancionada') AS sancionada,
         max(c.detalle->>'sancion') AS sancion, min(c.detalle->>'sancion_desde') AS sancion_desde, max(c.detalle->>'sancion_hasta') AS sancion_hasta,
         max(c.persona_nombre) AS nombre, count(DISTINCT c.ocid)::int AS contratos,
         (count(DISTINCT c.ocid) FILTER (WHERE c.severidad = 'alta'))::int AS graves, sum(c.monto)::float AS monto,
         count(DISTINCT cv.entidad_ruc)::int AS entidades, min(c.fecha) AS desde, max(c.fecha) AS hasta,
         COALESCE(bool_or((c.detalle->>'hecha_para_seguir')::boolean), false) AS hecha, max(c.detalle->>'fundada') AS fundada,
         (array_agg(c.ocid ORDER BY c.monto DESC NULLS LAST))[1:3] AS ejemplos, array_agg(DISTINCT cv.entidad_ruc::text) AS ents
    FROM cruces_proveedor c JOIN convocatorias cv ON cv.ocid = c.ocid
   WHERE c.tipo = 'socio_de_inhabilitada'
   GROUP BY 1, 2)
SELECT x.*, e.razon_social AS empresa,
       row_number() OVER (ORDER BY x.graves DESC, x.contratos DESC, x.monto DESC NULLS LAST, x.ruc, x.sancionada_ruc)::int AS orden
  FROM x LEFT JOIN empresas e ON e.ruc = x.ruc;
CREATE UNIQUE INDEX IF NOT EXISTS patron_lista_inhabilitada_llave ON patron_lista_inhabilitada (ruc, sancionada_ruc);

CREATE MATERIALIZED VIEW IF NOT EXISTS patron_lista_control AS
WITH x AS (
  SELECT c.ruc_empresa AS ruc, c.persona_doc, max(c.persona_nombre) AS nombre, max(c.detalle->>'rol_en_empresa') AS rol,
         (array_agg(c.detalle->>'informe_codigo' ORDER BY c.detalle->>'emision', c.fecha))[1] AS informe_codigo,
         (array_agg(c.detalle->>'informe_numero' ORDER BY c.detalle->>'emision', c.fecha))[1] AS informe_numero,
         (array_agg(c.detalle->>'informe_entidad' ORDER BY c.detalle->>'emision', c.fecha))[1] AS informe_entidad,
         (array_agg(c.detalle->>'informe_entidad_ruc' ORDER BY c.detalle->>'emision', c.fecha))[1] AS informe_entidad_ruc,
         (array_agg(c.detalle->>'emision' ORDER BY c.detalle->>'emision', c.fecha))[1] AS emision,
         (array_agg(c.detalle->'responsabilidades' ORDER BY c.detalle->>'emision', c.fecha))[1] AS responsabilidades,
         (array_agg(c.detalle->>'url_resumen' ORDER BY c.detalle->>'emision', c.fecha))[1] AS ficha,
         max((c.detalle->>'n_informes')::int) AS informes,
         count(DISTINCT c.ocid)::int AS contratos, (count(DISTINCT c.ocid) FILTER (WHERE c.severidad = 'alta'))::int AS graves,
         sum(c.monto)::float AS monto, count(DISTINCT cv.entidad_ruc)::int AS entidades,
         COALESCE(bool_or((c.detalle->>'misma_entidad')::boolean OR (c.detalle->>'misma_entidad_en_otro')::boolean), false) AS misma,
         min(c.fecha) AS desde, max(c.fecha) AS hasta,
         (array_agg(c.ocid ORDER BY c.severidad = 'alta' DESC, c.monto DESC NULLS LAST))[1:3] AS ejemplos,
         array_agg(DISTINCT cv.entidad_ruc::text) AS ents
    FROM cruces_proveedor c JOIN convocatorias cv ON cv.ocid = c.ocid
   WHERE c.tipo = 'socio_con_informe_control'
   GROUP BY c.ruc_empresa, c.persona_doc)
SELECT x.*, e.razon_social AS empresa,
       row_number() OVER (ORDER BY x.misma DESC, x.graves DESC, x.contratos DESC, x.monto DESC NULLS LAST, x.ruc, x.persona_doc)::int AS orden
  FROM x LEFT JOIN empresas e ON e.ruc = x.ruc;
CREATE UNIQUE INDEX IF NOT EXISTS patron_lista_control_llave ON patron_lista_control (ruc, persona_doc);

CREATE MATERIALIZED VIEW IF NOT EXISTS patron_lista_observado AS
WITH b AS (
  SELECT c.ruc_empresa AS ruc, btrim(cv.entidad_ruc::text) AS entidad_ruc, c.ocid, c.severidad, c.monto, c.fecha,
         c.detalle->>'informe_codigo' AS codigo, c.detalle->>'informe_numero' AS numero, NULLIF(c.detalle->>'emision', '')::date AS emision,
         c.detalle->'responsabilidades' AS resp, c.detalle->>'url_resumen' AS ficha, c.detalle->>'tema' AS tema
    FROM cruces_proveedor c JOIN convocatorias cv ON cv.ocid = c.ocid
   WHERE c.tipo = 'observado_por_contraloria' AND c.ruc_empresa ~ '^20[0-9]{9}$'),
x AS (
  SELECT ruc, entidad_ruc, count(DISTINCT ocid)::int AS observados, (count(DISTINCT ocid) FILTER (WHERE severidad = 'alta'))::int AS graves,
         sum(monto)::float AS monto, min(emision) AS emision,
         (array_agg(codigo ORDER BY emision, ocid))[1] AS informe_codigo, (array_agg(numero ORDER BY emision, ocid))[1] AS informe_numero,
         (array_agg(resp ORDER BY emision, ocid))[1] AS responsabilidades, (array_agg(ficha ORDER BY emision, ocid))[1] AS ficha,
         count(DISTINCT codigo)::int AS informes, array_agg(DISTINCT tema) FILTER (WHERE tema IS NOT NULL) AS temas,
         (array_agg(ocid ORDER BY severidad = 'alta' DESC, monto DESC NULLS LAST))[1:3] AS ejemplos,
         min(fecha) AS desde, max(fecha) AS hasta
    FROM b GROUP BY ruc, entidad_ruc),
k AS (
  SELECT DISTINCT b.ruc, b.entidad_ruc, p.codigo, p.n, CASE WHEN p.moneda = 'PEN' AND p.perjuicio > 0 THEN p.perjuicio END AS perjuicio
    FROM b JOIN informe_control_proceso p ON p.ocid = b.ocid),
o AS (
  SELECT n.ruc, n.entidad_ruc, n.observaciones, m.perjuicio
    FROM (SELECT ruc, entidad_ruc, count(*)::int AS observaciones FROM k GROUP BY 1, 2) n
    LEFT JOIN (SELECT ruc, entidad_ruc, sum(perjuicio)::float AS perjuicio
                 FROM (SELECT DISTINCT ruc, entidad_ruc, codigo, perjuicio FROM k WHERE perjuicio IS NOT NULL) u GROUP BY 1, 2) m
      ON m.ruc = n.ruc AND m.entidad_ruc = n.entidad_ruc)
SELECT x.*, e.razon_social AS empresa, en.nombre AS entidad, o.perjuicio, o.observaciones,
       COALESCE(d.despues, 0) AS despues, d.monto_despues, d.ultima AS ultima_despues,
       row_number() OVER (ORDER BY (COALESCE(d.despues, 0) > 0) DESC, x.graves DESC, COALESCE(d.despues, 0) DESC, o.perjuicio DESC NULLS LAST, x.ruc, x.entidad_ruc)::int AS orden
  FROM x
  LEFT JOIN o ON o.ruc = x.ruc AND o.entidad_ruc = x.entidad_ruc
  LEFT JOIN empresas e ON e.ruc = x.ruc
  LEFT JOIN entidades en ON btrim(en.ruc::text) = x.entidad_ruc
  LEFT JOIN LATERAL (
    SELECT count(DISTINCT a.codigo_convocatoria)::int AS despues, sum(a.monto_adjudicado)::float AS monto_despues, max(a.fecha_buenapro) AS ultima
      FROM conosce_adjudicaciones a
     WHERE x.emision IS NOT NULL AND a.ruc_proveedor = x.ruc AND a.entidad_ruc = x.entidad_ruc
       AND a.fecha_buenapro > x.emision AND a.monto_adjudicado > 0) d ON true;
CREATE UNIQUE INDEX IF NOT EXISTS patron_lista_observado_llave ON patron_lista_observado (ruc, entidad_ruc);

-- El refresco: CONCURRENTLY (quien lee no espera) y cada una por su lado (si una falla, las otras se refrescan igual).
CREATE OR REPLACE FUNCTION refrescar_patron_listas() RETURNS void LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['patron_lista_inhabilitada', 'patron_lista_control', 'patron_lista_observado'] LOOP
    BEGIN
      EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY public.%I', v);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'refrescar_patron_listas: % falló: %', v, SQLERRM;
    END;
  END LOOP;
END $$;

-- Sólo la API las lee (la de control guarda documentos: ningún otro rol).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_api') THEN
    GRANT SELECT ON patron_lista_inhabilitada, patron_lista_control, patron_lista_observado TO vigia_api;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('vigia-patron-listas', '13,43 * * * *', 'SELECT public.refrescar_patron_listas()');
  ELSE
    RAISE NOTICE 'Sin pg_cron: llama a refrescar_patron_listas() desde donde corran los refrescos.';
  END IF;
END $$;
