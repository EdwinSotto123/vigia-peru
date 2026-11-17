-- 333 · Trabajo en el ganador: vuelve la exclusión de los empleadores que son entidades públicas.
--
-- Al reordenar la función en la 332 (filtrar por las parejas con procesos antes de leer fechas) se perdió el filtro de la
-- 330 que deja fuera a los empleos en entidades públicas que también venden (una universidad, una empresa del Estado):
-- salieron 117 filas de más (1 344 contra 1 227). Haber trabajado en otra entidad pública no es un vínculo privado con
-- el proveedor. Es la función de la 332 con ese filtro de vuelta.
--
-- Cómo aplicarla: después de la 332. Luego SELECT refrescar_cruce_empleo_dji(), refrescar_casos_cruce_base() y
-- refrescar_senal_tasa_base().

CREATE OR REPLACE FUNCTION refrescar_cruce_empleo_dji() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n int;
  v_obs boolean := EXISTS (SELECT 1 FROM senal_en_observacion WHERE tipo = 'trabajo_en_el_ganador');
BEGIN
  SET LOCAL work_mem = '256MB';

  -- Cada proceso adjudicado a una empresa (sola o en un consorcio) con su ocid: sólo estas parejas de empresa y entidad
  -- pueden dar la señal.
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
     WHERE a.fecha_buenapro IS NOT NULL AND COALESCE(m.ruc_miembro, a.ruc_proveedor) ~ '^20\d{9}$'
     GROUP BY 1, 2, 3;
  CREATE INDEX ON _ej_a (ruc, entidad_ruc);
  ANALYZE _ej_a;

  -- Los empleos declarados en esas empresas, todavía sin fechas.
  CREATE TEMP TABLE _ej_e ON COMMIT DROP AS
    SELECT e.codigo_ddjj, e.ruc_entidad AS ruc, e.fecha_inicio, e.fecha_cese, left(btrim(e.cargo), 120) AS cargo_privado
      FROM dji_empleos e
     WHERE e.ruc_entidad IN (SELECT DISTINCT ruc FROM _ej_a)
       -- Una entidad pública que vende (una universidad, una empresa del Estado) no es un empleo privado: fuera, como en la 330.
       AND NOT EXISTS (SELECT 1 FROM entidades x WHERE x.ruc = e.ruc_entidad::char(11));
  CREATE INDEX ON _ej_e (codigo_ddjj);
  ANALYZE _ej_e;

  -- Las parejas en que el declarante es de la entidad que adjudicó (sólo los empates exactos del nombre de la entidad
  -- con su RUC); recién aquí se leen las fechas.
  CREATE TEMP TABLE _ej_p ON COMMIT DROP AS
    SELECT x.*, dji_fecha(x.fecha_inicio_cargo) AS c_ini, dji_fecha(x.fecha_cese_cargo) AS c_fin,
           dji_fecha(x.fecha_presentacion) AS presentada, dji_fecha(x.fecha_inicio) AS e_ini, dji_fecha(x.fecha_cese) AS e_fin
      FROM (SELECT f.codigo_ddjj, r.ruc AS entidad_ruc, r.como, f.nombre_norm, f.cargo,
                   f.fecha_inicio_cargo, f.fecha_cese_cargo, f.fecha_presentacion, e.ruc, e.fecha_inicio, e.fecha_cese, e.cargo_privado
              FROM _ej_e e
              JOIN dji_funcionarios f ON f.codigo_ddjj = e.codigo_ddjj
              JOIN dji_entidad_ruc r ON r.entidad = f.entidad
             WHERE r.como NOT IN ('trigramas', 'empleo_actual') AND r.ruc ~ '^20\d{9}$' AND e.ruc <> r.ruc
               AND EXISTS (SELECT 1 FROM _ej_a a WHERE a.ruc = e.ruc AND a.entidad_ruc = r.ruc)) x;
  DELETE FROM _ej_p WHERE c_ini IS NULL;
  CREATE INDEX ON _ej_p (ruc, entidad_ruc);
  ANALYZE _ej_p;

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
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER FUNCTION public.refrescar_cruce_empleo_dji() OWNER TO vigia_jobs;
    ALTER FUNCTION public.dji_fecha(text) OWNER TO vigia_jobs;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_cruce_empleo_dji() FROM PUBLIC;
