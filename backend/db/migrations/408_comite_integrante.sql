-- 408 · Una sola lista de quiénes integraron cada comité de selección: `comite_integrante`.
--
-- Hasta aquí, las dos señales de red que parten del comité (comite_mismo_ganador, 396; comite_socio_proveedor, 407)
-- recorrían cada una el JSON de alertas.analisis_full (~60 s cada una) y sólo veían los 3 306 procesos cuyo comité
-- leyeron los agentes. Ahora una vista materializada junta las dos fuentes:
--   agentes   alertas.analisis_full->document_analysis->comite_evaluacion, con la cita comprobada (evidencia verificada);
--   lector    documento_lectura clase «comite» (backend/lector/comite.py, GLM 5.3 flash sobre el acta): sólo los nombres
--             que `comprobar_pdfs` encontró, todas sus palabras, en el texto de una misma página (verificada).
-- Un nombre por proceso (DISTINCT ON por la clave sin títulos), primero el de los agentes. El lector cubre ~17 500 actas:
-- en el piloto de 40, los nombres comprobados coincidían con los de los agentes en 43 de 46.
--
-- Privacidad: son nombres de funcionarios para cruzar por dentro. La vista NO se otorga a la API ni al MCP (vigia_api,
-- vigia_api_admin, vigia_mcp): las señales muestran el papel en el comité y una clave estable (md5 de entidad y nombre).
--
-- Cómo aplicarla: después de la 407. Luego SELECT refrescar_comite_integrante(), refrescar_cruce_comite_mismo_ganador(),
-- refrescar_cruce_comite_socio_proveedor() y refrescar_senal_tasa_base() (tarea:refrescar-piezas lo hace en ese orden).

DROP MATERIALIZED VIEW IF EXISTS comite_integrante;
CREATE MATERIALIZED VIEW comite_integrante AS
SELECT DISTINCT ON (x.ocid, x.clave) x.*
  FROM (
    SELECT a.ocid, btrim(cv.entidad_ruc::text) AS ent, cv.fecha_convocatoria AS fconv,
           btrim(regexp_replace(
               regexp_replace(regexp_replace(upper(public.unaccent(m->>'nombre_completo')), '[^A-Z ]', ' ', 'g'), '\s+', ' ', 'g'),
               '^((ING|ARQ|ABOG|ABG|LIC|DR|DRA|SR|SRA|SRTA|CPC|C P C|ECON|ECO|BLGO|BIOL|MG|MBA|PROF|TEC|BACH|OBST|ENF|Q F|QF|MED|CD|PSIC|M C|MC|CAP|CRNL|MAY|TTE|ADM|CONT)\s+)+',
               '')) AS clave,
           NULLIF(btrim(m->>'rol'), '') AS rol, (m->'evidencia'->0->>'pagina')::int AS pagina,
           m->>'documento_sha256' AS sha, 'agentes'::text AS fuente
      FROM alertas a
      JOIN convocatorias cv ON cv.ocid = a.ocid
      CROSS JOIN LATERAL jsonb_array_elements(a.analisis_full->'document_analysis'->'comite_evaluacion') m
     WHERE jsonb_typeof(a.analisis_full->'document_analysis'->'comite_evaluacion') = 'array'
       AND jsonb_typeof(m) = 'object'
       AND COALESCE((m->'evidencia'->0->>'verificada')::boolean, false)
    UNION ALL
    SELECT l.ocid, btrim(cv.entidad_ruc::text), cv.fecha_convocatoria,
           btrim(regexp_replace(
               regexp_replace(regexp_replace(upper(public.unaccent(m->>'nombre_completo')), '[^A-Z ]', ' ', 'g'), '\s+', ' ', 'g'),
               '^((ING|ARQ|ABOG|ABG|LIC|DR|DRA|SR|SRA|SRTA|CPC|C P C|ECON|ECO|BLGO|BIOL|MG|MBA|PROF|TEC|BACH|OBST|ENF|Q F|QF|MED|CD|PSIC|M C|MC|CAP|CRNL|MAY|TTE|ADM|CONT)\s+)+',
               '')),
           NULLIF(btrim(m->>'rol'), ''), (m->>'pagina_texto')::int, g.sha256, 'lector'
      FROM documento_lectura l
      JOIN convocatorias cv ON cv.ocid = l.ocid
      LEFT JOIN documentos_gcs g ON g.id = l.documentos[1]
      CROSS JOIN LATERAL jsonb_array_elements(l.salida->'comite') m
     WHERE l.clase = 'comite' AND l.estado = 'ok' AND l.version NOT LIKE '%-2'
       AND jsonb_typeof(l.salida->'comite') = 'array' AND jsonb_typeof(m) = 'object'
       AND COALESCE((m->>'verificada')::boolean, false)) x
 WHERE array_length(string_to_array(x.clave, ' '), 1) >= 3
 ORDER BY x.ocid, x.clave, (x.fuente = 'agentes') DESC, x.pagina NULLS LAST;

