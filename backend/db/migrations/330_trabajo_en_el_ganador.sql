-- 330 · Trabajo en el ganador: un funcionario de la entidad declaró en su DJI (datos abiertos) un empleo en la empresa
--       que la entidad contrató mientras él ocupaba el cargo. En observación.
--
-- La señal `empleo_declarado` (migración 170) sale de las DJI que se bajan del portal DJIC de la Contraloría, una por
-- declarante: esa captura llegó a 36 % y está detenida, y la señal marca 79 procesos. Pero la Plataforma Nacional de
-- Datos Abiertos publica las DJI completas en dos archivos que se cargan cada mes: `dji_funcionarios` (quién declara,
-- en qué entidad, con qué cargo y desde cuándo) y `dji_empleos` (sus empleos: la empresa con su RUC, el cargo y las
-- fechas). Los dos traen el mismo `codigo_ddjj`: se unen sin pasar por nombres. La entidad del declarante viene como
-- texto y se lleva a su RUC con `dji_entidad_ruc` (sólo los empates exactos: sin «trigramas» ni «empleo_actual»).
--
-- Medido el 2026-11-17 (sólo lectura): 72 121 parejas de entidad y empresa en que un funcionario de la entidad declaró
-- haber trabajado en la empresa; en 1 102 la empresa le ganó un proceso a esa entidad. Con el funcionario en el cargo el
-- día de la buena pro: 414 procesos con el empleo vigente, 368 con el empleo dejado en los dos años anteriores, 782
-- antes, y 259 en que empezó a trabajar en la empresa después de la buena pro.
--
-- Qué marca: el proceso que la entidad adjudicó a la empresa (o a un consorcio que la integra) con la buena pro dentro
-- del periodo en que el declarante ocupaba su cargo en esa entidad, según la misma declaración. Cuándo fue el empleo:
--   a_la_vez         el empleo estaba vigente el día de la buena pro;
--   despues          empezó a trabajar en la empresa después de la buena pro, todavía en el cargo;
--   hasta_2_anios    lo había dejado en los dos años anteriores;
--   antes            lo había dejado antes;
--   sin_fechas       la declaración no dice cuándo.
-- Media en los tres primeros, baja en los otros dos. No se marca si ya lo marca `empleo_declarado` (la misma DJI leída
-- del portal).
--
-- Lo que NO afirma: que el funcionario interviniera en la contratación (puede ser de otra área), que el empleo fuera
-- relevante, ni que la declaración esté bien llenada. Es un posible conflicto de intereses que la Ley 31227 obliga a
-- declarar y el Código de Ética de la Función Pública (Ley 27815) a evitar. Va EN OBSERVACIÓN (migración 329): se
-- muestra con su evidencia y no puntúa hasta medir su precisión con una muestra revisada.
--
-- Cómo aplicarla: después de la 329. Luego SELECT refrescar_cruce_empleo_dji(), dedup_cruces_proveedor(),
-- refrescar_casos_cruce_base() y refrescar_senal_tasa_base().

-- La fecha de las DJI de datos abiertos: «DD/MM/AAAA» en los empleos y «DD/MM/AA» en los cargos. Lo que no es una fecha
-- válida, o cae fuera de 1950 al año siguiente, es NULL.
CREATE OR REPLACE FUNCTION dji_fecha(t text) RETURNS date
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d date;
BEGIN
  IF t ~ '^\d{2}/\d{2}/\d{4}$' THEN d := to_date(t, 'DD/MM/YYYY');
  ELSIF t ~ '^\d{2}/\d{2}/\d{2}$' THEN d := to_date(t, 'DD/MM/YY');
  ELSE RETURN NULL;
  END IF;
  IF d < DATE '1950-01-01' OR d > (DATE '2100-01-01') THEN RETURN NULL; END IF;
  RETURN d;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

INSERT INTO senal_en_observacion (tipo, motivo) VALUES
  ('trabajo_en_el_ganador', 'Indicador nuevo del 2026-11-17: falta medir su precisión con una muestra revisada.')
ON CONFLICT (tipo) DO NOTHING;

CREATE OR REPLACE FUNCTION refrescar_cruce_empleo_dji() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n int;
  v_obs boolean := EXISTS (SELECT 1 FROM senal_en_observacion WHERE tipo = 'trabajo_en_el_ganador');
