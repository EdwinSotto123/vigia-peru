-- 367 · La autoridad electa dejó de figurar en una empresa y esa empresa le vende a la entidad que gobierna o fiscaliza.
--
-- Los cruces de «socio que es autoridad» miran a quien HOY figura en la conformación jurídica del proveedor (RNP). Quien
-- sale de la empresa al asumir el cargo, o durante su gestión, desaparece de esos cruces. Con las salidas del RNP
-- (rnp_exsocio, migración 365, y `baja_corte` de la 360) se puede volver a verlo.
--
-- Medido en PROD el 2026-11-18: 60 autoridades con documento figuran entre quienes dejaron una empresa; en 9 casos
-- (4 personas) la empresa le vendió a SU entidad durante su periodo: S/ 1,25 M en órdenes y S/ 1,10 M en procesos. Entre
-- los socios que siguen figurando son 6 casos por S/ 0,38 M: quien sale de la empresa vende más que quien se queda.
--
-- Por qué importa: el impedimento para contratar alcanza a la persona jurídica en la que el alcalde, regidor, gobernador
-- o consejero tenga O HAYA TENIDO más del 30 % del capital dentro de los 12 meses anteriores a la convocatoria (literal i
-- del numeral 11.1 del artículo 11 de la Ley 30225; tipo 3.A del numeral 3 del párrafo 30.1 del artículo 30 de la Ley
-- 32069, que suma el requerimiento de invitación en los contratos menores), y a aquella en la que integra los órganos de
-- administración o la representa. Salir de la empresa no levanta el impedimento de inmediato.
--
-- Lo que NO dice: el RNP no publica el porcentaje de participación, y `baja_corte` es el corte MENSUAL en que dejó de
-- figurar (la salida real puede ser hasta unas semanas antes). Es un hecho para revisar, no una infracción comprobada.
-- Nace EN OBSERVACIÓN (migración 329).
--
--   mientras   ventas de la entidad a la empresa, dentro de su periodo, cuando todavía figuraba en ella
--   en_plazo   ventas dentro de su periodo hasta 12 meses después del corte en que dejó de figurar (incluye las de mientras)
--   severidad  alta   fue socio y hay ventas en ese plazo, o figuraba con cualquier papel cuando la empresa vendió
--              media  el resto: las ventas son de más de 12 meses después de su salida, o sólo fue representante o directivo
--
-- Privacidad: es una autoridad electa (su nombre es público y va completo, como en el resto del sistema). La tabla guarda
-- el id de jne_autoridades, no su documento. Sólo la API (migración 353).

CREATE TABLE IF NOT EXISTS autoridad_exsocio_venta (
  ruc_empresa        TEXT   NOT NULL,
  empresa            TEXT,
  autoridad_id       BIGINT NOT NULL,          -- jne_autoridades.id
  autoridad          TEXT,                     -- como lo publica el JNE
  cargo              TEXT   NOT NULL,
  lugar              TEXT,                     -- distrito, provincia o departamento de su cargo
  entidad_ruc        TEXT   NOT NULL,
  entidad            TEXT,
  periodo_inicio     DATE   NOT NULL,
  periodo_fin        DATE,
  roles              TEXT[] NOT NULL,          -- los papeles que tuvo en la empresa
  fue_socio          BOOLEAN NOT NULL,
  desde              DATE,                     -- desde cuándo figuraba, según el RNP
  baja_corte         DATE   NOT NULL,          -- corte del RNP en que dejó de figurar
  ordenes            INT    NOT NULL DEFAULT 0,   -- órdenes de la entidad a la empresa dentro de su periodo
  monto_ordenes      NUMERIC(18, 2) NOT NULL DEFAULT 0,
  procesos           INT    NOT NULL DEFAULT 0,   -- procesos adjudicados dentro de su periodo
  monto_procesos     NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ventas_mientras    INT    NOT NULL DEFAULT 0,   -- órdenes y procesos cuando todavía figuraba en la empresa
  ventas_en_plazo    INT    NOT NULL DEFAULT 0,   -- hasta 12 meses después de su salida (incluye las de mientras)
  monto_en_plazo     NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ventas_despues     INT    NOT NULL DEFAULT 0,   -- más de 12 meses después de su salida
  primera            DATE,
  ultima             DATE,
  severidad          TEXT   NOT NULL,
  PRIMARY KEY (ruc_empresa, autoridad_id, entidad_ruc)
);
CREATE INDEX IF NOT EXISTS autoridad_exsocio_venta_entidad ON autoridad_exsocio_venta (entidad_ruc);

