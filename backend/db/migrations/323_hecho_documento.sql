-- 323 · hecho_documento: lo que los lectores sacaron de cada documento, como HECHOS con tipo y con su verificación.
--
-- Fase 2 del plan del pipeline de documentos (2026-11-16). El problema que dio origen al plan: un monto leído de unas
-- bases viajaba por el pipeline como «la cuantía del documento», sin decir qué era, y una regla lo comparó contra lo
-- adjudicado (era la experiencia exigida al postor). Un dato sacado de un documento tiene que decir tres cosas:
--   · qué ES, de una lista cerrada (`tipo`): valor_referencial, experiencia_exigida_monto, monto_contratado…;
--   · de dónde sale: qué lector (`clase`, `version`), de qué proceso y con qué cita;
--   · si se pudo COMPROBAR sin modelo (`verificado`):
--       'registro'             coincide con un registro oficial (referencial de la convocatoria, adjudicado en CONOSCE…)
--       'contradice_registro'  no coincide: es una discrepancia real o un error de lectura, y se mira antes de usarlo
--       'cita'                 la cita que el lector copió del documento trae ese mismo valor
--       'dos_lecturas'         dos lecturas independientes dieron el mismo valor
--       'sin_verificar'        ninguna de las anteriores: sirve de contexto, no para sostener una señal
--
-- Se llena desde lo que YA se leyó (documento_lectura, 66 mil lecturas): no vuelve a leer nada ni llama a un modelo.
-- Las reglas y los agentes pasan a leer de aquí por tipo (fase 4); mientras, da la medida de calidad de cada lector:
--   SELECT clase, tipo, verificado, count(*) FROM hecho_documento GROUP BY 1, 2, 3 ORDER BY 1, 2, 4 DESC;
--
-- Sin datos personales: montos, plazos, fechas y citas de bases y contratos (ni nombres ni documentos de personas).

SET lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.hecho_documento (
  ocid         TEXT NOT NULL,
  tipo         TEXT NOT NULL CHECK (tipo IN (
                 'valor_referencial', 'experiencia_exigida_monto', 'experiencia_exigida_anios', 'plazo_dias',
                 'monto_contratado', 'fecha_suscripcion', 'adelanto_directo_pct', 'penalidad_mora_tope_pct',
                 'postores', 'consultas', 'contrato_de_otro_proceso')),
  clase        TEXT NOT NULL,            -- el lector: bases, buena_pro, contrato, consultas
  version      TEXT NOT NULL,
  valor_num    NUMERIC,
  valor_fecha  DATE,
  cita         TEXT,
  verificado   TEXT NOT NULL CHECK (verificado IN ('registro', 'contradice_registro', 'cita', 'dos_lecturas', 'sin_verificar')),
  contra       NUMERIC,                  -- el valor del registro o de la otra lectura contra el que se midió
  modelo       TEXT,
  leido_at     TIMESTAMPTZ,
  PRIMARY KEY (ocid, tipo, clase)
);
COMMENT ON TABLE public.hecho_documento IS
  'Lo que los lectores sacaron de cada documento como hechos con tipo (lista cerrada), su cita y si se comprobó sin modelo '
  '(contra un registro oficial, contra su propia cita o contra una segunda lectura). La rehace refrescar_hecho_documento() '
  'desde documento_lectura (migración 323).';
CREATE INDEX IF NOT EXISTS hecho_documento_tipo ON public.hecho_documento (tipo, verificado);

ALTER TABLE public.hecho_documento OWNER TO vigia_jobs;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.hecho_documento TO %I', r);
    END IF;
  END LOOP;
END $$;

