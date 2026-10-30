-- 218 · Cobertura por mes, precalculada.
--
-- /admin/cobertura sumaba en cada visita sobre la vista cobertura_contratos (migración 16): por cada una de las ~830 mil
-- convocatorias abre el JSON del OCDS y hace cuatro subconsultas. Se pensó para ~18 mil convocatorias; con el relleno
-- desde 2015 pasaba los 120 s del rol del panel y la página se quedaba cargando para siempre (DEV y PROD, 2026-10-30).
--
-- Ahora el resumen por mes vive en `cobertura_mes` y lo recalcula `refrescar_cobertura()` de a pocos meses (los 142 meses
-- tardaron 67 s en la base chica de DEV). El cron de cada 10 minutos (POST /admin/asignar) la llama con un tope de 12
-- meses y 45 s: primero llena los meses que
-- faltan, después mantiene al día el mes en curso y el anterior (lo que cambia cada día) y recorre los demás del más
-- viejo de calcular al más nuevo. `cobertura_resumen()` lee la tabla, con la misma forma de siempre. Las 14 convocatorias
-- sin fecha no caen en ningún mes (tampoco antes tenían fila útil).
--
-- Primer llenado: lo hace el mismo cron en una o dos horas, o a mano de una vez (cada llamada respeta su tope de segundos):
--   SELECT refrescar_cobertura(200, 600);

CREATE TABLE IF NOT EXISTS cobertura_mes (
  mes             DATE PRIMARY KEY,
  contratos       INT    NOT NULL,
  con_record      INT    NOT NULL,
  con_docs        INT    NOT NULL,
  docs_publicados BIGINT NOT NULL,
  docs_vigentes   BIGINT NOT NULL,
  clasificados    INT    NOT NULL,
  analizados      INT    NOT NULL,
  en_cola         INT    NOT NULL,
  calculado_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE cobertura_mes IS 'Resumen de cobertura por mes de convocatoria (lo que muestra /admin/cobertura). Lo llena refrescar_cobertura() desde la vista cobertura_contratos (migración 218).';

-- Un mes: la vista con el rango de fechas, que usa el índice de fecha_convocatoria (date) en vez de recorrer todo.
CREATE OR REPLACE FUNCTION refrescar_cobertura_mes(p_mes DATE) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO cobertura_mes (mes, contratos, con_record, con_docs, docs_publicados, docs_vigentes, clasificados, analizados, en_cola, calculado_at)
  SELECT p_mes,
         count(*)::int,
         count(*) FILTER (WHERE record_completo)::int,
         count(*) FILTER (WHERE docs_vigentes > 0)::int,
         COALESCE(sum(docs_publicados), 0)::bigint,
         COALESCE(sum(docs_vigentes), 0)::bigint,
         count(*) FILTER (WHERE tipo IS NOT NULL)::int,
         count(*) FILTER (WHERE analizado)::int,
         count(*) FILTER (WHERE procesamiento IN ('encolado', 'procesando', 'esperando_documentos'))::int,
         now()
    FROM cobertura_contratos
   WHERE fecha >= p_mes AND fecha < (p_mes + interval '1 month')::date
  ON CONFLICT (mes) DO UPDATE SET
    contratos = EXCLUDED.contratos, con_record = EXCLUDED.con_record, con_docs = EXCLUDED.con_docs,
    docs_publicados = EXCLUDED.docs_publicados, docs_vigentes = EXCLUDED.docs_vigentes, clasificados = EXCLUDED.clasificados,
    analizados = EXCLUDED.analizados, en_cola = EXCLUDED.en_cola, calculado_at = EXCLUDED.calculado_at;
$$;

-- Hasta `p_max` meses por llamada y no más de `p_segundos` (el mes que está corriendo termina): primero los que nunca se
-- calcularon, del más nuevo al más viejo; después el mes en curso y el anterior si pasaron 30 minutos; después el resto,
-- del más viejo de calcular. Devuelve cuántos meses recalculó.
CREATE OR REPLACE FUNCTION refrescar_cobertura(p_max INT DEFAULT 3, p_segundos INT DEFAULT 45) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_mes      DATE;
  v_n        INT := 0;
  v_inicio   TIMESTAMPTZ := clock_timestamp();
  v_reciente DATE := date_trunc('month', (now() - interval '1 month')::timestamp)::date;
BEGIN
  FOR v_mes IN
    SELECT ms.mes
      FROM (SELECT generate_series(date_trunc('month', min(fecha_convocatoria)::timestamp),
                                   date_trunc('month', max(fecha_convocatoria)::timestamp), interval '1 month')::date AS mes
              FROM convocatorias) ms
      LEFT JOIN cobertura_mes cm ON cm.mes = ms.mes
     WHERE ms.mes IS NOT NULL
     ORDER BY CASE WHEN cm.mes IS NULL THEN 0
                   WHEN ms.mes >= v_reciente AND cm.calculado_at < now() - interval '30 minutes' THEN 1
                   ELSE 2 END,
              cm.calculado_at ASC NULLS FIRST,
              ms.mes DESC
     LIMIT GREATEST(p_max, 0)
  LOOP
    PERFORM refrescar_cobertura_mes(v_mes);
    v_n := v_n + 1;
    EXIT WHEN clock_timestamp() - v_inicio > make_interval(secs => p_segundos);
  END LOOP;
  RETURN v_n;
END $$;

-- Misma forma que en la migración 16, ahora desde la tabla: lo que todavía no se calculó no aparece.
CREATE OR REPLACE FUNCTION cobertura_resumen()
RETURNS TABLE (mes DATE, contratos INT, con_record INT, con_docs INT, docs_publicados BIGINT, docs_vigentes BIGINT,
               clasificados INT, analizados INT, en_cola INT) LANGUAGE sql STABLE AS $$
  SELECT mes, contratos, con_record, con_docs, docs_publicados, docs_vigentes, clasificados, analizados, en_cola
    FROM cobertura_mes ORDER BY mes DESC
$$;

GRANT SELECT ON cobertura_mes TO vigia_api_admin;
REVOKE ALL ON FUNCTION refrescar_cobertura_mes(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION refrescar_cobertura(INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refrescar_cobertura(INT, INT) TO vigia_api_admin;
