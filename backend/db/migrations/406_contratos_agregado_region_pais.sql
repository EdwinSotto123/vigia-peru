-- 406 · Los resúmenes de la lista de contratos sobre agregados por región y por país.
--
-- contratos_agregado (migración 35) tiene una fila por distrito × tipo × etapa × mes × riesgo × estado × operativo: 285 mil.
-- Toda faceta o conteo SIN filtro de zona la recorría entera y sumaba: medido el 2026-11-19 con pg_stat_statements, las
-- facetas por mes costaban 0,94-1,04 s por llamada (3 600 llamadas cada forma), las demás 0,19-0,37 s, y el mapa por
-- departamento 0,25-0,36 s; en total, horas de base. Por región quedan 60 010 filas; para todo el país, 5 039.
--
--   contratos_agregado_region   left(ubigeo, 2) como `region`: el filtro de un departamento (igualdad, por el índice) y el
--                               mapa por departamento.
--   contratos_agregado_pais     sin zona: los resúmenes y conteos sin filtro de región.
--
-- La API elige la más chica que responde exacto (routes/contratos.ts, tablaAgregado): con provincia o distrito sigue la de
-- distritos. Las tres suman lo mismo: salen de la misma vista, en el mismo refresco y en este orden.

DROP MATERIALIZED VIEW IF EXISTS contratos_agregado_pais;
DROP MATERIALIZED VIEW IF EXISTS contratos_agregado_region;

CREATE MATERIALIZED VIEW contratos_agregado_region AS
  SELECT left(ubigeo, 2) AS region, tipo, etapa, mes, riesgo, estado_proc, operativo,
         sum(n)::int AS n, sum(n_revision)::int AS n_revision, sum(monto) AS monto
    FROM contratos_agregado
   GROUP BY 1, 2, 3, 4, 5, 6, 7;
CREATE UNIQUE INDEX contratos_agregado_region_uidx
    ON contratos_agregado_region (region, tipo, etapa, mes, riesgo, estado_proc, operativo) NULLS NOT DISTINCT;

CREATE MATERIALIZED VIEW contratos_agregado_pais AS
  SELECT tipo, etapa, mes, riesgo, estado_proc, operativo,
         sum(n)::int AS n, sum(n_revision)::int AS n_revision, sum(monto) AS monto
    FROM contratos_agregado
   GROUP BY 1, 2, 3, 4, 5, 6;
CREATE UNIQUE INDEX contratos_agregado_pais_uidx
    ON contratos_agregado_pais (tipo, etapa, mes, riesgo, estado_proc, operativo) NULLS NOT DISTINCT;

GRANT SELECT ON contratos_agregado_region, contratos_agregado_pais TO vigia_api, vigia_api_admin;
COMMENT ON MATERIALIZED VIEW contratos_agregado_region IS 'contratos_agregado sumado por departamento (region = left(ubigeo, 2)). Se refresca justo después de ella. Migración 406.';
COMMENT ON MATERIALIZED VIEW contratos_agregado_pais IS 'contratos_agregado sumado para todo el país (sin zona). Se refresca justo después de ella. Migración 406.';

CREATE OR REPLACE FUNCTION public.refrescar_derivados(p_nombre text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET work_mem TO '64MB'
AS $function$
DECLARE t0 TIMESTAMPTZ := clock_timestamp();
BEGIN
  DELETE FROM derivados_marcas WHERE nombre = p_nombre;
  IF p_nombre = 'financiamiento' THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY zona_estado;
    REFRESH MATERIALIZED VIEW CONCURRENTLY ranking_impacto;
  ELSIF p_nombre = 'contratos' THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY contratos_agregado;
    -- 406: por departamento y por país, de la recién refrescada (~0,5 s las dos).
    REFRESH MATERIALIZED VIEW CONCURRENTLY contratos_agregado_region;
    REFRESH MATERIALIZED VIEW CONCURRENTLY contratos_agregado_pais;
    REFRESH MATERIALIZED VIEW CONCURRENTLY entidad_stats;
    REFRESH MATERIALIZED VIEW CONCURRENTLY casos_cruce_totales;
    REFRESH MATERIALIZED VIEW CONCURRENTLY casos_cruce_dia;
    -- 386: la faceta Antecedentes de cada entidad, a lo más una vez por hora (cambia con casos_cruce, una vez al día).
    IF NOT EXISTS (SELECT 1 FROM casos_cruce_por_entidad WHERE calculado_at > now() - interval '1 hour') THEN
      REFRESH MATERIALIZED VIEW CONCURRENTLY casos_cruce_por_entidad;
    END IF;
    -- 383: las cuentas sin filtro de los procesos de cada partido, a lo más una vez por hora: el refresco son 5-6 s y
    -- este grupo corre decenas de veces al día (refrescarla siempre costaba lo que ahorraba). La lista sigue en vivo.
    IF NOT EXISTS (SELECT 1 FROM partido_proceso_facetas WHERE calculado_at > now() - interval '1 hour') THEN
      REFRESH MATERIALIZED VIEW CONCURRENTLY partido_proceso_facetas;
    END IF;
  ELSE
    RAISE EXCEPTION 'grupo de derivados desconocido: %', p_nombre;
  END IF;
  UPDATE derivados_refresco
     SET refrescado_at = now(), refrescos = refrescos + 1,
         duracion_ms = (extract(epoch FROM clock_timestamp() - t0) * 1000)::int
   WHERE nombre = p_nombre;
END $function$;