-- Un número de un JSON, o nulo si no es un número (los lectores a veces devuelven texto o nulo).
CREATE OR REPLACE FUNCTION public._hecho_num(j jsonb) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof(j) = 'number' THEN (j #>> '{}')::numeric END
$$;

-- Una fecha «AAAA-MM-DD» de un JSON, o nulo si no lo es o no existe (un 31 de junio). Los CASE van anidados: Postgres
-- sólo garantiza el orden de evaluación dentro de un CASE, y convertir a entero un texto que no es un número falla.
CREATE OR REPLACE FUNCTION public._hecho_fecha(t text) RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN t ~ '^\d{4}-\d{2}-\d{2}' THEN
           CASE WHEN left(t, 4)::int BETWEEN 1990 AND 2100 AND substr(t, 6, 2)::int BETWEEN 1 AND 12 THEN
             CASE WHEN substr(t, 9, 2)::int BETWEEN 1 AND
                       CASE substr(t, 6, 2)::int WHEN 2 THEN 28 WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30 ELSE 31 END
                  THEN left(t, 10)::date END
           END
         END
$$;

CREATE OR REPLACE FUNCTION public.refrescar_hecho_documento() RETURNS integer
LANGUAGE plpgsql SET work_mem = '128MB' SET statement_timeout = '900s' SET search_path = public, pg_temp AS $$
DECLARE v_n int;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('refrescar_hecho_documento')) THEN
    RETURN 0;
  END IF;

  -- La lectura vigente de cada proceso y clase (la primera versión; la segunda lectura, «-2», sirve para comprobar).
  CREATE TEMP TABLE _hd_l ON COMMIT DROP AS
  SELECT DISTINCT ON (d.ocid, d.clase) d.ocid, d.clase, d.version, d.salida, d.modelo, d.leido_at,
         (SELECT z.salida FROM documento_lectura z WHERE z.ocid = d.ocid AND z.clase = d.clase AND z.version = d.version || '-2' AND z.estado = 'ok') AS salida2
    FROM documento_lectura d
   WHERE d.estado = 'ok' AND d.version !~ '-2$' AND jsonb_typeof(d.salida) = 'object'
   ORDER BY d.ocid, d.clase, d.leido_at DESC;
  CREATE INDEX ON _hd_l (ocid);
  ANALYZE _hd_l;

  -- Lo que el registro dice de cada proceso leído: el referencial, lo adjudicado y cuántos postores.
  CREATE TEMP TABLE _hd_r ON COMMIT DROP AS
  SELECT c.ocid, NULLIF(c.cuantia_referencial, 0) AS referencial, c.fecha_buena_pro,
         (SELECT array_agg(a.monto_adjudicado) FROM conosce_adjudicaciones a WHERE a.codigo_convocatoria = c.codigo AND a.monto_adjudicado > 0) AS adjudicados,
         (SELECT count(DISTINCT p.ruc_postor)::int FROM conosce_postores p WHERE p.codigo_convocatoria = c.codigo) AS postores
    FROM convocatorias c WHERE c.ocid IN (SELECT ocid FROM _hd_l);
  CREATE INDEX ON _hd_r (ocid);
  ANALYZE _hd_r;

  DELETE FROM hecho_documento;

  -- El valor referencial, según las bases y según el acta: se mide contra el del registro.
  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, contra, modelo, leido_at)
  SELECT l.ocid, 'valor_referencial', l.clase, l.version, v.vr,
         CASE WHEN r.referencial IS NULL THEN 'sin_verificar'
              WHEN abs(v.vr - r.referencial) <= 0.005 * r.referencial THEN 'registro' ELSE 'contradice_registro' END,
         r.referencial, l.modelo, l.leido_at
    FROM _hd_l l LEFT JOIN _hd_r r ON r.ocid = l.ocid
   CROSS JOIN LATERAL (SELECT _hecho_num(l.salida->'valor_referencial') AS vr) v
   WHERE l.clase IN ('bases', 'buena_pro') AND v.vr > 0;

  -- La experiencia que se exige al postor: la cita copiada de las bases tiene que traer el monto.
  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, cita, verificado, contra, modelo, leido_at)
  SELECT l.ocid, 'experiencia_exigida_monto', l.clase, l.version, e.monto, NULLIF(left(e.cita, 600), ''),
         CASE WHEN regexp_replace(e.cita, '[^0-9]', '', 'g') LIKE '%' || trunc(e.monto)::text || '%' THEN 'cita'
              WHEN e.monto2 IS NOT NULL AND abs(e.monto - e.monto2) <= 0.01 * e.monto THEN 'dos_lecturas' ELSE 'sin_verificar' END,
         r.referencial, l.modelo, l.leido_at
    FROM _hd_l l LEFT JOIN _hd_r r ON r.ocid = l.ocid
   CROSS JOIN LATERAL (SELECT _hecho_num(l.salida->'experiencia_postor'->'monto_minimo') AS monto,
                              _hecho_num(l.salida2->'experiencia_postor'->'monto_minimo') AS monto2,
                              COALESCE(l.salida->'experiencia_postor'->>'cita', '') AS cita) e
   WHERE l.clase = 'bases' AND e.monto > 0;

  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, modelo, leido_at)
  SELECT l.ocid, 'experiencia_exigida_anios', l.clase, l.version, _hecho_num(l.salida->'experiencia_postor'->'anios'), 'sin_verificar', l.modelo, l.leido_at
    FROM _hd_l l WHERE l.clase = 'bases' AND _hecho_num(l.salida->'experiencia_postor'->'anios') > 0;

  -- El plazo, según las bases y según el contrato: si los dos documentos dicen lo mismo, se comprobó entre ellos.
  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, contra, modelo, leido_at)
  SELECT l.ocid, 'plazo_dias', l.clase, l.version, p.plazo,
         CASE WHEN o.plazo IS NOT NULL AND o.plazo = p.plazo THEN 'dos_lecturas' ELSE 'sin_verificar' END, o.plazo, l.modelo, l.leido_at
    FROM _hd_l l
   CROSS JOIN LATERAL (SELECT _hecho_num(l.salida->'plazo_dias') AS plazo) p
    LEFT JOIN LATERAL (SELECT _hecho_num(x.salida->'plazo_dias') AS plazo FROM _hd_l x
                        WHERE x.ocid = l.ocid AND x.clase = CASE l.clase WHEN 'bases' THEN 'contrato' ELSE 'bases' END) o ON true
   WHERE l.clase IN ('bases', 'contrato') AND p.plazo > 0;

  -- El contrato: su monto contra lo adjudicado en CONOSCE (un ítem o el total); su fecha contra la de la buena pro.
  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, contra, modelo, leido_at)
  SELECT l.ocid, 'monto_contratado', l.clase, l.version, m.monto,
         CASE WHEN r.adjudicados IS NULL THEN 'sin_verificar'
              WHEN EXISTS (SELECT 1 FROM unnest(r.adjudicados) v WHERE abs(m.monto - v) <= 0.005 * v)
                   OR abs(m.monto - t.total) <= 0.005 * t.total THEN 'registro' ELSE 'contradice_registro' END,
         t.total, l.modelo, l.leido_at
    FROM _hd_l l LEFT JOIN _hd_r r ON r.ocid = l.ocid
   CROSS JOIN LATERAL (SELECT _hecho_num(l.salida->'monto_contratado') AS monto) m
    LEFT JOIN LATERAL (SELECT sum(v) AS total FROM unnest(r.adjudicados) v) t ON true
   WHERE l.clase = 'contrato' AND m.monto > 0 AND COALESCE(l.salida->>'es_contrato', 'true') <> 'false';

  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_fecha, verificado, modelo, leido_at)
  SELECT l.ocid, 'fecha_suscripcion', l.clase, l.version, f.fecha,
         CASE WHEN r.fecha_buena_pro IS NULL THEN 'sin_verificar'
              WHEN f.fecha >= r.fecha_buena_pro AND f.fecha <= r.fecha_buena_pro + 365 THEN 'registro' ELSE 'contradice_registro' END,
         l.modelo, l.leido_at
    FROM _hd_l l LEFT JOIN _hd_r r ON r.ocid = l.ocid
   CROSS JOIN LATERAL (SELECT _hecho_fecha(l.salida->>'fecha_suscripcion') AS fecha) f
   WHERE l.clase = 'contrato' AND f.fecha IS NOT NULL AND COALESCE(l.salida->>'es_contrato', 'true') <> 'false';

  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, modelo, leido_at)
  SELECT l.ocid, x.tipo, l.clase, l.version, x.v, 'sin_verificar', l.modelo, l.leido_at
    FROM _hd_l l
   CROSS JOIN LATERAL (VALUES ('adelanto_directo_pct', _hecho_num(l.salida->'adelanto_directo_pct')),
                              ('penalidad_mora_tope_pct', _hecho_num(l.salida->'penalidad_mora_tope_pct'))) AS x(tipo, v)
   WHERE l.clase = 'contrato' AND x.v > 0 AND COALESCE(l.salida->>'es_contrato', 'true') <> 'false';

  -- El archivo publicado como contrato que el lector dice que es de otra compra.
  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, modelo, leido_at)
  SELECT l.ocid, 'contrato_de_otro_proceso', l.clase, l.version, 1, 'sin_verificar', l.modelo, l.leido_at
    FROM _hd_l l WHERE l.clase = 'contrato' AND l.salida->>'es_contrato' = 'false';

  -- El acta: cuántos postores, contra los que registra CONOSCE.
  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, contra, modelo, leido_at)
  SELECT l.ocid, 'postores', l.clase, l.version, n.n,
         CASE WHEN COALESCE(r.postores, 0) = 0 THEN 'sin_verificar' WHEN r.postores = n.n THEN 'registro' ELSE 'contradice_registro' END,
         r.postores, l.modelo, l.leido_at
    FROM _hd_l l LEFT JOIN _hd_r r ON r.ocid = l.ocid
   CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(l.salida->'postores') = 'array' THEN jsonb_array_length(l.salida->'postores') END AS n) n
   WHERE l.clase = 'buena_pro' AND n.n > 0;

  -- El pliego: cuántas consultas y observaciones; si hay segunda lectura, tiene que dar la misma cuenta.
  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, contra, modelo, leido_at)
  SELECT l.ocid, 'consultas', l.clase, l.version, _hecho_num(l.salida->'n_consultas'),
         CASE WHEN _hecho_num(l.salida2->'n_consultas') = _hecho_num(l.salida->'n_consultas') THEN 'dos_lecturas' ELSE 'sin_verificar' END,
         _hecho_num(l.salida2->'n_consultas'), l.modelo, l.leido_at
    FROM _hd_l l WHERE l.clase = 'consultas' AND _hecho_num(l.salida->'n_consultas') > 0;

  SELECT count(*) INTO v_n FROM hecho_documento;
  ANALYZE hecho_documento;
  RETURN v_n;
END $$;
ALTER FUNCTION public.refrescar_hecho_documento() OWNER TO vigia_jobs;

SET statement_timeout = '900s';
SELECT refrescar_hecho_documento() AS hechos;
