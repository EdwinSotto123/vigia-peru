-- 366 · Compras y familia (migración 364): contar las órdenes del familiar emitidas MIENTRAS la persona tenía el puesto.
--
-- La 364 comparaba años: «las órdenes del familiar van de 2018 a 2025 y el puesto es de 2021» daba un caso grave aunque el
-- puesto durara dos meses. El primer caso de la lista en PROD (2026-11-18) era así: un servicio de contrataciones de agosto
-- a octubre de 2021 y órdenes al conviviente de 2018 a 2025. Para un auditor lo que cuenta es la orden emitida con la
-- persona en el puesto, por su fecha.
--
-- Qué cambia:
--   · Las órdenes del familiar se cuentan una por una, por su fecha de emisión (conosce_ordenes, con los mismos filtros
--     que persona_orden_anual: orden de servicio, en soles, no anulada, una vez por número y fecha):
--       ordenes_en_puesto / monto_en_puesto   emitidas entre el inicio del puesto y su fin
--       ordenes_antes                         emitidas antes de que asumiera
--       ordenes_luego                         emitidas después del fin
--       primera_en_puesto / ultima_en_puesto  las fechas de las que caen dentro
--   · El fin del puesto: el cese declarado. Sin cese (465 de 627 casos), la fecha de la ÚLTIMA declaración jurada en que
--     nombró ese puesto como vigente (`visto_hasta`): hasta ahí consta que seguía; más allá no se afirma.
--     Antes un puesto sin cese se daba por vigente hasta hoy.
--   · Un cese declarado en una declaración posterior cierra el puesto, aunque una anterior no lo trajera (antes bastaba
--     una declaración sin cese para darlo por abierto).
--   · coincide        hay al menos una orden emitida con la persona en el puesto
--     empezo_despues  además, el familiar no tenía ninguna orden de esa entidad antes de que la persona asumiera
--     severidad  alta   compras + familiar cercano + al menos una orden en el puesto
--                media  compras + cercano sin órdenes dentro del puesto, o decide + cercano + alguna orden en el puesto
--                baja   el resto
-- Sigue EN OBSERVACIÓN (migración 329).
--
-- El documento del familiar no se guarda: se rearma aquí el mismo número de pariente de la migración 351 (misma
-- numeración: grado y documento) sólo para leer sus órdenes, y si para ese número no hay órdenes en la entidad (la
-- numeración cambió) las columnas nuevas quedan en NULL y el caso baja a lo que diga el resto.

