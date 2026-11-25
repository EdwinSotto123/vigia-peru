-- 445: en qué quedó la declaración jurada de intereses de cada persona con ficha de cargo (2026-11-25).
--
-- La ficha decía «No declaró familiares con documento» tanto de quien no declara ninguno como de quien todavía no
-- leímos, o de quien el portal de la Contraloría nunca nos entregó (pedido del usuario: «debería decir "No hemos leído
-- su declaración jurada aún" o "Se leyó y no declara familiares"»). Ahora cada persona con declaraciones lleva su estado:
--
--   leida            sus familiares están leídos (funcionario_familia_resumen: los cruces con órdenes y empresas)
--   sin_familiares   su última declaración no trae familiares: lo dice el dato abierto (dji_parentesco no tiene fila de
--                    esa declaración y el archivo ya la cubría) o el PDF leído marca «No» en la sección 7
--   ilegible         el PDF se bajó pero no se pudo leer (escaneado o con otro formato)
--   no_entregada     el portal no devolvió su declaración (dji_descargas: «sin resultados»)
--   por_leer         todavía no la leemos (pendiente, fuera de la lista de descarga, o leída sin poder atribuirla)
--
-- `declarados`: cuántos familiares trae su última declaración según el dato abierto (dji_parentesco, sin nombres ni
-- documentos), o null si esa declaración es posterior al archivo. La API sólo publica el total, nunca el parentesco.
--
-- dji_parentesco_carga anota cada carga de dji_parentesco (backend/scripts/cargar_dji_parentesco.py) con la fecha más
-- nueva del archivo: una declaración más antigua sin fila en dji_parentesco es una que no declara familiares.

CREATE TABLE IF NOT EXISTS public.dji_parentesco_carga (
  id             serial PRIMARY KEY,
  archivo        text NOT NULL,
  filas          bigint NOT NULL,
  declaraciones  int NOT NULL,
  hasta          date,
  cargado_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.dji_parentesco_carga IS
  'Cada carga de dji_parentesco (dato abierto de familiares de la Contraloría): archivo, filas y fecha más nueva. Migración 445.';

CREATE TABLE IF NOT EXISTS public.funcionario_dji_estado (
  codigo         text PRIMARY KEY,          -- funcionario_codigo.codigo (la ficha de cargo)
  declaraciones  int NOT NULL,
  ultima         date,                      -- presentación de su última declaración
  estado         text NOT NULL,
  leidos         int NOT NULL DEFAULT 0,    -- familiares leídos con documento (funcionario_familia_resumen)
  declarados     int,                       -- familiares de su última declaración cubierta por el dato abierto
  declarados_de  date,                      -- la fecha de esa declaración
  actualizado    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.funcionario_dji_estado IS
  'Estado de la declaración jurada de cada persona con ficha de cargo: leída, sin familiares, ilegible, no entregada o por leer. Migración 445.';

CREATE OR REPLACE FUNCTION public.refrescar_funcionario_dji_estado() RETURNS integer
LANGUAGE plpgsql SET work_mem = '256MB' AS $$
DECLARE
  n int;
  -- Unos días de margen: una declaración elaborada antes del corte puede haberse publicado después.
  hasta date := (SELECT max(c.hasta) FROM dji_parentesco_carga c) - 3;
BEGIN
  CREATE TEMP TABLE _fde ON COMMIT DROP AS
    SELECT d.nombre_norm, d.codigo_ddjj, fecha_dji(d.fecha_presentacion) AS pres, r.ruc,
           upper(btrim(btrim(d.apellido_paterno) || ' ' || coalesce(btrim(d.apellido_materno), ''))) AS apellidos
      FROM dji_funcionarios d LEFT JOIN dji_entidad_ruc r ON r.entidad = d.entidad
     WHERE d.nombre_norm <> '' AND d.codigo_ddjj IS NOT NULL;
  CREATE INDEX ON _fde (nombre_norm); ANALYZE _fde;

  -- Su última declaración, y la última que el dato abierto ya cubre.
  CREATE TEMP TABLE _fdu ON COMMIT DROP AS
    SELECT DISTINCT ON (nombre_norm) nombre_norm, codigo_ddjj, pres FROM _fde ORDER BY nombre_norm, pres DESC NULLS LAST, codigo_ddjj DESC;
  CREATE TEMP TABLE _fdc ON COMMIT DROP AS
    SELECT DISTINCT ON (nombre_norm) nombre_norm, codigo_ddjj, pres FROM _fde WHERE hasta IS NOT NULL AND pres <= hasta
     ORDER BY nombre_norm, pres DESC, codigo_ddjj DESC;

  -- Lo mejor que dejó la descarga de PDFs de cada persona (por RUC de la entidad y apellidos, la llave del ledger).
  CREATE TEMP TABLE _fdl ON COMMIT DROP AS
    SELECT x.nombre_norm,
           min(CASE WHEN l.estado = 'ok' AND l.parse_estado = 'ok' THEN 1
                    WHEN l.estado = 'ok' AND l.parse_estado = 'sin_familiares' THEN 2
                    WHEN l.estado = 'ok' THEN 3
                    WHEN l.estado = 'pendiente' THEN 4
                    WHEN l.estado = 'error' AND coalesce(l.error, '') NOT ILIKE '%sin resultados%' THEN 5
                    WHEN l.estado = 'error' THEN 6 END) AS mejor
      FROM (SELECT DISTINCT nombre_norm, ruc, apellidos FROM _fde WHERE ruc IS NOT NULL) x
      JOIN dji_descargas l ON l.ruc = x.ruc AND upper(btrim(l.apellidos)) = x.apellidos
     GROUP BY 1;
  CREATE INDEX ON _fdl (nombre_norm);

  TRUNCATE funcionario_dji_estado;
  INSERT INTO funcionario_dji_estado (codigo, declaraciones, ultima, estado, leidos, declarados, declarados_de)
  SELECT c.codigo, k.n, u.pres,
         CASE WHEN coalesce(r.declarados, 0) > 0 THEN 'leida'
              WHEN l.mejor = 2 OR (dc.codigo_ddjj IS NOT NULL AND p.codigo_ddjj IS NULL) THEN 'sin_familiares'
              WHEN l.mejor = 3 THEN 'ilegible'
              WHEN l.mejor = 6 THEN 'no_entregada'
              ELSE 'por_leer' END,
         coalesce(r.declarados, 0),
         CASE WHEN dc.codigo_ddjj IS NULL THEN NULL ELSE coalesce(p.n_total, 0) END,
         dc.pres
    FROM (SELECT nombre_norm, count(DISTINCT codigo_ddjj)::int AS n FROM _fde GROUP BY 1) k
    JOIN funcionario_codigo c ON c.nombre_norm = k.nombre_norm
    LEFT JOIN _fdu u ON u.nombre_norm = k.nombre_norm
    LEFT JOIN _fdc dc ON dc.nombre_norm = k.nombre_norm
    LEFT JOIN dji_parentesco p ON p.codigo_ddjj = dc.codigo_ddjj
    LEFT JOIN _fdl l ON l.nombre_norm = k.nombre_norm
    LEFT JOIN funcionario_familia_resumen r ON r.codigo = c.codigo;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE funcionario_dji_estado;
  RETURN n;
END $$;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.dji_parentesco_carga OWNER TO vigia_jobs;
    ALTER TABLE public.funcionario_dji_estado OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_funcionario_dji_estado() OWNER TO vigia_jobs;
  END IF;
  REVOKE ALL ON public.dji_parentesco_carga, public.funcionario_dji_estado FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'dev_api', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.funcionario_dji_estado TO %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.refrescar_funcionario_dji_estado() FROM PUBLIC;
