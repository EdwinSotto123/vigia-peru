--
-- PostgreSQL database dump
--

\restrict cayPLsN9i5zz8fcP11ASBU3t5QD5WueakgI6EBITNNVCHiI4M1RyTHkrdaRB2Du

-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15 (Debian 16.15-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: unaccent; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;


--
-- Name: EXTENSION unaccent; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION unaccent IS 'text search dictionary that removes accents';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: alcance_contratos(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.alcance_contratos(OUT tipos text[], OUT etapas text[]) RETURNS record
    LANGUAGE sql STABLE
    AS $$
  WITH v AS (SELECT (SELECT a.valor FROM public.ajustes a WHERE a.clave = 'procesamiento') AS valor),
  ok AS (SELECT ARRAY['bienes','servicios','consultoria','obras','convenio','directa','otro']::text[] AS tipos,
                ARRAY['planificacion','convocada','adjudicada','contratada','en_ejecucion','finalizada',
                      'desierta','cancelada','nula','desconocida']::text[] AS etapas)
  SELECT CASE WHEN jsonb_typeof(v.valor->'tipos_activos') = 'array' AND jsonb_typeof(v.valor->'etapas_activas') = 'array'
              THEN ARRAY(SELECT x #>> '{}' FROM jsonb_array_elements(v.valor->'tipos_activos') x
                          WHERE jsonb_typeof(x) = 'string' AND (x #>> '{}') = ANY(ok.tipos))
              ELSE ok.tipos END,
         CASE WHEN jsonb_typeof(v.valor->'tipos_activos') = 'array' AND jsonb_typeof(v.valor->'etapas_activas') = 'array'
              THEN ARRAY(SELECT x #>> '{}' FROM jsonb_array_elements(v.valor->'etapas_activas') x
                          WHERE jsonb_typeof(x) = 'string' AND (x #>> '{}') = ANY(ok.etapas))
              ELSE ok.etapas END
  FROM v, ok
$$;


--
-- Name: alerta_publicada(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.alerta_publicada(p_estado text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$ SELECT p_estado IN ('activa', 'confirmada') $$;


--
-- Name: asignar_contribucion(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.asignar_contribucion(p_contribucion_id bigint) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_ubigeo     TEXT;
  v_entidad    CHAR(11);
  v_partido    TEXT;
  v_anio       INT;
  v_total      INT;
  v_solo       BOOLEAN;
  v_tipos      TEXT[];
  v_ya         INT;
  v_insertados INT;
  v_faltan     INT;
BEGIN
  SELECT ubigeo, entidad_ruc, partido_clave, partido_anio, contratos, solo_con_documentos, tipos
    INTO v_ubigeo, v_entidad, v_partido, v_anio, v_total, v_solo, v_tipos
  FROM contribuciones WHERE id = p_contribucion_id AND estado IN ('pagada','en_proceso');
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT count(*) INTO v_ya FROM asignaciones WHERE contribucion_id = p_contribucion_id;
  IF v_ya >= v_total THEN RETURN 0; END IF;

  IF v_partido IS NOT NULL THEN
    -- Por partido: al azar entre los contratos en cola de las entidades que gobernó en ese período.
    INSERT INTO asignaciones (contribucion_id, ocid)
    SELECT p_contribucion_id, q.ocid
    FROM cola_auditoria q
    JOIN convocatorias c ON c.ocid = q.ocid
    JOIN contrato_partido cp ON cp.ocid = q.ocid
    WHERE cp.org_clave = v_partido AND cp.anio_eleccion = v_anio
      AND (v_tipos IS NULL OR c.tipo_contratacion = ANY (v_tipos))
      AND (NOT v_solo OR documentos_listos(q.ocid))
    ORDER BY documentos_listos(q.ocid) DESC, random()
    LIMIT (v_total - v_ya)
    ON CONFLICT (ocid) DO NOTHING;
    GET DIAGNOSTICS v_insertados = ROW_COUNT;
  ELSIF v_entidad IS NULL THEN
    -- Por zona: FIFO dentro de lo elegible (igual que la 38 y la 39).
    INSERT INTO asignaciones (contribucion_id, ocid)
    SELECT p_contribucion_id, q.ocid
    FROM cola_auditoria q
    JOIN convocatorias c ON c.ocid = q.ocid
    WHERE q.ubigeo LIKE v_ubigeo || '%'
      AND (v_tipos IS NULL OR c.tipo_contratacion = ANY (v_tipos))
      AND (NOT v_solo OR documentos_listos(q.ocid))
    ORDER BY q.fecha_convocatoria NULLS LAST, q.ocid
    LIMIT (v_total - v_ya)
    ON CONFLICT (ocid) DO NOTHING;
    GET DIAGNOSTICS v_insertados = ROW_COUNT;
  ELSE
    -- Por entidad (39).
    INSERT INTO asignaciones (contribucion_id, ocid)
    SELECT p_contribucion_id, q.ocid
    FROM cola_auditoria q
    JOIN convocatorias c ON c.ocid = q.ocid
    WHERE c.entidad_ruc = v_entidad
      AND (v_tipos IS NULL OR c.tipo_contratacion = ANY (v_tipos))
      AND (NOT v_solo OR documentos_listos(q.ocid))
    ORDER BY documentos_listos(q.ocid) DESC, random()
    LIMIT (v_total - v_ya)
    ON CONFLICT (ocid) DO NOTHING;
    GET DIAGNOSTICS v_insertados = ROW_COUNT;
  END IF;

  -- No alcanzaron los contratos listos: pedir al batch los que faltan, sin asignarlos (como la 38 y la 39).
  v_faltan := v_total - v_ya - v_insertados;
  IF v_solo AND v_faltan > 0 THEN
    IF v_partido IS NOT NULL THEN
      PERFORM pedir_descarga(s.ocid, 'financiado')
      FROM (SELECT q.ocid
            FROM cola_auditoria q
            JOIN convocatorias c ON c.ocid = q.ocid
            JOIN contrato_partido cp ON cp.ocid = q.ocid
            WHERE cp.org_clave = v_partido AND cp.anio_eleccion = v_anio
              AND (v_tipos IS NULL OR c.tipo_contratacion = ANY (v_tipos))
              AND NOT documentos_listos(q.ocid)
            ORDER BY md5(p_contribucion_id::text || ':' || q.ocid)
            LIMIT v_faltan) s;
    ELSIF v_entidad IS NULL THEN
      PERFORM pedir_descarga(s.ocid, 'financiado')
      FROM (SELECT q.ocid
            FROM cola_auditoria q
            JOIN convocatorias c ON c.ocid = q.ocid
            WHERE q.ubigeo LIKE v_ubigeo || '%'
              AND (v_tipos IS NULL OR c.tipo_contratacion = ANY (v_tipos))
              AND NOT documentos_listos(q.ocid)
            ORDER BY q.fecha_convocatoria NULLS LAST, q.ocid
            LIMIT v_faltan) s;
    ELSE
      PERFORM pedir_descarga(s.ocid, 'financiado')
      FROM (SELECT q.ocid
            FROM cola_auditoria q
            JOIN convocatorias c ON c.ocid = q.ocid
            WHERE c.entidad_ruc = v_entidad
              AND (v_tipos IS NULL OR c.tipo_contratacion = ANY (v_tipos))
              AND NOT documentos_listos(q.ocid)
            ORDER BY md5(p_contribucion_id::text || ':' || q.ocid)
            LIMIT v_faltan) s;
    END IF;
  END IF;

  IF v_insertados > 0 THEN
    UPDATE contribuciones SET estado = 'en_proceso' WHERE id = p_contribucion_id AND estado = 'pagada';
  END IF;
  RETURN v_insertados;
END $$;


--
-- Name: borrar_cuenta(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.borrar_cuenta(p_uid text) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_fin BIGINT;
  v_aportes INT := 0;
BEGIN
  SELECT financiador_id INTO v_fin FROM usuarios WHERE firebase_uid = p_uid;
  IF v_fin IS NULL THEN
    SELECT id INTO v_fin FROM financiadores WHERE firebase_uid = p_uid;
  END IF;
  IF v_fin IS NOT NULL THEN
    SELECT count(*) INTO v_aportes FROM contribuciones WHERE financiador_id = v_fin;
    UPDATE financiadores
       SET nombre_publico = NULL, slug = NULL, logo_url = NULL, firebase_uid = NULL,
           descripcion = NULL, sitio_web = NULL, email_publico = NULL, redes = '{}'::jsonb, portada_url = NULL,
           telefono = NULL, ubicacion = NULL, enlaces = '[]'::jsonb,
           visible = FALSE, motivo_no_visible = COALESCE(motivo_no_visible, 'cuenta_borrada')
     WHERE id = v_fin;
  END IF;
  UPDATE reportes_indexados SET user_id = NULL WHERE user_id = p_uid;
  DELETE FROM usuarios WHERE firebase_uid = p_uid;
  RETURN v_aportes;
END $$;


--
-- Name: cerrar_asignacion_por_alerta(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cerrar_asignacion_por_alerta() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- El orquestador persiste alertas con el OCID corto ('1216608'); la cola puede tener el largo
  -- ('ocds-dgv273-seacev3-1216608'). Comparamos por sufijo para cubrir ambos (ver 12_procesamientos.sql).
  UPDATE asignaciones SET procesada_at = COALESCE(procesada_at, now()), alerta_id = COALESCE(alerta_id, NEW.id)
  WHERE ocid = NEW.ocid OR regexp_replace(ocid, '^ocds-dgv273-seacev3-', '') = regexp_replace(NEW.ocid, '^ocds-dgv273-seacev3-', '');
  UPDATE contribuciones c SET estado = 'procesada'
  WHERE c.estado = 'en_proceso'
    AND (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = c.id AND s.procesada_at IS NOT NULL) >= c.contratos;
  RETURN NEW;
END $$;


--
-- Name: FUNCTION cerrar_asignacion_por_alerta(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.cerrar_asignacion_por_alerta() IS 'Sin trigger desde la migración 34: trg_alertas_cerrar_procesamiento hace lo mismo. Se conserva para poder volver atrás.';


--
-- Name: cerrar_pedidos_atendidos(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cerrar_pedidos_atendidos() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE n INT;
BEGIN
  WITH listos AS (
    UPDATE pedidos_descarga p SET estado = 'listo', atendido_at = now()
     WHERE p.estado = 'descargando'
       AND (EXISTS (SELECT 1 FROM documentos_gcs d
                     WHERE ocid_corto(d.ocid) = ocid_corto(p.ocid) AND d.borrado_at IS NULL
                       AND d.creado_at >= p.tomado_at)
            OR EXISTS (SELECT 1 FROM convocatorias c
                        WHERE ocid_corto(c.ocid) = ocid_corto(p.ocid) AND c.updated_at >= p.tomado_at
                          AND jsonb_array_length(COALESCE(c.ocds_payload->'tender'->'documents', '[]'::jsonb)) = 0))
     RETURNING p.ocid)
  UPDATE procesamientos pr SET estado = 'encolado', error = NULL, encolado_at = now()
    FROM listos l WHERE ocid_corto(pr.ocid) = ocid_corto(l.ocid) AND pr.estado = 'esperando_documentos';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;


--
-- Name: cerrar_procesamiento_por_alerta(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cerrar_procesamiento_por_alerta() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_corto TEXT := ocid_corto(NEW.ocid);
  -- Formas posibles del OCID (como OCID_CANDIDATOS de la API): la del alerta, la corta y la larga.
  v_formas TEXT[] := ARRAY[NEW.ocid, v_corto, 'ocds-dgv273-seacev3-' || v_corto];
BEGIN
  IF NEW.ocid IS NULL THEN
    RETURN NEW;   -- antes tampoco cerraba nada: ocid_corto(NULL) no iguala a ninguna fila
  END IF;
  -- La alerta se persiste en el checkpoint (antes del dictamen): con worker vivo el cierre lo hace el
  -- dispatcher al recibir `final` (migración 20).
  UPDATE procesamientos SET estado = 'procesado', finalizado_at = now(), fase_actual = 'final', fase_index = 10, error = NULL
   WHERE ocid = ANY(v_formas) AND ocid_corto(ocid) = v_corto AND estado <> 'procesado'
     AND NOT (estado = 'procesando' AND worker IS NOT NULL AND latido_at >= now() - interval '2 minutes');
  UPDATE asignaciones SET procesada_at = COALESCE(procesada_at, now()), alerta_id = COALESCE(alerta_id, NEW.id)
   WHERE ocid = ANY(v_formas) AND ocid_corto(ocid) = v_corto;
  -- Sólo las contribuciones de este contrato (antes: todas las 'en_proceso', con un count por cada una).
  UPDATE contribuciones c SET estado = 'procesada'
   WHERE c.estado = 'en_proceso'
     AND c.id IN (SELECT s.contribucion_id FROM asignaciones s
                   WHERE s.ocid = ANY(v_formas) AND ocid_corto(s.ocid) = v_corto)
     AND (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = c.id AND s.procesada_at IS NOT NULL) >= c.contratos;
  RETURN NEW;
END $$;


--
-- Name: cobertura_resumen(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cobertura_resumen() RETURNS TABLE(mes date, contratos integer, con_record integer, con_docs integer, docs_publicados bigint, docs_vigentes bigint, clasificados integer, analizados integer, en_cola integer)
    LANGUAGE sql STABLE
    AS $$
  SELECT mes,
         count(*)::int,
         count(*) FILTER (WHERE record_completo)::int,
         count(*) FILTER (WHERE docs_vigentes > 0)::int,
         sum(docs_publicados)::bigint,
         sum(docs_vigentes)::bigint,
         count(*) FILTER (WHERE tipo IS NOT NULL)::int,
         count(*) FILTER (WHERE analizado)::int,
         count(*) FILTER (WHERE procesamiento IN ('encolado','procesando','esperando_documentos'))::int
  FROM cobertura_contratos
  GROUP BY mes ORDER BY mes DESC
$$;


--
-- Name: contrato_estado_ajustes_trg(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contrato_estado_ajustes_trg() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM contrato_estado_recalcular_todo();
  RETURN NULL;
END $$;


--
-- Name: contrato_estado_alertas_trg(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contrato_estado_alertas_trg() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v TEXT[] := ARRAY[]::text[];
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.ocid IS NOT NULL THEN v := v || ocid_corto(NEW.ocid); END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.ocid IS NOT NULL THEN v := v || ocid_corto(OLD.ocid); END IF;
  IF cardinality(v) > 0 THEN
    PERFORM contrato_estado_recalcular(ARRAY(SELECT c.ocid FROM convocatorias c WHERE ocid_corto(c.ocid) = ANY(v)));
  END IF;
  RETURN NULL;
END $$;


--
-- Name: contrato_estado_convocatorias_trg(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contrato_estado_convocatorias_trg() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM contrato_estado_recalcular(ARRAY(SELECT n.ocid FROM nuevas n));
  ELSE
    PERFORM contrato_estado_recalcular(ARRAY(
      SELECT n.ocid FROM nuevas n LEFT JOIN viejas o ON o.ocid = n.ocid
       WHERE o.ocid IS NULL
          OR (n.procesable, n.tipo_contratacion, n.categoria, n.etapa, n.ubigeo_zona, n.entidad_ruc,
              n.fecha_convocatoria, n.created_at, n.cuantia_referencial)
             IS DISTINCT FROM
             (o.procesable, o.tipo_contratacion, o.categoria, o.etapa, o.ubigeo_zona, o.entidad_ruc,
              o.fecha_convocatoria, o.created_at, o.cuantia_referencial)));
  END IF;
  RETURN NULL;
END $$;


--
-- Name: contrato_estado_documentos_trg(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contrato_estado_documentos_trg() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM contrato_estado_recalcular(ARRAY(SELECT DISTINCT n.ocid FROM nuevas n));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM contrato_estado_recalcular(ARRAY(SELECT DISTINCT o.ocid FROM viejas o));
  ELSE
    PERFORM contrato_estado_recalcular(ARRAY(
      SELECT x.ocid FROM (
        SELECT n.ocid, o.ocid AS ocid_viejo FROM nuevas n JOIN viejas o ON o.id = n.id
         WHERE (n.ocid, n.borrado_at, n.expira_at) IS DISTINCT FROM (o.ocid, o.borrado_at, o.expira_at)) d
      CROSS JOIN LATERAL (VALUES (d.ocid), (d.ocid_viejo)) x(ocid)
      GROUP BY x.ocid));
  END IF;
  RETURN NULL;
END $$;


--
-- Name: contrato_estado_procesamientos_trg(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contrato_estado_procesamientos_trg() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v TEXT[] := ARRAY[]::text[];
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v := v || NEW.ocid; END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v := v || OLD.ocid; END IF;
  PERFORM contrato_estado_recalcular(v);
  RETURN NULL;
END $$;


--
-- Name: contrato_estado_recalcular(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contrato_estado_recalcular(p_ocids text[]) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE n INT;
BEGIN
  IF p_ocids IS NULL OR cardinality(p_ocids) = 0 THEN
    RETURN 0;
  END IF;
  INSERT INTO contrato_estado AS ce (ocid, riesgo, score, estado_proc, operativo, alerta_id, alerta_codigo, alerta_estado,
                                     ubigeo_zona, tipo, etapa, entidad_ruc, fecha_convocatoria, created_at, monto)
  SELECT v.ocid, v.riesgo, v.score, v.estado_proc, v.operativo, v.alerta_id, v.alerta_codigo, v.alerta_estado,
         v.ubigeo_zona, v.tipo, v.etapa, v.entidad_ruc, v.fecha_convocatoria, v.created_at, v.monto
    FROM contrato_estado_calculado v
   WHERE v.ocid = ANY(p_ocids)
  ON CONFLICT (ocid) DO UPDATE SET
    riesgo = EXCLUDED.riesgo, score = EXCLUDED.score, estado_proc = EXCLUDED.estado_proc, operativo = EXCLUDED.operativo,
    alerta_id = EXCLUDED.alerta_id, alerta_codigo = EXCLUDED.alerta_codigo, alerta_estado = EXCLUDED.alerta_estado,
    ubigeo_zona = EXCLUDED.ubigeo_zona, tipo = EXCLUDED.tipo, etapa = EXCLUDED.etapa, entidad_ruc = EXCLUDED.entidad_ruc,
    fecha_convocatoria = EXCLUDED.fecha_convocatoria, created_at = EXCLUDED.created_at, monto = EXCLUDED.monto,
    actualizado_at = now()
  WHERE (ce.riesgo, ce.score, ce.estado_proc, ce.operativo, ce.alerta_id, ce.alerta_codigo, ce.alerta_estado,
         ce.ubigeo_zona, ce.tipo, ce.etapa, ce.entidad_ruc, ce.fecha_convocatoria, ce.created_at, ce.monto)
        IS DISTINCT FROM
        (EXCLUDED.riesgo, EXCLUDED.score, EXCLUDED.estado_proc, EXCLUDED.operativo, EXCLUDED.alerta_id,
         EXCLUDED.alerta_codigo, EXCLUDED.alerta_estado, EXCLUDED.ubigeo_zona, EXCLUDED.tipo, EXCLUDED.etapa,
         EXCLUDED.entidad_ruc, EXCLUDED.fecha_convocatoria, EXCLUDED.created_at, EXCLUDED.monto);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;


--
-- Name: contrato_estado_recalcular_todo(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contrato_estado_recalcular_todo() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    SET work_mem TO '32MB'
    AS $$
DECLARE n INT;
BEGIN
  INSERT INTO contrato_estado AS ce (ocid, riesgo, score, estado_proc, operativo, alerta_id, alerta_codigo, alerta_estado,
                                     ubigeo_zona, tipo, etapa, entidad_ruc, fecha_convocatoria, created_at, monto)
  SELECT v.ocid, v.riesgo, v.score, v.estado_proc, v.operativo, v.alerta_id, v.alerta_codigo, v.alerta_estado,
         v.ubigeo_zona, v.tipo, v.etapa, v.entidad_ruc, v.fecha_convocatoria, v.created_at, v.monto
    FROM contrato_estado_calculado v
  ON CONFLICT (ocid) DO UPDATE SET
    riesgo = EXCLUDED.riesgo, score = EXCLUDED.score, estado_proc = EXCLUDED.estado_proc, operativo = EXCLUDED.operativo,
    alerta_id = EXCLUDED.alerta_id, alerta_codigo = EXCLUDED.alerta_codigo, alerta_estado = EXCLUDED.alerta_estado,
    ubigeo_zona = EXCLUDED.ubigeo_zona, tipo = EXCLUDED.tipo, etapa = EXCLUDED.etapa, entidad_ruc = EXCLUDED.entidad_ruc,
    fecha_convocatoria = EXCLUDED.fecha_convocatoria, created_at = EXCLUDED.created_at, monto = EXCLUDED.monto,
    actualizado_at = now()
  WHERE (ce.riesgo, ce.score, ce.estado_proc, ce.operativo, ce.alerta_id, ce.alerta_codigo, ce.alerta_estado,
         ce.ubigeo_zona, ce.tipo, ce.etapa, ce.entidad_ruc, ce.fecha_convocatoria, ce.created_at, ce.monto)
        IS DISTINCT FROM
        (EXCLUDED.riesgo, EXCLUDED.score, EXCLUDED.estado_proc, EXCLUDED.operativo, EXCLUDED.alerta_id,
         EXCLUDED.alerta_codigo, EXCLUDED.alerta_estado, EXCLUDED.ubigeo_zona, EXCLUDED.tipo, EXCLUDED.etapa,
         EXCLUDED.entidad_ruc, EXCLUDED.fecha_convocatoria, EXCLUDED.created_at, EXCLUDED.monto);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;


--
-- Name: contrato_estado_vencidos(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contrato_estado_vencidos() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE v_desde TIMESTAMPTZ; n INT;
BEGIN
  SELECT refrescado_at INTO v_desde FROM derivados_refresco WHERE nombre = 'vencimientos' FOR UPDATE;
  n := contrato_estado_recalcular(ARRAY(
         SELECT DISTINCT d.ocid FROM documentos_gcs d
          WHERE d.borrado_at IS NULL AND d.expira_at <= now()
            AND (v_desde IS NULL OR d.expira_at > v_desde)));
  UPDATE derivados_refresco SET refrescado_at = now(), refrescos = refrescos + 1 WHERE nombre = 'vencimientos';
  RETURN n;
END $$;


--
-- Name: convocatorias_ubigeo_zona_trg(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.convocatorias_ubigeo_zona_trg() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.ubigeo IS NOT DISTINCT FROM OLD.ubigeo
     AND NEW.region IS NOT DISTINCT FROM OLD.region
     AND NEW.entidad_ruc IS NOT DISTINCT FROM OLD.entidad_ruc
     AND NEW.ubigeo_zona IS NOT DISTINCT FROM OLD.ubigeo_zona THEN
    RETURN NEW;
  END IF;
  NEW.ubigeo_zona := zona_de_convocatoria(NEW.ubigeo, NEW.region, NEW.entidad_ruc);
  RETURN NEW;
END $$;


--
-- Name: documentos_listos(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.documentos_listos(p_ocid text) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (SELECT 1 FROM documentos_gcs d
                  WHERE ocid_corto(d.ocid) = ocid_corto(p_ocid) AND d.borrado_at IS NULL AND d.expira_at > now())
$$;


--
-- Name: documentos_vigentes(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.documentos_vigentes(p_ocid text) RETURNS TABLE(url_origen text, url_gcs text, tipo text, expira_at timestamp with time zone)
    LANGUAGE sql STABLE
    AS $$
  SELECT d.url_origen, d.url_gcs, d.tipo, d.expira_at
  FROM documentos_gcs d
  WHERE ocid_corto(d.ocid) = ocid_corto(p_ocid) AND d.borrado_at IS NULL AND d.expira_at > now()
$$;


--
-- Name: encolar_procesamiento(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.encolar_procesamiento() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO procesamientos (ocid, contribucion_id) VALUES (NEW.ocid, NEW.contribucion_id) ON CONFLICT (ocid) DO NOTHING;
  RETURN NEW;
END $$;


--
-- Name: entidades_ubigeo_zona_trg(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.entidades_ubigeo_zona_trg() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE convocatorias c SET ubigeo_zona = zona_de_convocatoria(c.ubigeo, c.region, c.entidad_ruc)
   WHERE c.entidad_ruc = NEW.ruc AND c.ubigeo IS NULL
     AND c.ubigeo_zona IS DISTINCT FROM zona_de_convocatoria(c.ubigeo, c.region, c.entidad_ruc);
  RETURN NULL;
END $$;


--
-- Name: esperar_documentos(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.esperar_documentos(p_ocid text) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE v_id BIGINT;
BEGIN
  v_id := pedir_descarga(p_ocid, 'financiado');
  UPDATE procesamientos SET estado = 'esperando_documentos', intentos = greatest(intentos - 1, 0),
         worker = NULL, fase_actual = NULL, fase_index = NULL,
         error = 'esperando documentos: se descargan en el lote nocturno'
   WHERE ocid = p_ocid;
  RETURN v_id;
END $$;


--
-- Name: estado_operativo(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estado_operativo(p_ocid text, p_tipo text, p_etapa text) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT CASE
    WHEN procesamiento_activo(p_tipo, p_etapa) THEN 'en_cola'
    WHEN EXISTS (SELECT 1 FROM documentos_gcs d WHERE ocid_corto(d.ocid) = ocid_corto(p_ocid)
                   AND d.borrado_at IS NULL AND d.expira_at > now()) THEN 'documentos_listos'
    ELSE 'sin_documentos' END
$$;


--
-- Name: immutable_unaccent(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.immutable_unaccent(text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $_$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $_$;


--
-- Name: jsonb_claves_texto(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.jsonb_claves_texto(j jsonb) RETURNS text[]
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $$
  SELECT CASE jsonb_typeof(j)
           WHEN 'array'  THEN ARRAY(SELECT e #>> '{}' FROM jsonb_array_elements(j) e WHERE jsonb_typeof(e) = 'string')
           WHEN 'object' THEN ARRAY(SELECT jsonb_object_keys(j))
           WHEN 'string' THEN ARRAY[j #>> '{}']
           ELSE ARRAY[]::text[] END
$$;


--
-- Name: marcar_derivados(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.marcar_derivados() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO derivados_marcas (nombre) SELECT unnest(TG_ARGV) ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;


--
-- Name: marcar_derivados_si_filas(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.marcar_derivados_si_filas() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM viejas) THEN RETURN NULL; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM nuevas) THEN RETURN NULL; END IF;
  END IF;
  INSERT INTO derivados_marcas (nombre) SELECT unnest(TG_ARGV) ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;


--
-- Name: next_codigo_contribucion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_codigo_contribucion() RETURNS text
    LANGUAGE sql
    AS $$
  SELECT 'VIG-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('contribuciones_codigo_seq')::text, 5, '0');
$$;


--
-- Name: next_codigo_reporte(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_codigo_reporte(modo text) RETURNS text
    LANGUAGE sql
    SET search_path TO 'public'
    AS $$
  SELECT 'RPT-' || CASE WHEN modo = 'entidad' THEN 'ENT-' ELSE '' END
         || to_char(now(), 'YYYY') || '-' || lpad(nextval('reportes_codigo_seq')::text, 5, '0')
$$;


--
-- Name: FUNCTION next_codigo_reporte(modo text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.next_codigo_reporte(modo text) IS 'ID público de una denuncia: RPT-AAAA-NNNNN (obra) o RPT-ENT-AAAA-NNNNN (entidad). Migración 33.';


--
-- Name: ocid_corto(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ocid_corto(p text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
  SELECT CASE WHEN p LIKE 'ocds-dgv273-seacev3-%' THEN substr(p, 21) ELSE p END
$$;


--
-- Name: pedir_descarga(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pedir_descarga(p_ocid text, p_motivo text DEFAULT 'financiado'::text) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE v_id BIGINT;
BEGIN
  SELECT id INTO v_id FROM pedidos_descarga
   WHERE ocid_corto(ocid) = ocid_corto(p_ocid) AND estado IN ('pendiente','descargando') LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO pedidos_descarga (ocid, motivo) VALUES (p_ocid, p_motivo) RETURNING id INTO v_id;
  RETURN v_id;
END $$;


--
-- Name: procesamiento_activo(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.procesamiento_activo(p_tipo text, p_etapa text) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
    (SELECT (valor->'tipos_activos')  ? COALESCE(p_tipo, '')
        AND (valor->'etapas_activas') ? COALESCE(p_etapa, '')
     FROM ajustes WHERE clave = 'procesamiento'),
    true)
$$;


--
-- Name: procesamiento_etapas_activas(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.procesamiento_etapas_activas() RETURNS text[]
    LANGUAGE sql STABLE
    AS $$
  SELECT public.jsonb_claves_texto(a.valor->'etapas_activas') FROM public.ajustes a WHERE a.clave = 'procesamiento'
$$;


--
-- Name: procesamiento_tipos_activos(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.procesamiento_tipos_activos() RETURNS text[]
    LANGUAGE sql STABLE
    AS $$
  SELECT public.jsonb_claves_texto(a.valor->'tipos_activos') FROM public.ajustes a WHERE a.clave = 'procesamiento'
$$;


--
-- Name: reclamar_procesamientos(integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reclamar_procesamientos(n integer, p_worker text) RETURNS SETOF text
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Latido vencido: con intentos disponibles vuelve a la cola; sin intentos, error visible.
  UPDATE procesamientos
     SET estado = CASE WHEN intentos >= 3 THEN 'error' ELSE 'encolado' END,
         worker = NULL,
         error = CASE WHEN intentos >= 3 THEN 'timeout sin latido: sin intentos restantes' ELSE 'timeout sin latido' END
   WHERE estado = 'procesando' AND latido_at < now() - interval '20 minutes';
  RETURN QUERY
  WITH c AS (
    SELECT ocid FROM procesamientos
     WHERE estado = 'encolado' AND intentos < 3
     ORDER BY encolado_at, ocid LIMIT n FOR UPDATE SKIP LOCKED)
  UPDATE procesamientos p SET estado = 'procesando', worker = p_worker, intentos = p.intentos + 1,
         iniciado_at = now(), latido_at = now(), fase_actual = 'started', fase_index = 0, error = NULL,
         fases = '{}'::jsonb, eventos = '[]'::jsonb
    FROM c WHERE p.ocid = c.ocid RETURNING p.ocid;
END $$;


--
-- Name: refrescar_derivados(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refrescar_derivados(p_nombre text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    SET work_mem TO '32MB'
    AS $$
DECLARE t0 TIMESTAMPTZ := clock_timestamp();
BEGIN
  DELETE FROM derivados_marcas WHERE nombre = p_nombre;
  IF p_nombre = 'financiamiento' THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY zona_estado;
    REFRESH MATERIALIZED VIEW CONCURRENTLY ranking_impacto;
  ELSIF p_nombre = 'contratos' THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY contratos_agregado;
    REFRESH MATERIALIZED VIEW CONCURRENTLY entidad_stats;
  ELSE
    RAISE EXCEPTION 'grupo de derivados desconocido: %', p_nombre;
  END IF;
  UPDATE derivados_refresco
     SET refrescado_at = now(), refrescos = refrescos + 1,
         duracion_ms = (extract(epoch FROM clock_timestamp() - t0) * 1000)::int
   WHERE nombre = p_nombre;
END $$;


--
-- Name: refresh_financiamiento(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_financiamiento() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    SET work_mem TO '32MB'
    AS $$
BEGIN
  PERFORM contrato_estado_vencidos();
  PERFORM refrescar_derivados('financiamiento');
  PERFORM refrescar_derivados('contratos');
END $$;


--
-- Name: refresh_financiamiento_si_hace_falta(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_financiamiento_si_hace_falta() RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    SET work_mem TO '32MB'
    AS $$
DECLARE
  v_fin_at TIMESTAMPTZ;
  v_con_at TIMESTAMPTZ;
  v_fin BOOLEAN;
  v_con BOOLEAN;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('vigia:refresh_financiamiento')) THEN
    RETURN false;
  END IF;
  PERFORM contrato_estado_vencidos();   -- si cambia algo, deja su propia marca en 'contratos'
  SELECT refrescado_at INTO v_fin_at FROM derivados_refresco WHERE nombre = 'financiamiento';
  SELECT refrescado_at INTO v_con_at FROM derivados_refresco WHERE nombre = 'contratos';
  v_fin := v_fin_at IS NULL
        OR EXISTS (SELECT 1 FROM derivados_marcas WHERE nombre = 'financiamiento')
        -- zona_estado.documentos_listos depende del reloj.
        OR EXISTS (SELECT 1 FROM documentos_gcs d
                    WHERE d.borrado_at IS NULL AND d.expira_at > v_fin_at AND d.expira_at <= now());
  v_con := v_con_at IS NULL
        OR EXISTS (SELECT 1 FROM derivados_marcas WHERE nombre = 'contratos');
  IF v_fin THEN PERFORM refrescar_derivados('financiamiento'); END IF;
  IF v_con THEN PERFORM refrescar_derivados('contratos'); END IF;
  RETURN v_fin OR v_con;
END $$;


--
-- Name: refresh_ranking(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_ranking() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY ranking_impacto;
END $$;


--
-- Name: zona_de_convocatoria(text, text, character); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.zona_de_convocatoria(p_ubigeo text, p_region text, p_entidad_ruc character) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT (COALESCE(
    p_ubigeo::bpchar,
    NULLIF((SELECT e.ubigeo FROM public.entidades e WHERE e.ruc = p_entidad_ruc), ''::bpchar),
    (SELECT z.ubigeo FROM public.zonas z
      WHERE z.nivel IN ('provincia', 'departamento')
        AND upper(public.unaccent('public.unaccent'::regdictionary, z.nombre))
          = upper(public.unaccent('public.unaccent'::regdictionary, COALESCE(
              NULLIF(p_region, ''),
              (SELECT e.region FROM public.entidades e WHERE e.ruc = p_entidad_ruc),
              (SELECT e.provincia FROM public.entidades e WHERE e.ruc = p_entidad_ruc),
              '')))
      ORDER BY CASE z.nivel WHEN 'provincia' THEN 0 ELSE 1 END
      LIMIT 1)::bpchar
  ))::text
$$;


--
-- Name: zona_de_entidad(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.zona_de_entidad(p_ruc text) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT z.ubigeo
  FROM cola_auditoria q
  JOIN convocatorias c ON c.ocid = q.ocid
  CROSS JOIN LATERAL (SELECT zz.ubigeo FROM zonas zz
                       WHERE zz.ubigeo IN (q.ubigeo, left(q.ubigeo, 4), left(q.ubigeo, 2))
                       ORDER BY length(zz.ubigeo) DESC LIMIT 1) z
  WHERE c.entidad_ruc = p_ruc::char(11)
  GROUP BY z.ubigeo
  ORDER BY count(*) DESC, length(z.ubigeo) DESC, z.ubigeo
  LIMIT 1
$$;


--
-- Name: FUNCTION zona_de_entidad(p_ruc text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.zona_de_entidad(p_ruc text) IS 'Zona (código de `zonas`) donde está la mayoría de los contratos en cola de la entidad; NULL si no tiene cola. Migración 39.';


--
-- Name: zona_de_partido(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.zona_de_partido(p_clave text, p_anio integer) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT z.ubigeo
  FROM cola_auditoria q
  JOIN contrato_partido cp ON cp.ocid = q.ocid
  CROSS JOIN LATERAL (SELECT zz.ubigeo FROM zonas zz
                       WHERE zz.ubigeo IN (q.ubigeo, left(q.ubigeo, 4), left(q.ubigeo, 2))
                       ORDER BY length(zz.ubigeo) DESC LIMIT 1) z
  WHERE cp.org_clave = p_clave AND cp.anio_eleccion = p_anio
  GROUP BY z.ubigeo
  ORDER BY count(*) DESC, length(z.ubigeo) DESC, z.ubigeo
  LIMIT 1
$$;


--
-- Name: FUNCTION zona_de_partido(p_clave text, p_anio integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.zona_de_partido(p_clave text, p_anio integer) IS 'Zona donde está la mayoría de los contratos en cola del partido en ese período; NULL si no tiene cola. Migración 41.';


--
-- Name: zonas_ubigeo_zona_trg(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.zonas_ubigeo_zona_trg() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE convocatorias c SET ubigeo_zona = zona_de_convocatoria(c.ubigeo, c.region, c.entidad_ruc)
   WHERE c.ubigeo IS NULL
     AND c.ubigeo_zona IS DISTINCT FROM zona_de_convocatoria(c.ubigeo, c.region, c.entidad_ruc);
  RETURN NULL;
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_log (
    id bigint NOT NULL,
    actor text NOT NULL,
    accion text NOT NULL,
    objeto text NOT NULL,
    detalle jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admin_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: admin_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.admin_log_id_seq OWNED BY public.admin_log.id;


--
-- Name: ajustes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ajustes (
    clave text NOT NULL,
    valor jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text
);


--
-- Name: alertas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alertas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    codigo text NOT NULL,
    ocid text,
    entidad_ruc character(11),
    proveedor_ruc character(11),
    monto_adjudicado numeric,
    fecha_buena_pro date,
    region text,
    score integer,
    estado text DEFAULT 'activa'::text NOT NULL,
    ubicacion_geo public.geography(Point,4326),
    reglas_disparadas text[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    objeto text,
    codigo_convocatoria text,
    provincia text,
    distrito text,
    unico_postor boolean,
    edad_ruc_dias integer,
    fuente_url text,
    analisis_full jsonb,
    dictamen_markdown text,
    analizado_en timestamp with time zone,
    monto_referencial numeric,
    moderacion jsonb,
    CONSTRAINT alertas_estado_check CHECK ((estado = ANY (ARRAY['activa'::text, 'descartada'::text, 'confirmada'::text, 'en_revision'::text, 'revision'::text]))),
    CONSTRAINT alertas_score_check CHECK (((score >= 0) AND (score <= 100)))
);


--
-- Name: COLUMN alertas.monto_adjudicado; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.alertas.monto_adjudicado IS 'Monto adjudicado/contratado: contracts[].value > awards[].value > oferta ganadora (acta) > referencial (persistence._montos_alerta).';


--
-- Name: COLUMN alertas.monto_referencial; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.alertas.monto_referencial IS 'Valor referencial / cuantía publicada (tender.value). Separado de monto_adjudicado desde la migración 21.';


--
-- Name: COLUMN alertas.moderacion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.alertas.moderacion IS 'Resolución humana de una alerta en revision: {accion: publicar|descartar, actor, motivo, at}. Lo escribe PUT /admin/alertas/:id/estado.';


--
-- Name: asignaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asignaciones (
    id bigint NOT NULL,
    contribucion_id bigint NOT NULL,
    ocid text NOT NULL,
    asignada_at timestamp with time zone DEFAULT now() NOT NULL,
    procesada_at timestamp with time zone,
    alerta_id uuid,
    costo_real_pen numeric(8,4)
);


--
-- Name: asignaciones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.asignaciones_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: asignaciones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.asignaciones_id_seq OWNED BY public.asignaciones.id;


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    user_id text,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    before jsonb,
    after jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: bandera_revision; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bandera_revision (
    id bigint NOT NULL,
    bandera_id bigint NOT NULL,
    alerta_id uuid NOT NULL,
    decision text NOT NULL,
    motivo text,
    revisor text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bandera_revision_decision_check CHECK ((decision = ANY (ARRAY['confirmada'::text, 'falso_positivo'::text, 'no_concluyente'::text, 'mal_clasificada'::text])))
);


--
-- Name: bandera_revision_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bandera_revision_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bandera_revision_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bandera_revision_id_seq OWNED BY public.bandera_revision.id;


--
-- Name: banderas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.banderas (
    id bigint NOT NULL,
    alerta_id uuid NOT NULL,
    regla text NOT NULL,
    severidad text NOT NULL,
    evidencia text,
    norma text,
    opinion_oece text,
    fuente_url text,
    agente_origen text,
    created_at timestamp with time zone DEFAULT now(),
    verificacion jsonb,
    puntua boolean DEFAULT true NOT NULL,
    regla_version text,
    pipeline_version text,
    modelo text,
    identidad text,
    CONSTRAINT banderas_identidad_check CHECK (((identidad IS NULL) OR (identidad = ANY (ARRAY['dni_confirmada'::text, 'solo_nombre'::text, 'no_aplica'::text])))),
    CONSTRAINT banderas_severidad_check CHECK ((severidad = ANY (ARRAY['alta'::text, 'media'::text, 'baja'::text])))
);


--
-- Name: COLUMN banderas.verificacion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.banderas.verificacion IS 'Resultado de tools/verify.verificar_bandera: {ok, motivos[], n_checks}. Solo se persisten banderas con ok=true.';


--
-- Name: banderas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.banderas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: banderas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.banderas_id_seq OWNED BY public.banderas.id;


--
-- Name: banderas_reclasificadas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.banderas_reclasificadas (
    bandera_id bigint NOT NULL,
    alerta_id uuid NOT NULL,
    severidad_previa text NOT NULL,
    evidencia_previa text,
    score_previo integer,
    motivo text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: convocatorias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.convocatorias (
    ocid text NOT NULL,
    codigo text NOT NULL,
    entidad_ruc character(11),
    objeto text NOT NULL,
    tipo_proceso text,
    modalidad_pago text,
    cuantia_referencial numeric,
    fuente_financiamiento text,
    fecha_convocatoria date,
    fecha_buena_pro date,
    region text,
    ubicacion_geo public.geography(Point,4326),
    ocds_payload jsonb,
    texto_busqueda tsvector GENERATED ALWAYS AS (to_tsvector('spanish'::regconfig, ((((COALESCE(codigo, ''::text) || ' '::text) || COALESCE(objeto, ''::text)) || ' '::text) || COALESCE(region, ''::text)))) STORED,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    ubigeo text,
    categoria text,
    estado_tender text,
    fuente text DEFAULT 'ocds_api'::text,
    tipo_contratacion text,
    etapa text,
    modalidad text,
    procesable boolean,
    motivo_no_procesable text,
    agentes_aplicables text[],
    validaciones_pendientes text[],
    proveedor_ruc character(11),
    clasificado_at timestamp with time zone,
    ubigeo_zona text,
    CONSTRAINT convocatorias_ubigeo_check CHECK (((ubigeo IS NULL) OR (ubigeo ~ '^[0-9]{2}([0-9]{2}([0-9]{2})?)?$'::text)))
);


--
-- Name: COLUMN convocatorias.ubigeo_zona; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.convocatorias.ubigeo_zona IS 'Zona del contrato (2/4/6 dígitos INEI): ubigeo propio → ubigeo de la entidad → provincia/departamento por nombre. Igual a la vista convocatoria_zona de la 11. La mantienen triggers (migración 32): no escribirla a mano.';


--
-- Name: documentos_gcs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documentos_gcs (
    id bigint NOT NULL,
    ocid text NOT NULL,
    tipo text,
    titulo text,
    seccion text,
    url_gcs text NOT NULL,
    sha256 text NOT NULL,
    bytes bigint,
    url_origen text,
    formato text,
    publicado_at timestamp with time zone,
    lote_id text,
    creado_at timestamp with time zone DEFAULT now() NOT NULL,
    expira_at timestamp with time zone DEFAULT (now() + '90 days'::interval),
    borrado_at timestamp with time zone
);


--
-- Name: procesamientos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procesamientos (
    ocid text NOT NULL,
    contribucion_id bigint NOT NULL,
    estado text DEFAULT 'encolado'::text NOT NULL,
    fase_actual text,
    fase_index integer,
    worker text,
    intentos integer DEFAULT 0 NOT NULL,
    error text,
    eventos jsonb DEFAULT '[]'::jsonb NOT NULL,
    encolado_at timestamp with time zone DEFAULT now() NOT NULL,
    iniciado_at timestamp with time zone,
    latido_at timestamp with time zone,
    finalizado_at timestamp with time zone,
    fases jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT procesamientos_estado_check CHECK ((estado = ANY (ARRAY['encolado'::text, 'procesando'::text, 'procesado'::text, 'error'::text, 'pendiente_de_procesamiento'::text, 'esperando_documentos'::text])))
);


--
-- Name: COLUMN procesamientos.fases; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.procesamientos.fases IS 'Estado por agente {fase: {estado: corriendo|hecho|omitido|error, desde, hasta, motivo, msg}} (dispatcher, DAG paralelo).';


--
-- Name: cobertura_contratos; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.cobertura_contratos AS
 SELECT ocid,
    fecha_convocatoria AS fecha,
    (date_trunc('month'::text, (fecha_convocatoria)::timestamp with time zone))::date AS mes,
    tipo_contratacion AS tipo,
    etapa,
    procesable,
    (ocds_payload ? 'parties'::text) AS record_completo,
    updated_at AS record_actualizado_at,
    ((COALESCE(jsonb_array_length(((ocds_payload -> 'tender'::text) -> 'documents'::text)), 0) + COALESCE(( SELECT (sum(jsonb_array_length(COALESCE((a.value -> 'documents'::text), '[]'::jsonb))))::integer AS sum
           FROM jsonb_array_elements(COALESCE((c.ocds_payload -> 'awards'::text), '[]'::jsonb)) a(value)), 0)) + COALESCE(( SELECT (sum(jsonb_array_length(COALESCE((k.value -> 'documents'::text), '[]'::jsonb))))::integer AS sum
           FROM jsonb_array_elements(COALESCE((c.ocds_payload -> 'contracts'::text), '[]'::jsonb)) k(value)), 0)) AS docs_publicados,
    ( SELECT (count(*))::integer AS count
           FROM public.documentos_gcs d
          WHERE ((public.ocid_corto(d.ocid) = public.ocid_corto(c.ocid)) AND (d.borrado_at IS NULL) AND (d.expira_at > now()))) AS docs_vigentes,
    ( SELECT max(d.expira_at) AS max
           FROM public.documentos_gcs d
          WHERE ((public.ocid_corto(d.ocid) = public.ocid_corto(c.ocid)) AND (d.borrado_at IS NULL) AND (d.expira_at > now()))) AS docs_expiran_at,
    (EXISTS ( SELECT 1
           FROM public.alertas a
          WHERE (public.ocid_corto(a.ocid) = public.ocid_corto(c.ocid)))) AS analizado,
    ( SELECT p.estado
           FROM public.procesamientos p
          WHERE (public.ocid_corto(p.ocid) = public.ocid_corto(c.ocid))
         LIMIT 1) AS procesamiento
   FROM public.convocatorias c;


--
-- Name: cola_auditoria; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.cola_auditoria AS
 SELECT ocid,
    ubigeo_zona AS ubigeo,
    fecha_convocatoria
   FROM public.convocatorias c
  WHERE ((ubigeo_zona IS NOT NULL) AND (procesable IS DISTINCT FROM false) AND ((( SELECT public.procesamiento_tipos_activos() AS procesamiento_tipos_activos) IS NULL) OR (tipo_contratacion = ANY (( SELECT public.procesamiento_tipos_activos() AS procesamiento_tipos_activos)::text[])) OR ((tipo_contratacion IS NULL) AND (''::text = ANY (( SELECT public.procesamiento_tipos_activos() AS procesamiento_tipos_activos)::text[])))) AND ((( SELECT public.procesamiento_etapas_activas() AS procesamiento_etapas_activas) IS NULL) OR (etapa = ANY (( SELECT public.procesamiento_etapas_activas() AS procesamiento_etapas_activas)::text[])) OR ((etapa IS NULL) AND (''::text = ANY (( SELECT public.procesamiento_etapas_activas() AS procesamiento_etapas_activas)::text[])))) AND (NOT (EXISTS ( SELECT 1
           FROM public.alertas a
          WHERE (a.ocid = c.ocid)))) AND (NOT (EXISTS ( SELECT 1
           FROM public.asignaciones s
          WHERE (s.ocid = c.ocid)))));


--
-- Name: contrato_estado; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contrato_estado (
    ocid text NOT NULL,
    riesgo text NOT NULL,
    score integer,
    estado_proc text NOT NULL,
    operativo text NOT NULL,
    alerta_id uuid,
    alerta_codigo text,
    alerta_estado text,
    ubigeo_zona text,
    tipo text,
    etapa text,
    entidad_ruc character(11),
    fecha_convocatoria date,
    created_at timestamp with time zone,
    monto numeric,
    actualizado_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE contrato_estado; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.contrato_estado IS 'Estado derivado de cada convocatoria (riesgo, score público, estado de procesamiento, estado operativo) + espejo de columnas para listar y agregar. Semántica = contratos.ts. La mantienen triggers (migración 35); la verdad es la vista contrato_estado_calculado.';


--
-- Name: contrato_estado_calculado; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.contrato_estado_calculado AS
 SELECT c.ocid,
        CASE
            WHEN (a.score IS NULL) THEN 'sin_analizar'::text
            WHEN (a.estado = 'revision'::text) THEN 'en_revision'::text
            WHEN (NOT public.alerta_publicada(a.estado)) THEN 'descartado'::text
            WHEN (a.score >= 70) THEN 'alto'::text
            WHEN (a.score >= 40) THEN 'medio'::text
            ELSE 'bajo'::text
        END AS riesgo,
        CASE
            WHEN public.alerta_publicada(a.estado) THEN a.score
            ELSE NULL::integer
        END AS score,
        CASE
            WHEN (p.estado IS NOT NULL) THEN p.estado
            WHEN (a.id IS NOT NULL) THEN 'procesado'::text
            WHEN (c.procesable = false) THEN 'pendiente_de_procesamiento'::text
            ELSE 'sin_analizar'::text
        END AS estado_proc,
        CASE
            WHEN ((c.tipo_contratacion = ANY (al.tipos)) AND (c.etapa = ANY (al.etapas))) THEN 'en_cola'::text
            WHEN (EXISTS ( SELECT 1
               FROM public.documentos_gcs d
              WHERE ((d.ocid = c.ocid) AND (d.borrado_at IS NULL) AND (d.expira_at > now())))) THEN 'documentos_listos'::text
            ELSE 'sin_documentos'::text
        END AS operativo,
    a.id AS alerta_id,
    a.codigo AS alerta_codigo,
    a.estado AS alerta_estado,
    c.ubigeo_zona,
    COALESCE(c.tipo_contratacion,
        CASE c.categoria
            WHEN 'goods'::text THEN 'bienes'::text
            WHEN 'services'::text THEN 'servicios'::text
            WHEN 'works'::text THEN 'obras'::text
            ELSE NULL::text
        END) AS tipo,
    c.etapa,
    c.entidad_ruc,
    c.fecha_convocatoria,
    c.created_at,
    c.cuantia_referencial AS monto
   FROM (((public.convocatorias c
     CROSS JOIN public.alcance_contratos() al(tipos, etapas))
     LEFT JOIN LATERAL ( SELECT a_1.id,
            a_1.codigo,
            a_1.score,
            a_1.estado
           FROM public.alertas a_1
          WHERE ((a_1.ocid IS NOT NULL) AND (public.ocid_corto(a_1.ocid) = public.ocid_corto(c.ocid)) AND (a_1.codigo !~~ 'ALT-%'::text))
          ORDER BY a_1.analizado_en DESC NULLS LAST, a_1.created_at DESC, a_1.id
         LIMIT 1) a ON (true))
     LEFT JOIN public.procesamientos p ON ((p.ocid = c.ocid)));


--
-- Name: entidades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entidades (
    ruc character(11) NOT NULL,
    nombre text NOT NULL,
    tipo text,
    region text,
    provincia text,
    distrito text,
    ubigeo character(6),
    pliego_nombre_mef text,
    pliego_id_mef integer,
    ubicacion_geo public.geography(Point,4326),
    fecha_alta date,
    estado_sunat text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT entidades_tipo_check CHECK ((tipo = ANY (ARRAY['municipal_distrital'::text, 'municipal_provincial'::text, 'gobierno_regional'::text, 'ministerio'::text, 'empresa_publica'::text, 'organismo_autonomo'::text])))
);


--
-- Name: entidad_gobierno; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.entidad_gobierno AS
 SELECT ruc,
        CASE
            WHEN (nombre ~* '^\s*GOBIERNO REGIONAL'::text) THEN 'regional'::text
            WHEN (nombre ~* '^\s*MUNICIPALIDAD (PROVINCIAL|METROPOLITANA)'::text) THEN 'provincial'::text
            WHEN (nombre ~* '^\s*MUNICIPALIDAD DISTRITAL'::text) THEN 'distrital'::text
            ELSE NULL::text
        END AS nivel,
        CASE
            WHEN (nombre ~* '^\s*GOBIERNO REGIONAL'::text) THEN "left"((ubigeo)::text, 2)
            WHEN (nombre ~* '^\s*MUNICIPALIDAD (PROVINCIAL|METROPOLITANA)'::text) THEN "left"((ubigeo)::text, 4)
            WHEN (nombre ~* '^\s*MUNICIPALIDAD DISTRITAL'::text) THEN (ubigeo)::text
            ELSE NULL::text
        END AS ubigeo
   FROM public.entidades e
  WHERE ((ubigeo IS NOT NULL) AND (length(ubigeo) = 6) AND (nombre ~* '^\s*(GOBIERNO REGIONAL|MUNICIPALIDAD (PROVINCIAL|METROPOLITANA|DISTRITAL))'::text));


--
-- Name: gobierno_periodo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gobierno_periodo (
    nivel text NOT NULL,
    ubigeo text NOT NULL,
    anio_eleccion integer NOT NULL,
    desde date NOT NULL,
    hasta date NOT NULL,
    autoridad text,
    org_clave text NOT NULL,
    org_nombre text NOT NULL,
    org_tipo text,
    CONSTRAINT gobierno_periodo_nivel_check CHECK ((nivel = ANY (ARRAY['regional'::text, 'provincial'::text, 'distrital'::text])))
);


--
-- Name: TABLE gobierno_periodo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.gobierno_periodo IS 'Quién gobierna cada región, provincia y distrito en cada período (JNE, elecciones 2014, 2018 y 2022). Migración 41.';


--
-- Name: contrato_partido; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.contrato_partido AS
 SELECT c.ocid,
    c.entidad_ruc,
    c.fecha_convocatoria,
    g.org_clave,
    g.org_nombre,
    g.org_tipo,
    g.anio_eleccion,
    g.nivel,
    g.ubigeo AS gobierno_ubigeo,
    g.autoridad
   FROM ((public.convocatorias c
     JOIN public.entidad_gobierno eg ON ((eg.ruc = c.entidad_ruc)))
     JOIN public.gobierno_periodo g ON (((g.nivel = eg.nivel) AND (g.ubigeo = eg.ubigeo) AND ((c.fecha_convocatoria >= g.desde) AND (c.fecha_convocatoria <= g.hasta)))));


--
-- Name: VIEW contrato_partido; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.contrato_partido IS 'Contrato asociado al partido que gobernaba la entidad el mes en que se convocó. Migración 41.';


--
-- Name: contratos_agregado; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.contratos_agregado AS
 SELECT ubigeo_zona AS ubigeo,
    tipo,
    etapa,
    (date_trunc('month'::text, (fecha_convocatoria)::timestamp without time zone))::date AS mes,
    riesgo,
    estado_proc,
    operativo,
    (count(*))::integer AS n,
    (count(*) FILTER (WHERE (alerta_estado = 'revision'::text)))::integer AS n_revision,
    COALESCE(sum(monto), (0)::numeric) AS monto
   FROM public.contrato_estado ce
  WHERE (ocid !~~ 'ocds-vigia-%'::text)
  GROUP BY ubigeo_zona, tipo, etapa, ((date_trunc('month'::text, (fecha_convocatoria)::timestamp without time zone))::date), riesgo, estado_proc, operativo
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW contratos_agregado; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.contratos_agregado IS 'Conteos de contratos (sin la semilla de demo) por zona × tipo × etapa × mes × riesgo × estado_proc × operativo. n = contratos, n_revision = con alerta en revisión, monto = suma de cuantia_referencial. Migración 35.';


--
-- Name: contribuciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contribuciones (
    id bigint NOT NULL,
    codigo text NOT NULL,
    financiador_id bigint NOT NULL,
    ubigeo text NOT NULL,
    contratos integer NOT NULL,
    tarifa_id integer NOT NULL,
    monto_pen numeric(10,2) NOT NULL,
    moneda_pago text DEFAULT 'PEN'::text NOT NULL,
    estado text DEFAULT 'pendiente_pago'::text NOT NULL,
    pasarela text,
    pasarela_ref text,
    comprobante_url text,
    validada_por text,
    pagada_at timestamp with time zone,
    mensaje_publico text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    nota_admin text,
    rechazada_motivo text,
    solo_con_documentos boolean DEFAULT true NOT NULL,
    tipos text[],
    entidad_ruc character(11),
    partido_clave text,
    partido_anio integer,
    CONSTRAINT contribuciones_contratos_check CHECK (((contratos >= 5) OR ((entidad_ruc IS NOT NULL) AND (contratos >= 1)))),
    CONSTRAINT contribuciones_estado_check CHECK ((estado = ANY (ARRAY['pendiente_pago'::text, 'pagada'::text, 'en_proceso'::text, 'procesada'::text, 'reembolsada'::text, 'rechazada'::text]))),
    CONSTRAINT contribuciones_partido_check CHECK ((((partido_clave IS NULL) AND (partido_anio IS NULL)) OR ((partido_clave IS NOT NULL) AND (partido_anio IS NOT NULL) AND (entidad_ruc IS NULL))))
);


--
-- Name: COLUMN contribuciones.solo_con_documentos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contribuciones.solo_con_documentos IS 'Solo asignar contratos con documentos vigentes en GCS (documentos_listos). Los que faltan se piden al batch.';


--
-- Name: COLUMN contribuciones.tipos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contribuciones.tipos IS 'Tipos de contratación elegibles (p. ej. {bienes}). NULL: los tipos activos de ajustes.procesamiento.';


--
-- Name: COLUMN contribuciones.entidad_ruc; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contribuciones.entidad_ruc IS 'Aporte por ENTIDAD (migración 39): se asignan contratos al azar entre los de esta entidad en cola. NULL = aporte por zona (ubigeo). Con entidad, `ubigeo` es la zona derivada (zona_de_entidad al crearlo).';


--
-- Name: COLUMN contribuciones.partido_clave; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contribuciones.partido_clave IS 'Aporte por PARTIDO (migración 41): se asignan contratos al azar entre los de las entidades que ese partido gobernó en `partido_anio`.';


--
-- Name: contribuciones_codigo_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contribuciones_codigo_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contribuciones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contribuciones_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contribuciones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contribuciones_id_seq OWNED BY public.contribuciones.id;


--
-- Name: convergencias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.convergencias (
    id text NOT NULL,
    alerta_id uuid NOT NULL,
    reporte_ids text[] NOT NULL,
    ubicacion_geo public.geography(Point,4326),
    resumen text,
    radio_match_m integer,
    delta_dias integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: convocatoria_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.convocatoria_items (
    id bigint NOT NULL,
    ocid text NOT NULL,
    numero_item integer NOT NULL,
    descripcion text,
    descripcion_corta text,
    cantidad numeric,
    unidad text,
    cuantia_referencial numeric,
    precio_unit_ref numeric,
    cubso text,
    especs_tecnicas jsonb
);


--
-- Name: convocatoria_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.convocatoria_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: convocatoria_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.convocatoria_items_id_seq OWNED BY public.convocatoria_items.id;


--
-- Name: convocatoria_zona; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.convocatoria_zona AS
 SELECT ocid,
    fecha_convocatoria,
    ubigeo_zona AS ubigeo
   FROM public.convocatorias c;


--
-- Name: datasets_cargas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.datasets_cargas (
    id bigint NOT NULL,
    fuente text NOT NULL,
    clave text NOT NULL,
    tabla text,
    archivo text,
    gcs_uri text,
    sha256 text NOT NULL,
    bytes bigint,
    filas integer,
    fuente_url text,
    descargado_at timestamp with time zone,
    cargado_at timestamp with time zone DEFAULT now() NOT NULL,
    estado text DEFAULT 'ok'::text NOT NULL,
    error text
);


--
-- Name: datasets_cargas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.datasets_cargas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: datasets_cargas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.datasets_cargas_id_seq OWNED BY public.datasets_cargas.id;


--
-- Name: datasets_cobertura; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.datasets_cobertura AS
 SELECT fuente,
    max(tabla) AS tabla,
    count(*) AS cargas,
    count(*) FILTER (WHERE (estado <> 'ok'::text)) AS cargas_con_error,
    sum(filas) AS filas,
    max(clave) AS ultima_clave,
    max(descargado_at) AS ultima_descarga,
    max(cargado_at) AS ultima_carga,
    (array_agg(error ORDER BY cargado_at DESC) FILTER (WHERE (error IS NOT NULL)))[1] AS ultimo_error
   FROM public.datasets_cargas
  GROUP BY fuente;


--
-- Name: derivados_marcas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.derivados_marcas (
    nombre text NOT NULL,
    tx xid8 DEFAULT pg_current_xact_id() NOT NULL,
    marcado_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE derivados_marcas; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.derivados_marcas IS 'Cambios pendientes de refrescar por grupo de vistas derivadas (una fila por transacción que escribió). La llenan triggers FOR EACH STATEMENT (marcar_derivados*) y la vacía el refresco (migración 32).';


--
-- Name: derivados_refresco; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.derivados_refresco (
    nombre text NOT NULL,
    refrescado_at timestamp with time zone,
    duracion_ms integer,
    refrescos bigint DEFAULT 0 NOT NULL
);


--
-- Name: TABLE derivados_refresco; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.derivados_refresco IS 'Último refresco de cada grupo: financiamiento = zona_estado + ranking_impacto (32); contratos = contratos_agregado + entidad_stats (35); vencimientos = último barrido de documentos vencidos sobre contrato_estado (35).';


--
-- Name: derivados_estado; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.derivados_estado AS
 SELECT nombre,
    (EXISTS ( SELECT 1
           FROM public.derivados_marcas m
          WHERE (m.nombre = r.nombre))) AS sucio,
    ( SELECT max(m.marcado_at) AS max
           FROM public.derivados_marcas m
          WHERE (m.nombre = r.nombre)) AS marcado_at,
    refrescado_at,
    duracion_ms,
    refrescos
   FROM public.derivados_refresco r;


--
-- Name: VIEW derivados_estado; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.derivados_estado IS 'nombre, sucio (hay cambios sin refrescar), marcado_at (último cambio), refrescado_at, duracion_ms, refrescos.';


--
-- Name: dji_empleos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dji_empleos (
    codigo_ddjj bigint,
    ruc_entidad_raw text,
    ruc_entidad text,
    nombre_entidad text,
    cargo text,
    fecha_inicio text,
    fecha_cese text,
    fecha_elaboracion text,
    fecha_presentacion text
);


--
-- Name: dji_funcionarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dji_funcionarios (
    codigo_ddjj bigint,
    tipo_documento text,
    apellido_paterno text,
    apellido_materno text,
    nombres text,
    entidad text,
    cargo text,
    fecha_elaboracion text,
    fecha_presentacion text,
    fecha_inicio_cargo text,
    fecha_cese_cargo text,
    nombre_norm text GENERATED ALWAYS AS (upper(public.immutable_unaccent(((((COALESCE(apellido_paterno, ''::text) || ' '::text) || COALESCE(apellido_materno, ''::text)) || ' '::text) || COALESCE(nombres, ''::text))))) STORED
);


--
-- Name: dji_puerta_giratoria; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.dji_puerta_giratoria AS
 SELECT f.codigo_ddjj,
    f.nombre_norm,
    f.entidad AS entidad_actual,
    f.cargo AS cargo_actual,
    e.ruc_entidad AS ruc_empleador_previo,
    e.nombre_entidad AS empleador_previo,
    e.cargo AS cargo_previo,
    e.fecha_inicio,
    e.fecha_cese
   FROM (public.dji_funcionarios f
     JOIN public.dji_empleos e USING (codigo_ddjj))
  WHERE (e.ruc_entidad ~~ '20%'::text);


--
-- Name: documentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documentos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ocid text,
    alerta_id uuid,
    tipo text NOT NULL,
    nombre text NOT NULL,
    blob_url text NOT NULL,
    fecha date,
    paginas integer,
    tamano_bytes bigint,
    texto_extraido text,
    resumen_agente text,
    agente_version text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    seccion text,
    ocds_doc_id text,
    sha256 text,
    CONSTRAINT documentos_tipo_check CHECK ((tipo = ANY (ARRAY['bases'::text, 'expediente_tecnico'::text, 'acta_buena_pro'::text, 'reporte_buena_pro'::text, 'informe_dec'::text, 'contrato'::text, 'adenda'::text, 'propuesta_postor'::text, 'otro'::text])))
);


--
-- Name: documentos_gcs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.documentos_gcs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: documentos_gcs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.documentos_gcs_id_seq OWNED BY public.documentos_gcs.id;


--
-- Name: documentos_texto; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documentos_texto (
    sha256 text NOT NULL,
    ocid text,
    url_gcs text,
    formato text,
    n_paginas integer,
    motor text,
    version_parser text,
    texto text,
    paginas jsonb,
    truncado boolean DEFAULT false NOT NULL,
    recortes jsonb,
    extraccion jsonb,
    creado_at timestamp with time zone DEFAULT now() NOT NULL,
    actualizado_at timestamp with time zone
);


--
-- Name: TABLE documentos_texto; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.documentos_texto IS 'Texto OCR por sha256 (una sola vez por documento) con páginas ⟦p.N⟧ y extracción estructurada por bloque del perfil.';


--
-- Name: empresa_personas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.empresa_personas (
    id bigint NOT NULL,
    empresa_ruc character(11) NOT NULL,
    persona_dni character(8) NOT NULL,
    rol text NOT NULL,
    porcentaje numeric(5,2),
    fecha_desde date,
    fecha_hasta date,
    fuente text
);


--
-- Name: empresa_personas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.empresa_personas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: empresa_personas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.empresa_personas_id_seq OWNED BY public.empresa_personas.id;


--
-- Name: empresas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.empresas (
    ruc character(11) NOT NULL,
    razon_social text NOT NULL,
    fecha_alta_ruc date,
    estado_sunat text,
    domicilio_fiscal text,
    capital_social numeric,
    actividad_economica text,
    ubicacion_geo public.geography(Point,4326),
    rnp_vigente boolean,
    rnp_categorias text[],
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: entidad_stats; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.entidad_stats AS
 SELECT e.ruc,
    e.nombre,
    public.immutable_unaccent(lower(e.nombre)) AS nombre_norm,
    e.tipo,
    e.region,
    e.provincia,
    e.distrito,
    e.ubigeo,
    e.pliego_nombre_mef,
    (COALESCE(cv.contratos, (0)::bigint))::integer AS contratos,
    COALESCE(cv.monto, (0)::numeric) AS monto_contratos,
    (COALESCE(al.activas, (0)::bigint))::integer AS alertas_activas,
    COALESCE(al.monto_activas, (0)::numeric) AS monto_alertas_activas,
    al.score_prom_activas,
    (COALESCE(al.publicadas, (0)::bigint))::integer AS alertas_publicadas,
    al.score_max
   FROM ((public.entidades e
     LEFT JOIN ( SELECT ce.entidad_ruc,
            count(*) AS contratos,
            sum(ce.monto) AS monto
           FROM public.contrato_estado ce
          WHERE ((ce.ocid !~~ 'ocds-vigia-%'::text) AND (ce.entidad_ruc IS NOT NULL))
          GROUP BY ce.entidad_ruc) cv ON ((cv.entidad_ruc = e.ruc)))
     LEFT JOIN ( SELECT a.entidad_ruc,
            count(*) FILTER (WHERE (a.estado = 'activa'::text)) AS activas,
            sum(a.monto_adjudicado) FILTER (WHERE (a.estado = 'activa'::text)) AS monto_activas,
            (avg(a.score) FILTER (WHERE (a.estado = 'activa'::text)))::integer AS score_prom_activas,
            count(*) FILTER (WHERE public.alerta_publicada(a.estado)) AS publicadas,
            max(a.score) FILTER (WHERE public.alerta_publicada(a.estado)) AS score_max
           FROM public.alertas a
          WHERE ((a.codigo !~~ 'ALT-%'::text) AND (a.entidad_ruc IS NOT NULL))
          GROUP BY a.entidad_ruc) al ON ((al.entidad_ruc = e.ruc)))
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW entidad_stats; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.entidad_stats IS 'Una fila por entidad: contratos (sin demo), alertas activas (lo que cuenta /entidades), alertas publicadas (activa|confirmada), montos y scores. nombre_norm = immutable_unaccent(lower(nombre)). Migración 35.';


--
-- Name: equipo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipo (
    correo text NOT NULL,
    rol text NOT NULL,
    nombre text,
    activo boolean DEFAULT true NOT NULL,
    creado_por text,
    creado_at timestamp with time zone DEFAULT now() NOT NULL,
    actualizado_por text,
    actualizado_at timestamp with time zone DEFAULT now() NOT NULL,
    ultimo_ingreso timestamp with time zone,
    CONSTRAINT equipo_correo_check CHECK (((correo = lower(btrim(correo))) AND (correo ~~ '%_@_%'::text))),
    CONSTRAINT equipo_rol_check CHECK ((rol = ANY (ARRAY['admin'::text, 'revisor'::text])))
);


--
-- Name: TABLE equipo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.equipo IS 'Miembros del panel admin (fuera de los principales del secreto admin-emails). Permisos por rol en frontend/lib/permisos.ts.';


--
-- Name: financiadores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financiadores (
    id bigint NOT NULL,
    tipo text NOT NULL,
    nombre_publico text,
    slug text,
    ruc character(11),
    logo_url text,
    email text NOT NULL,
    firebase_uid text,
    visible boolean DEFAULT true NOT NULL,
    motivo_no_visible text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    descripcion text,
    sitio_web text,
    email_publico text,
    redes jsonb DEFAULT '{}'::jsonb NOT NULL,
    portada_url text,
    telefono text,
    ubicacion text,
    enlaces jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT financiadores_descripcion_check CHECK (((descripcion IS NULL) OR (char_length(descripcion) <= 280))),
    CONSTRAINT financiadores_email_publico_check CHECK (((email_publico IS NULL) OR (email_publico ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text))),
    CONSTRAINT financiadores_enlaces_check CHECK (((jsonb_typeof(enlaces) = 'array'::text) AND (jsonb_array_length(enlaces) <= 5) AND (NOT jsonb_path_exists(enlaces, '$[*]?((((@.type() != "object" || !(@."url".type() == "string")) || !(@."url" starts with "https://")) || !(@."titulo".type() == "string")) || @."titulo".size() == 0)'::jsonpath)))),
    CONSTRAINT financiadores_portada_url_check CHECK (((portada_url IS NULL) OR (portada_url ~ '^https://\S+$'::text))),
    CONSTRAINT financiadores_redes_check CHECK (((jsonb_typeof(redes) = 'object'::text) AND ((redes - ARRAY['facebook'::text, 'instagram'::text, 'linkedin'::text, 'x'::text, 'tiktok'::text, 'youtube'::text]) = '{}'::jsonb) AND (NOT jsonb_path_exists(redes, '$.*?(@.type() != "string" || !(@ starts with "https://"))'::jsonpath)))),
    CONSTRAINT financiadores_sitio_web_check CHECK (((sitio_web IS NULL) OR (sitio_web ~ '^https://\S+$'::text))),
    CONSTRAINT financiadores_telefono_check CHECK (((telefono IS NULL) OR (telefono ~ '^\+?[0-9][0-9 ()-]{5,19}$'::text))),
    CONSTRAINT financiadores_tipo_check CHECK ((tipo = ANY (ARRAY['empresa'::text, 'persona'::text, 'organizacion'::text]))),
    CONSTRAINT financiadores_ubicacion_check CHECK (((ubicacion IS NULL) OR (char_length(ubicacion) <= 80)))
);


--
-- Name: COLUMN financiadores.descripcion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.financiadores.descripcion IS 'Perfil público (migración 30): quién es el aliado, ≤ 280 caracteres.';


--
-- Name: COLUMN financiadores.sitio_web; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.financiadores.sitio_web IS 'Perfil público (migración 30): web del aliado, https.';


--
-- Name: COLUMN financiadores.email_publico; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.financiadores.email_publico IS 'Perfil público (migración 30): correo de CONTACTO que el aliado eligió publicar. El de pago es `email` (privado).';


--
-- Name: COLUMN financiadores.redes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.financiadores.redes IS 'Perfil público (migración 30): {facebook|instagram|linkedin|x|tiktok|youtube: "https://…"}.';


--
-- Name: COLUMN financiadores.portada_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.financiadores.portada_url IS 'Perfil público (migración 30): imagen de portada, https.';


--
-- Name: COLUMN financiadores.telefono; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.financiadores.telefono IS 'Perfil público (migración 40): teléfono de contacto que el aliado eligió publicar.';


--
-- Name: COLUMN financiadores.ubicacion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.financiadores.ubicacion IS 'Perfil público (migración 40): ciudad o región, ≤ 80 caracteres.';


--
-- Name: COLUMN financiadores.enlaces; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.financiadores.enlaces IS 'Perfil público (migración 40): [{titulo, url}] hasta 5 enlaces relevantes, https.';


--
-- Name: financiadores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.financiadores_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: financiadores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.financiadores_id_seq OWNED BY public.financiadores.id;


--
-- Name: jne_autoridades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jne_autoridades (
    id bigint NOT NULL,
    proceso text NOT NULL,
    ubigeo text,
    departamento text,
    provincia text,
    distrito text,
    cargo text NOT NULL,
    nombre text NOT NULL,
    nombre_norm text NOT NULL,
    dni text,
    organizacion_politica text,
    periodo_inicio date,
    periodo_fin date,
    id_hoja_vida bigint,
    fuente text DEFAULT 'jne_infogob'::text NOT NULL,
    fuente_url text,
    sha256 text,
    descargado_at timestamp with time zone,
    cargado_at timestamp with time zone DEFAULT now() NOT NULL,
    ubigeo_jne text,
    posicion integer,
    ambito text,
    pronunciamiento text,
    es_reemplazo boolean DEFAULT false NOT NULL,
    periodo_texto text,
    genero text,
    vigente boolean DEFAULT true NOT NULL
);


--
-- Name: jne_autoridades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jne_autoridades_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jne_autoridades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jne_autoridades_id_seq OWNED BY public.jne_autoridades.id;


--
-- Name: jne_autoridades_vigentes; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.jne_autoridades_vigentes AS
 SELECT id,
    proceso,
    ubigeo,
    departamento,
    provincia,
    distrito,
    cargo,
    nombre,
    nombre_norm,
    dni,
    organizacion_politica,
    periodo_inicio,
    periodo_fin,
    id_hoja_vida,
    fuente,
    fuente_url,
    sha256,
    descargado_at,
    cargado_at,
    ubigeo_jne,
    posicion,
    ambito,
    pronunciamiento,
    es_reemplazo,
    periodo_texto,
    genero,
    vigente
   FROM public.jne_autoridades
  WHERE (vigente AND ((periodo_inicio IS NULL) OR (periodo_inicio <= CURRENT_DATE)) AND ((periodo_fin IS NULL) OR (periodo_fin >= CURRENT_DATE)));


--
-- Name: jne_candidaturas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jne_candidaturas (
    id bigint NOT NULL,
    numero_documento text,
    nombre text NOT NULL,
    nombre_original text,
    partido text,
    "año" integer,
    cargo text,
    resultado text,
    region text,
    provincia text,
    distrito text,
    numero_lista integer,
    fuente text DEFAULT 'JNE_PlataformaElectoral'::text,
    fuente_url text,
    cargado_en timestamp with time zone DEFAULT now()
);


--
-- Name: jne_candidaturas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jne_candidaturas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jne_candidaturas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jne_candidaturas_id_seq OWNED BY public.jne_candidaturas.id;


--
-- Name: lotes_ingesta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lotes_ingesta (
    id text NOT NULL,
    tipo text NOT NULL,
    manifest_uri text NOT NULL,
    estado text DEFAULT 'pending'::text NOT NULL,
    total integer DEFAULT 0 NOT NULL,
    ok integer DEFAULT 0 NOT NULL,
    fallidos integer DEFAULT 0 NOT NULL,
    iniciado_at timestamp with time zone,
    finalizado_at timestamp with time zone,
    error text,
    creado_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lotes_ingesta_estado_check CHECK ((estado = ANY (ARRAY['pending'::text, 'procesando'::text, 'ok'::text, 'error'::text]))),
    CONSTRAINT lotes_ingesta_tipo_check CHECK ((tipo = ANY (ARRAY['releases'::text, 'records'::text, 'documentos'::text])))
);


--
-- Name: lotes_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lotes_items (
    lote_id text NOT NULL,
    clave text NOT NULL,
    estado text DEFAULT 'pending'::text NOT NULL,
    error text,
    procesado_at timestamp with time zone,
    CONSTRAINT lotes_items_estado_check CHECK ((estado = ANY (ARRAY['pending'::text, 'ok'::text, 'error'::text])))
);


--
-- Name: mef_entity_budget; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mef_entity_budget (
    entidad_ruc character(11) NOT NULL,
    keyword text,
    total_rows bigint,
    by_year jsonb,
    matched_pliegos text[],
    kind text,
    last_refreshed timestamp with time zone DEFAULT now(),
    CONSTRAINT mef_entity_budget_kind_check CHECK ((kind = ANY (ARRAY['ok'::text, 'partial'::text, 'empty'::text, 'failed'::text])))
);


--
-- Name: mef_region_budget; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mef_region_budget (
    departamento text NOT NULL,
    total_rows bigint,
    by_year jsonb,
    top_sectores jsonb,
    top_pliegos jsonb,
    top_programas jsonb,
    top_genericas jsonb,
    last_refreshed timestamp with time zone DEFAULT now()
);


--
-- Name: network_expansions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.network_expansions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    alerta_id uuid NOT NULL,
    empresa_ruc character(11) NOT NULL,
    agente_version text,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ofertas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ofertas (
    id bigint NOT NULL,
    postor_id bigint NOT NULL,
    item_id bigint NOT NULL,
    monto_ofertado numeric,
    porcentaje_referencial numeric(6,3),
    admitida boolean DEFAULT false,
    calificada boolean DEFAULT false,
    ganadora boolean DEFAULT false
);


--
-- Name: ofertas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ofertas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ofertas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ofertas_id_seq OWNED BY public.ofertas.id;


--
-- Name: onpe_aportantes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onpe_aportantes (
    id bigint NOT NULL,
    numero_documento text,
    nombre text NOT NULL,
    nombre_original text,
    partido text NOT NULL,
    "año" integer,
    fecha_aporte date,
    monto numeric(14,2),
    tipo_aporte text,
    nivel text,
    fuente text DEFAULT 'ONPE_Claridad'::text,
    fuente_url text,
    cargado_en timestamp with time zone DEFAULT now(),
    proceso text,
    ruc_organizacion text,
    tipo_receptor text,
    receptor text,
    aporte_clave text,
    sha256 text,
    descargado_at timestamp with time zone
);


--
-- Name: onpe_aportantes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.onpe_aportantes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: onpe_aportantes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.onpe_aportantes_id_seq OWNED BY public.onpe_aportantes.id;


--
-- Name: onpe_candidatos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onpe_candidatos (
    id bigint NOT NULL,
    dni text,
    apellidos text,
    nombres text,
    nombre_norm text GENERATED ALWAYS AS (upper(public.immutable_unaccent(((COALESCE(apellidos, ''::text) || ' '::text) || COALESCE(nombres, ''::text))))) STORED,
    organizacion text,
    departamento text,
    proceso text,
    total_ingresos numeric(14,2),
    fuente text DEFAULT 'onpe_claridad'::text NOT NULL,
    fuente_url text,
    sha256 text,
    descargado_at timestamp with time zone,
    cargado_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: onpe_candidatos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.onpe_candidatos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: onpe_candidatos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.onpe_candidatos_id_seq OWNED BY public.onpe_candidatos.id;


--
-- Name: opiniones_oece; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opiniones_oece (
    numero text NOT NULL,
    fecha date,
    titulo text,
    texto text,
    texto_busqueda tsvector GENERATED ALWAYS AS (to_tsvector('spanish'::regconfig, ((COALESCE(titulo, ''::text) || ' '::text) || COALESCE(texto, ''::text)))) STORED,
    embedding public.vector(768),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: opiniones_oece_estructurado; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opiniones_oece_estructurado (
    id bigint NOT NULL,
    ano integer NOT NULL,
    norma text NOT NULL,
    num_opinion text NOT NULL,
    articulo_ley text,
    numeral_art_ley text,
    literal_art_ley text,
    articulo_reglamento text,
    interpretacion text NOT NULL,
    link text,
    embedding public.vector(768)
);


--
-- Name: opiniones_oece_estructurado_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.opiniones_oece_estructurado_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: opiniones_oece_estructurado_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.opiniones_oece_estructurado_id_seq OWNED BY public.opiniones_oece_estructurado.id;


--
-- Name: osce_sancionados; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.osce_sancionados (
    id bigint NOT NULL,
    tipo text NOT NULL,
    razon_social text NOT NULL,
    razon_social_norm text NOT NULL,
    ruc text NOT NULL,
    es_persona_natural boolean,
    resolucion text,
    fecha_resolucion date,
    monto_multa_soles numeric(14,2),
    verificacion_pago text,
    periodo text,
    fecha_desde date,
    fecha_hasta date,
    infraccion text,
    norma text,
    estado text,
    cargado_en timestamp with time zone DEFAULT now()
);


--
-- Name: osce_sancionados_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.osce_sancionados_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: osce_sancionados_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.osce_sancionados_id_seq OWNED BY public.osce_sancionados.id;


--
-- Name: osce_sancionados_vigentes; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.osce_sancionados_vigentes AS
 SELECT id,
    tipo,
    razon_social,
    razon_social_norm,
    ruc,
    es_persona_natural,
    resolucion,
    fecha_resolucion,
    monto_multa_soles,
    verificacion_pago,
    periodo,
    fecha_desde,
    fecha_hasta,
    infraccion,
    norma,
    estado,
    cargado_en
   FROM public.osce_sancionados
  WHERE ((upper(COALESCE(estado, ''::text)) = 'VIGENTE'::text) AND ((tipo = 'definitivo'::text) OR ((tipo = 'temporal'::text) AND (fecha_hasta IS NOT NULL) AND (fecha_hasta >= CURRENT_DATE)) OR ((tipo = 'multa'::text) AND ((fecha_hasta IS NULL) OR (fecha_hasta >= CURRENT_DATE)))));


--
-- Name: pedidos_descarga; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pedidos_descarga (
    id bigint NOT NULL,
    ocid text NOT NULL,
    motivo text DEFAULT 'financiado'::text NOT NULL,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    solicitado_at timestamp with time zone DEFAULT now() NOT NULL,
    tomado_at timestamp with time zone,
    atendido_at timestamp with time zone,
    intentos integer DEFAULT 0 NOT NULL,
    lote_id text,
    error text,
    CONSTRAINT pedidos_descarga_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'descargando'::text, 'listo'::text, 'fallido'::text])))
);


--
-- Name: pedidos_descarga_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pedidos_descarga_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pedidos_descarga_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pedidos_descarga_id_seq OWNED BY public.pedidos_descarga.id;


--
-- Name: penalidades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.penalidades (
    id bigint NOT NULL,
    contrato_id text,
    empresa_ruc character(11),
    tipo_penalidad text,
    objeto_contrato text,
    entidad_contratante text,
    fecha date,
    descripcion text,
    monto numeric,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: penalidades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.penalidades_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: penalidades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.penalidades_id_seq OWNED BY public.penalidades.id;


--
-- Name: peps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.peps (
    id bigint NOT NULL,
    numero_documento text,
    nombre text NOT NULL,
    nombre_norm text,
    cargo text,
    entidad text,
    region text,
    "año_desde" integer,
    "año_hasta" integer,
    fuente text DEFAULT 'JNE_heuristico'::text,
    fuente_url text,
    cargado_en timestamp with time zone DEFAULT now()
);


--
-- Name: peps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.peps_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: peps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.peps_id_seq OWNED BY public.peps.id;


--
-- Name: persona_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.persona_flags (
    id bigint NOT NULL,
    persona_dni character(8),
    empresa_ruc character(11),
    alerta_id uuid,
    tipo text NOT NULL,
    severidad text,
    detalle text,
    fuente_url text,
    fuente_fecha date,
    agente_origen text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT persona_flags_severidad_check CHECK ((severidad = ANY (ARRAY['alta'::text, 'media'::text, 'baja'::text])))
);


--
-- Name: persona_flags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.persona_flags_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: persona_flags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.persona_flags_id_seq OWNED BY public.persona_flags.id;


--
-- Name: personas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personas (
    dni character(8) NOT NULL,
    nombre text NOT NULL,
    apellidos text,
    fecha_nacimiento date,
    metadata jsonb
);


--
-- Name: postores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.postores (
    id bigint NOT NULL,
    ocid text NOT NULL,
    empresa_ruc character(11),
    tipo text NOT NULL,
    rnp_vigente boolean,
    CONSTRAINT postores_tipo_check CHECK ((tipo = ANY (ARRAY['persona_juridica'::text, 'consorcio'::text, 'persona_natural'::text])))
);


--
-- Name: postores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.postores_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: postores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.postores_id_seq OWNED BY public.postores.id;


--
-- Name: zonas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zonas (
    ubigeo text NOT NULL,
    nivel text NOT NULL,
    nombre text NOT NULL,
    padre_ubigeo text,
    lat numeric(9,5),
    lon numeric(9,5),
    CONSTRAINT zonas_nivel_check CHECK ((nivel = ANY (ARRAY['departamento'::text, 'provincia'::text, 'distrito'::text]))),
    CONSTRAINT zonas_ubigeo_check CHECK ((ubigeo ~ '^[0-9]{2}([0-9]{2}([0-9]{2})?)?$'::text))
);


--
-- Name: procesamientos_publico; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.procesamientos_publico AS
 SELECT p.ocid,
    p.estado,
    p.fase_actual,
    p.fase_index,
    p.intentos,
    p.encolado_at,
    p.iniciado_at,
    p.finalizado_at,
    co.codigo AS contribucion_codigo,
    co.ubigeo,
    z.nombre AS zona,
        CASE
            WHEN f.visible THEN COALESCE(f.nombre_publico, 'Anónimo'::text)
            ELSE 'Aliado no visible'::text
        END AS financiador,
    f.visible AS financiador_visible,
    cv.objeto AS titulo,
    e.nombre AS entidad,
    cv.cuantia_referencial AS monto_pen,
    a.codigo AS alerta_codigo,
    a.score,
    ( SELECT count(*) AS count
           FROM public.banderas b
          WHERE (b.alerta_id = a.id)) AS banderas,
    p.fases,
    a.estado AS alerta_estado,
    a.id AS alerta_id
   FROM ((((((public.procesamientos p
     JOIN public.contribuciones co ON ((co.id = p.contribucion_id)))
     JOIN public.financiadores f ON ((f.id = co.financiador_id)))
     JOIN public.zonas z ON ((z.ubigeo = co.ubigeo)))
     JOIN public.convocatorias cv ON ((cv.ocid = p.ocid)))
     LEFT JOIN public.entidades e ON ((e.ruc = cv.entidad_ruc)))
     LEFT JOIN public.alertas a ON ((public.ocid_corto(a.ocid) = public.ocid_corto(p.ocid))));


--
-- Name: reportes_codigo_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reportes_codigo_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reportes_indexados; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reportes_indexados (
    id text NOT NULL,
    categoria text NOT NULL,
    descripcion text,
    foto_url text,
    ubicacion_geo public.geography(Point,4326),
    region text,
    fecha date NOT NULL,
    confirmado boolean DEFAULT false,
    confirmaciones integer DEFAULT 1,
    convergencia_id text,
    user_id text,
    anonimo boolean DEFAULT true,
    moderacion_estado text DEFAULT 'pendiente'::text,
    created_at timestamp with time zone DEFAULT now(),
    direccion_texto text,
    ruc_entidad text,
    contacto_email text,
    modo text DEFAULT 'obra'::text,
    media_urls jsonb DEFAULT '[]'::jsonb,
    provincia text,
    distrito text,
    monto_estimado numeric,
    periodo_desde date,
    periodo_hasta date,
    personas_involucradas text,
    enlaces_externos jsonb DEFAULT '[]'::jsonb,
    contacto_nombre text,
    contacto_telefono text,
    CONSTRAINT reportes_indexados_moderacion_estado_check CHECK ((moderacion_estado = ANY (ARRAY['pendiente'::text, 'aprobado'::text, 'rechazado'::text])))
);


--
-- Name: rnp_conformacion_juridica; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rnp_conformacion_juridica (
    id bigint NOT NULL,
    fecha_corte date NOT NULL,
    tipo_documento text NOT NULL,
    numero_documento text NOT NULL,
    nombre text NOT NULL,
    nombre_original text,
    ruc_empresa character(11) NOT NULL,
    tipo_rol text NOT NULL,
    fecha_inicio_vigencia date,
    id_forma_societaria text,
    forma_societaria text
);


--
-- Name: rnp_conformacion_juridica_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rnp_conformacion_juridica_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rnp_conformacion_juridica_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rnp_conformacion_juridica_id_seq OWNED BY public.rnp_conformacion_juridica.id;


--
-- Name: senales_publicas; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.senales_publicas AS
 SELECT b.id AS bandera_id,
    b.alerta_id,
    a.codigo AS alerta_codigo,
    a.ocid,
    a.codigo_convocatoria,
    b.regla,
    b.severidad,
        CASE b.severidad
            WHEN 'alta'::text THEN 0
            WHEN 'media'::text THEN 1
            ELSE 2
        END AS severidad_orden,
    b.evidencia,
    b.norma,
    b.opinion_oece,
    b.fuente_url,
    b.agente_origen AS agente,
        CASE
            WHEN ((b.verificacion ->> 'ok'::text) = ANY (ARRAY['true'::text, 'false'::text])) THEN ((b.verificacion ->> 'ok'::text))::boolean
            ELSE NULL::boolean
        END AS verificada,
    b.verificacion,
    b.created_at,
    (EXISTS ( SELECT 1
           FROM public.banderas b2
          WHERE ((b2.alerta_id = b.alerta_id) AND (b2.regla = b.regla) AND (b2.id < b.id) AND (lower(btrim(regexp_replace(COALESCE(b2.evidencia, ''::text), '\s+'::text, ' '::text, 'g'::text))) = lower(btrim(regexp_replace(COALESCE(b.evidencia, ''::text), '\s+'::text, ' '::text, 'g'::text))))))) AS repetida,
    (( SELECT count(DISTINCT ROW(b3.regla, lower(btrim(regexp_replace(COALESCE(b3.evidencia, ''::text), '\s+'::text, ' '::text, 'g'::text))))) AS count
           FROM public.banderas b3
          WHERE (b3.alerta_id = b.alerta_id)))::integer AS senales_del_contrato,
    COALESCE(a.score, 0) AS score,
    a.estado AS alerta_estado,
    a.objeto,
    a.monto_adjudicado,
    a.fecha_buena_pro,
    a.region,
    a.provincia,
    a.distrito,
    a.analizado_en,
    a.entidad_ruc,
    COALESCE(e.nombre, '—'::text) AS entidad,
    a.proveedor_ruc,
    COALESCE(emp.razon_social, '—'::text) AS proveedor
   FROM (((public.banderas b
     JOIN public.alertas a ON ((a.id = b.alerta_id)))
     LEFT JOIN public.entidades e ON ((e.ruc = a.entidad_ruc)))
     LEFT JOIN public.empresas emp ON ((emp.ruc = a.proveedor_ruc)))
  WHERE (public.alerta_publicada(a.estado) AND (a.codigo !~~ 'ALT-%'::text));


--
-- Name: VIEW senales_publicas; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.senales_publicas IS 'Una fila por bandera de alerta publicada (activa|confirmada, no demo). Orden público: severidad_orden, score DESC, entidad, bandera_id. repetida = copia de otra bandera de la misma alerta. Migración 35.';


--
-- Name: tarifas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tarifas (
    id integer NOT NULL,
    vigente_desde date NOT NULL,
    costo_real_pen numeric(8,2) NOT NULL,
    precio_pen numeric(8,2) NOT NULL,
    precio_usd numeric(8,2) NOT NULL,
    nota text
);


--
-- Name: tarifas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tarifas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tarifas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tarifas_id_seq OWNED BY public.tarifas.id;


--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usuarios (
    firebase_uid text NOT NULL,
    financiador_id bigint,
    nombre_publico text,
    visible boolean DEFAULT false NOT NULL,
    zonas_seguidas text[] DEFAULT '{}'::text[] NOT NULL,
    entidades_seguidas text[] DEFAULT '{}'::text[] NOT NULL,
    notificaciones jsonb DEFAULT '{"senales_en_mi_zona": false, "contrato_financiado_procesado": true}'::jsonb NOT NULL,
    correo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: visitas_entidades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visitas_entidades (
    id bigint NOT NULL,
    fecha_registro date,
    fecha_visita date,
    entidad_visitada text NOT NULL,
    entidad_visitada_norm text NOT NULL,
    visitante text NOT NULL,
    visitante_norm text NOT NULL,
    tipo_documento text,
    numero_documento text,
    tipo_entidad_visitante text,
    entidad_visitante text,
    funcionario_visitado text,
    funcionario_nombre text,
    funcionario_area text,
    funcionario_cargo text,
    hora_ingreso time without time zone,
    hora_salida time without time zone,
    duracion_min integer,
    motivo text,
    lugar_especifico text,
    observacion text,
    cargado_en timestamp with time zone DEFAULT now(),
    fuente text DEFAULT 'pnda_visitas'::text,
    periodo text,
    sha256 text,
    descargado_at timestamp with time zone
);


--
-- Name: visitas_entidades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.visitas_entidades_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: visitas_entidades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.visitas_entidades_id_seq OWNED BY public.visitas_entidades.id;


--
-- Name: visitas_frecuencia_anormal; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.visitas_frecuencia_anormal AS
 SELECT numero_documento,
    visitante,
    funcionario_nombre,
    entidad_visitada,
    count(*) AS n_visitas,
    min(fecha_visita) AS primera,
    max(fecha_visita) AS ultima,
    sum(COALESCE(duracion_min, 0)) AS minutos_totales
   FROM public.visitas_entidades
  WHERE ((numero_documento IS NOT NULL) AND (funcionario_nombre IS NOT NULL))
  GROUP BY numero_documento, visitante, funcionario_nombre, entidad_visitada
 HAVING (count(*) >= 5);


--
-- Name: zona_estado; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.zona_estado AS
 WITH alcance AS MATERIALIZED (
         SELECT ( SELECT (ajustes.valor -> 'tipos_activos'::text)
                   FROM public.ajustes
                  WHERE (ajustes.clave = 'procesamiento'::text)) AS tipos,
            ( SELECT (ajustes.valor -> 'etapas_activas'::text)
                   FROM public.ajustes
                  WHERE (ajustes.clave = 'procesamiento'::text)) AS etapas
        ), cola AS (
         SELECT q.ubigeo,
            (count(*))::integer AS n
           FROM public.cola_auditoria q
          GROUP BY q.ubigeo
        ), docs AS (
         SELECT c.ubigeo_zona AS ubigeo,
            (count(*))::integer AS n
           FROM (public.convocatorias c
             CROSS JOIN alcance al)
          WHERE ((c.ubigeo_zona IS NOT NULL) AND (((al.tipos ? COALESCE(c.tipo_contratacion, ''::text)) AND (al.etapas ? COALESCE(c.etapa, ''::text))) IS FALSE) AND (EXISTS ( SELECT 1
                   FROM public.documentos_gcs d
                  WHERE ((public.ocid_corto(d.ocid) = public.ocid_corto(c.ocid)) AND (d.borrado_at IS NULL) AND (d.expira_at > now())))) AND (NOT (EXISTS ( SELECT 1
                   FROM public.alertas a
                  WHERE (public.ocid_corto(a.ocid) = public.ocid_corto(c.ocid))))))
          GROUP BY c.ubigeo_zona
        ), aportes AS (
         SELECT c.ubigeo,
            sum(c.contratos) AS contratos,
            count(*) AS n
           FROM public.contribuciones c
          WHERE ((c.estado = ANY (ARRAY['pagada'::text, 'en_proceso'::text, 'procesada'::text])) AND ((c.entidad_ruc IS NULL) AND (c.partido_clave IS NULL)))
          GROUP BY c.ubigeo
        UNION ALL
         SELECT c.ubigeo,
            sum(GREATEST((c.contratos - COALESCE(k.n, (0)::bigint)), (0)::bigint)) AS sum,
            count(*) AS count
           FROM (public.contribuciones c
             LEFT JOIN ( SELECT s.contribucion_id,
                    count(*) AS n
                   FROM public.asignaciones s
                  GROUP BY s.contribucion_id) k ON ((k.contribucion_id = c.id)))
          WHERE ((c.estado = ANY (ARRAY['pagada'::text, 'en_proceso'::text, 'procesada'::text])) AND ((c.entidad_ruc IS NOT NULL) OR (c.partido_clave IS NOT NULL)))
          GROUP BY c.ubigeo
        UNION ALL
         SELECT COALESCE(cv.ubigeo_zona, c.ubigeo) AS "coalesce",
            count(*) AS count,
            0
           FROM ((public.asignaciones s
             JOIN public.contribuciones c ON ((c.id = s.contribucion_id)))
             JOIN public.convocatorias cv ON ((cv.ocid = s.ocid)))
          WHERE ((c.estado = ANY (ARRAY['pagada'::text, 'en_proceso'::text, 'procesada'::text])) AND ((c.entidad_ruc IS NOT NULL) OR (c.partido_clave IS NOT NULL)))
          GROUP BY COALESCE(cv.ubigeo_zona, c.ubigeo)
        ), asig AS (
         SELECT
                CASE
                    WHEN ((c.entidad_ruc IS NULL) AND (c.partido_clave IS NULL)) THEN c.ubigeo
                    ELSE COALESCE(cv.ubigeo_zona, c.ubigeo)
                END AS ubigeo,
            count(*) AS asignados,
            count(*) FILTER (WHERE (s.procesada_at IS NOT NULL)) AS procesados,
            count(*) FILTER (WHERE ((a.id IS NOT NULL) AND public.alerta_publicada(a.estado) AND (EXISTS ( SELECT 1
                   FROM public.banderas b
                  WHERE (b.alerta_id = a.id))))) AS senales,
            count(*) FILTER (WHERE (a.estado = 'revision'::text)) AS en_revision
           FROM (((public.asignaciones s
             JOIN public.contribuciones c ON ((c.id = s.contribucion_id)))
             LEFT JOIN public.convocatorias cv ON ((cv.ocid = s.ocid)))
             LEFT JOIN public.alertas a ON ((a.id = s.alerta_id)))
          GROUP BY
                CASE
                    WHEN ((c.entidad_ruc IS NULL) AND (c.partido_clave IS NULL)) THEN c.ubigeo
                    ELSE COALESCE(cv.ubigeo_zona, c.ubigeo)
                END
        ), cola_z AS (
         SELECT p.z AS ubigeo,
            sum(x.n) AS n
           FROM (cola x
             CROSS JOIN LATERAL ( VALUES ("left"(x.ubigeo, 2)), (
                        CASE
                            WHEN (length(x.ubigeo) >= 4) THEN "left"(x.ubigeo, 4)
                            ELSE NULL::text
                        END), (
                        CASE
                            WHEN (length(x.ubigeo) >= 6) THEN "left"(x.ubigeo, 6)
                            ELSE NULL::text
                        END)) p(z))
          WHERE (p.z IS NOT NULL)
          GROUP BY p.z
        ), docs_z AS (
         SELECT p.z AS ubigeo,
            sum(x.n) AS n
           FROM (docs x
             CROSS JOIN LATERAL ( VALUES ("left"(x.ubigeo, 2)), (
                        CASE
                            WHEN (length(x.ubigeo) >= 4) THEN "left"(x.ubigeo, 4)
                            ELSE NULL::text
                        END), (
                        CASE
                            WHEN (length(x.ubigeo) >= 6) THEN "left"(x.ubigeo, 6)
                            ELSE NULL::text
                        END)) p(z))
          WHERE (p.z IS NOT NULL)
          GROUP BY p.z
        ), aportes_z AS (
         SELECT p.z AS ubigeo,
            sum(x.contratos) AS contratos,
            sum(x.n) AS n
           FROM (aportes x
             CROSS JOIN LATERAL ( VALUES ("left"(x.ubigeo, 2)), (
                        CASE
                            WHEN (length(x.ubigeo) >= 4) THEN "left"(x.ubigeo, 4)
                            ELSE NULL::text
                        END), (
                        CASE
                            WHEN (length(x.ubigeo) >= 6) THEN "left"(x.ubigeo, 6)
                            ELSE NULL::text
                        END)) p(z))
          WHERE (p.z IS NOT NULL)
          GROUP BY p.z
        ), asig_z AS (
         SELECT p.z AS ubigeo,
            sum(x.asignados) AS asignados,
            sum(x.procesados) AS procesados,
            sum(x.senales) AS senales,
            sum(x.en_revision) AS en_revision
           FROM (asig x
             CROSS JOIN LATERAL ( VALUES ("left"(x.ubigeo, 2)), (
                        CASE
                            WHEN (length(x.ubigeo) >= 4) THEN "left"(x.ubigeo, 4)
                            ELSE NULL::text
                        END), (
                        CASE
                            WHEN (length(x.ubigeo) >= 6) THEN "left"(x.ubigeo, 6)
                            ELSE NULL::text
                        END)) p(z))
          WHERE (p.z IS NOT NULL)
          GROUP BY p.z
        ), tarifa AS (
         SELECT tarifas.precio_pen,
            tarifas.precio_usd
           FROM public.tarifas
          ORDER BY tarifas.vigente_desde DESC
         LIMIT 1
        ), base AS (
         SELECT z.ubigeo,
            z.nivel,
            z.nombre,
            z.padre_ubigeo,
            z.lat,
            z.lon,
            t.precio_pen,
            t.precio_usd,
            (COALESCE(q.n, (0)::bigint))::integer AS pendientes,
            (COALESCE(f.contratos, (0)::numeric))::integer AS financiados,
            (COALESCE(f.n, (0)::numeric))::integer AS contribuciones,
            (COALESCE(p.asignados, (0)::numeric))::integer AS asignados,
            (COALESCE(p.procesados, (0)::numeric))::integer AS procesados,
            (COALESCE(p.senales, (0)::numeric))::integer AS senales,
            (COALESCE(p.en_revision, (0)::numeric))::integer AS en_revision,
            (COALESCE(d.n, (0)::bigint))::integer AS documentos_listos
           FROM (((((public.zonas z
             CROSS JOIN tarifa t)
             LEFT JOIN cola_z q ON ((q.ubigeo = z.ubigeo)))
             LEFT JOIN docs_z d ON ((d.ubigeo = z.ubigeo)))
             LEFT JOIN aportes_z f ON ((f.ubigeo = z.ubigeo)))
             LEFT JOIN asig_z p ON ((p.ubigeo = z.ubigeo)))
        )
 SELECT ubigeo,
    nivel,
    nombre,
    padre_ubigeo,
    lat,
    lon,
    precio_pen,
    precio_usd,
    pendientes,
    financiados,
    contribuciones,
    asignados,
    procesados,
    senales,
    (pendientes + asignados) AS total_cola,
        CASE
            WHEN ((pendientes + asignados) = 0) THEN 'sin_datos'::text
            WHEN (procesados >= (pendientes + asignados)) THEN 'procesada'::text
            WHEN (financiados >= (pendientes + asignados)) THEN 'financiada'::text
            WHEN (financiados > 0) THEN 'parcial'::text
            ELSE 'pendiente'::text
        END AS estado,
    en_revision,
    documentos_listos
   FROM base
  WITH NO DATA;


--
-- Name: admin_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_log ALTER COLUMN id SET DEFAULT nextval('public.admin_log_id_seq'::regclass);


--
-- Name: asignaciones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asignaciones ALTER COLUMN id SET DEFAULT nextval('public.asignaciones_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: bandera_revision id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandera_revision ALTER COLUMN id SET DEFAULT nextval('public.bandera_revision_id_seq'::regclass);


--
-- Name: banderas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banderas ALTER COLUMN id SET DEFAULT nextval('public.banderas_id_seq'::regclass);


--
-- Name: contribuciones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contribuciones ALTER COLUMN id SET DEFAULT nextval('public.contribuciones_id_seq'::regclass);


--
-- Name: convocatoria_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.convocatoria_items ALTER COLUMN id SET DEFAULT nextval('public.convocatoria_items_id_seq'::regclass);


--
-- Name: datasets_cargas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.datasets_cargas ALTER COLUMN id SET DEFAULT nextval('public.datasets_cargas_id_seq'::regclass);


--
-- Name: documentos_gcs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos_gcs ALTER COLUMN id SET DEFAULT nextval('public.documentos_gcs_id_seq'::regclass);


--
-- Name: empresa_personas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresa_personas ALTER COLUMN id SET DEFAULT nextval('public.empresa_personas_id_seq'::regclass);


--
-- Name: financiadores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financiadores ALTER COLUMN id SET DEFAULT nextval('public.financiadores_id_seq'::regclass);


--
-- Name: jne_autoridades id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jne_autoridades ALTER COLUMN id SET DEFAULT nextval('public.jne_autoridades_id_seq'::regclass);


--
-- Name: jne_candidaturas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jne_candidaturas ALTER COLUMN id SET DEFAULT nextval('public.jne_candidaturas_id_seq'::regclass);


--
-- Name: ofertas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ofertas ALTER COLUMN id SET DEFAULT nextval('public.ofertas_id_seq'::regclass);


--
-- Name: onpe_aportantes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onpe_aportantes ALTER COLUMN id SET DEFAULT nextval('public.onpe_aportantes_id_seq'::regclass);


--
-- Name: onpe_candidatos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onpe_candidatos ALTER COLUMN id SET DEFAULT nextval('public.onpe_candidatos_id_seq'::regclass);


--
-- Name: opiniones_oece_estructurado id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opiniones_oece_estructurado ALTER COLUMN id SET DEFAULT nextval('public.opiniones_oece_estructurado_id_seq'::regclass);


--
-- Name: osce_sancionados id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.osce_sancionados ALTER COLUMN id SET DEFAULT nextval('public.osce_sancionados_id_seq'::regclass);


--
-- Name: pedidos_descarga id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedidos_descarga ALTER COLUMN id SET DEFAULT nextval('public.pedidos_descarga_id_seq'::regclass);


--
-- Name: penalidades id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.penalidades ALTER COLUMN id SET DEFAULT nextval('public.penalidades_id_seq'::regclass);


--
-- Name: peps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.peps ALTER COLUMN id SET DEFAULT nextval('public.peps_id_seq'::regclass);


--
-- Name: persona_flags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona_flags ALTER COLUMN id SET DEFAULT nextval('public.persona_flags_id_seq'::regclass);


--
-- Name: postores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postores ALTER COLUMN id SET DEFAULT nextval('public.postores_id_seq'::regclass);


--
-- Name: rnp_conformacion_juridica id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rnp_conformacion_juridica ALTER COLUMN id SET DEFAULT nextval('public.rnp_conformacion_juridica_id_seq'::regclass);


--
-- Name: tarifas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tarifas ALTER COLUMN id SET DEFAULT nextval('public.tarifas_id_seq'::regclass);


--
-- Name: visitas_entidades id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitas_entidades ALTER COLUMN id SET DEFAULT nextval('public.visitas_entidades_id_seq'::regclass);


--
-- Name: financiadores financiadores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financiadores
    ADD CONSTRAINT financiadores_pkey PRIMARY KEY (id);


--
-- Name: ranking_impacto; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.ranking_impacto AS
 SELECT f.id AS financiador_id,
    f.tipo,
    COALESCE(f.nombre_publico, 'Anónimo'::text) AS nombre,
    f.slug,
    f.logo_url,
    (sum(c.contratos))::integer AS contratos_financiados,
    (count(DISTINCT c.ubigeo))::integer AS zonas,
    (( SELECT count(*) AS count
           FROM ((public.asignaciones s
             JOIN public.contribuciones c2 ON ((c2.id = s.contribucion_id)))
             JOIN public.alertas a ON ((a.id = s.alerta_id)))
          WHERE ((c2.financiador_id = f.id) AND public.alerta_publicada(a.estado) AND (EXISTS ( SELECT 1
                   FROM public.banderas b
                  WHERE (b.alerta_id = a.id))))))::integer AS senales_halladas,
    (( SELECT count(s.procesada_at) AS count
           FROM (public.asignaciones s
             JOIN public.contribuciones c2 ON ((c2.id = s.contribucion_id)))
          WHERE (c2.financiador_id = f.id)))::integer AS contratos_procesados,
    min(c.pagada_at) AS desde,
    max(c.pagada_at) AS ultimo_aporte,
    (( SELECT count(*) AS count
           FROM ((public.asignaciones s
             JOIN public.contribuciones c2 ON ((c2.id = s.contribucion_id)))
             JOIN public.alertas a ON ((a.id = s.alerta_id)))
          WHERE ((c2.financiador_id = f.id) AND (a.estado = 'revision'::text))))::integer AS en_revision
   FROM (public.financiadores f
     JOIN public.contribuciones c ON (((c.financiador_id = f.id) AND (c.estado = ANY (ARRAY['pagada'::text, 'en_proceso'::text, 'procesada'::text])))))
  WHERE f.visible
  GROUP BY f.id
  WITH NO DATA;


--
-- Name: admin_log admin_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_log
    ADD CONSTRAINT admin_log_pkey PRIMARY KEY (id);


--
-- Name: ajustes ajustes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ajustes
    ADD CONSTRAINT ajustes_pkey PRIMARY KEY (clave);


--
-- Name: alertas alertas_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alertas
    ADD CONSTRAINT alertas_codigo_key UNIQUE (codigo);


--
-- Name: alertas alertas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alertas
    ADD CONSTRAINT alertas_pkey PRIMARY KEY (id);


--
-- Name: asignaciones asignaciones_ocid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asignaciones
    ADD CONSTRAINT asignaciones_ocid_key UNIQUE (ocid);


--
-- Name: asignaciones asignaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asignaciones
    ADD CONSTRAINT asignaciones_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: bandera_revision bandera_revision_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandera_revision
    ADD CONSTRAINT bandera_revision_pkey PRIMARY KEY (id);


--
-- Name: banderas banderas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banderas
    ADD CONSTRAINT banderas_pkey PRIMARY KEY (id);


--
-- Name: banderas_reclasificadas banderas_reclasificadas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banderas_reclasificadas
    ADD CONSTRAINT banderas_reclasificadas_pkey PRIMARY KEY (bandera_id);


--
-- Name: contrato_estado contrato_estado_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contrato_estado
    ADD CONSTRAINT contrato_estado_pkey PRIMARY KEY (ocid);


--
-- Name: contribuciones contribuciones_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contribuciones
    ADD CONSTRAINT contribuciones_codigo_key UNIQUE (codigo);


--
-- Name: contribuciones contribuciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contribuciones
    ADD CONSTRAINT contribuciones_pkey PRIMARY KEY (id);


--
-- Name: convergencias convergencias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.convergencias
    ADD CONSTRAINT convergencias_pkey PRIMARY KEY (id);


--
-- Name: convocatoria_items convocatoria_items_ocid_numero_item_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.convocatoria_items
    ADD CONSTRAINT convocatoria_items_ocid_numero_item_key UNIQUE (ocid, numero_item);


--
-- Name: convocatoria_items convocatoria_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.convocatoria_items
    ADD CONSTRAINT convocatoria_items_pkey PRIMARY KEY (id);


--
-- Name: convocatorias convocatorias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.convocatorias
    ADD CONSTRAINT convocatorias_pkey PRIMARY KEY (ocid);


--
-- Name: datasets_cargas datasets_cargas_fuente_clave_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.datasets_cargas
    ADD CONSTRAINT datasets_cargas_fuente_clave_key UNIQUE (fuente, clave);


--
-- Name: datasets_cargas datasets_cargas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.datasets_cargas
    ADD CONSTRAINT datasets_cargas_pkey PRIMARY KEY (id);


--
-- Name: derivados_marcas derivados_marcas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.derivados_marcas
    ADD CONSTRAINT derivados_marcas_pkey PRIMARY KEY (nombre, tx);


--
-- Name: derivados_refresco derivados_refresco_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.derivados_refresco
    ADD CONSTRAINT derivados_refresco_pkey PRIMARY KEY (nombre);


--
-- Name: documentos_gcs documentos_gcs_ocid_sha256_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos_gcs
    ADD CONSTRAINT documentos_gcs_ocid_sha256_key UNIQUE (ocid, sha256);


--
-- Name: documentos_gcs documentos_gcs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos_gcs
    ADD CONSTRAINT documentos_gcs_pkey PRIMARY KEY (id);


--
-- Name: documentos documentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT documentos_pkey PRIMARY KEY (id);


--
-- Name: documentos_texto documentos_texto_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos_texto
    ADD CONSTRAINT documentos_texto_pkey PRIMARY KEY (sha256);


--
-- Name: empresa_personas empresa_personas_empresa_ruc_persona_dni_rol_fecha_desde_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresa_personas
    ADD CONSTRAINT empresa_personas_empresa_ruc_persona_dni_rol_fecha_desde_key UNIQUE (empresa_ruc, persona_dni, rol, fecha_desde);


--
-- Name: empresa_personas empresa_personas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresa_personas
    ADD CONSTRAINT empresa_personas_pkey PRIMARY KEY (id);


--
-- Name: empresas empresas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresas
    ADD CONSTRAINT empresas_pkey PRIMARY KEY (ruc);


--
-- Name: entidades entidades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entidades
    ADD CONSTRAINT entidades_pkey PRIMARY KEY (ruc);


--
-- Name: equipo equipo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipo
    ADD CONSTRAINT equipo_pkey PRIMARY KEY (correo);


--
-- Name: financiadores financiadores_firebase_uid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financiadores
    ADD CONSTRAINT financiadores_firebase_uid_key UNIQUE (firebase_uid);


--
-- Name: financiadores financiadores_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financiadores
    ADD CONSTRAINT financiadores_slug_key UNIQUE (slug);


--
-- Name: gobierno_periodo gobierno_periodo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gobierno_periodo
    ADD CONSTRAINT gobierno_periodo_pkey PRIMARY KEY (nivel, ubigeo, anio_eleccion);


--
-- Name: jne_autoridades jne_autoridades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jne_autoridades
    ADD CONSTRAINT jne_autoridades_pkey PRIMARY KEY (id);


--
-- Name: jne_candidaturas jne_candidaturas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jne_candidaturas
    ADD CONSTRAINT jne_candidaturas_pkey PRIMARY KEY (id);


--
-- Name: lotes_ingesta lotes_ingesta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lotes_ingesta
    ADD CONSTRAINT lotes_ingesta_pkey PRIMARY KEY (id);


--
-- Name: lotes_items lotes_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lotes_items
    ADD CONSTRAINT lotes_items_pkey PRIMARY KEY (lote_id, clave);


--
-- Name: mef_entity_budget mef_entity_budget_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mef_entity_budget
    ADD CONSTRAINT mef_entity_budget_pkey PRIMARY KEY (entidad_ruc);


--
-- Name: mef_region_budget mef_region_budget_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mef_region_budget
    ADD CONSTRAINT mef_region_budget_pkey PRIMARY KEY (departamento);


--
-- Name: network_expansions network_expansions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.network_expansions
    ADD CONSTRAINT network_expansions_pkey PRIMARY KEY (id);


--
-- Name: ofertas ofertas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ofertas
    ADD CONSTRAINT ofertas_pkey PRIMARY KEY (id);


--
-- Name: ofertas ofertas_postor_id_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ofertas
    ADD CONSTRAINT ofertas_postor_id_item_id_key UNIQUE (postor_id, item_id);


--
-- Name: onpe_aportantes onpe_aportantes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onpe_aportantes
    ADD CONSTRAINT onpe_aportantes_pkey PRIMARY KEY (id);


--
-- Name: onpe_candidatos onpe_candidatos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onpe_candidatos
    ADD CONSTRAINT onpe_candidatos_pkey PRIMARY KEY (id);


--
-- Name: opiniones_oece_estructurado opiniones_oece_estructurado_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opiniones_oece_estructurado
    ADD CONSTRAINT opiniones_oece_estructurado_pkey PRIMARY KEY (id);


--
-- Name: opiniones_oece opiniones_oece_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opiniones_oece
    ADD CONSTRAINT opiniones_oece_pkey PRIMARY KEY (numero);


--
-- Name: osce_sancionados osce_sancionados_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.osce_sancionados
    ADD CONSTRAINT osce_sancionados_pkey PRIMARY KEY (id);


--
-- Name: pedidos_descarga pedidos_descarga_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedidos_descarga
    ADD CONSTRAINT pedidos_descarga_pkey PRIMARY KEY (id);


--
-- Name: penalidades penalidades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.penalidades
    ADD CONSTRAINT penalidades_pkey PRIMARY KEY (id);


--
-- Name: peps peps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.peps
    ADD CONSTRAINT peps_pkey PRIMARY KEY (id);


--
-- Name: persona_flags persona_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona_flags
    ADD CONSTRAINT persona_flags_pkey PRIMARY KEY (id);


--
-- Name: personas personas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personas
    ADD CONSTRAINT personas_pkey PRIMARY KEY (dni);


--
-- Name: postores postores_ocid_empresa_ruc_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postores
    ADD CONSTRAINT postores_ocid_empresa_ruc_key UNIQUE (ocid, empresa_ruc);


--
-- Name: postores postores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postores
    ADD CONSTRAINT postores_pkey PRIMARY KEY (id);


--
-- Name: procesamientos procesamientos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procesamientos
    ADD CONSTRAINT procesamientos_pkey PRIMARY KEY (ocid);


--
-- Name: reportes_indexados reportes_indexados_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_indexados
    ADD CONSTRAINT reportes_indexados_pkey PRIMARY KEY (id);


--
-- Name: rnp_conformacion_juridica rnp_conformacion_juridica_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rnp_conformacion_juridica
    ADD CONSTRAINT rnp_conformacion_juridica_pkey PRIMARY KEY (id);


--
-- Name: tarifas tarifas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tarifas
    ADD CONSTRAINT tarifas_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (firebase_uid);


--
-- Name: visitas_entidades visitas_entidades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitas_entidades
    ADD CONSTRAINT visitas_entidades_pkey PRIMARY KEY (id);


--
-- Name: zonas zonas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zonas
    ADD CONSTRAINT zonas_pkey PRIMARY KEY (ubigeo);


--
-- Name: admin_log_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_log_created_idx ON public.admin_log USING btree (created_at DESC);


--
-- Name: admin_log_objeto_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_log_objeto_idx ON public.admin_log USING btree (objeto);


--
-- Name: alertas_ocid_corto_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX alertas_ocid_corto_idx ON public.alertas USING btree (public.ocid_corto(ocid));


--
-- Name: alertas_ocid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX alertas_ocid_idx ON public.alertas USING btree (ocid);


--
-- Name: asignaciones_alerta_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asignaciones_alerta_idx ON public.asignaciones USING btree (alerta_id);


--
-- Name: asignaciones_contrib_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asignaciones_contrib_idx ON public.asignaciones USING btree (contribucion_id);


--
-- Name: bandera_revision_alerta_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bandera_revision_alerta_idx ON public.bandera_revision USING btree (alerta_id);


--
-- Name: bandera_revision_bandera_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bandera_revision_bandera_idx ON public.bandera_revision USING btree (bandera_id);


--
-- Name: banderas_alerta_regla_evidencia_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX banderas_alerta_regla_evidencia_uniq ON public.banderas USING btree (alerta_id, regla, md5(COALESCE(evidencia, ''::text)));


--
-- Name: INDEX banderas_alerta_regla_evidencia_uniq; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.banderas_alerta_regla_evidencia_uniq IS 'Una bandera por (alerta, regla, evidencia). Las inserciones usan ON CONFLICT DO NOTHING (migración 27).';


--
-- Name: contrato_estado_entidad_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contrato_estado_entidad_idx ON public.contrato_estado USING btree (entidad_ruc);


--
-- Name: contrato_estado_estado_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contrato_estado_estado_idx ON public.contrato_estado USING btree (estado_proc) WHERE (estado_proc <> 'sin_analizar'::text);


--
-- Name: contrato_estado_keyset_score_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contrato_estado_keyset_score_idx ON public.contrato_estado USING btree (COALESCE(score, '-1'::integer) DESC, COALESCE(fecha_convocatoria, '-infinity'::date) DESC, created_at DESC, ocid DESC);


--
-- Name: contrato_estado_operativo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contrato_estado_operativo_idx ON public.contrato_estado USING btree (operativo) WHERE (operativo <> 'sin_documentos'::text);


--
-- Name: contrato_estado_riesgo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contrato_estado_riesgo_idx ON public.contrato_estado USING btree (riesgo) WHERE (riesgo <> 'sin_analizar'::text);


--
-- Name: contrato_estado_tipo_fecha_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contrato_estado_tipo_fecha_idx ON public.contrato_estado USING btree (tipo, COALESCE(fecha_convocatoria, '-infinity'::date) DESC, created_at DESC, ocid DESC);


--
-- Name: contratos_agregado_ubigeo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contratos_agregado_ubigeo_idx ON public.contratos_agregado USING btree (ubigeo text_pattern_ops);


--
-- Name: contratos_agregado_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX contratos_agregado_uidx ON public.contratos_agregado USING btree (ubigeo, tipo, etapa, mes, riesgo, estado_proc, operativo) NULLS NOT DISTINCT;


--
-- Name: contribuciones_entidad_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contribuciones_entidad_idx ON public.contribuciones USING btree (entidad_ruc, estado) WHERE (entidad_ruc IS NOT NULL);


--
-- Name: contribuciones_financiador_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contribuciones_financiador_idx ON public.contribuciones USING btree (financiador_id);


--
-- Name: contribuciones_partido_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contribuciones_partido_idx ON public.contribuciones USING btree (partido_clave, partido_anio, estado) WHERE (partido_clave IS NOT NULL);


--
-- Name: contribuciones_zona_estado_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contribuciones_zona_estado_idx ON public.contribuciones USING btree (ubigeo, estado);


--
-- Name: convocatorias_codigo_prefijo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX convocatorias_codigo_prefijo_idx ON public.convocatorias USING btree (upper(codigo) text_pattern_ops);


--
-- Name: convocatorias_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX convocatorias_created_idx ON public.convocatorias USING btree (created_at);


--
-- Name: convocatorias_fecha_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX convocatorias_fecha_idx ON public.convocatorias USING btree (fecha_convocatoria DESC);


--
-- Name: convocatorias_keyset_fecha_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX convocatorias_keyset_fecha_idx ON public.convocatorias USING btree (COALESCE(fecha_convocatoria, '-infinity'::date) DESC, created_at DESC, ocid DESC);


--
-- Name: convocatorias_keyset_monto_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX convocatorias_keyset_monto_idx ON public.convocatorias USING btree (cuantia_referencial DESC NULLS LAST, ocid DESC);


--
-- Name: convocatorias_ocid_corto_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX convocatorias_ocid_corto_idx ON public.convocatorias USING btree (public.ocid_corto(ocid));


--
-- Name: convocatorias_ocid_corto_prefijo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX convocatorias_ocid_corto_prefijo_idx ON public.convocatorias USING btree (public.ocid_corto(ocid) text_pattern_ops);


--
-- Name: convocatorias_procesable_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX convocatorias_procesable_idx ON public.convocatorias USING btree (procesable);


--
-- Name: convocatorias_proveedor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX convocatorias_proveedor_idx ON public.convocatorias USING btree (proveedor_ruc) WHERE (proveedor_ruc IS NOT NULL);


--
-- Name: convocatorias_tipo_etapa_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX convocatorias_tipo_etapa_idx ON public.convocatorias USING btree (tipo_contratacion, etapa);


--
-- Name: convocatorias_ubigeo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX convocatorias_ubigeo_idx ON public.convocatorias USING btree (ubigeo);


--
-- Name: convocatorias_ubigeo_zona_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX convocatorias_ubigeo_zona_idx ON public.convocatorias USING btree (ubigeo_zona text_pattern_ops);


--
-- Name: datasets_cargas_fuente_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX datasets_cargas_fuente_idx ON public.datasets_cargas USING btree (fuente, cargado_at DESC);


--
-- Name: dji_empleos_codigo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dji_empleos_codigo_idx ON public.dji_empleos USING btree (codigo_ddjj);


--
-- Name: dji_empleos_ruc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dji_empleos_ruc_idx ON public.dji_empleos USING btree (ruc_entidad);


--
-- Name: dji_funcionarios_codigo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dji_funcionarios_codigo_idx ON public.dji_funcionarios USING btree (codigo_ddjj);


--
-- Name: dji_funcionarios_entidad_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dji_funcionarios_entidad_idx ON public.dji_funcionarios USING btree (upper(entidad));


--
-- Name: dji_funcionarios_nombre_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dji_funcionarios_nombre_trgm ON public.dji_funcionarios USING gin (nombre_norm public.gin_trgm_ops);


--
-- Name: documentos_gcs_expira_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documentos_gcs_expira_idx ON public.documentos_gcs USING btree (expira_at) WHERE (borrado_at IS NULL);


--
-- Name: documentos_gcs_ocid_corto_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documentos_gcs_ocid_corto_idx ON public.documentos_gcs USING btree (public.ocid_corto(ocid)) WHERE (borrado_at IS NULL);


--
-- Name: documentos_gcs_tipo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documentos_gcs_tipo_idx ON public.documentos_gcs USING btree (tipo);


--
-- Name: documentos_gcs_vigentes_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documentos_gcs_vigentes_idx ON public.documentos_gcs USING btree (ocid, expira_at) WHERE (borrado_at IS NULL);


--
-- Name: documentos_ocid_blob_url_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX documentos_ocid_blob_url_idx ON public.documentos USING btree (ocid, blob_url);


--
-- Name: documentos_texto_ocid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documentos_texto_ocid_idx ON public.documentos_texto USING btree (ocid);


--
-- Name: entidad_stats_alertas_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX entidad_stats_alertas_idx ON public.entidad_stats USING btree (alertas_activas DESC, nombre, ruc);


--
-- Name: entidad_stats_contratos_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX entidad_stats_contratos_idx ON public.entidad_stats USING btree (contratos DESC, nombre, ruc);


--
-- Name: entidad_stats_nombre_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX entidad_stats_nombre_trgm ON public.entidad_stats USING gin (nombre_norm public.gin_trgm_ops);


--
-- Name: entidad_stats_ruc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX entidad_stats_ruc_idx ON public.entidad_stats USING btree (ruc);


--
-- Name: financiadores_ruc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX financiadores_ruc_idx ON public.financiadores USING btree (ruc);


--
-- Name: gobierno_periodo_fechas_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gobierno_periodo_fechas_idx ON public.gobierno_periodo USING btree (nivel, ubigeo, desde, hasta);


--
-- Name: gobierno_periodo_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gobierno_periodo_org_idx ON public.gobierno_periodo USING btree (org_clave, anio_eleccion);


--
-- Name: idx_alertas_codigo_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alertas_codigo_conv ON public.alertas USING btree (codigo_convocatoria);


--
-- Name: idx_alertas_entidad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alertas_entidad ON public.alertas USING btree (entidad_ruc);


--
-- Name: idx_alertas_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alertas_estado ON public.alertas USING btree (estado);


--
-- Name: idx_alertas_estado_revision; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alertas_estado_revision ON public.alertas USING btree (analizado_en DESC) WHERE (estado = 'revision'::text);


--
-- Name: idx_alertas_geo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alertas_geo ON public.alertas USING gist (ubicacion_geo);


--
-- Name: idx_alertas_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alertas_region ON public.alertas USING btree (region);


--
-- Name: idx_alertas_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alertas_score ON public.alertas USING btree (score DESC);


--
-- Name: idx_audit_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_date ON public.audit_log USING btree (created_at DESC);


--
-- Name: idx_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_entity ON public.audit_log USING btree (entity_type, entity_id);


--
-- Name: idx_audit_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_user ON public.audit_log USING btree (user_id);


--
-- Name: idx_banderas_alerta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_banderas_alerta ON public.banderas USING btree (alerta_id);


--
-- Name: idx_banderas_regla; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_banderas_regla ON public.banderas USING btree (regla);


--
-- Name: idx_banderas_severidad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_banderas_severidad ON public.banderas USING btree (severidad);


--
-- Name: idx_conv_busqueda; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_busqueda ON public.convocatorias USING gin (texto_busqueda);


--
-- Name: idx_conv_codigo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_codigo ON public.convocatorias USING btree (codigo);


--
-- Name: idx_conv_entidad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_entidad ON public.convocatorias USING btree (entidad_ruc);


--
-- Name: idx_converg_alerta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_converg_alerta ON public.convergencias USING btree (alerta_id);


--
-- Name: idx_converg_geo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_converg_geo ON public.convergencias USING gist (ubicacion_geo);


--
-- Name: idx_docs_alerta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_docs_alerta ON public.documentos USING btree (alerta_id);


--
-- Name: idx_docs_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_docs_tipo ON public.documentos USING btree (tipo);


--
-- Name: idx_emppers_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emppers_persona ON public.empresa_personas USING btree (persona_dni);


--
-- Name: idx_empresas_alta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_empresas_alta ON public.empresas USING btree (fecha_alta_ruc);


--
-- Name: idx_empresas_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_empresas_estado ON public.empresas USING btree (estado_sunat);


--
-- Name: idx_entidades_geo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entidades_geo ON public.entidades USING gist (ubicacion_geo);


--
-- Name: idx_entidades_nombre_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entidades_nombre_trgm ON public.entidades USING gin (public.immutable_unaccent(lower(nombre)) public.gin_trgm_ops);


--
-- Name: idx_entidades_pliego; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entidades_pliego ON public.entidades USING btree (pliego_nombre_mef);


--
-- Name: idx_entidades_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entidades_region ON public.entidades USING btree (region);


--
-- Name: idx_items_cubso; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_items_cubso ON public.convocatoria_items USING btree (cubso);


--
-- Name: idx_jne_año; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_jne_año" ON public.jne_candidaturas USING btree ("año" DESC);


--
-- Name: idx_jne_documento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jne_documento ON public.jne_candidaturas USING btree (numero_documento);


--
-- Name: idx_jne_nombre_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jne_nombre_trgm ON public.jne_candidaturas USING gin (nombre public.gin_trgm_ops);


--
-- Name: idx_jne_nombre_upper; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jne_nombre_upper ON public.jne_candidaturas USING btree (upper(nombre));


--
-- Name: idx_jne_partido; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jne_partido ON public.jne_candidaturas USING btree (partido);


--
-- Name: idx_jne_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jne_region ON public.jne_candidaturas USING btree (region);


--
-- Name: idx_netexp_alerta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_netexp_alerta ON public.network_expansions USING btree (alerta_id);


--
-- Name: idx_ofertas_ganadora; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ofertas_ganadora ON public.ofertas USING btree (ganadora) WHERE (ganadora = true);


--
-- Name: idx_ofertas_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ofertas_item ON public.ofertas USING btree (item_id);


--
-- Name: idx_onpe_apt_año; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_onpe_apt_año" ON public.onpe_aportantes USING btree ("año" DESC);


--
-- Name: idx_onpe_apt_documento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_onpe_apt_documento ON public.onpe_aportantes USING btree (numero_documento);


--
-- Name: idx_onpe_apt_nombre_upper; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_onpe_apt_nombre_upper ON public.onpe_aportantes USING btree (upper(nombre));


--
-- Name: idx_onpe_apt_partido; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_onpe_apt_partido ON public.onpe_aportantes USING btree (partido);


--
-- Name: idx_onpe_nombre_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_onpe_nombre_trgm ON public.onpe_aportantes USING gin (nombre public.gin_trgm_ops);


--
-- Name: idx_opin_ano; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opin_ano ON public.opiniones_oece_estructurado USING btree (ano DESC);


--
-- Name: idx_opin_art_ley; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opin_art_ley ON public.opiniones_oece_estructurado USING btree (articulo_ley);


--
-- Name: idx_opin_art_reglamento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opin_art_reglamento ON public.opiniones_oece_estructurado USING btree (articulo_reglamento);


--
-- Name: idx_opin_norma; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opin_norma ON public.opiniones_oece_estructurado USING btree (norma);


--
-- Name: idx_opin_num_opinion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opin_num_opinion ON public.opiniones_oece_estructurado USING btree (num_opinion);


--
-- Name: idx_opiniones_emb; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opiniones_emb ON public.opiniones_oece USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='50');


--
-- Name: idx_opiniones_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opiniones_fts ON public.opiniones_oece USING gin (texto_busqueda);


--
-- Name: idx_penalidades_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_penalidades_empresa ON public.penalidades USING btree (empresa_ruc);


--
-- Name: idx_penalidades_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_penalidades_fecha ON public.penalidades USING btree (fecha DESC);


--
-- Name: idx_peps_documento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_peps_documento ON public.peps USING btree (numero_documento);


--
-- Name: idx_peps_nombre_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_peps_nombre_trgm ON public.peps USING gin (nombre_norm public.gin_trgm_ops);


--
-- Name: idx_pflags_alerta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pflags_alerta ON public.persona_flags USING btree (alerta_id);


--
-- Name: idx_pflags_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pflags_persona ON public.persona_flags USING btree (persona_dni);


--
-- Name: idx_postores_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_postores_empresa ON public.postores USING btree (empresa_ruc);


--
-- Name: idx_reportes_categ; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reportes_categ ON public.reportes_indexados USING btree (categoria);


--
-- Name: idx_reportes_geo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reportes_geo ON public.reportes_indexados USING gist (ubicacion_geo);


--
-- Name: idx_reportes_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reportes_region ON public.reportes_indexados USING btree (region);


--
-- Name: idx_rnp_nombre; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rnp_nombre ON public.rnp_conformacion_juridica USING btree (nombre);


--
-- Name: idx_rnp_nombre_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rnp_nombre_trgm ON public.rnp_conformacion_juridica USING gin (nombre public.gin_trgm_ops);


--
-- Name: idx_rnp_pe; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rnp_pe ON public.rnp_conformacion_juridica USING btree (numero_documento, ruc_empresa);


--
-- Name: idx_rnp_ruc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rnp_ruc ON public.rnp_conformacion_juridica USING btree (ruc_empresa);


--
-- Name: idx_sanc_estado_vigente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sanc_estado_vigente ON public.osce_sancionados USING btree (estado, fecha_hasta);


--
-- Name: idx_sanc_persona_natural; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sanc_persona_natural ON public.osce_sancionados USING btree (es_persona_natural);


--
-- Name: idx_sanc_razon_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sanc_razon_norm ON public.osce_sancionados USING btree (razon_social_norm);


--
-- Name: idx_sanc_razon_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sanc_razon_trgm ON public.osce_sancionados USING gin (razon_social_norm public.gin_trgm_ops);


--
-- Name: idx_sanc_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sanc_tipo ON public.osce_sancionados USING btree (tipo);


--
-- Name: idx_visitas_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visitas_fecha ON public.visitas_entidades USING btree (fecha_visita DESC);


--
-- Name: idx_visitas_funcionario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visitas_funcionario ON public.visitas_entidades USING btree (funcionario_nombre);


--
-- Name: idx_visitas_tipo_ent_priv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visitas_tipo_ent_priv ON public.visitas_entidades USING btree (tipo_entidad_visitante) WHERE (tipo_entidad_visitante = 'privada'::text);


--
-- Name: idx_visitas_visitante_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visitas_visitante_norm ON public.visitas_entidades USING btree (visitante_norm);


--
-- Name: idx_visitas_visitante_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visitas_visitante_trgm ON public.visitas_entidades USING gin (visitante_norm public.gin_trgm_ops);


--
-- Name: jne_aut_dni_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jne_aut_dni_idx ON public.jne_autoridades USING btree (dni);


--
-- Name: jne_aut_nombre_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jne_aut_nombre_trgm ON public.jne_autoridades USING gin (nombre_norm public.gin_trgm_ops);


--
-- Name: jne_aut_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jne_aut_org_idx ON public.jne_autoridades USING btree (organizacion_politica);


--
-- Name: jne_aut_ubigeo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jne_aut_ubigeo_idx ON public.jne_autoridades USING btree (ubigeo);


--
-- Name: jne_aut_ubigeo_jne_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jne_aut_ubigeo_jne_idx ON public.jne_autoridades USING btree (ubigeo_jne);


--
-- Name: jne_aut_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX jne_aut_uq ON public.jne_autoridades USING btree (proceso, cargo, nombre_norm, COALESCE(ubigeo, ''::text));


--
-- Name: jne_aut_vigente_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jne_aut_vigente_idx ON public.jne_autoridades USING btree (periodo_inicio, periodo_fin);


--
-- Name: lotes_ingesta_estado_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lotes_ingesta_estado_idx ON public.lotes_ingesta USING btree (estado, creado_at DESC);


--
-- Name: lotes_items_estado_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lotes_items_estado_idx ON public.lotes_items USING btree (lote_id, estado);


--
-- Name: onpe_apt_clave_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX onpe_apt_clave_uq ON public.onpe_aportantes USING btree (aporte_clave) WHERE (aporte_clave IS NOT NULL);


--
-- Name: onpe_apt_proceso_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onpe_apt_proceso_idx ON public.onpe_aportantes USING btree (proceso);


--
-- Name: onpe_apt_ruc_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onpe_apt_ruc_org_idx ON public.onpe_aportantes USING btree (ruc_organizacion);


--
-- Name: onpe_cand_dni_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onpe_cand_dni_idx ON public.onpe_candidatos USING btree (dni);


--
-- Name: onpe_cand_nombre_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onpe_cand_nombre_trgm ON public.onpe_candidatos USING gin (nombre_norm public.gin_trgm_ops);


--
-- Name: onpe_cand_proceso_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onpe_cand_proceso_idx ON public.onpe_candidatos USING btree (proceso);


--
-- Name: onpe_cand_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX onpe_cand_uq ON public.onpe_candidatos USING btree (COALESCE(dni, ''::text), nombre_norm, COALESCE(organizacion, ''::text), COALESCE(proceso, ''::text));


--
-- Name: osce_sancionados_ruc_res_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX osce_sancionados_ruc_res_uq ON public.osce_sancionados USING btree (ruc, resolucion);


--
-- Name: pedidos_descarga_abierto_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pedidos_descarga_abierto_idx ON public.pedidos_descarga USING btree (public.ocid_corto(ocid)) WHERE (estado = ANY (ARRAY['pendiente'::text, 'descargando'::text]));


--
-- Name: pedidos_descarga_estado_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pedidos_descarga_estado_idx ON public.pedidos_descarga USING btree (estado, solicitado_at);


--
-- Name: procesamientos_contrib_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX procesamientos_contrib_idx ON public.procesamientos USING btree (contribucion_id);


--
-- Name: procesamientos_estado_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX procesamientos_estado_idx ON public.procesamientos USING btree (estado, encolado_at);


--
-- Name: procesamientos_ocid_corto_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX procesamientos_ocid_corto_idx ON public.procesamientos USING btree (public.ocid_corto(ocid));


--
-- Name: ranking_impacto_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ranking_impacto_id_idx ON public.ranking_impacto USING btree (financiador_id);


--
-- Name: reportes_fecha_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reportes_fecha_created_idx ON public.reportes_indexados USING btree (fecha DESC, created_at DESC);


--
-- Name: reportes_indexados_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reportes_indexados_user_idx ON public.reportes_indexados USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: usuarios_entidades_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usuarios_entidades_idx ON public.usuarios USING gin (entidades_seguidas);


--
-- Name: usuarios_financiador_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usuarios_financiador_idx ON public.usuarios USING btree (financiador_id);


--
-- Name: usuarios_zonas_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usuarios_zonas_idx ON public.usuarios USING gin (zonas_seguidas);


--
-- Name: visitas_doc_fecha_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visitas_doc_fecha_idx ON public.visitas_entidades USING btree (numero_documento, fecha_visita);


--
-- Name: visitas_ent_visitante_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visitas_ent_visitante_idx ON public.visitas_entidades USING btree (upper(entidad_visitante)) WHERE (entidad_visitante IS NOT NULL);


--
-- Name: visitas_entidad_fecha_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visitas_entidad_fecha_idx ON public.visitas_entidades USING btree (entidad_visitada_norm, fecha_visita);


--
-- Name: visitas_periodo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visitas_periodo_idx ON public.visitas_entidades USING btree (periodo);


--
-- Name: zona_estado_nivel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX zona_estado_nivel_idx ON public.zona_estado USING btree (nivel);


--
-- Name: zona_estado_padre_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX zona_estado_padre_idx ON public.zona_estado USING btree (padre_ubigeo);


--
-- Name: zona_estado_ubigeo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX zona_estado_ubigeo_idx ON public.zona_estado USING btree (ubigeo);


--
-- Name: zonas_nivel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX zonas_nivel_idx ON public.zonas USING btree (nivel);


--
-- Name: zonas_padre_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX zonas_padre_idx ON public.zonas USING btree (padre_ubigeo);


--
-- Name: alertas trg_alertas_cerrar_procesamiento; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_alertas_cerrar_procesamiento AFTER INSERT ON public.alertas FOR EACH ROW EXECUTE FUNCTION public.cerrar_procesamiento_por_alerta();


--
-- Name: asignaciones trg_asignaciones_encolar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_asignaciones_encolar AFTER INSERT ON public.asignaciones FOR EACH ROW EXECUTE FUNCTION public.encolar_procesamiento();


--
-- Name: ajustes trg_contrato_estado_ajustes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_contrato_estado_ajustes AFTER INSERT OR UPDATE ON public.ajustes FOR EACH ROW WHEN ((new.clave = 'procesamiento'::text)) EXECUTE FUNCTION public.contrato_estado_ajustes_trg();


--
-- Name: ajustes trg_contrato_estado_ajustes_del; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_contrato_estado_ajustes_del AFTER DELETE ON public.ajustes FOR EACH ROW WHEN ((old.clave = 'procesamiento'::text)) EXECUTE FUNCTION public.contrato_estado_ajustes_trg();


--
-- Name: alertas trg_contrato_estado_alertas; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_contrato_estado_alertas AFTER INSERT OR DELETE ON public.alertas FOR EACH ROW EXECUTE FUNCTION public.contrato_estado_alertas_trg();


--
-- Name: alertas trg_contrato_estado_alertas_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_contrato_estado_alertas_upd AFTER UPDATE OF ocid, codigo, estado, score, analizado_en, created_at ON public.alertas FOR EACH ROW WHEN (((old.ocid IS DISTINCT FROM new.ocid) OR (old.codigo IS DISTINCT FROM new.codigo) OR (old.estado IS DISTINCT FROM new.estado) OR (old.score IS DISTINCT FROM new.score) OR (old.analizado_en IS DISTINCT FROM new.analizado_en) OR (old.created_at IS DISTINCT FROM new.created_at))) EXECUTE FUNCTION public.contrato_estado_alertas_trg();


--
-- Name: convocatorias trg_contrato_estado_conv_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_contrato_estado_conv_ins AFTER INSERT ON public.convocatorias REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.contrato_estado_convocatorias_trg();


--
-- Name: convocatorias trg_contrato_estado_conv_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_contrato_estado_conv_upd AFTER UPDATE ON public.convocatorias REFERENCING OLD TABLE AS viejas NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.contrato_estado_convocatorias_trg();


--
-- Name: documentos_gcs trg_contrato_estado_docs_del; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_contrato_estado_docs_del AFTER DELETE ON public.documentos_gcs REFERENCING OLD TABLE AS viejas FOR EACH STATEMENT EXECUTE FUNCTION public.contrato_estado_documentos_trg();


--
-- Name: documentos_gcs trg_contrato_estado_docs_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_contrato_estado_docs_ins AFTER INSERT ON public.documentos_gcs REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.contrato_estado_documentos_trg();


--
-- Name: documentos_gcs trg_contrato_estado_docs_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_contrato_estado_docs_upd AFTER UPDATE ON public.documentos_gcs REFERENCING OLD TABLE AS viejas NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.contrato_estado_documentos_trg();


--
-- Name: procesamientos trg_contrato_estado_proc; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_contrato_estado_proc AFTER INSERT OR DELETE ON public.procesamientos FOR EACH ROW EXECUTE FUNCTION public.contrato_estado_procesamientos_trg();


--
-- Name: procesamientos trg_contrato_estado_proc_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_contrato_estado_proc_upd AFTER UPDATE OF estado, ocid ON public.procesamientos FOR EACH ROW WHEN (((old.estado IS DISTINCT FROM new.estado) OR (old.ocid IS DISTINCT FROM new.ocid))) EXECUTE FUNCTION public.contrato_estado_procesamientos_trg();


--
-- Name: convocatorias trg_convocatorias_ubigeo_zona; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_convocatorias_ubigeo_zona BEFORE INSERT OR UPDATE OF ubigeo, region, entidad_ruc, ubigeo_zona ON public.convocatorias FOR EACH ROW EXECUTE FUNCTION public.convocatorias_ubigeo_zona_trg();


--
-- Name: ajustes trg_derivados_ajustes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_ajustes AFTER INSERT OR UPDATE ON public.ajustes FOR EACH ROW WHEN ((new.clave = 'procesamiento'::text)) EXECUTE FUNCTION public.marcar_derivados('financiamiento');


--
-- Name: ajustes trg_derivados_ajustes_del; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_ajustes_del AFTER DELETE ON public.ajustes FOR EACH ROW WHEN ((old.clave = 'procesamiento'::text)) EXECUTE FUNCTION public.marcar_derivados('financiamiento');


--
-- Name: alertas trg_derivados_alertas_del; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_alertas_del AFTER DELETE ON public.alertas REFERENCING OLD TABLE AS viejas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('financiamiento', 'contratos');


--
-- Name: alertas trg_derivados_alertas_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_alertas_ins AFTER INSERT ON public.alertas REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('financiamiento', 'contratos');


--
-- Name: alertas trg_derivados_alertas_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_alertas_upd AFTER UPDATE ON public.alertas REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('financiamiento', 'contratos');


--
-- Name: asignaciones trg_derivados_asignaciones_del; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_asignaciones_del AFTER DELETE ON public.asignaciones REFERENCING OLD TABLE AS viejas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('financiamiento');


--
-- Name: asignaciones trg_derivados_asignaciones_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_asignaciones_ins AFTER INSERT ON public.asignaciones REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('financiamiento');


--
-- Name: asignaciones trg_derivados_asignaciones_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_asignaciones_upd AFTER UPDATE ON public.asignaciones REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('financiamiento');


--
-- Name: banderas trg_derivados_banderas_del; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_banderas_del AFTER DELETE ON public.banderas REFERENCING OLD TABLE AS viejas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('financiamiento');


--
-- Name: banderas trg_derivados_banderas_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_banderas_ins AFTER INSERT ON public.banderas REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('financiamiento');


--
-- Name: banderas trg_derivados_banderas_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_banderas_upd AFTER UPDATE ON public.banderas REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('financiamiento');


--
-- Name: contrato_estado trg_derivados_contrato_estado_del; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_contrato_estado_del AFTER DELETE ON public.contrato_estado REFERENCING OLD TABLE AS viejas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('contratos');


--
-- Name: contrato_estado trg_derivados_contrato_estado_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_contrato_estado_ins AFTER INSERT ON public.contrato_estado REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('contratos');


--
-- Name: contrato_estado trg_derivados_contrato_estado_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_contrato_estado_upd AFTER UPDATE ON public.contrato_estado REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('contratos');


--
-- Name: contribuciones trg_derivados_contribuciones_del; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_contribuciones_del AFTER DELETE ON public.contribuciones REFERENCING OLD TABLE AS viejas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('financiamiento');


--
-- Name: contribuciones trg_derivados_contribuciones_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_contribuciones_ins AFTER INSERT ON public.contribuciones REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('financiamiento');


--
-- Name: contribuciones trg_derivados_contribuciones_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_contribuciones_upd AFTER UPDATE ON public.contribuciones REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('financiamiento');


--
-- Name: convocatorias trg_derivados_convocatorias; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_convocatorias AFTER INSERT OR DELETE OR UPDATE ON public.convocatorias FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados('financiamiento');


--
-- Name: documentos_gcs trg_derivados_documentos_gcs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_documentos_gcs AFTER INSERT OR DELETE OR UPDATE ON public.documentos_gcs FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados('financiamiento');


--
-- Name: entidades trg_derivados_entidades_del; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_entidades_del AFTER DELETE ON public.entidades REFERENCING OLD TABLE AS viejas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('contratos');


--
-- Name: entidades trg_derivados_entidades_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_entidades_ins AFTER INSERT ON public.entidades REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('contratos');


--
-- Name: entidades trg_derivados_entidades_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_entidades_upd AFTER UPDATE ON public.entidades REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('contratos');


--
-- Name: financiadores trg_derivados_financiadores_del; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_financiadores_del AFTER DELETE ON public.financiadores REFERENCING OLD TABLE AS viejas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('financiamiento');


--
-- Name: financiadores trg_derivados_financiadores_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_financiadores_ins AFTER INSERT ON public.financiadores REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('financiamiento');


--
-- Name: financiadores trg_derivados_financiadores_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_financiadores_upd AFTER UPDATE ON public.financiadores REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('financiamiento');


--
-- Name: tarifas trg_derivados_tarifas_del; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_tarifas_del AFTER DELETE ON public.tarifas REFERENCING OLD TABLE AS viejas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('financiamiento');


--
-- Name: tarifas trg_derivados_tarifas_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_tarifas_ins AFTER INSERT ON public.tarifas REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('financiamiento');


--
-- Name: tarifas trg_derivados_tarifas_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_tarifas_upd AFTER UPDATE ON public.tarifas REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('financiamiento');


--
-- Name: zonas trg_derivados_zonas_del; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_zonas_del AFTER DELETE ON public.zonas REFERENCING OLD TABLE AS viejas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('financiamiento');


--
-- Name: zonas trg_derivados_zonas_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_zonas_ins AFTER INSERT ON public.zonas REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('financiamiento');


--
-- Name: zonas trg_derivados_zonas_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_derivados_zonas_upd AFTER UPDATE ON public.zonas REFERENCING NEW TABLE AS nuevas FOR EACH STATEMENT EXECUTE FUNCTION public.marcar_derivados_si_filas('financiamiento');


--
-- Name: entidades trg_entidades_ubigeo_zona; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_entidades_ubigeo_zona AFTER UPDATE OF ubigeo, region, provincia ON public.entidades FOR EACH ROW WHEN (((old.ubigeo IS DISTINCT FROM new.ubigeo) OR (old.region IS DISTINCT FROM new.region) OR (old.provincia IS DISTINCT FROM new.provincia))) EXECUTE FUNCTION public.entidades_ubigeo_zona_trg();


--
-- Name: zonas trg_zonas_ubigeo_zona; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_zonas_ubigeo_zona AFTER INSERT OR DELETE OR UPDATE ON public.zonas FOR EACH STATEMENT EXECUTE FUNCTION public.zonas_ubigeo_zona_trg();


--
-- Name: alertas alertas_entidad_ruc_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alertas
    ADD CONSTRAINT alertas_entidad_ruc_fkey FOREIGN KEY (entidad_ruc) REFERENCES public.entidades(ruc);


--
-- Name: alertas alertas_ocid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alertas
    ADD CONSTRAINT alertas_ocid_fkey FOREIGN KEY (ocid) REFERENCES public.convocatorias(ocid);


--
-- Name: alertas alertas_proveedor_ruc_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alertas
    ADD CONSTRAINT alertas_proveedor_ruc_fkey FOREIGN KEY (proveedor_ruc) REFERENCES public.empresas(ruc);


--
-- Name: asignaciones asignaciones_alerta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asignaciones
    ADD CONSTRAINT asignaciones_alerta_id_fkey FOREIGN KEY (alerta_id) REFERENCES public.alertas(id);


--
-- Name: asignaciones asignaciones_contribucion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asignaciones
    ADD CONSTRAINT asignaciones_contribucion_id_fkey FOREIGN KEY (contribucion_id) REFERENCES public.contribuciones(id);


--
-- Name: asignaciones asignaciones_ocid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asignaciones
    ADD CONSTRAINT asignaciones_ocid_fkey FOREIGN KEY (ocid) REFERENCES public.convocatorias(ocid);


--
-- Name: bandera_revision bandera_revision_alerta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandera_revision
    ADD CONSTRAINT bandera_revision_alerta_id_fkey FOREIGN KEY (alerta_id) REFERENCES public.alertas(id) ON DELETE CASCADE;


--
-- Name: bandera_revision bandera_revision_bandera_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bandera_revision
    ADD CONSTRAINT bandera_revision_bandera_id_fkey FOREIGN KEY (bandera_id) REFERENCES public.banderas(id) ON DELETE CASCADE;


--
-- Name: banderas banderas_alerta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banderas
    ADD CONSTRAINT banderas_alerta_id_fkey FOREIGN KEY (alerta_id) REFERENCES public.alertas(id) ON DELETE CASCADE;


--
-- Name: contrato_estado contrato_estado_ocid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contrato_estado
    ADD CONSTRAINT contrato_estado_ocid_fkey FOREIGN KEY (ocid) REFERENCES public.convocatorias(ocid) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: contribuciones contribuciones_entidad_ruc_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contribuciones
    ADD CONSTRAINT contribuciones_entidad_ruc_fkey FOREIGN KEY (entidad_ruc) REFERENCES public.entidades(ruc);


--
-- Name: contribuciones contribuciones_financiador_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contribuciones
    ADD CONSTRAINT contribuciones_financiador_id_fkey FOREIGN KEY (financiador_id) REFERENCES public.financiadores(id);


--
-- Name: contribuciones contribuciones_tarifa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contribuciones
    ADD CONSTRAINT contribuciones_tarifa_id_fkey FOREIGN KEY (tarifa_id) REFERENCES public.tarifas(id);


--
-- Name: contribuciones contribuciones_ubigeo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contribuciones
    ADD CONSTRAINT contribuciones_ubigeo_fkey FOREIGN KEY (ubigeo) REFERENCES public.zonas(ubigeo);


--
-- Name: convergencias convergencias_alerta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.convergencias
    ADD CONSTRAINT convergencias_alerta_id_fkey FOREIGN KEY (alerta_id) REFERENCES public.alertas(id) ON DELETE CASCADE;


--
-- Name: convocatoria_items convocatoria_items_ocid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.convocatoria_items
    ADD CONSTRAINT convocatoria_items_ocid_fkey FOREIGN KEY (ocid) REFERENCES public.convocatorias(ocid) ON DELETE CASCADE;


--
-- Name: convocatorias convocatorias_entidad_ruc_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.convocatorias
    ADD CONSTRAINT convocatorias_entidad_ruc_fkey FOREIGN KEY (entidad_ruc) REFERENCES public.entidades(ruc);


--
-- Name: convocatorias convocatorias_ubigeo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.convocatorias
    ADD CONSTRAINT convocatorias_ubigeo_fkey FOREIGN KEY (ubigeo) REFERENCES public.zonas(ubigeo);


--
-- Name: documentos documentos_alerta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT documentos_alerta_id_fkey FOREIGN KEY (alerta_id) REFERENCES public.alertas(id) ON DELETE SET NULL;


--
-- Name: documentos_gcs documentos_gcs_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos_gcs
    ADD CONSTRAINT documentos_gcs_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.lotes_ingesta(id) ON DELETE SET NULL;


--
-- Name: documentos documentos_ocid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT documentos_ocid_fkey FOREIGN KEY (ocid) REFERENCES public.convocatorias(ocid) ON DELETE CASCADE;


--
-- Name: empresa_personas empresa_personas_empresa_ruc_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresa_personas
    ADD CONSTRAINT empresa_personas_empresa_ruc_fkey FOREIGN KEY (empresa_ruc) REFERENCES public.empresas(ruc) ON DELETE CASCADE;


--
-- Name: empresa_personas empresa_personas_persona_dni_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresa_personas
    ADD CONSTRAINT empresa_personas_persona_dni_fkey FOREIGN KEY (persona_dni) REFERENCES public.personas(dni) ON DELETE CASCADE;


--
-- Name: lotes_items lotes_items_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lotes_items
    ADD CONSTRAINT lotes_items_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.lotes_ingesta(id) ON DELETE CASCADE;


--
-- Name: mef_entity_budget mef_entity_budget_entidad_ruc_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mef_entity_budget
    ADD CONSTRAINT mef_entity_budget_entidad_ruc_fkey FOREIGN KEY (entidad_ruc) REFERENCES public.entidades(ruc) ON DELETE CASCADE;


--
-- Name: network_expansions network_expansions_alerta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.network_expansions
    ADD CONSTRAINT network_expansions_alerta_id_fkey FOREIGN KEY (alerta_id) REFERENCES public.alertas(id) ON DELETE CASCADE;


--
-- Name: ofertas ofertas_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ofertas
    ADD CONSTRAINT ofertas_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.convocatoria_items(id) ON DELETE CASCADE;


--
-- Name: ofertas ofertas_postor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ofertas
    ADD CONSTRAINT ofertas_postor_id_fkey FOREIGN KEY (postor_id) REFERENCES public.postores(id) ON DELETE CASCADE;


--
-- Name: penalidades penalidades_empresa_ruc_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.penalidades
    ADD CONSTRAINT penalidades_empresa_ruc_fkey FOREIGN KEY (empresa_ruc) REFERENCES public.empresas(ruc);


--
-- Name: persona_flags persona_flags_alerta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona_flags
    ADD CONSTRAINT persona_flags_alerta_id_fkey FOREIGN KEY (alerta_id) REFERENCES public.alertas(id) ON DELETE CASCADE;


--
-- Name: persona_flags persona_flags_empresa_ruc_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona_flags
    ADD CONSTRAINT persona_flags_empresa_ruc_fkey FOREIGN KEY (empresa_ruc) REFERENCES public.empresas(ruc);


--
-- Name: persona_flags persona_flags_persona_dni_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona_flags
    ADD CONSTRAINT persona_flags_persona_dni_fkey FOREIGN KEY (persona_dni) REFERENCES public.personas(dni);


--
-- Name: postores postores_empresa_ruc_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postores
    ADD CONSTRAINT postores_empresa_ruc_fkey FOREIGN KEY (empresa_ruc) REFERENCES public.empresas(ruc);


--
-- Name: postores postores_ocid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.postores
    ADD CONSTRAINT postores_ocid_fkey FOREIGN KEY (ocid) REFERENCES public.convocatorias(ocid) ON DELETE CASCADE;


--
-- Name: procesamientos procesamientos_contribucion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procesamientos
    ADD CONSTRAINT procesamientos_contribucion_id_fkey FOREIGN KEY (contribucion_id) REFERENCES public.contribuciones(id);


--
-- Name: procesamientos procesamientos_ocid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procesamientos
    ADD CONSTRAINT procesamientos_ocid_fkey FOREIGN KEY (ocid) REFERENCES public.convocatorias(ocid);


--
-- Name: usuarios usuarios_financiador_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_financiador_id_fkey FOREIGN KEY (financiador_id) REFERENCES public.financiadores(id) ON DELETE SET NULL;


--
-- Name: zonas zonas_padre_ubigeo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zonas
    ADD CONSTRAINT zonas_padre_ubigeo_fkey FOREIGN KEY (padre_ubigeo) REFERENCES public.zonas(ubigeo);


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT ALL ON SCHEMA public TO cloudsqlsuperuser;
GRANT USAGE ON SCHEMA public TO vigia_api;
GRANT USAGE ON SCHEMA public TO vigia_api_admin;
GRANT USAGE ON SCHEMA public TO vigia_mcp;
GRANT USAGE ON SCHEMA public TO vigia_dispatcher;
GRANT ALL ON SCHEMA public TO vigia_jobs;


--
-- Name: FUNCTION asignar_contribucion(p_contribucion_id bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.asignar_contribucion(p_contribucion_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.asignar_contribucion(p_contribucion_id bigint) TO vigia_api_admin;


--
-- Name: FUNCTION borrar_cuenta(p_uid text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.borrar_cuenta(p_uid text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.borrar_cuenta(p_uid text) TO vigia_api;


--
-- Name: FUNCTION cerrar_procesamiento_por_alerta(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cerrar_procesamiento_por_alerta() FROM PUBLIC;


--
-- Name: FUNCTION contrato_estado_ajustes_trg(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.contrato_estado_ajustes_trg() FROM PUBLIC;


--
-- Name: FUNCTION contrato_estado_alertas_trg(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.contrato_estado_alertas_trg() FROM PUBLIC;


--
-- Name: FUNCTION contrato_estado_convocatorias_trg(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.contrato_estado_convocatorias_trg() FROM PUBLIC;


--
-- Name: FUNCTION contrato_estado_documentos_trg(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.contrato_estado_documentos_trg() FROM PUBLIC;


--
-- Name: FUNCTION contrato_estado_procesamientos_trg(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.contrato_estado_procesamientos_trg() FROM PUBLIC;


--
-- Name: FUNCTION contrato_estado_recalcular(p_ocids text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.contrato_estado_recalcular(p_ocids text[]) FROM PUBLIC;


--
-- Name: FUNCTION contrato_estado_recalcular_todo(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.contrato_estado_recalcular_todo() FROM PUBLIC;


--
-- Name: FUNCTION contrato_estado_vencidos(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.contrato_estado_vencidos() FROM PUBLIC;


--
-- Name: FUNCTION convocatorias_ubigeo_zona_trg(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.convocatorias_ubigeo_zona_trg() FROM PUBLIC;


--
-- Name: FUNCTION documentos_listos(p_ocid text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.documentos_listos(p_ocid text) TO vigia_api;
GRANT ALL ON FUNCTION public.documentos_listos(p_ocid text) TO vigia_api_admin;
GRANT ALL ON FUNCTION public.documentos_listos(p_ocid text) TO vigia_dispatcher;


--
-- Name: FUNCTION encolar_procesamiento(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.encolar_procesamiento() FROM PUBLIC;


--
-- Name: FUNCTION entidades_ubigeo_zona_trg(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.entidades_ubigeo_zona_trg() FROM PUBLIC;


--
-- Name: FUNCTION marcar_derivados(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.marcar_derivados() FROM PUBLIC;


--
-- Name: FUNCTION marcar_derivados_si_filas(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.marcar_derivados_si_filas() FROM PUBLIC;


--
-- Name: FUNCTION refrescar_derivados(p_nombre text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refrescar_derivados(p_nombre text) FROM PUBLIC;


--
-- Name: FUNCTION refresh_financiamiento(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refresh_financiamiento() FROM PUBLIC;
GRANT ALL ON FUNCTION public.refresh_financiamiento() TO vigia_api_admin;
GRANT ALL ON FUNCTION public.refresh_financiamiento() TO vigia_dispatcher;
GRANT ALL ON FUNCTION public.refresh_financiamiento() TO vigia_jobs;


--
-- Name: FUNCTION refresh_financiamiento_si_hace_falta(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refresh_financiamiento_si_hace_falta() FROM PUBLIC;
GRANT ALL ON FUNCTION public.refresh_financiamiento_si_hace_falta() TO vigia_api_admin;
GRANT ALL ON FUNCTION public.refresh_financiamiento_si_hace_falta() TO vigia_dispatcher;
GRANT ALL ON FUNCTION public.refresh_financiamiento_si_hace_falta() TO vigia_jobs;


--
-- Name: FUNCTION refresh_ranking(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refresh_ranking() FROM PUBLIC;
GRANT ALL ON FUNCTION public.refresh_ranking() TO vigia_api_admin;
GRANT ALL ON FUNCTION public.refresh_ranking() TO vigia_dispatcher;


--
-- Name: FUNCTION zona_de_entidad(p_ruc text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.zona_de_entidad(p_ruc text) TO vigia_api;
GRANT ALL ON FUNCTION public.zona_de_entidad(p_ruc text) TO vigia_api_admin;


--
-- Name: FUNCTION zona_de_partido(p_clave text, p_anio integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.zona_de_partido(p_clave text, p_anio integer) TO vigia_api;
GRANT ALL ON FUNCTION public.zona_de_partido(p_clave text, p_anio integer) TO vigia_api_admin;


--
-- Name: FUNCTION zonas_ubigeo_zona_trg(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.zonas_ubigeo_zona_trg() FROM PUBLIC;


--
-- Name: TABLE admin_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.admin_log TO vigia_api_admin;


--
-- Name: SEQUENCE admin_log_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.admin_log_id_seq TO vigia_api_admin;


--
-- Name: TABLE ajustes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.ajustes TO vigia_api;
GRANT INSERT,UPDATE ON TABLE public.ajustes TO vigia_api_admin;


--
-- Name: TABLE alertas; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.alertas TO vigia_api;
GRANT INSERT,UPDATE ON TABLE public.alertas TO vigia_api_admin;
GRANT SELECT ON TABLE public.alertas TO vigia_mcp;
GRANT SELECT ON TABLE public.alertas TO vigia_dispatcher;


--
-- Name: TABLE asignaciones; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.asignaciones TO vigia_api;


--
-- Name: TABLE bandera_revision; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.bandera_revision TO vigia_api;
GRANT SELECT,INSERT ON TABLE public.bandera_revision TO vigia_api_admin;


--
-- Name: SEQUENCE bandera_revision_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.bandera_revision_id_seq TO vigia_api_admin;


--
-- Name: TABLE banderas; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.banderas TO vigia_api;
GRANT INSERT ON TABLE public.banderas TO vigia_api_admin;
GRANT SELECT ON TABLE public.banderas TO vigia_mcp;


--
-- Name: SEQUENCE banderas_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.banderas_id_seq TO vigia_api_admin;


--
-- Name: TABLE banderas_reclasificadas; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.banderas_reclasificadas TO vigia_api;


--
-- Name: TABLE convocatorias; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.convocatorias TO vigia_api;
GRANT SELECT ON TABLE public.convocatorias TO vigia_mcp;
GRANT SELECT ON TABLE public.convocatorias TO vigia_dispatcher;
GRANT SELECT,INSERT,UPDATE ON TABLE public.convocatorias TO vigia_jobs;


--
-- Name: TABLE documentos_gcs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.documentos_gcs TO vigia_api;
GRANT SELECT ON TABLE public.documentos_gcs TO vigia_dispatcher;
GRANT SELECT,INSERT,UPDATE ON TABLE public.documentos_gcs TO vigia_jobs;


--
-- Name: TABLE procesamientos; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.procesamientos TO vigia_api;
GRANT UPDATE ON TABLE public.procesamientos TO vigia_api_admin;
GRANT SELECT,UPDATE ON TABLE public.procesamientos TO vigia_dispatcher;
GRANT SELECT,UPDATE ON TABLE public.procesamientos TO vigia_jobs;


--
-- Name: TABLE cobertura_contratos; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.cobertura_contratos TO vigia_api_admin;


--
-- Name: TABLE cola_auditoria; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.cola_auditoria TO vigia_api;


--
-- Name: TABLE contrato_estado; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.contrato_estado TO vigia_api;


--
-- Name: TABLE entidades; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.entidades TO vigia_api;
GRANT SELECT,INSERT,UPDATE ON TABLE public.entidades TO vigia_jobs;


--
-- Name: TABLE entidad_gobierno; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.entidad_gobierno TO vigia_api;
GRANT SELECT ON TABLE public.entidad_gobierno TO vigia_api_admin;


--
-- Name: TABLE gobierno_periodo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.gobierno_periodo TO vigia_api;
GRANT SELECT ON TABLE public.gobierno_periodo TO vigia_api_admin;


--
-- Name: TABLE contrato_partido; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.contrato_partido TO vigia_api;
GRANT SELECT ON TABLE public.contrato_partido TO vigia_api_admin;


--
-- Name: TABLE contratos_agregado; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.contratos_agregado TO vigia_api;


--
-- Name: TABLE contribuciones; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.contribuciones TO vigia_api;
GRANT INSERT,UPDATE ON TABLE public.contribuciones TO vigia_api_admin;


--
-- Name: COLUMN contribuciones.codigo; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(codigo) ON TABLE public.contribuciones TO vigia_api;


--
-- Name: COLUMN contribuciones.financiador_id; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(financiador_id),UPDATE(financiador_id) ON TABLE public.contribuciones TO vigia_api;


--
-- Name: COLUMN contribuciones.ubigeo; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(ubigeo) ON TABLE public.contribuciones TO vigia_api;


--
-- Name: COLUMN contribuciones.contratos; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(contratos) ON TABLE public.contribuciones TO vigia_api;


--
-- Name: COLUMN contribuciones.tarifa_id; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(tarifa_id) ON TABLE public.contribuciones TO vigia_api;


--
-- Name: COLUMN contribuciones.monto_pen; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(monto_pen) ON TABLE public.contribuciones TO vigia_api;


--
-- Name: COLUMN contribuciones.pasarela; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(pasarela) ON TABLE public.contribuciones TO vigia_api;


--
-- Name: COLUMN contribuciones.pasarela_ref; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(pasarela_ref) ON TABLE public.contribuciones TO vigia_api;


--
-- Name: COLUMN contribuciones.comprobante_url; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(comprobante_url) ON TABLE public.contribuciones TO vigia_api;


--
-- Name: COLUMN contribuciones.mensaje_publico; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(mensaje_publico) ON TABLE public.contribuciones TO vigia_api;


--
-- Name: COLUMN contribuciones.entidad_ruc; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(entidad_ruc) ON TABLE public.contribuciones TO vigia_api;


--
-- Name: COLUMN contribuciones.partido_clave; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(partido_clave) ON TABLE public.contribuciones TO vigia_api;


--
-- Name: COLUMN contribuciones.partido_anio; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(partido_anio) ON TABLE public.contribuciones TO vigia_api;


--
-- Name: SEQUENCE contribuciones_codigo_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.contribuciones_codigo_seq TO vigia_api;


--
-- Name: SEQUENCE contribuciones_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.contribuciones_id_seq TO vigia_api;
GRANT USAGE ON SEQUENCE public.contribuciones_id_seq TO vigia_api_admin;


--
-- Name: TABLE convergencias; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.convergencias TO vigia_api;


--
-- Name: TABLE convocatoria_zona; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.convocatoria_zona TO vigia_api;


--
-- Name: TABLE datasets_cobertura; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.datasets_cobertura TO vigia_api_admin;


--
-- Name: TABLE derivados_refresco; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.derivados_refresco TO vigia_api_admin;


--
-- Name: TABLE derivados_estado; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.derivados_estado TO vigia_api_admin;


--
-- Name: SEQUENCE documentos_gcs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.documentos_gcs_id_seq TO vigia_jobs;


--
-- Name: TABLE empresas; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.empresas TO vigia_api;


--
-- Name: TABLE entidad_stats; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.entidad_stats TO vigia_api;


--
-- Name: TABLE equipo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.equipo TO vigia_api_admin;


--
-- Name: TABLE financiadores; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.financiadores TO vigia_api;
GRANT INSERT,UPDATE ON TABLE public.financiadores TO vigia_api_admin;


--
-- Name: COLUMN financiadores.tipo; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(tipo),UPDATE(tipo) ON TABLE public.financiadores TO vigia_api;


--
-- Name: COLUMN financiadores.nombre_publico; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(nombre_publico),UPDATE(nombre_publico) ON TABLE public.financiadores TO vigia_api;


--
-- Name: COLUMN financiadores.slug; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(slug),UPDATE(slug) ON TABLE public.financiadores TO vigia_api;


--
-- Name: COLUMN financiadores.ruc; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(ruc),UPDATE(ruc) ON TABLE public.financiadores TO vigia_api;


--
-- Name: COLUMN financiadores.logo_url; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(logo_url),UPDATE(logo_url) ON TABLE public.financiadores TO vigia_api;


--
-- Name: COLUMN financiadores.email; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(email),UPDATE(email) ON TABLE public.financiadores TO vigia_api;


--
-- Name: COLUMN financiadores.firebase_uid; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(firebase_uid),UPDATE(firebase_uid) ON TABLE public.financiadores TO vigia_api;


--
-- Name: COLUMN financiadores.visible; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(visible),UPDATE(visible) ON TABLE public.financiadores TO vigia_api;


--
-- Name: COLUMN financiadores.motivo_no_visible; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(motivo_no_visible) ON TABLE public.financiadores TO vigia_api;


--
-- Name: COLUMN financiadores.descripcion; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(descripcion) ON TABLE public.financiadores TO vigia_api;


--
-- Name: COLUMN financiadores.sitio_web; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(sitio_web) ON TABLE public.financiadores TO vigia_api;


--
-- Name: COLUMN financiadores.email_publico; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(email_publico) ON TABLE public.financiadores TO vigia_api;


--
-- Name: COLUMN financiadores.redes; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(redes) ON TABLE public.financiadores TO vigia_api;


--
-- Name: COLUMN financiadores.portada_url; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(portada_url) ON TABLE public.financiadores TO vigia_api;


--
-- Name: COLUMN financiadores.telefono; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(telefono) ON TABLE public.financiadores TO vigia_api;


--
-- Name: COLUMN financiadores.ubicacion; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(ubicacion) ON TABLE public.financiadores TO vigia_api;


--
-- Name: COLUMN financiadores.enlaces; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(enlaces) ON TABLE public.financiadores TO vigia_api;


--
-- Name: SEQUENCE financiadores_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.financiadores_id_seq TO vigia_api;
GRANT USAGE ON SEQUENCE public.financiadores_id_seq TO vigia_api_admin;


--
-- Name: TABLE lotes_ingesta; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.lotes_ingesta TO vigia_api;


--
-- Name: TABLE lotes_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.lotes_items TO vigia_api_admin;


--
-- Name: TABLE mef_entity_budget; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.mef_entity_budget TO vigia_api;


--
-- Name: TABLE network_expansions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.network_expansions TO vigia_api;


--
-- Name: TABLE osce_sancionados; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.osce_sancionados TO vigia_api;


--
-- Name: TABLE osce_sancionados_vigentes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.osce_sancionados_vigentes TO vigia_mcp;


--
-- Name: TABLE pedidos_descarga; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.pedidos_descarga TO vigia_api;
GRANT INSERT,UPDATE ON TABLE public.pedidos_descarga TO vigia_api_admin;
GRANT SELECT,INSERT ON TABLE public.pedidos_descarga TO vigia_dispatcher;
GRANT SELECT,UPDATE ON TABLE public.pedidos_descarga TO vigia_jobs;


--
-- Name: SEQUENCE pedidos_descarga_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.pedidos_descarga_id_seq TO vigia_api_admin;
GRANT USAGE ON SEQUENCE public.pedidos_descarga_id_seq TO vigia_dispatcher;


--
-- Name: TABLE zonas; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.zonas TO vigia_api;
GRANT SELECT ON TABLE public.zonas TO vigia_jobs;


--
-- Name: TABLE procesamientos_publico; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.procesamientos_publico TO vigia_api;


--
-- Name: SEQUENCE reportes_codigo_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.reportes_codigo_seq TO vigia_api;


--
-- Name: TABLE reportes_indexados; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.reportes_indexados TO vigia_api;


--
-- Name: TABLE senales_publicas; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.senales_publicas TO vigia_api;


--
-- Name: TABLE tarifas; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.tarifas TO vigia_api;


--
-- Name: TABLE usuarios; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.usuarios TO vigia_api;


--
-- Name: TABLE zona_estado; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.zona_estado TO vigia_api;


--
-- Name: TABLE ranking_impacto; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.ranking_impacto TO vigia_api;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO vigia_api;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE vigia_jobs IN SCHEMA public GRANT SELECT ON TABLES TO vigia_api;


--
-- PostgreSQL database dump complete
--

\unrestrict cayPLsN9i5zz8fcP11ASBU3t5QD5WueakgI6EBITNNVCHiI4M1RyTHkrdaRB2Du