ALTER TABLE funcionario_compras_familiar
  ADD COLUMN IF NOT EXISTS visto_hasta       DATE,
  ADD COLUMN IF NOT EXISTS ordenes_en_puesto INT,
  ADD COLUMN IF NOT EXISTS monto_en_puesto   NUMERIC(18, 2),
  ADD COLUMN IF NOT EXISTS ordenes_antes     INT,
  ADD COLUMN IF NOT EXISTS ordenes_luego     INT,
  ADD COLUMN IF NOT EXISTS primera_en_puesto DATE,
  ADD COLUMN IF NOT EXISTS ultima_en_puesto  DATE;

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
  -- de compras, después el que decide; dentro de cada tipo, el más reciente. `visto`: la última declaración que lo nombra
  -- sin cese (hasta ahí consta que seguía en el puesto).
  CREATE TEMP TABLE _cp ON COMMIT DROP AS
    SELECT DISTINCT ON (x.codigo, x.entidad_ruc) x.codigo, x.entidad_ruc, x.cargo, x.tipo_cargo, x.inicio,
           -- Cerrado: declaró un cese y no volvió a declararlo vigente después de esa fecha.
           CASE WHEN x.cese IS NOT NULL AND (x.visto IS NULL OR x.cese >= x.visto) THEN x.cese END AS fin,
           CASE WHEN x.cese IS NOT NULL AND (x.visto IS NULL OR x.cese >= x.visto) THEN NULL ELSE GREATEST(x.visto, x.inicio) END AS visto_hasta
      FROM (SELECT f.codigo, f.entidad_ruc, upper(btrim(e.cargo)) AS cargo,
                   CASE WHEN upper(e.cargo) ~ '(LOGISTIC|ABASTECIM|ADQUISICION|CONTRATACION|COMPRAS|PROCESOS? DE SELECCION|ALMACEN|COTIZA|PROGRAMACION DE (BIENES|COMPRAS|ABASTEC))' THEN 'compras'
                        WHEN upper(e.cargo) ~ '(GERENTE MUNICIPAL|GERENTE GENERAL|ADMINISTRACION|ADMINISTRADOR|TESORER|PRESUPUESTO|ALCALDE|GOBERNADOR|DIRECTOR GENERAL|JEFE DE LA OFICINA GENERAL)' THEN 'decide' END AS tipo_cargo,
                   min(fecha_dji(e.fecha_inicio)) AS inicio, max(fecha_dji(e.fecha_cese)) AS cese,
                   max(fecha_dji(e.fecha_presentacion)) FILTER (WHERE COALESCE(btrim(e.fecha_cese), '') = '') AS visto
              FROM (SELECT DISTINCT codigo, entidad_ruc FROM _cf) f
              JOIN funcionario_codigo k ON k.codigo = f.codigo
              JOIN dji_funcionarios d ON d.nombre_norm = k.nombre_norm
              JOIN dji_empleos e ON e.codigo_ddjj = d.codigo_ddjj AND e.ruc_entidad = f.entidad_ruc
             WHERE length(btrim(COALESCE(e.cargo, ''))) >= 3
             GROUP BY 1, 2, 3, 4) x
     WHERE x.tipo_cargo IS NOT NULL
     ORDER BY x.codigo, x.entidad_ruc, (x.tipo_cargo = 'compras') DESC, x.inicio DESC NULLS LAST, x.cargo;
  CREATE INDEX ON _cp (codigo, entidad_ruc); ANALYZE _cp;

  -- El documento de cada familiar, con la MISMA numeración de la migración 351 (grado y documento). No se guarda.
  CREATE TEMP TABLE _cd ON COMMIT DROP AS
    SELECT y.codigo, y.dni,
           (row_number() OVER (PARTITION BY y.codigo ORDER BY CASE y.grado WHEN 'conyuge' THEN 0 WHEN 'hijo' THEN 1 WHEN 'padre' THEN 2 WHEN 'hermano' THEN 3 ELSE 4 END, y.dni))::int AS pariente
      FROM (SELECT DISTINCT ON (f.codigo, v.pariente_doc) f.codigo, v.pariente_doc AS dni, v.grado
              FROM dji_vinculos v JOIN funcionario_codigo f ON f.nombre_norm = v.declarante_norm
             WHERE v.pariente_doc ~ '^\d{8}$' AND f.codigo IN (SELECT codigo FROM _cp)
             ORDER BY f.codigo, v.pariente_doc, CASE v.grado WHEN 'conyuge' THEN 0 WHEN 'hijo' THEN 1 WHEN 'padre' THEN 2 WHEN 'hermano' THEN 3 ELSE 4 END) y;
  CREATE INDEX ON _cd (codigo, pariente); ANALYZE _cd;

  -- Sus órdenes de esa entidad, una por una, frente al puesto. Mismos filtros que persona_orden_anual (migración 94).
  CREATE TEMP TABLE _co ON COMMIT DROP AS
    SELECT w.codigo, w.entidad_ruc, w.pariente,
           (count(*) FILTER (WHERE w.fecha_emision BETWEEN w.inicio AND w.tope))::int AS en_puesto,
           COALESCE(sum(w.monto) FILTER (WHERE w.fecha_emision BETWEEN w.inicio AND w.tope), 0) AS monto_en_puesto,
           (count(*) FILTER (WHERE w.fecha_emision < w.inicio))::int AS antes,
           (count(*) FILTER (WHERE w.fecha_emision > w.tope))::int AS luego,
           min(w.fecha_emision) FILTER (WHERE w.fecha_emision BETWEEN w.inicio AND w.tope) AS primera,
           max(w.fecha_emision) FILTER (WHERE w.fecha_emision BETWEEN w.inicio AND w.tope) AS ultima
      FROM (SELECT DISTINCT ON (c.codigo, c.entidad_ruc, c.pariente, o.orden, o.fecha_emision)
                   c.codigo, c.entidad_ruc, c.pariente, o.fecha_emision, o.monto, p.inicio, COALESCE(p.fin, p.visto_hasta) AS tope
              FROM _cf c
              JOIN _cp p ON p.codigo = c.codigo AND p.entidad_ruc = c.entidad_ruc
              JOIN _cd d ON d.codigo = c.codigo AND d.pariente = c.pariente
              JOIN conosce_ordenes o ON o.entidad_ruc = c.entidad_ruc AND o.ruc_contratista BETWEEN '10' || d.dni || '0' AND '10' || d.dni || '9'
             WHERE p.inicio IS NOT NULL AND COALESCE(p.fin, p.visto_hasta) IS NOT NULL
               AND o.fecha_emision IS NOT NULL AND o.tipo_orden = 'Orden de Servicio'
               AND o.estado IS DISTINCT FROM 'Anulada' AND o.moneda = 'Nuevos Soles' AND o.monto > 0
             ORDER BY c.codigo, c.entidad_ruc, c.pariente, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC) w
     GROUP BY 1, 2, 3;
  CREATE INDEX ON _co (codigo, entidad_ruc, pariente); ANALYZE _co;

  DELETE FROM funcionario_compras_familiar;
  INSERT INTO funcionario_compras_familiar (codigo, entidad_ruc, entidad, cargo, tipo_cargo, cargo_desde, cargo_hasta, visto_hasta, pariente, parentesco, grado,
                                            cercano, ordenes, monto, desde, hasta, ordenes_en_puesto, monto_en_puesto, ordenes_antes, ordenes_luego,
                                            primera_en_puesto, ultima_en_puesto, coincide, empezo_despues, severidad)
  SELECT z.codigo, z.entidad_ruc, z.entidad, z.cargo, z.tipo_cargo, z.inicio, z.fin, z.visto_hasta, z.pariente, z.parentesco, z.grado, z.cercano, z.ordenes, z.monto,
         z.desde, z.hasta, z.en_puesto, z.monto_en_puesto, z.antes, z.luego, z.primera, z.ultima,
         COALESCE(z.en_puesto, 0) > 0, COALESCE(z.en_puesto, 0) > 0 AND COALESCE(z.antes, 0) = 0,
         CASE WHEN z.tipo_cargo = 'compras' AND z.cercano AND COALESCE(z.en_puesto, 0) > 0 THEN 'alta'
              WHEN (z.tipo_cargo = 'compras' AND z.cercano) OR (z.tipo_cargo = 'decide' AND z.cercano AND COALESCE(z.en_puesto, 0) > 0) THEN 'media'
              ELSE 'baja' END
    FROM (SELECT c.*, p.cargo, p.tipo_cargo, p.inicio, p.fin, p.visto_hasta,
                 COALESCE(c.grado, '') IN ('conyuge', 'padre', 'hijo', 'hermano') AS cercano,
                 o.en_puesto, o.monto_en_puesto, o.antes, o.luego, o.primera, o.ultima
            FROM _cf c
            JOIN _cp p ON p.codigo = c.codigo AND p.entidad_ruc = c.entidad_ruc
            LEFT JOIN _co o ON o.codigo = c.codigo AND o.entidad_ruc = c.entidad_ruc AND o.pariente = c.pariente
           WHERE c.ordenes > 0 AND c.monto > 0) z;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE funcionario_compras_familiar;
  RETURN n;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER FUNCTION public.refrescar_funcionario_compras_familiar() OWNER TO vigia_jobs;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.refrescar_funcionario_compras_familiar() FROM PUBLIC;
