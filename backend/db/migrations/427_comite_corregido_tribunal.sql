-- 427 · El integrante del comité cuyas evaluaciones el Tribunal corrige una y otra vez.
--
-- Junta dos lecturas con modelo: quién integró el comité de cada proceso (actas leídas por los agentes y el lector del
-- comité, comite_integrante, 408) y qué procesos corrigió el Tribunal de Contrataciones al resolver una apelación
-- (fundada, en parte o nulidad, comprobada contra el primer punto resolutivo: tribunal_corrigio, 423).
-- Que el Tribunal corrija un proceso dice que el comité calificó o descalificó mal, o que las bases tenían un vicio. Una vez
-- le pasa a cualquiera; que le pase a la misma persona en varios de sus procesos, mucho más que al resto de su entidad,
-- es el patrón de un evaluador que favorece a un postor o no respeta las reglas.
--
-- Por persona y entidad (como la 415): sus procesos con comité leído (n ≥ 3) y cuántos corrigió el Tribunal (m ≥ 2),
-- contra la tasa de la entidad sin ella (5 procesos o más): binomial_cola y Benjamini-Hochberg al 10 % sobre todas las
-- personas probadas. Se marca cada proceso corregido de la persona sobre su ganador, con la resolución. De la persona,
-- sólo su papel y su clave estable (`integrante`, la misma de la 396, 407 y 415).
--
-- Medido el 2026-11-19: 3 816 procesos con comité leído, 504 corregidos por el Tribunal, 45 en los dos y UNA persona con
-- dos o más. Hoy no sale nadie; crece con la lectura del comité (7 300 de 18 237) y las resoluciones (1 000 de 23 500).
-- EN OBSERVACIÓN hasta revisar 40 casos en /admin/senales.

INSERT INTO senal_en_observacion (tipo, desde, motivo) VALUES
  ('comite_corregido_tribunal', current_date, 'Nueva (427): integrante del comité corregido por el Tribunal más que su entidad; revisar 40 casos')
ON CONFLICT (tipo) DO NOTHING;

CREATE OR REPLACE FUNCTION refrescar_cruce_comite_corregido_tribunal() RETURNS integer
LANGUAGE plpgsql SET work_mem TO '128MB' AS $$
DECLARE
  n int;
  v_obs boolean := EXISTS (SELECT 1 FROM senal_en_observacion WHERE tipo = 'comite_corregido_tribunal');
