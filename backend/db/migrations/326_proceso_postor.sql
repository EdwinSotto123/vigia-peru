-- 326 · proceso_postor y proceso_item: la competencia de cada proceso, leída de los reportes que genera el SEACE.
--
-- Fase 2a del plan de extracción por tipo de documento. Los reportes del SEACE se leen sin modelo (pieza_lectura, migración
-- 325) y juntos cuentan la competencia entera de un proceso, ítem por ítem:
--   · presentación de ofertas   quién presentó, con fecha y hora
--   · evaluación técnica        a quién se admitió, a quién se calificó y con qué puntaje
--   · otorgamiento              la cuantía del ítem, el resultado, quién ganó y por cuánto, y los integrantes del consorcio
--   · desempate                 el orden de prelación cuando hubo empate
-- Hasta hoy estos datos salían de una lectura con modelo del acta (postores: 87,1 % de acierto contra el registro) o no
-- salían: la admisión y la calificación por postor no están en ningún registro que Vigía tenga.
--
-- proceso_item    un renglón por ítem: cuantía, resultado, cuántas ofertas, cuántas admitidas y calificadas, lo adjudicado
-- proceso_postor  un renglón por postor e ítem, uniendo los cuatro reportes por el nombre (el reporte de evaluación no
--                 trae el RUC, sólo el nombre; el código es el RUC o el que el SEACE le da a un consorcio)
-- Las rehace refrescar_proceso_postor() desde pieza_lectura. Sólo usa lecturas en estado ok (sin líneas sobrantes).
--
-- Privacidad: un postor puede ser una persona (RUC 10), igual que en conosce_postores. La API tapa un apellido al
-- publicar y nunca muestra ni enlaza un RUC 10. No hay DNI.

SET lock_timeout = '10s';

-- Un nombre comparable: sin tildes, en mayúsculas, sólo letras y números con espacios simples.
CREATE OR REPLACE FUNCTION public.nombre_plano(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(translate(upper(coalesce(t, '')), 'ÁÉÍÓÚÜ', 'AEIOUU'), '[^A-Z0-9Ñ]+', ' ', 'g'))
$$;

CREATE TABLE IF NOT EXISTS public.proceso_item (
  ocid                 TEXT NOT NULL,
  item                 INT NOT NULL,
  descripcion          TEXT,
  resultado            TEXT,            -- adjudicado | desierto | monto_mayor | cancelado | nulo | otro (del reporte de otorgamiento)
  cuantia              NUMERIC,         -- la del ítem, como la publica el reporte («Valor Referencial»)
  moneda               TEXT,
  unidad               TEXT,
  cantidad_solicitada  NUMERIC,
  cantidad_desierta    NUMERIC,
  ofertas              INT,             -- nulo si no se leyó el reporte de presentación
  admitidas            INT,             -- nulo si no se leyó el de evaluación
  calificadas          INT,
  monto_adjudicado     NUMERIC,
  ganadores            INT,
  fuentes              TEXT[] NOT NULL DEFAULT '{}',
  generado             DATE,            -- cuándo generó el SEACE el reporte más reciente
  actualizado_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ocid, item)
);
COMMENT ON TABLE public.proceso_item IS
  'Cada ítem de un proceso según los reportes que genera el SEACE (leídos sin modelo): cuantía, resultado, ofertas, '
  'admitidas, calificadas y adjudicado. La rehace refrescar_proceso_postor() (migración 326).';

CREATE TABLE IF NOT EXISTS public.proceso_postor (
  ocid                 TEXT NOT NULL,
  item                 INT NOT NULL,
  nombre_plano         TEXT NOT NULL,
  nombre               TEXT NOT NULL,
  codigo               TEXT,            -- RUC, o el código que el SEACE le da a un consorcio
  presento_at          TIMESTAMP,       -- hora de Lima, del reporte de presentación
  forma                TEXT,
  registro             TEXT,
  admitida             BOOLEAN,
  calificada           BOOLEAN,
  puntaje_tecnico      NUMERIC,
  orden_prelacion      INT,
  puntaje_total        NUMERIC,
  gano                 BOOLEAN NOT NULL DEFAULT false,
  monto_adjudicado     NUMERIC,
  cantidad_adjudicada  NUMERIC,
  integrantes          JSONB,           -- [{ruc, nombre}] si es un consorcio
  fuentes              TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (ocid, item, nombre_plano)
);
COMMENT ON TABLE public.proceso_postor IS
  'Cada postor de cada ítem según los reportes que genera el SEACE: cuándo presentó, si fue admitido y calificado, su '
  'puntaje, si ganó y por cuánto. Puede traer personas (RUC 10): la API tapa al publicar. La rehace '
  'refrescar_proceso_postor() (migración 326).';
