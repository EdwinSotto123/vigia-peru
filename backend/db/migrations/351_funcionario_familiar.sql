-- 351 · La red de familia de quien tiene cargo público: qué obtuvo del Estado cada familiar que declaró en su DJI.
--
-- Pedido del usuario del 2026-11-17: una sola ficha por persona y, en ella, «la red de familia dentro de la entidad».
-- La 301 ya lo hacía para los políticos (politico_familiar). Aquí, para todo declarante con ficha de cargo público
-- (funcionario_codigo): medido en PROD ese día, 95 447 declarantes con 782 mil parientes con documento; 55 124
-- declarantes tienen parientes con órdenes del Estado a su RUC (240 mil filas, 7 415 en la entidad del propio declarante)
-- y 26 491, parientes socios, representantes o directivos de empresas (RNP).
--
-- funcionario_familiar: una fila por familiar y por lo que obtuvo, SIN su nombre ni su documento (numerado 1, 2, 3…
-- dentro de cada funcionario, como en politico_familiar):
--   tipo «orden»    órdenes de una entidad a su RUC 10 (persona_orden_anual);
--   tipo «empresa»  una empresa en que es socio, representante o directivo, con lo que esa empresa le vendió al Estado
--                   (empresa_resumen) y, aparte, lo que le vendió por órdenes a las entidades del funcionario.
--   su_entidad      lo obtuvo de una entidad en la que el funcionario presentó declaración: el indicio de nepotismo (136)
--                   o de la empresa de un pariente (350). No prueba que el funcionario haya intervenido.
-- funcionario_familia_resumen: los conteos por funcionario, para la cabecera de su ficha.
--
-- Fuera las personas que figuran en más de 10 empresas del RNP (apoderados de muchas), como en 189 y 350. Sólo empresas
-- que le vendieron algo al Estado. La planilla no trae documento y la DJI escribe los nombres en otro orden: un familiar
-- en planilla no se cruza aquí.

CREATE TABLE IF NOT EXISTS funcionario_familiar (
  codigo              TEXT     NOT NULL,   -- el funcionario (funcionario_codigo)
  pariente            SMALLINT NOT NULL,   -- 1, 2, 3…: qué familiar, sin su nombre ni su documento
  parentesco          TEXT,
  grado               TEXT,                -- conyuge, padre, hijo, hermano, otro
  tipo                TEXT     NOT NULL,   -- orden | empresa
  entidad_ruc         TEXT,                -- orden: la entidad que le dio órdenes
  entidad             TEXT,
  empresa_ruc         TEXT,                -- empresa: RUC 20
  empresa             TEXT,
  rol                 TEXT,                -- su papel en la empresa (RNP)
  ordenes             INT,                 -- orden: las de esa entidad; empresa: las de todo el Estado
  procesos            INT,                 -- empresa: buenas pro en todo el Estado
  monto               NUMERIC(18, 2),      -- orden: de esa entidad; empresa: órdenes más adjudicado
  desde               INT,
  hasta               INT,
  su_entidad          BOOLEAN  NOT NULL DEFAULT false,
  su_entidad_ordenes  INT,                 -- empresa: órdenes de las entidades del funcionario
  su_entidad_monto    NUMERIC(18, 2)
);
CREATE INDEX IF NOT EXISTS funcionario_familiar_codigo ON funcionario_familiar (codigo, pariente);
CREATE INDEX IF NOT EXISTS funcionario_familiar_entidad ON funcionario_familiar (entidad_ruc) WHERE su_entidad;
COMMENT ON TABLE funcionario_familiar IS
  'Lo que obtuvo del Estado cada familiar que un funcionario declara en su DJI (órdenes, empresas), sin nombre ni documento del familiar (migración 351).';

