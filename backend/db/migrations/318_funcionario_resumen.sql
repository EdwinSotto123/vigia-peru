-- 318_funcionario_resumen.sql — Las personas con cargo público, para poder ENCONTRARLAS y ver su rastro.
--
-- Pedido del dueño (2026-11-16): el titular de un organismo del Estado «no aparece en la BBDD… no aparece nada de su
-- rastro». Sí estaba: 14 declaraciones juradas de intereses en 5 entidades y 81 visitas a 19 entidades. Lo que faltaba era
-- por dónde llegar: el buscador de la web no busca personas, y «Personas contratadas» sólo trae a quien recibió órdenes o
-- ganó procesos. Quien tiene un cargo de decisión y nunca fue proveedor no tenía ficha.
--
-- Quién tiene «cargo público» aquí: quien presentó una declaración jurada de intereses a la Contraloría (dji_funcionarios,
-- 1,8 M de declaraciones de 443 mil personas). La ley obliga a declarar justamente a quien decide: titulares, directivos,
-- quienes contratan, administran fondos o integran comités.
--
--   funcionario_codigo     el código de ficha de cada persona (al azar, estable entre refrescos): nunca su documento.
--   funcionario_resumen    una fila por persona: sus apellidos y nombres aparte, las palabras por las que se la puede buscar
--                          (`palabras`: el apellido paterno y los nombres, que es lo que se muestra), cuántas declaraciones,
--                          en cuántas entidades y su último cargo.
--   dji_fecha(text)        las fechas de la DJI vienen como texto «DD/MM/AA».
--   refrescar_funcionario_resumen()   la rehace entera (la captura de DJI está parada: basta correrla tras cada carga).
--
-- La persona es su NOMBRE COMPLETO normalizado (dji_funcionarios no guarda el documento): dos homónimos exactos comparten
-- ficha, y la ficha lo dice. Dos personas que sólo comparten el apellido paterno y los nombres son dos fichas.
--
-- Privacidad: la tabla guarda el nombre entero; de la API sale con el apellido materno tapado y se busca SÓLO por
-- `palabras` (lo visible): buscar por el materno no devuelve a nadie, así no se puede confirmar probando. Sólo la API la lee.

SET lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.dji_fecha(t text) RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN t ~ '^\d{2}/\d{2}/\d{2}$' THEN to_date(t, 'DD/MM/YY')
              WHEN t ~ '^\d{2}/\d{2}/\d{4}' THEN to_date(left(t, 10), 'DD/MM/YYYY')
              WHEN t ~ '^\d{4}-\d{2}-\d{2}' THEN to_date(left(t, 10), 'YYYY-MM-DD') END
$$;
COMMENT ON FUNCTION public.dji_fecha(text) IS 'Una fecha de la DJI («DD/MM/AA», texto) como date; null si no tiene esa forma (migración 318).';

CREATE TABLE IF NOT EXISTS public.funcionario_codigo (
  nombre_norm TEXT PRIMARY KEY,
  codigo      TEXT NOT NULL UNIQUE DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
);
COMMENT ON TABLE public.funcionario_codigo IS
  'El código de ficha (al azar) de cada persona con declaración jurada de intereses, por su nombre completo normalizado (migración 318).';

CREATE TABLE IF NOT EXISTS public.funcionario_resumen (
  codigo         TEXT    PRIMARY KEY,
  nombre_norm    TEXT    NOT NULL UNIQUE,   -- el nombre completo: nunca sale de la API
  paterno        TEXT    NOT NULL,
  materno        TEXT,                      -- se tapa siempre
  nombres        TEXT    NOT NULL,
  palabras       TEXT[]  NOT NULL,          -- paterno + nombres, palabra por palabra (mef_norm): por aquí se busca
  declaraciones  INT     NOT NULL,
  entidades      INT     NOT NULL,
  cargo          TEXT,                      -- el de su declaración más reciente
  entidad        TEXT,
  entidad_ruc    TEXT,
  primera        DATE,
  ultima         DATE
);
COMMENT ON TABLE public.funcionario_resumen IS
  'Una fila por persona con declaración jurada de intereses (Contraloría): su último cargo y entidad, cuántas declaraciones '
  'y las palabras visibles de su nombre para buscarla. La rehace refrescar_funcionario_resumen(). El nombre completo sólo '
  'sale de la API con el apellido materno tapado (migración 318).';