CREATE UNIQUE INDEX comite_integrante_uidx ON comite_integrante (ocid, clave);
CREATE INDEX comite_integrante_ent ON comite_integrante (ent);
COMMENT ON MATERIALIZED VIEW comite_integrante IS 'Integrantes del comité de selección por proceso, de los agentes y del lector del acta (sólo nombres comprobados). Interna: no se otorga a la API ni al MCP. Migración 408.';

CREATE OR REPLACE FUNCTION refrescar_comite_integrante() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY comite_integrante;
  SELECT count(*) INTO n FROM comite_integrante;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION refrescar_cruce_comite_mismo_ganador() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n int;
  v_obs boolean := EXISTS (SELECT 1 FROM senal_en_observacion WHERE tipo = 'comite_mismo_ganador');
BEGIN
  -- Cada integrante del comité por proceso, con su nombre comprobado en el documento: de los agentes o del lector del
  -- comité (vista comite_integrante, migración 408).
  CREATE TEMP TABLE _cm ON COMMIT DROP AS
  SELECT ocid, ent, clave, rol, pagina, sha FROM comite_integrante;
  ANALYZE _cm;

  -- El ganador de cada uno: la empresa, o cada integrante RUC 20 de un consorcio.
  CREATE TEMP TABLE _cg ON COMMIT DROP AS
  SELECT c.ocid, COALESCE(m.ruc_miembro, a.ruc_proveedor) AS ruc, max(a.fecha_buenapro) AS f,
         sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS monto,
         max(CASE WHEN m.ruc_miembro IS NOT NULL THEN a.ruc_proveedor END) AS consorcio
    FROM (SELECT DISTINCT ocid FROM _cm) c
    JOIN convocatorias v ON v.ocid = c.ocid
    JOIN conosce_adjudicaciones a ON a.codigo_convocatoria = v.codigo AND a.entidad_ruc = v.entidad_ruc
    LEFT JOIN conosce_consorcios m ON m.ruc_consorcio = a.ruc_proveedor AND a.ruc_proveedor !~ '^(10|20)\d{9}$'
   WHERE COALESCE(m.ruc_miembro, a.ruc_proveedor) ~ '^20\d{9}$'
   GROUP BY c.ocid, COALESCE(m.ruc_miembro, a.ruc_proveedor);
  ANALYZE _cg;

  -- Los pares persona-empresa: cuántos procesos juntos, de cuántos de esa persona, y la parte de la empresa sin ella.
  CREATE TEMP TABLE _cp ON COMMIT DROP AS
  WITH con_ganador AS (SELECT DISTINCT c.ent, c.ocid FROM _cm c WHERE EXISTS (SELECT 1 FROM _cg g WHERE g.ocid = c.ocid)),
       total AS (SELECT ent, count(*) AS total FROM con_ganador GROUP BY ent),
       persona AS (SELECT c.ent, c.clave, count(DISTINCT c.ocid) AS n
                     FROM _cm c JOIN con_ganador p ON p.ocid = c.ocid GROUP BY c.ent, c.clave),
       juntos AS (SELECT c.ent, c.clave, g.ruc, count(DISTINCT c.ocid) AS k
                    FROM _cm c JOIN _cg g ON g.ocid = c.ocid GROUP BY c.ent, c.clave, g.ruc),
       empresa AS (SELECT p.ent, g.ruc, count(DISTINCT p.ocid) AS gana
                     FROM con_ganador p JOIN _cg g ON g.ocid = p.ocid GROUP BY p.ent, g.ruc)
  SELECT j.ent, j.clave, j.ruc, j.k, pe.n, t.total, e.gana,
         round(j.k::numeric / pe.n, 2) AS parte_con,
         CASE WHEN t.total > pe.n THEN round((e.gana - j.k)::numeric / (t.total - pe.n), 2) END AS parte_sin
    FROM juntos j
    JOIN persona pe ON pe.ent = j.ent AND pe.clave = j.clave
    JOIN total t ON t.ent = j.ent
    JOIN empresa e ON e.ent = j.ent AND e.ruc = j.ruc
   WHERE j.k >= 3 AND j.k::numeric / pe.n >= 0.5;
  DELETE FROM _cp WHERE parte_sin IS NOT NULL AND parte_con < 2 * parte_sin;

  DELETE FROM cruces_proveedor WHERE tipo = 'comite_mismo_ganador';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, persona_doc, persona_nombre, persona_rol,
                                detalle, fuente, fuente_url)
  SELECT DISTINCT ON (c.ocid, p.ruc)
         'comite_mismo_ganador', p.ruc, c.ocid,
         CASE WHEN p.parte_sin IS NULL THEN 'baja'
              WHEN p.k >= 5 AND p.parte_sin <= 0.10 THEN 'alta' ELSE 'media' END,
         g.f, g.monto, NULL, NULL, c.rol,
         jsonb_build_object('integrante', left(md5(p.ent || '|' || p.clave), 10), 'veces', p.k, 'procesos_de_la_persona', p.n, 'parte_con_la_persona', p.parte_con,
                            'parte_sin_la_persona', p.parte_sin, 'procesos_leidos_de_la_entidad', p.total,
                            'rol', c.rol, 'pagina', c.pagina, 'documento_sha256', c.sha, 'consorcio', g.consorcio,
                            'documento', 'acta del proceso, leída por los agentes de Vigía (cita comprobada)',
                            'en_observacion', v_obs),
         'comite_dictamen', NULL
    FROM _cp p
    JOIN _cm c ON c.ent = p.ent AND c.clave = p.clave
    JOIN _cg g ON g.ocid = c.ocid AND g.ruc = p.ruc
   ORDER BY c.ocid, p.ruc, p.k DESC, p.parte_con DESC;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION refrescar_cruce_comite_socio_proveedor() RETURNS integer