CREATE INDEX IF NOT EXISTS proceso_postor_codigo ON public.proceso_postor (codigo) WHERE codigo IS NOT NULL;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.proceso_item OWNER TO vigia_jobs;
    ALTER TABLE public.proceso_postor OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.proceso_item, public.proceso_postor TO %I', r);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.refrescar_proceso_postor() RETURNS integer
LANGUAGE plpgsql SET work_mem = '128MB' SET statement_timeout = '900s' SET search_path = public, pg_temp AS $$
DECLARE v_n int;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('refrescar_proceso_postor')) THEN
    RETURN 0;
  END IF;

  -- Cada ítem de cada reporte leído sin sobras. Del mismo reporte repetido (dos copias en el expediente, o uno vuelto a
  -- generar) queda el que el SEACE generó último.
  CREATE TEMP TABLE _pp_i ON COMMIT DROP AS
  SELECT DISTINCT ON (p.ocid, l.lector, (i.it->>'item')::int)
         p.ocid, l.lector, (i.it->>'item')::int AS item, i.it, _hecho_fecha(l.salida->>'generado') AS generado
    FROM pieza_lectura l JOIN documento_pieza p ON p.id = l.pieza_id
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(l.salida->'items') = 'array' THEN l.salida->'items'
                                                ELSE '[]'::jsonb END) AS i(it)
   WHERE l.estado = 'ok' AND l.modelo = 'plantilla' AND (i.it->>'item') ~ '^\d{1,6}$'
   ORDER BY p.ocid, l.lector, (i.it->>'item')::int, _hecho_fecha(l.salida->>'generado') DESC NULLS LAST, l.leido_at DESC;
  CREATE INDEX ON _pp_i (ocid, item, lector);
  ANALYZE _pp_i;

  -- Las filas de postores de los cuatro reportes, con el nombre comparable.
  CREATE TEMP TABLE _pp_f ON COMMIT DROP AS
  SELECT i.ocid, i.item, nombre_plano(o->>'nombre') AS np, o->>'nombre' AS nombre, o->>'ruc' AS codigo,
         CASE WHEN (o->>'hora') ~ '^([01]?\d|2[0-3]):[0-5]\d:[0-5]\d$' AND _hecho_fecha(o->>'fecha') IS NOT NULL
              THEN _hecho_fecha(o->>'fecha') + (o->>'hora')::time END AS presento_at,
         o->>'forma' AS forma, NULL::text AS registro, NULL::boolean AS admitida, NULL::boolean AS calificada,
         NULL::numeric AS puntaje_tecnico, NULL::int AS orden, NULL::numeric AS puntaje_total, false AS gano,
         NULL::numeric AS monto, NULL::numeric AS cantidad, NULL::jsonb AS integrantes, 'reporte_presentacion'::text AS fuente
    FROM _pp_i i CROSS JOIN LATERAL jsonb_array_elements(i.it->'ofertas') o
   WHERE i.lector = 'reporte_presentacion' AND jsonb_typeof(i.it->'ofertas') = 'array'
  UNION ALL
  SELECT i.ocid, i.item, nombre_plano(o->>'nombre'), o->>'nombre', NULL, NULL, NULL, o->>'registro',
         CASE o->>'admitida' WHEN 'true' THEN true WHEN 'false' THEN false END,
         CASE o->>'calificada' WHEN 'true' THEN true WHEN 'false' THEN false END,
         _hecho_num(o->'puntaje_tecnico'), NULL, NULL, false, NULL, NULL, NULL, 'reporte_evaluacion'
    FROM _pp_i i CROSS JOIN LATERAL jsonb_array_elements(i.it->'postores') o
   WHERE i.lector = 'reporte_evaluacion' AND jsonb_typeof(i.it->'postores') = 'array'
  UNION ALL
  SELECT i.ocid, i.item, nombre_plano(o->>'nombre'), o->>'nombre', o->>'ruc', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true,
         _hecho_num(o->'monto'), _hecho_num(o->'cantidad'), NULLIF(o->'integrantes', '[]'::jsonb), 'reporte_otorgamiento'
    FROM _pp_i i CROSS JOIN LATERAL jsonb_array_elements(i.it->'adjudicados') o
   WHERE i.lector = 'reporte_otorgamiento' AND jsonb_typeof(i.it->'adjudicados') = 'array'
  UNION ALL
  SELECT i.ocid, i.item, nombre_plano(o->>'nombre'), o->>'nombre', o->>'ruc', NULL, NULL, NULL, NULL, NULL,
         _hecho_num(o->'puntaje_tecnico'), _hecho_num(o->'orden')::int, _hecho_num(o->'puntaje_total'), false, NULL, NULL, NULL,
         'reporte_desempate'
    FROM _pp_i i CROSS JOIN LATERAL jsonb_array_elements(i.it->'postores') o
   WHERE i.lector = 'reporte_desempate' AND jsonb_typeof(i.it->'postores') = 'array';
  ANALYZE _pp_f;

  DELETE FROM proceso_postor;
  INSERT INTO proceso_postor (ocid, item, nombre_plano, nombre, codigo, presento_at, forma, registro, admitida, calificada,
                              puntaje_tecnico, orden_prelacion, puntaje_total, gano, monto_adjudicado, cantidad_adjudicada,
                              integrantes, fuentes)
  SELECT f.ocid, f.item, f.np, (array_agg(f.nombre ORDER BY length(f.nombre) DESC))[1], max(f.codigo), max(f.presento_at),
         max(f.forma), max(f.registro), bool_or(f.admitida), bool_or(f.calificada), max(f.puntaje_tecnico), min(f.orden),
         max(f.puntaje_total), bool_or(f.gano), max(f.monto), max(f.cantidad),
         (array_agg(f.integrantes) FILTER (WHERE f.integrantes IS NOT NULL))[1], array_agg(DISTINCT f.fuente)
    FROM _pp_f f WHERE f.np <> '' GROUP BY f.ocid, f.item, f.np;

  DELETE FROM proceso_item;
  INSERT INTO proceso_item (ocid, item, descripcion, resultado, cuantia, moneda, unidad, cantidad_solicitada, cantidad_desierta,
                            ofertas, admitidas, calificadas, monto_adjudicado, ganadores, fuentes, generado)
  SELECT k.ocid, k.item, COALESCE(o.it->>'descripcion', e.it->>'descripcion', p.it->>'descripcion'),
         o.it->>'resultado', _hecho_num(o.it->'valor_referencial'), o.it->>'moneda', o.it->>'unidad',
         _hecho_num(o.it->'cantidad_solicitada'), _hecho_num(o.it->'cantidad_desierta'),
         CASE WHEN jsonb_typeof(p.it->'ofertas') = 'array' THEN jsonb_array_length(p.it->'ofertas') END,
         CASE WHEN jsonb_typeof(e.it->'postores') = 'array'
              THEN (SELECT count(*) FILTER (WHERE x->>'admitida' = 'true')::int FROM jsonb_array_elements(e.it->'postores') x) END,
         CASE WHEN jsonb_typeof(e.it->'postores') = 'array'
              THEN (SELECT count(*) FILTER (WHERE x->>'calificada' = 'true')::int FROM jsonb_array_elements(e.it->'postores') x) END,
         CASE WHEN jsonb_typeof(o.it->'adjudicados') = 'array'
              THEN (SELECT sum(_hecho_num(x->'monto')) FROM jsonb_array_elements(o.it->'adjudicados') x) END,
         CASE WHEN jsonb_typeof(o.it->'adjudicados') = 'array' THEN jsonb_array_length(o.it->'adjudicados') END,
         array_remove(ARRAY[CASE WHEN p.it IS NOT NULL THEN 'reporte_presentacion' END,
                            CASE WHEN e.it IS NOT NULL THEN 'reporte_evaluacion' END,
                            CASE WHEN o.it IS NOT NULL THEN 'reporte_otorgamiento' END], NULL),
         GREATEST(o.generado, e.generado, p.generado)
    FROM (SELECT DISTINCT ocid, item FROM _pp_i WHERE lector <> 'reporte_desempate') k
    LEFT JOIN _pp_i p ON p.ocid = k.ocid AND p.item = k.item AND p.lector = 'reporte_presentacion'
    LEFT JOIN _pp_i e ON e.ocid = k.ocid AND e.item = k.item AND e.lector = 'reporte_evaluacion'
    LEFT JOIN _pp_i o ON o.ocid = k.ocid AND o.item = k.item AND o.lector = 'reporte_otorgamiento';

  SELECT count(*) INTO v_n FROM proceso_postor;
  ANALYZE proceso_postor;
  ANALYZE proceso_item;
  RETURN v_n;
END $$;

ALTER FUNCTION public.refrescar_proceso_postor() OWNER TO vigia_jobs;
