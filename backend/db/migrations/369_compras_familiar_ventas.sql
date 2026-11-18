-- 369 · Compras y familia: la evidencia venta por venta (cada orden y cada proceso frente al puesto).
--
-- El panel de un caso decía «21 órdenes por S/ 351 mil» y nada más: ni cuáles, ni un enlace para verlas. El usuario, el
-- 2026-11-18: «acá no aparecen datos ni nada, ni enlaces ni otras cosas». Una señal sin su evidencia citada no sirve.
--
-- `funcionario_compras_familiar_venta` guarda, de cada caso de la migración 368, cada orden y cada proceso con su fecha,
-- su monto y en qué momento cayó frente al puesto:
--   antes         antes de que la persona asumiera
--   en_puesto     con la persona en el puesto (y, con una empresa, con el familiar ya figurando en ella)
--   sin_familiar  con la persona en el puesto, pero antes de que el familiar figurara en la empresa
--   despues       después del cese o, sin cese, de su última declaración que nombra el puesto
--   sin_fecha     no declaró desde cuándo tiene el puesto
-- La llena el mismo refresco, con las mismas tablas temporales: las cuentas del caso y su lista no pueden diferir.
--
-- Privacidad:
--   · Con la empresa del familiar (pública): el número de la orden, su descripción, el código del proceso y su OCID, para
--     enlazar cada venta a la lista de compras de la entidad y a la ficha del contrato.
--   · A nombre del familiar: SÓLO la fecha y el monto. El número de la orden o su descripción llevarían a su nombre.
--   · La API no lee dji_vinculos (migraciones 213 y 214): por eso la evidencia se guarda aquí, ya sin documentos.
-- Sólo la lee la API.