BEGIN
  SET LOCAL work_mem = '256MB';

  -- Los empleos declarados en empresas (RUC 20 que no es una entidad pública).
  CREATE TEMP TABLE _ej_e ON COMMIT DROP AS
    SELECT e.codigo_ddjj, e.ruc_entidad AS ruc, dji_fecha(e.fecha_inicio) AS e_ini, dji_fecha(e.fecha_cese) AS e_fin,
           left(btrim(e.cargo), 120) AS cargo_privado
      FROM dji_empleos e
     WHERE e.ruc_entidad ~ '^20\d{9}$'
       AND NOT EXISTS (SELECT 1 FROM entidades x WHERE x.ruc = e.ruc_entidad::char(11));
  CREATE INDEX ON _ej_e (codigo_ddjj);
  ANALYZE _ej_e;

  -- Quién declaró, en qué entidad (sólo los empates exactos del nombre de la entidad con su RUC) y su periodo en el cargo.
  CREATE TEMP TABLE _ej_f ON COMMIT DROP AS
    SELECT f.codigo_ddjj, r.ruc AS entidad_ruc, r.como, f.nombre_norm, f.cargo,
           dji_fecha(f.fecha_inicio_cargo) AS c_ini, dji_fecha(f.fecha_cese_cargo) AS c_fin, dji_fecha(f.fecha_presentacion) AS presentada
      FROM dji_funcionarios f
      JOIN dji_entidad_ruc r ON r.entidad = f.entidad
     WHERE r.como NOT IN ('trigramas', 'empleo_actual') AND r.ruc ~ '^20\d{9}$'
       AND f.codigo_ddjj IN (SELECT codigo_ddjj FROM _ej_e);
  CREATE INDEX ON _ej_f (codigo_ddjj);
  ANALYZE _ej_f;

  CREATE TEMP TABLE _ej_p ON COMMIT DROP AS
    SELECT f.*, e.ruc, e.e_ini, e.e_fin, e.cargo_privado
      FROM _ej_f f JOIN _ej_e e USING (codigo_ddjj)
     WHERE e.ruc <> f.entidad_ruc AND f.c_ini IS NOT NULL;
  CREATE INDEX ON _ej_p (ruc, entidad_ruc);
  ANALYZE _ej_p;

  -- Cada proceso que la empresa (sola o en un consorcio) le ganó a esa entidad, con su ocid.
  CREATE TEMP TABLE _ej_a ON COMMIT DROP AS
    SELECT cv.ocid, COALESCE(m.ruc_miembro, a.ruc_proveedor) AS ruc, a.entidad_ruc::text AS entidad_ruc,
           max(CASE WHEN m.ruc_miembro IS NOT NULL THEN a.proveedor END) AS consorcio,
           max(a.fecha_buenapro) AS f,
           sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS monto
      FROM conosce_adjudicaciones a
      JOIN (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
             WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid) cv
        ON cv.codigo = a.codigo_convocatoria AND cv.entidad_ruc = a.entidad_ruc
      LEFT JOIN conosce_consorcios m ON m.ruc_consorcio = a.ruc_proveedor AND a.ruc_proveedor !~ '^(10|20)\d{9}$'
     WHERE a.fecha_buenapro IS NOT NULL
       AND (COALESCE(m.ruc_miembro, a.ruc_proveedor), a.entidad_ruc::text) IN (SELECT ruc, entidad_ruc FROM _ej_p)
     GROUP BY 1, 2, 3;
  ANALYZE _ej_a;

  DELETE FROM cruces_proveedor WHERE tipo = 'trabajo_en_el_ganador';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (x.ocid, x.ruc)
         'trabajo_en_el_ganador', x.ruc, x.ocid, CASE WHEN x.cuando IN ('antes', 'sin_fechas') THEN 'baja' ELSE 'media' END,
         x.f, x.monto, NULL, x.nombre_norm, x.cargo,
         jsonb_build_object('cuando', x.cuando, 'cargo', x.cargo, 'cargo_desde', x.c_ini, 'cargo_hasta', x.c_fin,
                            'empleo_desde', x.e_ini, 'empleo_hasta', x.e_fin, 'cargo_en_la_empresa', x.cargo_privado,
                            'presentada', x.presentada, 'entidad_por', x.como, 'consorcio', x.consorcio, 'buena_pro', x.f,
                            'en_observacion', v_obs),
         'pnda_dji', 'https://www.datosabiertos.gob.pe/dataset/declaraciones-juradas-de-intereses-presentadas-ante-la-contralor%C3%ADa'
    FROM (SELECT a.ocid, a.ruc, a.f, a.monto, a.consorcio, p.nombre_norm, p.cargo, p.c_ini, p.c_fin, p.e_ini, p.e_fin,
                 p.cargo_privado, p.presentada, p.como,
                 CASE WHEN p.e_ini IS NOT NULL AND p.e_ini > a.f THEN 'despues'
                      WHEN p.e_ini IS NULL AND p.e_fin IS NULL THEN 'sin_fechas'
                      WHEN p.e_fin IS NULL OR p.e_fin >= a.f THEN 'a_la_vez'
                      WHEN p.e_fin >= a.f - 730 THEN 'hasta_2_anios'
                      ELSE 'antes' END AS cuando
            FROM _ej_a a
            JOIN _ej_p p ON p.ruc = a.ruc AND p.entidad_ruc = a.entidad_ruc
           -- El declarante ocupaba su cargo en la entidad el día de la buena pro.
           WHERE p.c_ini <= a.f AND (p.c_fin IS NULL OR p.c_fin >= a.f)) x
   WHERE NOT EXISTS (SELECT 1 FROM cruces_proveedor c WHERE c.tipo = 'empleo_declarado' AND c.ocid = x.ocid AND c.ruc_empresa = x.ruc)
   ORDER BY x.ocid, x.ruc,
            CASE x.cuando WHEN 'a_la_vez' THEN 0 WHEN 'despues' THEN 1 WHEN 'hasta_2_anios' THEN 2 WHEN 'antes' THEN 3 ELSE 4 END,
            x.presentada DESC NULLS LAST;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER FUNCTION public.refrescar_cruce_empleo_dji() OWNER TO vigia_jobs;
    ALTER FUNCTION public.dji_fecha(text) OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.dji_fecha(text) TO %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_cruce_empleo_dji() FROM PUBLIC;