LANGUAGE plpgsql SET work_mem TO '128MB' AS $$
DECLARE
  n int;
  v_obs boolean := EXISTS (SELECT 1 FROM senal_en_observacion WHERE tipo = 'comite_socio_proveedor');
BEGIN
  -- Cada integrante del comité por proceso (vista comite_integrante, migración 408), con su nombre de palabras ordenadas.
  CREATE TEMP TABLE _sm ON COMMIT DROP AS
  SELECT ocid, ent, fconv, clave, rol, pagina, sha,
         (SELECT string_agg(w, ' ' ORDER BY w) FROM unnest(string_to_array(clave, ' ')) w) AS orden
    FROM comite_integrante;

  -- Por persona y entidad: en cuántos procesos estuvo, entre qué fechas y el último (con su papel, página y documento).
  CREATE TEMP TABLE _sp ON COMMIT DROP AS
  SELECT ent, clave, orden, count(DISTINCT ocid)::int AS procesos, min(fconv) AS desde, max(fconv) AS hasta,
         array_agg(DISTINCT ocid) AS ocids,
         (array_agg(ocid ORDER BY fconv DESC NULLS LAST))[1] AS ocid_comite,
         (array_agg(rol ORDER BY fconv DESC NULLS LAST) FILTER (WHERE rol IS NOT NULL))[1] AS rol,
         (array_agg(pagina ORDER BY fconv DESC NULLS LAST))[1] AS pagina,
         (array_agg(sha ORDER BY fconv DESC NULLS LAST))[1] AS sha
    FROM _sm GROUP BY ent, clave, orden;
  CREATE INDEX ON _sp (orden);
  ANALYZE _sp;

  -- Lo que ganan las empresas (RUC 20, o cada integrante RUC 20 de un consorcio) en esas entidades, por proceso.
  CREATE TEMP TABLE _sa ON COMMIT DROP AS
  SELECT COALESCE(m.ruc_miembro, a.ruc_proveedor)::text AS ruc, btrim(a.entidad_ruc::text) AS ent, cv.ocid,
         max(a.fecha_buenapro) AS f,
         sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS monto,
         max(CASE WHEN m.ruc_miembro IS NOT NULL THEN a.ruc_proveedor END) AS consorcio
    FROM conosce_adjudicaciones a
    JOIN (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
           WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid) cv
      ON cv.codigo = a.codigo_convocatoria AND cv.entidad_ruc = a.entidad_ruc
    LEFT JOIN conosce_consorcios m ON m.ruc_consorcio = a.ruc_proveedor AND a.ruc_proveedor !~ '^(10|20)\d{9}$'
   WHERE a.entidad_ruc IN (SELECT DISTINCT ent::bpchar FROM _sp)
     AND COALESCE(m.ruc_miembro, a.ruc_proveedor) ~ '^20\d{9}$'
   GROUP BY 1, 2, 3;
  ANALYZE _sa;

  -- Socios, representantes y órganos de administración (RNP) de esas empresas, con el nombre en el mismo orden.
  CREATE TEMP TABLE _sr ON COMMIT DROP AS
  SELECT btrim(r.ruc_empresa::text) AS ruc, r.numero_documento AS doc, r.tipo_rol, r.fecha_inicio_vigencia AS ini,
         r.baja_corte AS baja,
         (SELECT string_agg(w, ' ' ORDER BY w)
            FROM unnest(string_to_array(btrim(regexp_replace(regexp_replace(upper(public.unaccent(r.nombre)), '[^A-Z ]', ' ', 'g'), '\s+', ' ', 'g')), ' ')) w) AS orden
    FROM rnp_conformacion_juridica r
   WHERE r.ruc_empresa IN (SELECT DISTINCT ruc::bpchar FROM _sa) AND r.nombre IS NOT NULL;
  CREATE INDEX ON _sr (orden);
  ANALYZE _sr;

  -- Los pares: la persona del comité es socia de una empresa que gana en su entidad. Por par, sus roles y su vigencia.
  CREATE TEMP TABLE _sx ON COMMIT DROP AS
  SELECT p.ent, p.clave, p.procesos, p.desde, p.hasta, p.ocids, p.ocid_comite, p.rol, p.pagina, p.sha, r.ruc,
         array_agg(DISTINCT r.tipo_rol ORDER BY r.tipo_rol) AS roles, min(r.ini) AS ini,
         CASE WHEN bool_or(r.baja IS NULL) THEN NULL ELSE max(r.baja) END AS baja,
         CASE WHEN EXISTS (SELECT 1 FROM persona_entidad pe
                            WHERE pe.entidad_ruc = p.ent AND substr(pe.ruc, 3, 8) = ANY(array_agg(r.doc)))
                THEN 'documento'
              WHEN array_length(string_to_array(p.orden, ' '), 1) >= 4 THEN 'nombre_completo'
              ELSE 'nombre' END AS identidad
    FROM _sp p
    JOIN _sr r ON r.orden = p.orden
   WHERE EXISTS (SELECT 1 FROM _sa s WHERE s.ruc = r.ruc AND s.ent = p.ent)
   GROUP BY p.ent, p.clave, p.orden, p.procesos, p.desde, p.hasta, p.ocids, p.ocid_comite, p.rol, p.pagina, p.sha, r.ruc;

  DELETE FROM cruces_proveedor WHERE tipo = 'comite_socio_proveedor';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, persona_doc, persona_nombre, persona_rol,
                                detalle, fuente, fuente_url)
  SELECT DISTINCT ON (z.ocid, z.ruc)
         'comite_socio_proveedor', z.ruc, z.ocid,
         CASE WHEN z.en_su_comite AND z.socio_al_ganar THEN 'alta'
              WHEN z.socio_al_ganar AND z.cuando IN ('a_la_vez', 'cerca') AND z.identidad <> 'nombre' THEN 'alta'
              WHEN z.socio_al_ganar AND z.cuando IN ('a_la_vez', 'cerca') THEN 'media'
              ELSE 'baja' END,
         z.f, z.monto, NULL, NULL, z.rol,
         jsonb_build_object('integrante', left(md5(z.ent || '|' || z.clave), 10), 'rol', z.rol,
                            'procesos_de_la_persona', z.procesos, 'ocid_comite', z.ocid_comite,
                            'comite_desde', z.desde, 'comite_hasta', z.hasta, 'cuando', z.cuando,
                            'en_su_comite', z.en_su_comite, 'rol_en_empresa', to_jsonb(z.roles), 'socio_desde', z.ini,
                            'socio_baja', z.baja, 'socio_al_ganar', z.socio_al_ganar, 'identidad', z.identidad,
                            'pagina', z.pagina, 'documento_sha256', z.sha, 'consorcio', z.consorcio,
                            'documento', 'acta del proceso (comité, cita comprobada) y Registro Nacional de Proveedores',
                            'en_observacion', v_obs),
         'comite_dictamen', NULL
    FROM (
      SELECT x.*, s.ocid, s.f, s.monto, s.consorcio,
             s.ocid = ANY(x.ocids) AS en_su_comite,
             (x.ini IS NULL OR x.ini <= s.f) AND (x.baja IS NULL OR x.baja >= s.f) AS socio_al_ganar,
             CASE WHEN s.f IS NULL OR x.desde IS NULL THEN 'sin_fechas'
                  WHEN s.f BETWEEN x.desde AND x.hasta THEN 'a_la_vez'
                  WHEN s.f BETWEEN x.desde - 365 AND x.hasta + 365 THEN 'cerca'
                  ELSE 'lejos' END AS cuando
        FROM _sx x
        JOIN _sa s ON s.ruc = x.ruc AND s.ent = x.ent) z
   ORDER BY z.ocid, z.ruc,
            CASE WHEN z.en_su_comite THEN 0 WHEN z.cuando = 'a_la_vez' THEN 1 WHEN z.cuando = 'cerca' THEN 2 ELSE 3 END,
            CASE z.identidad WHEN 'documento' THEN 0 WHEN 'nombre_completo' THEN 1 ELSE 2 END;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION refrescar_senal_tasa_base() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n int;
  u_todos int; u_visitas int; u_acta int; u_bases int; u_consultas int; u_ofertas int; u_empresas int; u_admision int; u_comite int;
  f_min date; f_max date;
