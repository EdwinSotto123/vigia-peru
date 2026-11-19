-- 402 · Las apelaciones que resuelve el Tribunal de Contrataciones, unidas a su contrato.
--
-- La verdad de la etapa de selección que Vigía no tenía (docs/DATOS_Y_SENALES.md §15.1): el Tribunal declara FUNDADA
-- una apelación cuando el comité se equivocó al otorgar la buena pro o al descalificar a un postor, y declara la
-- NULIDAD DE OFICIO cuando el procedimiento tenía un vicio que lo invalida. Son hechos oficiales y públicos.
--
-- De dónde: el texto de cada resolución (gob.pe, colecciones del OECE; backend/scripts/normas_descarga/bajar_tribunal.py)
-- leído por backend/lector/tribunal.py (GLM por Workers AI, con la cita del resolutivo y cada procedimiento comprobados
-- en el texto) y cargado por backend/scripts/tribunal_cargar.py, que también une cada procedimiento a su contrato.
--
--   convocatoria_nomenclatura  la nomenclatura de cada proceso (OCDS tender.title), partida en tipo, número, año, sigla y
--                              convocatoria, con índice: sirve para unir cualquier texto que nombre un proceso.
--   tribunal_resolucion        una fila por resolución leída que resuelve una apelación.
--   tribunal_proceso           cada procedimiento que la resolución nombra, con su contrato si se pudo unir sin duda.

CREATE TABLE IF NOT EXISTS convocatoria_nomenclatura (
  ocid          text PRIMARY KEY,
  nomenclatura  text NOT NULL,
  tipo          text NOT NULL,      -- la primera sigla: LP, AS, CP, SIE, COMPRE, DIRECTA, PEC…
  prefijo       text NOT NULL,      -- todo lo que va antes del número (LP-ABR, AS-SM…)
  num           int NOT NULL,
  anio          int NOT NULL,
  sigla         text NOT NULL,      -- lo que va entre el año y la convocatoria (MDH/C, GRA/CS…)
  conv          int,
  entidad_ruc   text
);
CREATE INDEX IF NOT EXISTS convocatoria_nomenclatura_clave ON convocatoria_nomenclatura (tipo, num, anio);

CREATE OR REPLACE FUNCTION refrescar_convocatoria_nomenclatura() RETURNS integer
LANGUAGE plpgsql SET work_mem = '128MB' AS $$
DECLARE n int;
BEGIN
  DELETE FROM convocatoria_nomenclatura;
  INSERT INTO convocatoria_nomenclatura (ocid, nomenclatura, tipo, prefijo, num, anio, sigla, conv, entidad_ruc)
  SELECT x.ocid, x.nom, split_part(split_part((x.m)[1], '-', 1), ' ', 1), (x.m)[1], (x.m)[2]::int, (x.m)[3]::int, (x.m)[4],
         (x.m)[5]::int, btrim(x.entidad_ruc::text)
    FROM (
      SELECT c.ocid, c.entidad_ruc, upper(public.immutable_unaccent(c.ocds_payload -> 'tender' ->> 'title')) AS nom,
             regexp_match(upper(public.immutable_unaccent(c.ocds_payload -> 'tender' ->> 'title')),
                          '^(.*)-0*([0-9]{1,6})-((?:19|20)[0-9]{2})-(.+)-([0-9]{1,3})$') AS m
        FROM convocatorias c
       WHERE c.ocid NOT LIKE 'ocds-vigia-%' AND c.ocds_payload -> 'tender' ->> 'title' IS NOT NULL
    ) x
   WHERE x.m IS NOT NULL AND (x.m)[3]::int BETWEEN 2010 AND 2100
  ON CONFLICT (ocid) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE convocatoria_nomenclatura;
  RETURN n;
END $$;

CREATE TABLE IF NOT EXISTS tribunal_resolucion (
  id            bigint PRIMARY KEY,                -- el número de la página en gob.pe
  titulo        text NOT NULL,                     -- «Resolución N.° 9712-2026-TCP-S4»
  numero        int,
  anio          int,
  sala          text,
  tribunal      text CHECK (tribunal IN ('TCE', 'TCP')),
  fecha         date,
  resultado     text CHECK (resultado IN ('fundado', 'fundado_en_parte', 'infundado', 'improcedente', 'nulidad_de_oficio',
                                          'desistimiento', 'otro')),
  efectos       text[] NOT NULL DEFAULT '{}',
  entidad       text,
  impugnante    text,                              -- puede ser una persona natural: la API sólo publica empresas
  motivo        text,
  cita          text,
  cita_ok       boolean NOT NULL DEFAULT false,
  url           text NOT NULL,
  pdf           text,
  modelo        text,
  version       text,
  costo_usd     numeric(10, 6),
  leido_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tribunal_resolucion_resultado ON tribunal_resolucion (resultado);

CREATE TABLE IF NOT EXISTS tribunal_proceso (
  resolucion_id bigint NOT NULL REFERENCES tribunal_resolucion (id) ON DELETE CASCADE,
  n             int NOT NULL,
  texto         text NOT NULL,                     -- el procedimiento como lo escribe la resolución
  ocid          text,                              -- el contrato en Vigía, si se unió sin duda
  via           text CHECK (via IN ('exacta', 'sigla_y_entidad')),
  PRIMARY KEY (resolucion_id, n)
);
CREATE INDEX IF NOT EXISTS tribunal_proceso_ocid ON tribunal_proceso (ocid) WHERE ocid IS NOT NULL;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.convocatoria_nomenclatura OWNER TO vigia_jobs;
    ALTER TABLE public.tribunal_resolucion OWNER TO vigia_jobs;
    ALTER TABLE public.tribunal_proceso OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_convocatoria_nomenclatura() OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.tribunal_resolucion, public.tribunal_proceso, public.convocatoria_nomenclatura TO %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_convocatoria_nomenclatura() FROM PUBLIC;
