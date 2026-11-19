-- 415 · Un integrante del comité cuyos procesos terminan con la competencia restringida más de lo que explica el azar
-- (indicador EN OBSERVACIÓN, migración 329).
--
-- Las señales de competencia miran un proceso a la vez: único postor, el acta deja sólo al ganador, descalificaciones por
-- formalidad, la oferta más baja descartada, sólo admitieron al ganador. Ésta mira a la PERSONA que evalúa, a través de
-- todos sus procesos en la entidad (comite_integrante, 408 y 411): si en los suyos la competencia queda restringida mucho
-- más que en los demás procesos de la misma entidad, es el patrón del evaluador que filtra a los postores.
--
-- Sin azar disfrazado: la tasa base es alta (un tercio de los procesos con comité tiene alguna de esas marcas, sobre todo
-- único postor) y con 4 procesos llegar al 75 % por suerte pasa una vez de cada diez. Por eso, por persona con 4 o más
-- procesos y una entidad con 5 o más sin ella: la probabilidad binomial de tener tantos restringidos con la tasa de su
-- entidad sin ella (binomial_cola), y sólo pasan las que superan el control de falsos descubrimientos de
-- Benjamini-Hochberg al 10 % sobre TODAS las personas probadas en cada refresco. Medido el 2026-11-19: 147 personas
-- probadas, 6 con p < 0,01 (el azar daría 1,5), 4 pasan; p. ej. 7 de 8 procesos restringidos donde la entidad tiene 31 %.
-- Alta con p < 0,001; si no, media. Crece con el lector del comité.
--
-- Se marca cada proceso restringido de esa persona, sobre la empresa que ganó (o cada integrante RUC 20 del consorcio).
-- Del funcionario, sólo su papel y la clave estable `integrante` (la misma de 396 y 407).

INSERT INTO senal_en_observacion (tipo, motivo) VALUES
  ('comite_competencia_restringida', 'Nueva (migración 415): falta medir su precisión con 40 casos revisados a mano.')
ON CONFLICT (tipo) DO NOTHING;

-- P(X >= m) con X ~ Binomial(n, p), por logaritmos (sin desbordes para n grande).
CREATE OR REPLACE FUNCTION binomial_cola(n int, m int, p float8) RETURNS float8
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s float8 := 0; k int; i int; lc float8;
BEGIN
  IF m <= 0 THEN RETURN 1; END IF;
  IF m > n THEN RETURN 0; END IF;
  p := least(greatest(p, 1e-9), 1 - 1e-9);
  FOR k IN m..n LOOP
    lc := 0;
    FOR i IN 1..k LOOP lc := lc + ln(n - k + i) - ln(i); END LOOP;
    s := s + exp(lc + k * ln(p) + (n - k) * ln(1 - p));
  END LOOP;
  RETURN least(s, 1);
END $$;

CREATE OR REPLACE FUNCTION refrescar_cruce_comite_competencia_restringida() RETURNS integer
LANGUAGE plpgsql SET work_mem TO '128MB' AS $$
DECLARE
  n int;
  v_obs boolean := EXISTS (SELECT 1 FROM senal_en_observacion WHERE tipo = 'comite_competencia_restringida');
  t_rest text[] := ARRAY['unico_postor', 'acta_solo_queda_el_ganador', 'acta_descalificados_por_formalidad',
                         'acta_oferta_mas_baja_descartada', 'solo_admitido_el_ganador'];