CREATE OR REPLACE FUNCTION public.refrescar_autoridad_exsocio_venta() RETURNS integer
LANGUAGE plpgsql SET work_mem = '128MB' SET max_parallel_workers_per_gather = 0 SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  -- Quien ya no figura en la empresa (ninguno de sus papeles sigue vigente), con el último corte en que salió.
  CREATE TEMP TABLE _ax ON COMMIT DROP AS
    SELECT u.ruc_empresa, u.dni, array_agg(DISTINCT u.tipo_rol) AS roles, min(u.fecha_inicio_vigencia) AS desde, max(u.baja_corte) AS baja_corte
      FROM (SELECT x.ruc_empresa, x.numero_documento AS dni, x.tipo_rol, x.fecha_inicio_vigencia, x.baja_corte
              FROM rnp_exsocio x
             WHERE x.numero_documento IN (SELECT dni FROM jne_autoridades WHERE dni IS NOT NULL)
            UNION ALL
            SELECT r.ruc_empresa::text, r.numero_documento, r.tipo_rol, r.fecha_inicio_vigencia, r.baja_corte
              FROM rnp_conformacion_juridica r
             WHERE r.baja_corte IS NOT NULL AND r.numero_documento IN (SELECT dni FROM jne_autoridades WHERE dni IS NOT NULL)) u
     WHERE u.ruc_empresa ~ '^20\d{9}$'
       AND NOT EXISTS (SELECT 1 FROM rnp_conformacion_juridica v
                        WHERE v.ruc_empresa = u.ruc_empresa::char(11) AND v.numero_documento = u.dni AND v.baja_corte IS NULL)
     GROUP BY 1, 2;

  -- Su cargo electo y las entidades que gobierna o fiscaliza. Sólo si dejó de figurar cuando ya era autoridad o hasta 12
  -- meses antes de asumir (el plazo del impedimento por participación).
  CREATE TEMP TABLE _aa ON COMMIT DROP AS
    SELECT DISTINCT ON (x.ruc_empresa, a.id, ega.ruc)
           x.ruc_empresa, x.roles, x.desde, x.baja_corte, a.id AS autoridad_id, a.nombre AS autoridad, a.cargo,
           CASE WHEN a.cargo LIKE '%DISTRITAL' THEN a.distrito WHEN a.cargo LIKE '%PROVINCIAL' THEN a.provincia ELSE a.departamento END AS lugar,
           a.periodo_inicio, a.periodo_fin, LEAST(COALESCE(a.periodo_fin, current_date), current_date) AS fin, ega.ruc AS entidad_ruc
      FROM _ax x
      JOIN jne_autoridades a ON a.dni = x.dni AND a.periodo_inicio IS NOT NULL
      JOIN entidad_gobierno_amplia ega ON ega.como = 'entidades' AND (
           (ega.nivel = 'distrital'  AND a.cargo IN ('ALCALDE DISTRITAL', 'REGIDOR DISTRITAL')   AND a.ubigeo = ega.ubigeo)
        OR (ega.nivel = 'provincial' AND a.cargo IN ('ALCALDE PROVINCIAL', 'REGIDOR PROVINCIAL') AND left(a.ubigeo, 4) = ega.ubigeo)
        OR (ega.nivel = 'regional'   AND a.cargo IN ('GOBERNADOR REGIONAL', 'VICEGOBERNADOR REGIONAL', 'CONSEJERO REGIONAL') AND left(a.ubigeo, 2) = ega.ubigeo))
     WHERE x.baja_corte >= a.periodo_inicio - 365
     ORDER BY x.ruc_empresa, a.id, ega.ruc;
  CREATE INDEX ON _aa (entidad_ruc, ruc_empresa); ANALYZE _aa;

  -- Las ventas de la entidad a la empresa dentro de su periodo, una por una: órdenes (por fecha de emisión, una vez por
  -- número y fecha, en soles y sin anuladas) y procesos (por su buena pro; el plazo de 12 meses se mide a la convocatoria).
  CREATE TEMP TABLE _av ON COMMIT DROP AS
    SELECT a.ruc_empresa, a.autoridad_id, a.entidad_ruc, 'orden'::text AS tipo, o.entidad, o.fecha, o.fecha AS referencia, o.monto
      FROM _aa a
      JOIN LATERAL (SELECT DISTINCT ON (c.orden, c.fecha_emision) c.entidad, c.fecha_emision AS fecha, c.monto
                      FROM conosce_ordenes c
                     WHERE c.entidad_ruc = a.entidad_ruc AND c.ruc_contratista = a.ruc_empresa
                       AND c.fecha_emision BETWEEN a.periodo_inicio AND a.fin
                       AND c.estado IS DISTINCT FROM 'Anulada' AND c.moneda = 'Nuevos Soles' AND c.monto > 0
                     ORDER BY c.orden, c.fecha_emision, c.anio DESC, c.mes DESC) o ON true
    UNION ALL
    SELECT a.ruc_empresa, a.autoridad_id, a.entidad_ruc, 'proceso', p.entidad, p.fecha, p.referencia, p.monto
      FROM _aa a
      JOIN LATERAL (SELECT max(c.entidad) AS entidad, max(c.fecha_buenapro) AS fecha, COALESCE(min(c.fecha_convocatoria), max(c.fecha_buenapro)) AS referencia,
                           COALESCE(sum(c.monto_adjudicado), 0) AS monto
                      FROM conosce_adjudicaciones c
                     WHERE c.entidad_ruc = a.entidad_ruc AND c.ruc_proveedor = a.ruc_empresa
                       AND c.fecha_buenapro BETWEEN a.periodo_inicio AND a.fin
                     GROUP BY c.codigo_convocatoria) p ON true;
  CREATE INDEX ON _av (ruc_empresa, autoridad_id, entidad_ruc); ANALYZE _av;

  DELETE FROM autoridad_exsocio_venta;
  INSERT INTO autoridad_exsocio_venta (ruc_empresa, empresa, autoridad_id, autoridad, cargo, lugar, entidad_ruc, entidad, periodo_inicio, periodo_fin, roles,
                                       fue_socio, desde, baja_corte, ordenes, monto_ordenes, procesos, monto_procesos, ventas_mientras, ventas_en_plazo,
                                       monto_en_plazo, ventas_despues, primera, ultima, severidad)
  SELECT z.ruc_empresa, e.nombre, z.autoridad_id, z.autoridad, z.cargo, z.lugar, z.entidad_ruc, z.entidad, z.periodo_inicio, z.periodo_fin, z.roles,
         z.fue_socio, z.desde, z.baja_corte, z.ordenes, z.monto_ordenes, z.procesos, z.monto_procesos, z.mientras, z.en_plazo, z.monto_en_plazo, z.despues,
         z.primera, z.ultima,
         CASE WHEN (z.fue_socio AND z.en_plazo > 0) OR z.mientras > 0 THEN 'alta' ELSE 'media' END
    FROM (SELECT a.ruc_empresa, a.autoridad_id, a.autoridad, a.cargo, a.lugar, a.entidad_ruc, max(v.entidad) AS entidad, a.periodo_inicio, a.periodo_fin, a.roles,
                 'SOCIO_ACCIONISTA_TITULAR' = ANY (a.roles) AS fue_socio, a.desde, a.baja_corte,
                 (count(*) FILTER (WHERE v.tipo = 'orden'))::int AS ordenes, COALESCE(sum(v.monto) FILTER (WHERE v.tipo = 'orden'), 0) AS monto_ordenes,
                 (count(*) FILTER (WHERE v.tipo = 'proceso'))::int AS procesos, COALESCE(sum(v.monto) FILTER (WHERE v.tipo = 'proceso'), 0) AS monto_procesos,
                 (count(*) FILTER (WHERE v.referencia < a.baja_corte))::int AS mientras,
                 (count(*) FILTER (WHERE v.referencia < a.baja_corte + 365))::int AS en_plazo,
                 COALESCE(sum(v.monto) FILTER (WHERE v.referencia < a.baja_corte + 365), 0) AS monto_en_plazo,
                 (count(*) FILTER (WHERE v.referencia >= a.baja_corte + 365))::int AS despues,
                 min(v.fecha) AS primera, max(v.fecha) AS ultima
            FROM _aa a JOIN _av v ON v.ruc_empresa = a.ruc_empresa AND v.autoridad_id = a.autoridad_id AND v.entidad_ruc = a.entidad_ruc
           GROUP BY a.ruc_empresa, a.autoridad_id, a.autoridad, a.cargo, a.lugar, a.entidad_ruc, a.periodo_inicio, a.periodo_fin, a.roles, a.desde, a.baja_corte) z
    LEFT JOIN empresa_resumen e ON e.ruc = z.ruc_empresa;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE autoridad_exsocio_venta;
  RETURN n;
END $$;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.autoridad_exsocio_venta OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_autoridad_exsocio_venta() OWNER TO vigia_jobs;
    -- La función corre como vigia_jobs y lee la tabla de ex socios (migración 365, que nació sólo para la API).
    GRANT SELECT ON public.rnp_exsocio TO vigia_jobs;
  END IF;
  REVOKE ALL ON public.autoridad_exsocio_venta FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'dev_api', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.autoridad_exsocio_venta TO %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.refrescar_autoridad_exsocio_venta() FROM PUBLIC;