CREATE TABLE IF NOT EXISTS funcionario_compras_familiar_venta (
  codigo              TEXT     NOT NULL,
  entidad_ruc         TEXT     NOT NULL,
  pariente            SMALLINT NOT NULL,
  empresa_ruc         TEXT     NOT NULL DEFAULT '',
  tipo                TEXT     NOT NULL,          -- orden | proceso
  fecha               DATE     NOT NULL,          -- emisión de la orden o buena pro del proceso
  monto               NUMERIC(18, 2),
  momento             TEXT     NOT NULL,          -- antes | en_puesto | sin_familiar | despues | sin_fecha
  orden               TEXT,                       -- sólo con empresa
  tipo_orden          TEXT,
  estado              TEXT,
  descripcion         TEXT,
  codigo_convocatoria TEXT,                       -- sólo procesos
  nomenclatura        TEXT,
  ocid                TEXT
);
CREATE INDEX IF NOT EXISTS funcionario_compras_familiar_venta_caso
  ON funcionario_compras_familiar_venta (codigo, entidad_ruc, pariente, empresa_ruc, fecha DESC);

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

  -- Las empresas de sus familiares (RNP) que le vendieron algo al Estado (migración 351).
  CREATE TEMP TABLE _ce ON COMMIT DROP AS
    SELECT ff.codigo, ff.pariente, max(ff.parentesco) AS parentesco, max(ff.grado) AS grado, ff.empresa_ruc, max(ff.empresa) AS empresa, max(ff.rol) AS rol
      FROM funcionario_familiar ff
     WHERE ff.tipo = 'empresa' AND ff.empresa_ruc ~ '^20\d{9}$'
     GROUP BY ff.codigo, ff.pariente, ff.empresa_ruc;
  CREATE INDEX ON _ce (codigo); ANALYZE _ce;

  -- El puesto del funcionario en cada entidad, de la sección de empleos de sus declaraciones. Si declaró varios en la misma,
  -- primero el de compras, después el que decide; dentro de cada tipo, el más reciente. `visto`: la última declaración que
  -- lo nombra sin cese (hasta ahí consta que seguía en el puesto).
  CREATE TEMP TABLE _cp ON COMMIT DROP AS
    SELECT DISTINCT ON (x.codigo, x.entidad_ruc) x.codigo, x.entidad_ruc, x.cargo, x.tipo_cargo, x.inicio,
           -- Cerrado: declaró un cese y no volvió a declararlo vigente después de esa fecha.
           CASE WHEN x.cese IS NOT NULL AND (x.visto IS NULL OR x.cese >= x.visto) THEN x.cese END AS fin,
           CASE WHEN x.cese IS NOT NULL AND (x.visto IS NULL OR x.cese >= x.visto) THEN NULL ELSE GREATEST(x.visto, x.inicio) END AS visto_hasta
      FROM (SELECT f.codigo, e.ruc_entidad AS entidad_ruc, upper(btrim(e.cargo)) AS cargo,
                   -- Sobre el texto sin tildes («LOGÍSTICA», «ADQUISICIÓN»). «Contratación de…» sola es el encargo por el
                   -- que lo contrataron («contratación de servicios de alquiler de maquinaria»), no un puesto de compras:
                   -- cuenta «contrataciones» o «contratación pública / del Estado». Quien dicta un curso tampoco.
                   CASE WHEN c.t ~ '^(DOCENTE|PROFESOR|CAPACITADOR|EXPOSITOR|PONENTE)' THEN NULL
                        WHEN c.t ~ '(LOGISTIC|ABASTECIM|ADQUISICION|CONTRATACIONES|CONTRATACI ONES|CONTRATACION (PUBLICA|ESTATAL|DEL ESTADO)|COMPRAS|(PROCESOS?|PROCEDIMIENTOS?) DE SELECCION|ALMACEN|COTIZA|PROGRAMACION DE (BIENES|COMPRAS|ABASTEC))' THEN 'compras'
                        WHEN c.t ~ '(GERENTE MUNICIPAL|GERENTE GENERAL|ADMINISTRACION|ADMINISTRADOR|TESORER|PRESUPUESTO|ALCALDE|GOBERNADOR|DIRECTOR GENERAL|JEFE DE LA OFICINA GENERAL)' THEN 'decide' END AS tipo_cargo,
                   min(fecha_dji(e.fecha_inicio)) AS inicio, max(fecha_dji(e.fecha_cese)) AS cese,
                   max(fecha_dji(e.fecha_presentacion)) FILTER (WHERE COALESCE(btrim(e.fecha_cese), '') = '') AS visto
              FROM (SELECT codigo FROM _cf UNION SELECT codigo FROM _ce) f
              JOIN funcionario_codigo k ON k.codigo = f.codigo
              JOIN dji_funcionarios d ON d.nombre_norm = k.nombre_norm
              JOIN dji_empleos e ON e.codigo_ddjj = d.codigo_ddjj AND e.ruc_entidad ~ '^\d{11}$'
              CROSS JOIN LATERAL (SELECT upper(immutable_unaccent(COALESCE(e.cargo, ''))) AS t) c
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

  -- A nombre del familiar: sus órdenes de esa entidad, una por una, frente al puesto. Mismos filtros que
  -- persona_orden_anual (migración 94).
  CREATE TEMP TABLE _cw ON COMMIT DROP AS
    SELECT DISTINCT ON (c.codigo, c.entidad_ruc, c.pariente, o.orden, o.fecha_emision)
                   c.codigo, c.entidad_ruc, c.pariente, o.fecha_emision, o.monto, p.inicio, COALESCE(p.fin, p.visto_hasta) AS tope
              FROM _cf c
              JOIN _cp p ON p.codigo = c.codigo AND p.entidad_ruc = c.entidad_ruc
              JOIN _cd d ON d.codigo = c.codigo AND d.pariente = c.pariente
              JOIN conosce_ordenes o ON o.entidad_ruc = c.entidad_ruc AND o.ruc_contratista BETWEEN '10' || d.dni || '0' AND '10' || d.dni || '9'
             WHERE p.inicio IS NOT NULL AND COALESCE(p.fin, p.visto_hasta) IS NOT NULL
               AND o.fecha_emision IS NOT NULL AND o.tipo_orden = 'Orden de Servicio'
               AND o.estado IS DISTINCT FROM 'Anulada' AND o.moneda = 'Nuevos Soles' AND o.monto > 0
             ORDER BY c.codigo, c.entidad_ruc, c.pariente, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC;
  CREATE INDEX ON _cw (codigo, entidad_ruc, pariente); ANALYZE _cw;

  CREATE TEMP TABLE _co ON COMMIT DROP AS
    SELECT w.codigo, w.entidad_ruc, w.pariente,
           (count(*) FILTER (WHERE w.fecha_emision BETWEEN w.inicio AND w.tope))::int AS en_puesto,
           COALESCE(sum(w.monto) FILTER (WHERE w.fecha_emision BETWEEN w.inicio AND w.tope), 0) AS monto_en_puesto,
           (count(*) FILTER (WHERE w.fecha_emision < w.inicio))::int AS antes,
           (count(*) FILTER (WHERE w.fecha_emision > w.tope))::int AS luego,
           min(w.fecha_emision) FILTER (WHERE w.fecha_emision BETWEEN w.inicio AND w.tope) AS primera,
           max(w.fecha_emision) FILTER (WHERE w.fecha_emision BETWEEN w.inicio AND w.tope) AS ultima
      FROM _cw w
     GROUP BY 1, 2, 3;
  CREATE INDEX ON _co (codigo, entidad_ruc, pariente); ANALYZE _co;

  -- Con su empresa: cada empresa de un familiar frente a cada entidad donde el declarante tiene un puesto de compras o
  -- que decide. `pariente_desde`: desde cuándo figura el familiar en la empresa (RNP).
  CREATE TEMP TABLE _cx ON COMMIT DROP AS
    SELECT e.codigo, p.entidad_ruc, e.pariente, e.parentesco, e.grado, e.empresa_ruc, e.empresa, e.rol, p.cargo, p.tipo_cargo, p.inicio, p.fin, p.visto_hasta,
           COALESCE(p.fin, p.visto_hasta) AS tope,
           (SELECT min(r.fecha_inicio_vigencia) FROM rnp_conformacion_juridica r
             WHERE r.numero_documento = d.dni AND r.ruc_empresa = e.empresa_ruc::char(11)) AS pariente_desde
      FROM _ce e
      JOIN _cp p ON p.codigo = e.codigo
      JOIN _cd d ON d.codigo = e.codigo AND d.pariente = e.pariente
     WHERE EXISTS (SELECT 1 FROM conosce_ordenes c WHERE c.entidad_ruc = p.entidad_ruc AND c.ruc_contratista = e.empresa_ruc)
        OR EXISTS (SELECT 1 FROM conosce_adjudicaciones a WHERE a.entidad_ruc = p.entidad_ruc AND a.ruc_proveedor = e.empresa_ruc);
  CREATE INDEX ON _cx (entidad_ruc, empresa_ruc); ANALYZE _cx;

  -- Sus ventas a esa entidad, una por una: órdenes (por fecha de emisión) y procesos (por su buena pro).
  CREATE TEMP TABLE _cv ON COMMIT DROP AS
    SELECT x.codigo, x.entidad_ruc, x.pariente, x.empresa_ruc, 'orden'::text AS tipo, o.entidad, o.fecha, o.monto,
           o.orden, o.tipo_orden, o.estado, o.descripcion, NULL::text AS convocatoria, NULL::text AS nomenclatura
      FROM _cx x
      JOIN LATERAL (SELECT DISTINCT ON (c.orden, c.fecha_emision) c.entidad, c.fecha_emision AS fecha, c.monto, c.orden, c.tipo_orden, c.estado, c.descripcion
                      FROM conosce_ordenes c
                     WHERE c.entidad_ruc = x.entidad_ruc AND c.ruc_contratista = x.empresa_ruc AND c.fecha_emision IS NOT NULL
                       AND c.estado IS DISTINCT FROM 'Anulada' AND c.moneda = 'Nuevos Soles' AND c.monto > 0
                     ORDER BY c.orden, c.fecha_emision, c.anio DESC, c.mes DESC) o ON true
    UNION ALL
    SELECT x.codigo, x.entidad_ruc, x.pariente, x.empresa_ruc, 'proceso', a.entidad, a.fecha, a.monto,
           NULL, NULL, NULL, a.descripcion, a.convocatoria, a.nomenclatura
      FROM _cx x
      JOIN LATERAL (SELECT max(c.entidad) AS entidad, max(c.fecha_buenapro) AS fecha, COALESCE(sum(c.monto_adjudicado), 0) AS monto,
                           c.codigo_convocatoria AS convocatoria, max(c.nomenclatura) AS nomenclatura, max(c.descripcion_proceso) AS descripcion
                      FROM conosce_adjudicaciones c
                     WHERE c.entidad_ruc = x.entidad_ruc AND c.ruc_proveedor = x.empresa_ruc AND c.fecha_buenapro IS NOT NULL
                     GROUP BY c.codigo_convocatoria) a ON true;
  CREATE INDEX ON _cv (codigo, entidad_ruc, pariente, empresa_ruc); ANALYZE _cv;

  DELETE FROM funcionario_compras_familiar;
  -- A nombre del familiar.
  INSERT INTO funcionario_compras_familiar (codigo, entidad_ruc, entidad, cargo, tipo_cargo, cargo_desde, cargo_hasta, visto_hasta, pariente, parentesco, grado,
                                            cercano, ordenes, monto, desde, hasta, ordenes_en_puesto, monto_en_puesto, ordenes_antes, ordenes_luego,
                                            primera_en_puesto, ultima_en_puesto, coincide, empezo_despues, severidad, via, empresa_ruc)
  SELECT z.codigo, z.entidad_ruc, z.entidad, z.cargo, z.tipo_cargo, z.inicio, z.fin, z.visto_hasta, z.pariente, z.parentesco, z.grado, z.cercano, z.ordenes, z.monto,
         z.desde, z.hasta, z.en_puesto, z.monto_en_puesto, z.antes, z.luego, z.primera, z.ultima,
         COALESCE(z.en_puesto, 0) > 0, COALESCE(z.en_puesto, 0) > 0 AND COALESCE(z.antes, 0) = 0,
         CASE WHEN z.tipo_cargo = 'compras' AND z.cercano AND COALESCE(z.en_puesto, 0) > 0 THEN 'alta'
              WHEN (z.tipo_cargo = 'compras' AND z.cercano) OR (z.tipo_cargo = 'decide' AND z.cercano AND COALESCE(z.en_puesto, 0) > 0) THEN 'media'
              ELSE 'baja' END, 'persona', ''
    FROM (SELECT c.*, p.cargo, p.tipo_cargo, p.inicio, p.fin, p.visto_hasta,
                 COALESCE(c.grado, '') IN ('conyuge', 'padre', 'hijo', 'hermano') AS cercano,
                 o.en_puesto, o.monto_en_puesto, o.antes, o.luego, o.primera, o.ultima
            FROM _cf c
            JOIN _cp p ON p.codigo = c.codigo AND p.entidad_ruc = c.entidad_ruc
            LEFT JOIN _co o ON o.codigo = c.codigo AND o.entidad_ruc = c.entidad_ruc AND o.pariente = c.pariente
           WHERE c.ordenes > 0 AND c.monto > 0) z;
  GET DIAGNOSTICS n = ROW_COUNT;

  -- Con la empresa del familiar. «En el puesto»: entre el inicio y el fin del puesto y con el familiar ya en la empresa.
  INSERT INTO funcionario_compras_familiar (codigo, entidad_ruc, entidad, cargo, tipo_cargo, cargo_desde, cargo_hasta, visto_hasta, pariente, parentesco, grado,
                                            cercano, ordenes, monto, desde, hasta, ordenes_en_puesto, monto_en_puesto, ordenes_antes, ordenes_luego,
                                            primera_en_puesto, ultima_en_puesto, coincide, empezo_despues, severidad, via, empresa_ruc, empresa, rol_en_empresa,
                                            pariente_desde, procesos_en_puesto, monto_procesos_en_puesto)
  SELECT z.codigo, z.entidad_ruc, z.entidad, z.cargo, z.tipo_cargo, z.inicio, z.fin, z.visto_hasta, z.pariente, z.parentesco, z.grado, z.cercano, z.ordenes, z.monto,
         z.desde, z.hasta, z.en_puesto, z.monto_en_puesto, z.antes, z.luego, z.primera, z.ultima,
         z.en_puesto + z.procesos_en_puesto > 0, z.en_puesto + z.procesos_en_puesto > 0 AND z.antes + z.procesos_antes = 0,
         CASE WHEN z.tipo_cargo = 'compras' AND z.cercano AND z.en_puesto + z.procesos_en_puesto > 0 THEN 'alta'
              WHEN (z.tipo_cargo = 'compras' AND z.cercano) OR (z.tipo_cargo = 'decide' AND z.cercano AND z.en_puesto + z.procesos_en_puesto > 0) THEN 'media'
              ELSE 'baja' END, 'empresa', z.empresa_ruc, z.empresa, z.rol, z.pariente_desde, z.procesos_en_puesto, z.monto_procesos_en_puesto
    FROM (SELECT x.codigo, x.entidad_ruc, max(v.entidad) AS entidad, x.cargo, x.tipo_cargo, x.inicio, x.fin, x.visto_hasta, x.pariente, x.parentesco, x.grado,
                 COALESCE(x.grado, '') IN ('conyuge', 'padre', 'hijo', 'hermano') AS cercano, x.empresa_ruc, x.empresa, x.rol, x.pariente_desde,
                 (count(*) FILTER (WHERE v.tipo = 'orden'))::int AS ordenes, COALESCE(sum(v.monto) FILTER (WHERE v.tipo = 'orden'), 0) AS monto,
                 (min(extract(year FROM v.fecha)))::int AS desde, (max(extract(year FROM v.fecha)))::int AS hasta,
                 (count(*) FILTER (WHERE v.tipo = 'orden' AND d.dentro))::int AS en_puesto,
                 COALESCE(sum(v.monto) FILTER (WHERE v.tipo = 'orden' AND d.dentro), 0) AS monto_en_puesto,
                 (count(*) FILTER (WHERE v.tipo = 'proceso' AND d.dentro))::int AS procesos_en_puesto,
                 COALESCE(sum(v.monto) FILTER (WHERE v.tipo = 'proceso' AND d.dentro), 0) AS monto_procesos_en_puesto,
                 (count(*) FILTER (WHERE v.tipo = 'orden' AND v.fecha < x.inicio))::int AS antes,
                 (count(*) FILTER (WHERE v.tipo = 'proceso' AND v.fecha < x.inicio))::int AS procesos_antes,
                 (count(*) FILTER (WHERE v.tipo = 'orden' AND v.fecha > x.tope))::int AS luego,
                 min(v.fecha) FILTER (WHERE d.dentro) AS primera, max(v.fecha) FILTER (WHERE d.dentro) AS ultima
            FROM _cx x
            JOIN _cv v ON v.codigo = x.codigo AND v.entidad_ruc = x.entidad_ruc AND v.pariente = x.pariente AND v.empresa_ruc = x.empresa_ruc
            CROSS JOIN LATERAL (SELECT COALESCE(x.inicio IS NOT NULL AND x.tope IS NOT NULL AND v.fecha BETWEEN x.inicio AND x.tope
                                                 AND (x.pariente_desde IS NULL OR v.fecha >= x.pariente_desde), false) AS dentro) d
           GROUP BY x.codigo, x.entidad_ruc, x.cargo, x.tipo_cargo, x.inicio, x.fin, x.visto_hasta, x.tope, x.pariente, x.parentesco, x.grado, x.empresa_ruc,
                    x.empresa, x.rol, x.pariente_desde) z;
  ANALYZE funcionario_compras_familiar;

  -- La evidencia, venta por venta, con el mismo corte que las cuentas de arriba.
  DELETE FROM funcionario_compras_familiar_venta;
  -- A nombre del familiar: sólo la fecha y el monto. El número de la orden o su descripción lo identificarían.
  INSERT INTO funcionario_compras_familiar_venta (codigo, entidad_ruc, pariente, empresa_ruc, tipo, fecha, monto, momento)
  SELECT w.codigo, w.entidad_ruc, w.pariente, '', 'orden', w.fecha_emision, w.monto,
         CASE WHEN w.fecha_emision < w.inicio THEN 'antes' WHEN w.fecha_emision > w.tope THEN 'despues' ELSE 'en_puesto' END
    FROM _cw w
   WHERE EXISTS (SELECT 1 FROM funcionario_compras_familiar k
                  WHERE k.codigo = w.codigo AND k.entidad_ruc = w.entidad_ruc AND k.pariente = w.pariente AND k.empresa_ruc = '');
  -- Con su empresa: cada orden con su número y cada proceso con su código y su OCID (la empresa es pública).
  INSERT INTO funcionario_compras_familiar_venta (codigo, entidad_ruc, pariente, empresa_ruc, tipo, fecha, monto, momento, orden, tipo_orden, estado,
                                                  descripcion, codigo_convocatoria, nomenclatura, ocid)
  SELECT v.codigo, v.entidad_ruc, v.pariente, v.empresa_ruc, v.tipo, v.fecha, v.monto,
         CASE WHEN x.inicio IS NULL OR x.tope IS NULL THEN 'sin_fecha'
              WHEN v.fecha < x.inicio THEN 'antes'
              WHEN v.fecha > x.tope THEN 'despues'
              WHEN x.pariente_desde IS NOT NULL AND v.fecha < x.pariente_desde THEN 'sin_familiar'
              ELSE 'en_puesto' END,
         v.orden, v.tipo_orden, v.estado, left(v.descripcion, 300), v.convocatoria, v.nomenclatura,
         (SELECT c.ocid FROM convocatorias c WHERE c.codigo = v.convocatoria AND c.entidad_ruc = v.entidad_ruc LIMIT 1)
    FROM _cv v
    JOIN _cx x ON x.codigo = v.codigo AND x.entidad_ruc = v.entidad_ruc AND x.pariente = v.pariente AND x.empresa_ruc = v.empresa_ruc;
  ANALYZE funcionario_compras_familiar_venta;
  RETURN (SELECT count(*)::int FROM funcionario_compras_familiar);
END $$;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.funcionario_compras_familiar_venta OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_funcionario_compras_familiar() OWNER TO vigia_jobs;
  END IF;
  REVOKE ALL ON public.funcionario_compras_familiar_venta FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'dev_api', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.funcionario_compras_familiar_venta TO %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.refrescar_funcionario_compras_familiar() FROM PUBLIC;