BEGIN
  SELECT min(fecha_visita), max(fecha_visita) INTO f_min, f_max FROM visitas_entidades;
  -- Procesos adjudicados que la base puede enlazar a su ficha, y los de entidades con registro de visitas.
  SELECT count(DISTINCT cv.ocid),
         count(DISTINCT cv.ocid) FILTER (WHERE a.fecha_buenapro BETWEEN f_min AND f_max + 180
                                           AND a.entidad_ruc::text IN (SELECT ruc FROM visita_entidad_ruc))
    INTO u_todos, u_visitas
    FROM conosce_adjudicaciones a
    JOIN (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
           WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid) cv
      ON cv.codigo = a.codigo_convocatoria AND cv.entidad_ruc = a.entidad_ruc;
  SELECT count(DISTINCT ocid) FILTER (WHERE clase = 'buena_pro'), count(DISTINCT ocid) FILTER (WHERE clase = 'bases'),
         count(DISTINCT ocid) FILTER (WHERE clase = 'consultas')
    INTO u_acta, u_bases, u_consultas FROM documento_lectura;
  SELECT count(DISTINCT ocid) INTO u_ofertas
    FROM (SELECT ocid FROM proceso_postor WHERE codigo ~ '^20\d{9}$' AND presento_at IS NOT NULL
           GROUP BY ocid, item HAVING count(DISTINCT codigo) >= 2) z;
  SELECT count(*) INTO u_empresas FROM empresa_resumen WHERE adj_procesos > 0;
  -- Migración 391: sólo admitieron al ganador se mide sobre los procesos que pueden tenerlo (un ítem adjudicado con 4 o
  -- más ofertas y la admisión leída del reporte de evaluación), no sobre todos los adjudicados.
  SELECT count(DISTINCT ocid) INTO u_admision
    FROM proceso_item WHERE resultado = 'adjudicado' AND ofertas >= 4 AND admitidas IS NOT NULL;
  -- Migraciones 397 y 408: las señales del comité se miden sobre los procesos con su comité leído (agentes o lector).
  SELECT count(DISTINCT ocid) INTO u_comite FROM comite_integrante;

  DELETE FROM senal_tasa_base;
  INSERT INTO senal_tasa_base (tipo, casos, universo, universo_que)
  SELECT t.tipo, t.casos,
         CASE WHEN NOT t.por_proceso THEN u_empresas
              WHEN t.tipo ~ '^visita_|^reunion_en_evaluacion$' THEN u_visitas
              WHEN t.tipo LIKE 'acta\_%' THEN u_acta
              WHEN t.tipo LIKE 'bases\_%' THEN u_bases
              WHEN t.tipo LIKE 'consultas\_%' THEN u_consultas
              WHEN t.tipo = 'ofertas_a_la_vez' THEN u_ofertas
              WHEN t.tipo = 'solo_admitido_el_ganador' THEN u_admision
              WHEN t.tipo IN ('comite_mismo_ganador', 'comite_socio_proveedor') THEN u_comite
              WHEN t.tipo ~ '^(obra|inversion)_' THEN NULL
              ELSE u_todos END,
         CASE WHEN NOT t.por_proceso THEN 'empresas que ganaron algún proceso'
              WHEN t.tipo ~ '^visita_|^reunion_en_evaluacion$' THEN 'procesos adjudicados en entidades con registro de visitas'
              WHEN t.tipo LIKE 'acta\_%' THEN 'procesos con el acta de buena pro leída'
              WHEN t.tipo LIKE 'bases\_%' THEN 'procesos con las bases leídas'
              WHEN t.tipo LIKE 'consultas\_%' THEN 'procesos con el pliego de consultas leído'
              WHEN t.tipo = 'ofertas_a_la_vez' THEN 'procesos con dos o más ofertas de empresas y su hora de registro'
              WHEN t.tipo = 'solo_admitido_el_ganador' THEN 'procesos con un ítem adjudicado de cuatro o más ofertas y su reporte de evaluación'
              WHEN t.tipo IN ('comite_mismo_ganador', 'comite_socio_proveedor') THEN 'procesos con el comité de selección leído (agentes o lector del acta)'
              WHEN t.tipo ~ '^(obra|inversion)_' THEN NULL
              ELSE 'procesos adjudicados' END
    FROM (SELECT tipo, bool_or(ocid IS NOT NULL) AS por_proceso,
                 CASE WHEN bool_or(ocid IS NOT NULL) THEN count(DISTINCT ocid) ELSE count(DISTINCT ruc_empresa) END::int AS casos
            FROM cruces_proveedor GROUP BY tipo) t;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER MATERIALIZED VIEW public.comite_integrante OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_comite_integrante() OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_cruce_comite_mismo_ganador() OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_cruce_comite_socio_proveedor() OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_senal_tasa_base() OWNER TO vigia_jobs;
  END IF;
  -- Nombres de funcionarios: ningún rol que responde al público la lee.
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON public.comite_integrante FROM %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON comite_integrante FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refrescar_comite_integrante() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refrescar_cruce_comite_mismo_ganador() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refrescar_cruce_comite_socio_proveedor() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refrescar_senal_tasa_base() FROM PUBLIC;