CREATE INDEX IF NOT EXISTS funcionario_resumen_palabras ON public.funcionario_resumen USING gin (palabras);

ALTER TABLE public.funcionario_codigo OWNER TO vigia_jobs;
ALTER TABLE public.funcionario_resumen OWNER TO vigia_jobs;
REVOKE ALL ON public.funcionario_codigo, public.funcionario_resumen FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON public.funcionario_codigo, public.funcionario_resumen FROM %I', r);
    END IF;
  END LOOP;
  -- Sólo la API, que tapa el apellido materno al publicar. El MCP y los agentes llegan por ella.
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.funcionario_resumen TO %I', r);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.refrescar_funcionario_resumen() RETURNS integer
LANGUAGE plpgsql SET work_mem = '128MB' SET statement_timeout = '900s' SET search_path = public, pg_temp AS $$
DECLARE v_filas int;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('refrescar_funcionario_resumen')) THEN
    RETURN 0;                       -- ya hay otra corriendo
  END IF;

  -- El código de quien todavía no lo tiene (el de los demás no cambia: los enlaces a su ficha siguen valiendo).
  INSERT INTO funcionario_codigo (nombre_norm)
  SELECT DISTINCT d.nombre_norm FROM dji_funcionarios d
   WHERE d.nombre_norm <> '' AND COALESCE(d.apellido_paterno, '') <> '' AND COALESCE(d.nombres, '') <> ''
  ON CONFLICT (nombre_norm) DO NOTHING;

  DELETE FROM funcionario_resumen;
  INSERT INTO funcionario_resumen
    (codigo, nombre_norm, paterno, materno, nombres, palabras, declaraciones, entidades, cargo, entidad, entidad_ruc, primera, ultima)
  WITH d AS (
    SELECT x.nombre_norm, x.apellido_paterno, x.apellido_materno, x.nombres, x.cargo, x.entidad, x.codigo_ddjj,
           dji_fecha(x.fecha_presentacion) AS presentada
      FROM dji_funcionarios x
     WHERE x.nombre_norm <> '' AND COALESCE(x.apellido_paterno, '') <> '' AND COALESCE(x.nombres, '') <> ''
  ), ult AS (
    -- Su declaración más reciente da el cargo y la entidad que se muestran.
    SELECT DISTINCT ON (d.nombre_norm) d.nombre_norm, d.apellido_paterno, d.apellido_materno, d.nombres, d.cargo, d.entidad
      FROM d ORDER BY d.nombre_norm, d.presentada DESC NULLS LAST, d.codigo_ddjj DESC
  ), cta AS (
    SELECT d.nombre_norm, count(DISTINCT d.codigo_ddjj)::int AS declaraciones, count(DISTINCT d.entidad)::int AS entidades,
           min(d.presentada) AS primera, max(d.presentada) AS ultima
      FROM d GROUP BY d.nombre_norm
  )
  SELECT c.codigo, u.nombre_norm, mef_norm(u.apellido_paterno), NULLIF(mef_norm(u.apellido_materno), ''), mef_norm(u.nombres),
         ARRAY(SELECT DISTINCT w FROM unnest(string_to_array(mef_norm(u.apellido_paterno || ' ' || u.nombres), ' ')) w WHERE length(w) >= 2),
         a.declaraciones, a.entidades, NULLIF(btrim(u.cargo), ''), NULLIF(btrim(u.entidad), ''),
         (SELECT r.ruc FROM dji_entidad_ruc r WHERE r.entidad = u.entidad), a.primera, a.ultima
    FROM ult u JOIN cta a USING (nombre_norm) JOIN funcionario_codigo c USING (nombre_norm);
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  ANALYZE funcionario_resumen;
  RETURN v_filas;
END $$;
ALTER FUNCTION public.refrescar_funcionario_resumen() OWNER TO vigia_jobs;

SET statement_timeout = '900s';
SELECT refrescar_funcionario_resumen() AS personas_con_cargo_publico;