CREATE TABLE IF NOT EXISTS funcionario_familia_resumen (
  codigo            TEXT PRIMARY KEY,
  declarados        INT NOT NULL,            -- familiares que declara (con documento)
  con_ordenes       INT NOT NULL DEFAULT 0,  -- … con órdenes del Estado a su RUC
  monto_ordenes     NUMERIC(18, 2) NOT NULL DEFAULT 0,
  con_empresas      INT NOT NULL DEFAULT 0,  -- … socios o representantes de empresas que le venden al Estado
  en_su_entidad     INT NOT NULL DEFAULT 0,  -- … que obtuvieron algo de una entidad donde él declaró
  monto_su_entidad  NUMERIC(18, 2) NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION refrescar_funcionario_familiar() RETURNS integer
LANGUAGE plpgsql SET work_mem = '256MB' AS $$
DECLARE n int;
BEGIN
  -- Los declarantes con ficha, sus entidades y sus familiares con documento, numerados (los más cercanos primero).
  CREATE TEMP TABLE _ffv ON COMMIT DROP AS
    SELECT f.codigo, v.entidad_ruc, v.pariente_doc AS dni, v.grado, v.parentesco
      FROM dji_vinculos v JOIN funcionario_codigo f ON f.nombre_norm = v.declarante_norm
     WHERE v.pariente_doc ~ '^\d{8}$';
  CREATE INDEX ON _ffv (codigo); ANALYZE _ffv;
  CREATE TEMP TABLE _ffp ON COMMIT DROP AS
    SELECT codigo, dni, grado, parentesco,
           (row_number() OVER (PARTITION BY codigo ORDER BY CASE grado WHEN 'conyuge' THEN 0 WHEN 'hijo' THEN 1 WHEN 'padre' THEN 2 WHEN 'hermano' THEN 3 ELSE 4 END, dni))::int AS pariente
      FROM (SELECT DISTINCT ON (codigo, dni) codigo, dni, grado, parentesco FROM _ffv
             ORDER BY codigo, dni, CASE grado WHEN 'conyuge' THEN 0 WHEN 'hijo' THEN 1 WHEN 'padre' THEN 2 WHEN 'hermano' THEN 3 ELSE 4 END) x;
  CREATE INDEX ON _ffp (dni); CREATE INDEX ON _ffp (codigo); ANALYZE _ffp;
  CREATE TEMP TABLE _ffe ON COMMIT DROP AS SELECT DISTINCT codigo, entidad_ruc FROM _ffv WHERE entidad_ruc ~ '^\d{11}$';
  CREATE INDEX ON _ffe (codigo, entidad_ruc); ANALYZE _ffe;

  -- Órdenes a su RUC 10, por entidad.
  CREATE TEMP TABLE _ffo ON COMMIT DROP AS
    SELECT substr(p.ruc, 3, 8) AS dni, p.entidad_ruc, max(p.entidad) AS entidad, sum(p.ordenes)::int AS ordenes, sum(p.monto) AS monto,
           min(p.anio)::int AS a0, max(p.anio)::int AS a1
      FROM persona_orden_anual p
     WHERE p.ruc ~ '^10\d{9}$' AND substr(p.ruc, 3, 8) IN (SELECT dni FROM _ffp)
     GROUP BY 1, 2;
  CREATE INDEX ON _ffo (dni); ANALYZE _ffo;

  -- Sus empresas (RNP) que le vendieron algo al Estado.
  CREATE TEMP TABLE _ffr ON COMMIT DROP AS
    SELECT r.numero_documento AS dni, r.ruc_empresa::text AS ruc, string_agg(DISTINCT lower(r.tipo_rol), ', ') AS rol
      FROM rnp_conformacion_juridica r
     WHERE r.numero_documento IN (SELECT dni FROM _ffp) AND r.ruc_empresa::text ~ '^20\d{9}$'
     GROUP BY 1, 2;
  DELETE FROM _ffr WHERE dni IN (SELECT dni FROM _ffr GROUP BY dni HAVING count(*) > 10);
  CREATE INDEX ON _ffr (dni); CREATE INDEX ON _ffr (ruc); ANALYZE _ffr;
  CREATE TEMP TABLE _ffc ON COMMIT DROP AS
    SELECT e.ruc, e.nombre, COALESCE(e.ord_n, 0)::int AS ordenes, COALESCE(e.adj_procesos, 0)::int AS procesos,
           COALESCE(e.ord_monto, 0) + COALESCE(e.adj_monto, 0) AS monto,
           extract(year FROM e.primera)::int AS a0, extract(year FROM e.ultima)::int AS a1
      FROM empresa_resumen e
     WHERE e.ruc IN (SELECT ruc FROM _ffr) AND (COALESCE(e.ord_n, 0) > 0 OR COALESCE(e.adj_procesos, 0) > 0);
  CREATE UNIQUE INDEX ON _ffc (ruc); ANALYZE _ffc;
  -- Lo que esas empresas le vendieron por órdenes a cada entidad.
  CREATE TEMP TABLE _ffce ON COMMIT DROP AS
    SELECT e.ruc, e.entidad_ruc, sum(e.ordenes)::int AS ordenes, sum(e.monto) AS monto
      FROM empresa_orden_anual e WHERE e.ruc IN (SELECT ruc FROM _ffc) GROUP BY 1, 2;
  CREATE INDEX ON _ffce (ruc, entidad_ruc); ANALYZE _ffce;

  DELETE FROM funcionario_familiar;
  INSERT INTO funcionario_familiar (codigo, pariente, parentesco, grado, tipo, entidad_ruc, entidad, ordenes, monto, desde, hasta, su_entidad)
  SELECT p.codigo, p.pariente, p.parentesco, p.grado, 'orden', o.entidad_ruc, o.entidad, o.ordenes, o.monto, o.a0, o.a1,
         EXISTS (SELECT 1 FROM _ffe e WHERE e.codigo = p.codigo AND e.entidad_ruc = o.entidad_ruc)
    FROM _ffp p JOIN _ffo o ON o.dni = p.dni;
  INSERT INTO funcionario_familiar (codigo, pariente, parentesco, grado, tipo, empresa_ruc, empresa, rol, ordenes, procesos, monto, desde, hasta,
                                    su_entidad, su_entidad_ordenes, su_entidad_monto)
  SELECT p.codigo, p.pariente, p.parentesco, p.grado, 'empresa', c.ruc, c.nombre, r.rol, c.ordenes, c.procesos, c.monto, c.a0, c.a1,
         COALESCE(s.ordenes, 0) > 0, s.ordenes, s.monto
    FROM _ffp p
    JOIN _ffr r ON r.dni = p.dni
    JOIN _ffc c ON c.ruc = r.ruc
    LEFT JOIN LATERAL (SELECT sum(x.ordenes)::int AS ordenes, sum(x.monto) AS monto
                         FROM _ffce x JOIN _ffe e ON e.entidad_ruc = x.entidad_ruc AND e.codigo = p.codigo
                        WHERE x.ruc = c.ruc) s ON true;
  GET DIAGNOSTICS n = ROW_COUNT;

  DELETE FROM funcionario_familia_resumen;
  INSERT INTO funcionario_familia_resumen (codigo, declarados, con_ordenes, monto_ordenes, con_empresas, en_su_entidad, monto_su_entidad)
  SELECT d.codigo, d.declarados, COALESCE(f.con_ordenes, 0), COALESCE(f.monto_ordenes, 0), COALESCE(f.con_empresas, 0),
         COALESCE(f.en_su_entidad, 0), COALESCE(f.monto_su_entidad, 0)
    FROM (SELECT codigo, count(*)::int AS declarados FROM _ffp GROUP BY 1) d
    LEFT JOIN (SELECT codigo,
                      (count(DISTINCT pariente) FILTER (WHERE tipo = 'orden'))::int AS con_ordenes,
                      COALESCE(sum(monto) FILTER (WHERE tipo = 'orden'), 0) AS monto_ordenes,
                      (count(DISTINCT pariente) FILTER (WHERE tipo = 'empresa'))::int AS con_empresas,
                      (count(DISTINCT pariente) FILTER (WHERE su_entidad))::int AS en_su_entidad,
                      COALESCE(sum(CASE WHEN NOT su_entidad THEN 0 WHEN tipo = 'orden' THEN monto ELSE su_entidad_monto END), 0) AS monto_su_entidad
                 FROM funcionario_familiar GROUP BY 1) f ON f.codigo = d.codigo;
  ANALYZE funcionario_familiar;
  ANALYZE funcionario_familia_resumen;
  RETURN n;
END $$;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.funcionario_familiar OWNER TO vigia_jobs;
    ALTER TABLE public.funcionario_familia_resumen OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_funcionario_familiar() OWNER TO vigia_jobs;
  END IF;
  REVOKE ALL ON public.funcionario_familiar, public.funcionario_familia_resumen FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'dev_api', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.funcionario_familiar, public.funcionario_familia_resumen TO %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_funcionario_familiar() FROM PUBLIC;
