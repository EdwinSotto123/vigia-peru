-- 364 · Trabaja en compras (o decide el gasto) y un familiar suyo recibe órdenes de su misma entidad.
--
-- La red de familia (migración 351) ya decía qué obtuvo del Estado cada familiar declarado por un funcionario. Faltaba
-- saber QUÉ hace el funcionario: la declaración jurada sólo trae la categoría del formulario («Colaborador»). Desde la
-- migración 357 se lee el puesto con sus palabras (dji_empleos), y eso permite la pregunta que importa a un auditor:
-- ¿quien arma o decide las compras de la entidad tiene un familiar que le vende a esa entidad?
--
-- Medido en PROD el 2026-11-18: de 6 336 declarantes con un familiar que obtuvo algo de su entidad, 2 402 declaran su
-- puesto en ella; 199 están en compras o logística (41 con su cónyuge o conviviente, S/ 16,7 M en órdenes; 79 con un
-- hermano, S/ 5,3 M; 24 con un hijo; 9 con un padre) y 331 en cargos que deciden o pagan (administración, gerencia,
-- tesorería, presupuesto).
--
-- Por qué importa: la Ley de Contrataciones impide contratar con la entidad al cónyuge, conviviente y parientes hasta
-- el segundo grado de quien interviene en sus contrataciones (art. 11 del TUO de la Ley 30225; art. 30 de la Ley 32069).
-- Esto NO dice que hubo una contratación indebida: dice que el puesto, el parentesco declarado y las órdenes coinciden en
-- la misma entidad, y que alguien debe mirar si esa persona intervino. El empate del familiar con quien recibió las
-- órdenes es por su documento (declarado en la DJI); el del puesto, por la sección de empleos de la misma declaración.
--
--   tipo_cargo  compras   el puesto nombra logística, abastecimiento, adquisiciones, contrataciones, almacén…
--               decide    administración, gerencia municipal o general, tesorería, presupuesto, la autoridad titular
--   coincide        las órdenes del familiar caen en años en que el funcionario tenía ese puesto (inicio y cese declarados)
--   empezo_despues  la primera orden del familiar en la entidad es del año en que el funcionario asumió el puesto o
--                   posterior: el familiar empieza a cobrar cuando el funcionario ya está ahí
--   severidad   alta   compras + familiar cercano (cónyuge o conviviente, padres, hijos, hermanos) + las órdenes empezaron
--                      después o siguieron al menos un año más allá del año en que asumió
--               media  compras con familiar cercano en otro caso, o decide + cercano + coincide
--               baja   el resto
-- «Programación» sola no es compras (programación y presupuesto es otra oficina): cuenta si nombra bienes, compras o
-- abastecimiento.
-- Nace EN OBSERVACIÓN (migración 329): se muestra como un hecho para revisar y no puntúa hasta tener revisados.
-- Sólo órdenes a nombre del familiar (persona natural): son de UNA entidad. Las empresas del familiar quedan para después
-- (la tabla de la 351 las suma entre todas las entidades del funcionario).

CREATE TABLE IF NOT EXISTS funcionario_compras_familiar (
  codigo         TEXT     NOT NULL,           -- funcionario_codigo: la ficha de la persona
  entidad_ruc    TEXT     NOT NULL,
  entidad        TEXT,
  cargo          TEXT     NOT NULL,           -- el puesto declarado en esa entidad (dji_empleos)
  tipo_cargo     TEXT     NOT NULL,           -- compras | decide
  cargo_desde    DATE,
  cargo_hasta    DATE,                        -- NULL: sin cese declarado
  pariente       SMALLINT NOT NULL,           -- el número del familiar en su declaración (nunca su nombre)
  parentesco     TEXT,
  grado          TEXT,
  cercano        BOOLEAN  NOT NULL,
  ordenes        INT      NOT NULL,
  monto          NUMERIC(18, 2) NOT NULL,
  desde          INT,                         -- años de las órdenes del familiar en esa entidad
  hasta          INT,
  coincide       BOOLEAN  NOT NULL,
  empezo_despues BOOLEAN  NOT NULL DEFAULT false,
  severidad      TEXT     NOT NULL,
  PRIMARY KEY (codigo, entidad_ruc, pariente)
);
ALTER TABLE funcionario_compras_familiar ADD COLUMN IF NOT EXISTS empezo_despues BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS funcionario_compras_familiar_entidad ON funcionario_compras_familiar (entidad_ruc, severidad);
CREATE INDEX IF NOT EXISTS funcionario_compras_familiar_orden ON funcionario_compras_familiar (severidad, monto DESC);