BEGIN
  -- Los procesos corregidos, con su resolución más reciente.
  CREATE TEMP TABLE _tc ON COMMIT DROP AS
  SELECT DISTINCT ON (p.ocid) p.ocid, r.titulo, r.fecha, r.resultado, COALESCE(r.pdf, r.url) AS enlace
    FROM tribunal_proceso p JOIN tribunal_resolucion r ON r.id = p.resolucion_id
   WHERE p.ocid IS NOT NULL AND tribunal_corrigio(r)
   ORDER BY p.ocid, r.fecha DESC NULLS LAST, r.id DESC;
  CREATE INDEX ON _tc (ocid);
  ANALYZE _tc;

  CREATE TEMP TABLE _cr ON COMMIT DROP AS
  SELECT ci.ent, ci.clave, ci.ocid, ci.rol, (t.ocid IS NOT NULL) AS corregido
    FROM comite_integrante ci LEFT JOIN _tc t ON t.ocid = ci.ocid;
  ANALYZE _cr;

  CREATE TEMP TABLE _cp ON COMMIT DROP AS
  WITH ent AS (SELECT ent, count(DISTINCT ocid) AS n, count(DISTINCT ocid) FILTER (WHERE corregido) AS m FROM _cr GROUP BY ent),
       per AS (SELECT ent, clave, count(DISTINCT ocid) AS n, count(DISTINCT ocid) FILTER (WHERE corregido) AS m,
                      (array_agg(rol ORDER BY rol) FILTER (WHERE rol IS NOT NULL))[1] AS rol
                 FROM _cr GROUP BY ent, clave)
  SELECT p.ent, p.clave, p.rol, p.n, p.m, e.n - p.n AS n0, e.m - p.m AS m0,
         ((e.m - p.m) + 0.5) / ((e.n - p.n) + 1.0) AS base,
         binomial_cola(p.n::int, p.m::int, ((e.m - p.m) + 0.5) / ((e.n - p.n) + 1.0)) AS pv
    FROM per p JOIN ent e ON e.ent = p.ent
   WHERE p.n >= 3 AND e.n - p.n >= 5;

  CREATE TEMP TABLE _cs ON COMMIT DROP AS
  WITH o AS (SELECT *, row_number() OVER (ORDER BY pv, ent, clave) AS i, count(*) OVER () AS l FROM _cp),
       c AS (SELECT max(i) AS corte FROM o WHERE pv <= 0.10 * i / l)
  SELECT o.*, least(1, o.pv * o.l / o.i) AS q FROM o, c
   WHERE c.corte IS NOT NULL AND o.i <= c.corte AND o.m >= 2 AND o.m > o.n * o.base;

  CREATE TEMP TABLE _cg ON COMMIT DROP AS
  SELECT c.ocid, COALESCE(m.ruc_miembro, a.ruc_proveedor) AS ruc, max(a.fecha_buenapro) AS f,
         sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS monto,
         max(CASE WHEN m.ruc_miembro IS NOT NULL THEN a.ruc_proveedor END) AS consorcio
    FROM (SELECT DISTINCT r.ocid FROM _cr r JOIN _cs s ON s.ent = r.ent AND s.clave = r.clave WHERE r.corregido) c
    JOIN convocatorias v ON v.ocid = c.ocid
    JOIN conosce_adjudicaciones a ON a.codigo_convocatoria = v.codigo AND a.entidad_ruc = v.entidad_ruc
    LEFT JOIN conosce_consorcios m ON m.ruc_consorcio = a.ruc_proveedor AND a.ruc_proveedor !~ '^(10|20)\d{9}$'
   WHERE COALESCE(m.ruc_miembro, a.ruc_proveedor) ~ '^20\d{9}$'
   GROUP BY c.ocid, COALESCE(m.ruc_miembro, a.ruc_proveedor);

  DELETE FROM cruces_proveedor WHERE tipo = 'comite_corregido_tribunal';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, persona_doc, persona_nombre, persona_rol,
                                detalle, fuente, fuente_url)
  SELECT DISTINCT ON (r.ocid, g.ruc)
         'comite_corregido_tribunal', g.ruc, r.ocid,
         CASE WHEN s.pv < 0.001 THEN 'alta' ELSE 'media' END,
         COALESCE(t.fecha, g.f), g.monto, NULL, NULL, COALESCE(r.rol, s.rol),
         jsonb_build_object('integrante', left(md5(s.ent || '|' || s.clave), 10), 'rol', COALESCE(r.rol, s.rol),
                            'procesos_de_la_persona', s.n, 'corregidos', s.m,
                            'procesos_entidad_sin_la_persona', s.n0, 'tasa_entidad', round(s.base::numeric, 4),
                            'p_valor', s.pv, 'q_valor', round(s.q::numeric, 4),
                            'resolucion', t.titulo, 'resultado', t.resultado, 'enlace', t.enlace, 'consorcio', g.consorcio,
                            'documento', 'comité del acta (agentes o lector del comité) y resoluciones del Tribunal leídas por Vigía',
                            'en_observacion', v_obs),
         'tribunal_apelaciones', t.enlace
    FROM _cs s
    JOIN _cr r ON r.ent = s.ent AND r.clave = s.clave AND r.corregido
    JOIN _tc t ON t.ocid = r.ocid
    JOIN _cg g ON g.ocid = r.ocid
   ORDER BY r.ocid, g.ruc, s.pv;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER FUNCTION public.refrescar_cruce_comite_corregido_tribunal() OWNER TO vigia_jobs;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_cruce_comite_corregido_tribunal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refrescar_cruce_comite_corregido_tribunal() TO vigia_jobs;

-- La tasa base mide la señal sobre los procesos con el comité leído, como las demás del comité.
CREATE OR REPLACE FUNCTION public.refrescar_senal_tasa_base()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
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
              WHEN t.tipo IN ('comite_mismo_ganador', 'comite_socio_proveedor', 'comite_competencia_restringida', 'comite_corregido_tribunal') THEN u_comite
              WHEN t.tipo ~ '^(obra|inversion)_' THEN NULL
              ELSE u_todos END,
         CASE WHEN NOT t.por_proceso THEN 'empresas que ganaron algún proceso'
              WHEN t.tipo ~ '^visita_|^reunion_en_evaluacion$' THEN 'procesos adjudicados en entidades con registro de visitas'
              WHEN t.tipo LIKE 'acta\_%' THEN 'procesos con el acta de buena pro leída'
              WHEN t.tipo LIKE 'bases\_%' THEN 'procesos con las bases leídas'
              WHEN t.tipo LIKE 'consultas\_%' THEN 'procesos con el pliego de consultas leído'
              WHEN t.tipo = 'ofertas_a_la_vez' THEN 'procesos con dos o más ofertas de empresas y su hora de registro'
              WHEN t.tipo = 'solo_admitido_el_ganador' THEN 'procesos con un ítem adjudicado de cuatro o más ofertas y su reporte de evaluación'
              WHEN t.tipo IN ('comite_mismo_ganador', 'comite_socio_proveedor', 'comite_competencia_restringida', 'comite_corregido_tribunal') THEN 'procesos con el comité de selección leído (agentes o lector del acta)'
              WHEN t.tipo ~ '^(obra|inversion)_' THEN NULL
              ELSE 'procesos adjudicados' END
    FROM (SELECT tipo, bool_or(ocid IS NOT NULL) AS por_proceso,
                 CASE WHEN bool_or(ocid IS NOT NULL) THEN count(DISTINCT ocid) ELSE count(DISTINCT ruc_empresa) END::int AS casos
            FROM cruces_proveedor GROUP BY tipo) t;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$
;

SELECT refrescar_cruce_comite_corregido_tribunal();