BEGIN
  -- Las marcas de competencia de cada proceso (de cruces_proveedor: incluye las que están en observación).
  CREATE TEMP TABLE _rm ON COMMIT DROP AS
  SELECT ocid, array_agg(DISTINCT tipo ORDER BY tipo) AS marcas
    FROM cruces_proveedor WHERE tipo = ANY (t_rest) AND ocid IS NOT NULL GROUP BY ocid;
  CREATE INDEX ON _rm (ocid);
  ANALYZE _rm;

  -- Cada integrante en cada proceso, con las marcas de ese proceso.
  CREATE TEMP TABLE _rr ON COMMIT DROP AS
  SELECT ci.ent, ci.clave, ci.ocid, ci.rol, COALESCE(m.marcas, '{}') AS marcas
    FROM comite_integrante ci LEFT JOIN _rm m ON m.ocid = ci.ocid;
  ANALYZE _rr;

  -- Por persona: sus procesos y los restringidos, contra la entidad sin ella.
  CREATE TEMP TABLE _rp ON COMMIT DROP AS
  WITH ent AS (SELECT ent, count(DISTINCT ocid) AS n, count(DISTINCT ocid) FILTER (WHERE cardinality(marcas) > 0) AS m
                 FROM _rr GROUP BY ent),
       per AS (SELECT ent, clave, count(DISTINCT ocid) AS n, count(DISTINCT ocid) FILTER (WHERE cardinality(marcas) > 0) AS m,
                      (array_agg(rol ORDER BY rol) FILTER (WHERE rol IS NOT NULL))[1] AS rol
                 FROM _rr GROUP BY ent, clave)
  SELECT p.ent, p.clave, p.rol, p.n, p.m, e.n - p.n AS n0, e.m - p.m AS m0,
         ((e.m - p.m) + 0.5) / ((e.n - p.n) + 1.0) AS base,
         binomial_cola(p.n::int, p.m::int, ((e.m - p.m) + 0.5) / ((e.n - p.n) + 1.0)) AS pv
    FROM per p JOIN ent e ON e.ent = p.ent
   WHERE p.n >= 4 AND e.n - p.n >= 5;

  -- Benjamini-Hochberg al 10 % sobre todas las personas probadas.
  CREATE TEMP TABLE _rs ON COMMIT DROP AS
  WITH o AS (SELECT *, row_number() OVER (ORDER BY pv, ent, clave) AS i, count(*) OVER () AS l FROM _rp),
       c AS (SELECT max(i) AS corte FROM o WHERE pv <= 0.10 * i / l)
  SELECT o.*, least(1, o.pv * o.l / o.i) AS q FROM o, c WHERE c.corte IS NOT NULL AND o.i <= c.corte AND o.m > o.n * o.base;

  -- El ganador de cada proceso restringido de esas personas (como la 396).
  CREATE TEMP TABLE _rg ON COMMIT DROP AS
  SELECT c.ocid, COALESCE(m.ruc_miembro, a.ruc_proveedor) AS ruc, max(a.fecha_buenapro) AS f,
         sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS monto,
         max(CASE WHEN m.ruc_miembro IS NOT NULL THEN a.ruc_proveedor END) AS consorcio
    FROM (SELECT DISTINCT r.ocid FROM _rr r JOIN _rs s ON s.ent = r.ent AND s.clave = r.clave WHERE cardinality(r.marcas) > 0) c
    JOIN convocatorias v ON v.ocid = c.ocid
    JOIN conosce_adjudicaciones a ON a.codigo_convocatoria = v.codigo AND a.entidad_ruc = v.entidad_ruc
    LEFT JOIN conosce_consorcios m ON m.ruc_consorcio = a.ruc_proveedor AND a.ruc_proveedor !~ '^(10|20)\d{9}$'
   WHERE COALESCE(m.ruc_miembro, a.ruc_proveedor) ~ '^20\d{9}$'
   GROUP BY c.ocid, COALESCE(m.ruc_miembro, a.ruc_proveedor);

  DELETE FROM cruces_proveedor WHERE tipo = 'comite_competencia_restringida';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, persona_doc, persona_nombre, persona_rol,
                                detalle, fuente, fuente_url)
  SELECT DISTINCT ON (r.ocid, g.ruc)
         'comite_competencia_restringida', g.ruc, r.ocid,
         CASE WHEN s.pv < 0.001 THEN 'alta' ELSE 'media' END,
         g.f, g.monto, NULL, NULL, COALESCE(r.rol, s.rol),
         jsonb_build_object('integrante', left(md5(s.ent || '|' || s.clave), 10), 'rol', COALESCE(r.rol, s.rol),
                            'procesos_de_la_persona', s.n, 'restringidos', s.m,
                            'procesos_entidad_sin_la_persona', s.n0, 'tasa_entidad', round(s.base::numeric, 3),
                            'p_valor', s.pv, 'q_valor', round(s.q::numeric, 4), 'marcas', to_jsonb(r.marcas),
                            'consorcio', g.consorcio,
                            'documento', 'comité del acta (agentes o lector del comité) y banderas de competencia de Vigía',
                            'en_observacion', v_obs),
         'comite_dictamen', NULL
    FROM _rs s
    JOIN _rr r ON r.ent = s.ent AND r.clave = s.clave AND cardinality(r.marcas) > 0
    JOIN _rg g ON g.ocid = r.ocid
   ORDER BY r.ocid, g.ruc, s.pv;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER FUNCTION public.refrescar_cruce_comite_competencia_restringida() OWNER TO vigia_jobs;
    ALTER FUNCTION public.binomial_cola(int, int, float8) OWNER TO vigia_jobs;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_cruce_comite_competencia_restringida() FROM PUBLIC;

-- La tasa base de las tres señales del comité, sobre los procesos con su comité leído (la función de la 408 con esta).
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
              WHEN t.tipo IN ('comite_mismo_ganador', 'comite_socio_proveedor', 'comite_competencia_restringida') THEN u_comite
              WHEN t.tipo ~ '^(obra|inversion)_' THEN NULL
              ELSE u_todos END,
         CASE WHEN NOT t.por_proceso THEN 'empresas que ganaron algún proceso'
              WHEN t.tipo ~ '^visita_|^reunion_en_evaluacion$' THEN 'procesos adjudicados en entidades con registro de visitas'
              WHEN t.tipo LIKE 'acta\_%' THEN 'procesos con el acta de buena pro leída'
              WHEN t.tipo LIKE 'bases\_%' THEN 'procesos con las bases leídas'
              WHEN t.tipo LIKE 'consultas\_%' THEN 'procesos con el pliego de consultas leído'
              WHEN t.tipo = 'ofertas_a_la_vez' THEN 'procesos con dos o más ofertas de empresas y su hora de registro'
              WHEN t.tipo = 'solo_admitido_el_ganador' THEN 'procesos con un ítem adjudicado de cuatro o más ofertas y su reporte de evaluación'
              WHEN t.tipo IN ('comite_mismo_ganador', 'comite_socio_proveedor', 'comite_competencia_restringida') THEN 'procesos con el comité de selección leído (agentes o lector del acta)'
              WHEN t.tipo ~ '^(obra|inversion)_' THEN NULL
              ELSE 'procesos adjudicados' END
    FROM (SELECT tipo, bool_or(ocid IS NOT NULL) AS por_proceso,
                 CASE WHEN bool_or(ocid IS NOT NULL) THEN count(DISTINCT ocid) ELSE count(DISTINCT ruc_empresa) END::int AS casos
            FROM cruces_proveedor GROUP BY tipo) t;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN ALTER FUNCTION public.refrescar_senal_tasa_base() OWNER TO vigia_jobs; END IF; END $$;
REVOKE EXECUTE ON FUNCTION refrescar_senal_tasa_base() FROM PUBLIC;