CREATE OR REPLACE FUNCTION public.refrescar_funcionario_compras_familiar() RETURNS integer
LANGUAGE plpgsql SET work_mem = '128MB' SET max_parallel_workers_per_gather = 0 SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  -- Los familiares con órdenes a su nombre de una entidad en que el funcionario declaró.
  CREATE TEMP TABLE _cf ON COMMIT DROP AS
    SELECT ff.codigo, ff.entidad_ruc, max(ff.entidad) AS entidad, ff.pariente, max(ff.parentesco) AS parentesco, max(ff.grado) AS grado,
           sum(COALESCE(ff.ordenes, 0))::int AS ordenes, sum(COALESCE(ff.monto, 0)) AS monto, min(ff.desde) AS desde, max(ff.hasta) AS hasta
      FROM funcionario_familiar ff
     WHERE ff.su_entidad AND ff.tipo = 'orden' AND ff.entidad_ruc ~ '^\d{11}$'
     GROUP BY ff.codigo, ff.entidad_ruc, ff.pariente;
  CREATE INDEX ON _cf (codigo, entidad_ruc); ANALYZE _cf;

  -- El puesto del funcionario EN ESA entidad, de la sección de empleos de sus declaraciones. Si declaró varios, primero el
  -- de compras, después el que decide; dentro de cada tipo, el más reciente.
  CREATE TEMP TABLE _cp ON COMMIT DROP AS
    SELECT DISTINCT ON (x.codigo, x.entidad_ruc) x.*
      FROM (SELECT f.codigo, f.entidad_ruc, upper(btrim(e.cargo)) AS cargo,
                   CASE WHEN upper(e.cargo) ~ '(LOGISTIC|ABASTECIM|ADQUISICION|CONTRATACION|COMPRAS|PROCESOS? DE SELECCION|ALMACEN|COTIZA|PROGRAMACION DE (BIENES|COMPRAS|ABASTEC))' THEN 'compras'
                        WHEN upper(e.cargo) ~ '(GERENTE MUNICIPAL|GERENTE GENERAL|ADMINISTRACION|ADMINISTRADOR|TESORER|PRESUPUESTO|ALCALDE|GOBERNADOR|DIRECTOR GENERAL|JEFE DE LA OFICINA GENERAL)' THEN 'decide' END AS tipo_cargo,
                   min(fecha_dji(e.fecha_inicio)) AS inicio, max(fecha_dji(e.fecha_cese)) AS cese,
                   bool_or(COALESCE(btrim(e.fecha_cese), '') = '') AS sin_cese
              FROM (SELECT DISTINCT codigo, entidad_ruc FROM _cf) f
              JOIN funcionario_codigo k ON k.codigo = f.codigo
              JOIN dji_funcionarios d ON d.nombre_norm = k.nombre_norm
              JOIN dji_empleos e ON e.codigo_ddjj = d.codigo_ddjj AND e.ruc_entidad = f.entidad_ruc
             WHERE length(btrim(COALESCE(e.cargo, ''))) >= 3
             GROUP BY 1, 2, 3, 4) x
     WHERE x.tipo_cargo IS NOT NULL
     ORDER BY x.codigo, x.entidad_ruc, (x.tipo_cargo = 'compras') DESC, x.inicio DESC NULLS LAST, x.cargo;
  CREATE INDEX ON _cp (codigo, entidad_ruc); ANALYZE _cp;

  DELETE FROM funcionario_compras_familiar;
  INSERT INTO funcionario_compras_familiar (codigo, entidad_ruc, entidad, cargo, tipo_cargo, cargo_desde, cargo_hasta, pariente, parentesco, grado,
                                            cercano, ordenes, monto, desde, hasta, coincide, empezo_despues, severidad)
  SELECT z.codigo, z.entidad_ruc, z.entidad, z.cargo, z.tipo_cargo, z.inicio, z.fin, z.pariente, z.parentesco, z.grado, z.cercano, z.ordenes, z.monto,
         z.desde, z.hasta, z.coincide, z.empezo_despues,
         CASE WHEN z.tipo_cargo = 'compras' AND z.cercano AND z.coincide AND (z.empezo_despues OR z.hasta > extract(year FROM z.inicio)::int) THEN 'alta'
              WHEN (z.tipo_cargo = 'compras' AND z.cercano) OR (z.tipo_cargo = 'decide' AND z.cercano AND z.coincide) THEN 'media'
              ELSE 'baja' END
    FROM (SELECT c.*, p.cargo, p.tipo_cargo, p.inicio, CASE WHEN p.sin_cese THEN NULL ELSE p.cese END AS fin,
                 COALESCE(c.grado, '') IN ('conyuge', 'padre', 'hijo', 'hermano') AS cercano,
                 -- Los años de las órdenes frente al puesto: sin inicio declarado no se puede afirmar que coinciden.
                 (p.inicio IS NOT NULL AND c.hasta >= extract(year FROM p.inicio)::int
                  AND c.desde <= extract(year FROM COALESCE(CASE WHEN p.sin_cese THEN NULL ELSE p.cese END, current_date))::int) AS coincide,
                 (p.inicio IS NOT NULL AND c.desde >= extract(year FROM p.inicio)::int
                  AND c.desde <= extract(year FROM COALESCE(CASE WHEN p.sin_cese THEN NULL ELSE p.cese END, current_date))::int) AS empezo_despues
            FROM _cf c JOIN _cp p ON p.codigo = c.codigo AND p.entidad_ruc = c.entidad_ruc
           WHERE c.ordenes > 0 AND c.monto > 0) z;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE funcionario_compras_familiar;
  RETURN n;
END $$;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.funcionario_compras_familiar OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_funcionario_compras_familiar() OWNER TO vigia_jobs;
  END IF;
  REVOKE ALL ON public.funcionario_compras_familiar FROM PUBLIC;
  -- Sólo la API (migración 353: una tabla con datos de personas no se abre a los agentes ni a vigia_ab).
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'dev_api', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.funcionario_compras_familiar TO %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.refrescar_funcionario_compras_familiar() FROM PUBLIC;
