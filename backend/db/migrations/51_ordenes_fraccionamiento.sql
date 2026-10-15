-- 51 · Órdenes de compra y de servicio (CONOSCE) y posible fraccionamiento.
--
-- conosce_ordenes: las órdenes que registran las entidades en el SEACE (compras de hasta 8 UIT, las derivadas de
-- procesos, catálogo electrónico…), un archivo por mes de registro:
--   https://conosce.osce.gob.pe/buscador/assets/67ae6c4a/reportes/ordenes/<año>/CONOSCE_ORDENESCOMPRA<MES><año>_0.xlsx
-- (MES en mayúsculas y sin tilde: ENERO … SEPTIEMBRE … DICIEMBRE; hay copias viejas "SETIEMBRE" con otro formato
-- que no se usan). El scraper `conosce` carga cada mes en una transacción (borra el mes y lo vuelve a copiar).
--
-- ordenes_fraccionadas (refrescar_fraccionamiento()): una fila por entidad, empresa (RUC 20), día de emisión y
-- objeto cuando ese día la entidad le emitió a la misma empresa 2 o más órdenes "hasta 8 UIT" que juntas pasan el
-- tope. La ley prohíbe fraccionar una contratación para evitar el procedimiento de selección: esto es el patrón
-- en los registros, no la prueba de que lo hubo. Severidad alta con 3 o más órdenes o con la misma descripción en
-- todas. Sólo RUC 20: las personas naturales (RUC 10) son en su mayoría locadores con órdenes mensuales y aquí no
-- se publican.
--
-- refrescar_cruces() (migración 50) suma `fraccionamiento`: el ganador de un proceso tiene ese patrón con la misma
-- entidad.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/51_ordenes_fraccionamiento.sql

CREATE TABLE IF NOT EXISTS conosce_ordenes (
  anio               SMALLINT NOT NULL,       -- año y mes de registro (los del archivo)
  mes                SMALLINT NOT NULL,
  entidad            TEXT,
  entidad_ruc        TEXT,
  departamento       TEXT,
  tipo_orden         TEXT,                    -- Orden de Compra | Orden de Servicio
  nro_orden          TEXT,
  orden              TEXT,                    -- "O/S-6982-2026-OFICINA DE ABASTECIMIENTO"
  descripcion        TEXT,
  objeto             TEXT,                    -- BIENES | SERVICIOS | CONSULTORIAS OBRAS…
  estado             TEXT,                    -- Emitida | Comprometida | Devengada | Anulada
  tipo_contratacion  TEXT,                    -- "Contrataciones hasta 8 UIT …", "Deviene de Procesos de Selección"…
  monto              NUMERIC(18, 2),
  moneda             TEXT,
  ruc_contratista    TEXT,
  contratista        TEXT,
  fecha_registro     DATE,
  fecha_emision      DATE,
  fecha_compromiso   DATE,
  fecha_notificacion DATE
);
CREATE INDEX IF NOT EXISTS conosce_ordenes_mes ON conosce_ordenes (anio, mes);
CREATE INDEX IF NOT EXISTS conosce_ordenes_entidad ON conosce_ordenes (entidad_ruc, ruc_contratista);
CREATE INDEX IF NOT EXISTS conosce_ordenes_contratista ON conosce_ordenes (ruc_contratista);
ALTER TABLE conosce_ordenes OWNER TO vigia_jobs;
GRANT SELECT ON conosce_ordenes TO vigia_api;

-- UIT en soles por año (decreto supremo de cada diciembre). Años sin dato: la última conocida.
CREATE OR REPLACE FUNCTION uit_soles(anio INT) RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN anio <= 2018 THEN 4150 WHEN anio = 2019 THEN 4200 WHEN anio = 2020 THEN 4300 WHEN anio = 2021 THEN 4400
    WHEN anio = 2022 THEN 4600 WHEN anio = 2023 THEN 4950 WHEN anio = 2024 THEN 5150 WHEN anio = 2025 THEN 5350
    ELSE 5500 END
$$;
ALTER FUNCTION uit_soles(INT) OWNER TO vigia_jobs;

CREATE TABLE IF NOT EXISTS ordenes_fraccionadas (
  entidad_ruc        TEXT NOT NULL,
  entidad            TEXT,
  ruc_contratista    TEXT NOT NULL,
  contratista        TEXT,
  fecha              DATE NOT NULL,           -- día de emisión
  objeto             TEXT,
  ordenes            INT NOT NULL,
  total              NUMERIC(18, 2) NOT NULL,
  tope               NUMERIC(18, 2) NOT NULL, -- 8 UIT del año (9 con el D.U. 016-2022)
  misma_descripcion  BOOLEAN NOT NULL,
  severidad          TEXT NOT NULL,
  detalle            JSONB NOT NULL           -- [{orden, monto, descripcion, estado}]
);
CREATE INDEX IF NOT EXISTS ordenes_fraccionadas_entidad ON ordenes_fraccionadas (entidad_ruc, fecha DESC);
CREATE INDEX IF NOT EXISTS ordenes_fraccionadas_contratista ON ordenes_fraccionadas (ruc_contratista);
ALTER TABLE ordenes_fraccionadas OWNER TO vigia_jobs;
GRANT SELECT ON ordenes_fraccionadas TO vigia_api;

CREATE OR REPLACE FUNCTION refrescar_fraccionamiento() RETURNS INT LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  DELETE FROM ordenes_fraccionadas;
  INSERT INTO ordenes_fraccionadas (entidad_ruc, entidad, ruc_contratista, contratista, fecha, objeto, ordenes, total, tope,
                                    misma_descripcion, severidad, detalle)
  SELECT o.entidad_ruc, max(o.entidad), o.ruc_contratista, max(o.contratista), o.fecha_emision, o.objeto, count(*), sum(o.monto),
         max(o.n_uit) * uit_soles(extract(year FROM o.fecha_emision)::int),
         count(DISTINCT left(mef_norm(o.descripcion), 40)) = 1,
         CASE WHEN count(*) >= 3 OR count(DISTINCT left(mef_norm(o.descripcion), 40)) = 1 THEN 'alta' ELSE 'media' END,
         jsonb_agg(jsonb_build_object('orden', o.orden, 'monto', o.monto, 'descripcion', left(o.descripcion, 200), 'estado', o.estado)
                   ORDER BY o.monto DESC)
  FROM (
    -- Una vez cada orden (un mismo archivo puede repetirla).
    SELECT DISTINCT ON (entidad_ruc, orden, fecha_emision) *,
           COALESCE(substring(tipo_contratacion FROM 'hasta (\d+) UIT')::int, 8) AS n_uit
    FROM conosce_ordenes
    WHERE tipo_contratacion ILIKE 'Contrataciones hasta%' AND estado IS DISTINCT FROM 'Anulada'
      AND moneda = 'Nuevos Soles' AND ruc_contratista ~ '^20\d{9}$' AND fecha_emision IS NOT NULL AND monto > 0
    ORDER BY entidad_ruc, orden, fecha_emision, anio DESC, mes DESC
  ) o
  GROUP BY o.entidad_ruc, o.ruc_contratista, o.fecha_emision, o.objeto
  HAVING count(*) >= 2 AND sum(o.monto) > max(o.n_uit) * uit_soles(extract(year FROM o.fecha_emision)::int);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_fraccionamiento() OWNER TO vigia_jobs;
GRANT SELECT ON conosce_ordenes, ordenes_fraccionadas TO vigia_jobs;

CREATE OR REPLACE FUNCTION refrescar_cruces() RETURNS TABLE (tipo TEXT, filas INT)
LANGUAGE plpgsql AS $$
BEGIN
  -- Ganadores: un proveedor por adjudicación (los consorcios llegan como varios suppliers).
  DROP TABLE IF EXISTS _cg;
  CREATE TEMP TABLE _cg ON COMMIT DROP AS
    SELECT DISTINCT c.ocid, c.entidad_ruc::text AS entidad_ruc,
           regexp_replace(s->>'id', '^PE-RUC-', '') AS ruc, s->>'name' AS nombre,
           NULLIF(aw->>'date', '')::date AS f
    FROM convocatorias c,
         jsonb_array_elements(COALESCE(c.ocds_payload->'awards', '[]'::jsonb)) aw,
         jsonb_array_elements(COALESCE(aw->'suppliers', '[]'::jsonb)) s
    WHERE c.ocid NOT LIKE 'ocds-vigia-%' AND regexp_replace(s->>'id', '^PE-RUC-', '') ~ '^(10|20)\d{9}$';
  CREATE INDEX ON _cg (ruc);

  -- Personas detrás de cada ganador: socios / representantes / directivos con DNI en el RNP, y el titular
  -- de un RUC 10 (sus dígitos 3 a 10 son el DNI).
  DROP TABLE IF EXISTS _cp;
  CREATE TEMP TABLE _cp ON COMMIT DROP AS
    SELECT ruc, dni, max(nombre) AS nombre, string_agg(DISTINCT rol, ', ' ORDER BY rol) AS rol FROM (
      SELECT r.ruc_empresa::text AS ruc, r.numero_documento AS dni, r.nombre, r.tipo_rol AS rol
      FROM rnp_conformacion_juridica r
      WHERE r.tipo_documento LIKE 'DOC. NACIONAL%' AND r.numero_documento ~ '^\d{8}$'
        AND r.ruc_empresa::text IN (SELECT ruc FROM _cg)
      UNION ALL
      SELECT DISTINCT g.ruc, substr(g.ruc, 3, 8), g.nombre, 'TITULAR' FROM _cg g WHERE g.ruc LIKE '10%'
    ) x GROUP BY ruc, dni;
  CREATE INDEX ON _cp (dni);

  DELETE FROM cruces_proveedor;

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, severidad, fecha, monto, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT 'aporte', p.ruc, 'media', max(a.fecha_aporte), sum(a.monto), p.dni, p.nombre, p.rol,
         jsonb_build_object('partido', a.partido, 'aportes', count(*), 'desde', min(a."año"), 'hasta', max(a."año")),
         'onpe_aportantes', 'https://claridad.onpe.gob.pe/'
  FROM _cp p JOIN onpe_aportantes a ON a.numero_documento = p.dni
  GROUP BY p.ruc, p.dni, p.nombre, p.rol, a.partido;

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT 'aporte_empresa', a.numero_documento, 'media', max(a.fecha_aporte), sum(a.monto),
         jsonb_build_object('partido', a.partido, 'aportes', count(*), 'desde', min(a."año"), 'hasta', max(a."año")),
         'onpe_aportantes', 'https://claridad.onpe.gob.pe/'
  FROM onpe_aportantes a WHERE a.numero_documento LIKE '20%' AND a.numero_documento IN (SELECT ruc FROM _cg)
  GROUP BY a.numero_documento, a.partido;

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, severidad, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT DISTINCT 'candidato', p.ruc, 'media', p.dni, p.nombre, p.rol,
         jsonb_build_object('organizacion', k.organizacion, 'proceso', k.proceso, 'departamento', k.departamento),
         'onpe_candidatos', 'https://claridad.onpe.gob.pe/'
  FROM _cp p JOIN onpe_candidatos k ON k.dni = p.dni;

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, severidad, fecha, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT DISTINCT 'autoridad', p.ruc, 'alta', j.periodo_inicio, p.dni, j.nombre, p.rol,
         jsonb_build_object('cargo', j.cargo, 'organizacion', j.organizacion_politica, 'departamento', j.departamento,
                            'provincia', j.provincia, 'distrito', j.distrito, 'desde', j.periodo_inicio, 'hasta', j.periodo_fin),
         'jne_autoridades', j.fuente_url
  FROM _cp p JOIN jne_autoridades j ON j.dni = p.dni;

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT 'penalidad', pe.empresa_ruc::text, 'media', max(pe.fecha), sum(pe.monto),
         jsonb_build_object('penalidades', count(*), 'entidades', count(DISTINCT pe.entidad_contratante),
                            'desde', min(pe.fecha), 'hasta', max(pe.fecha)),
         'penalidades', 'https://www.datosabiertos.gob.pe/dataset/penalidades-aplicadas-contratos-oece'
  FROM penalidades pe WHERE pe.empresa_ruc::text IN (SELECT ruc FROM _cg)
  GROUP BY pe.empresa_ruc;

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT 'sancion', s.ruc, CASE s.tipo WHEN 'definitivo' THEN 'alta' WHEN 'temporal' THEN 'media' ELSE 'baja' END,
         COALESCE(s.fecha_desde, s.fecha_resolucion), s.monto_multa_soles,
         jsonb_build_object('tipo', s.tipo, 'infraccion', s.infraccion, 'resolucion', s.resolucion,
                            'desde', s.fecha_desde, 'hasta', s.fecha_hasta, 'estado', s.estado),
         'osce_sancionados', 'https://www.datosabiertos.gob.pe/dataset/proveedores-sancionados-2025'
  FROM osce_sancionados s WHERE s.ruc IN (SELECT ruc FROM _cg);

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (g.ocid, g.ruc) 'sancion_vigente', g.ruc, g.ocid, 'alta', g.f, NULL::numeric,
         jsonb_build_object('tipo', s.tipo, 'infraccion', s.infraccion, 'resolucion', s.resolucion,
                            'desde', s.fecha_desde, 'hasta', s.fecha_hasta),
         'osce_sancionados', 'https://www.datosabiertos.gob.pe/dataset/proveedores-sancionados-2025'
  FROM _cg g JOIN osce_sancionados s ON s.ruc = g.ruc AND s.tipo IN ('temporal', 'definitivo')
   AND g.f >= s.fecha_desde AND (s.fecha_hasta IS NULL OR g.f <= s.fecha_hasta)
  ORDER BY g.ocid, g.ruc, s.fecha_desde DESC;

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT 'visita_previa', g.ruc, g.ocid,
         CASE WHEN mef_norm(v.entidad_visitada) = mef_norm(e.nombre) THEN 'alta' ELSE 'media' END,
         v.fecha_visita, p.dni, p.nombre, p.rol,
         jsonb_build_object('entidad_visitada', v.entidad_visitada, 'misma_entidad', mef_norm(v.entidad_visitada) = mef_norm(e.nombre),
                            'funcionario', v.funcionario_nombre, 'cargo_funcionario', v.funcionario_cargo, 'motivo', v.motivo,
                            'dias_antes', g.f - v.fecha_visita, 'buena_pro', g.f),
         'visitas_entidades', 'https://www.datosabiertos.gob.pe/'
  FROM _cg g JOIN _cp p ON p.ruc = g.ruc
  JOIN visitas_entidades v ON v.numero_documento = p.dni AND v.fecha_visita BETWEEN g.f - 180 AND g.f
  LEFT JOIN entidades e ON e.ruc::text = g.entidad_ruc;

  -- Postores de cada proceso: los del expediente (postores) y los de CONOSCE (migración 49), sólo con RUC
  -- (los códigos de consorcio del SEACE no cruzan con el RNP).
  DROP TABLE IF EXISTS _pp;
  CREATE TEMP TABLE _pp ON COMMIT DROP AS
    SELECT DISTINCT ocid, ruc FROM (
      SELECT p.ocid, p.empresa_ruc::text AS ruc FROM postores p WHERE p.ocid NOT LIKE 'ocds-vigia-%'
      UNION ALL
      SELECT c.ocid, cp.ruc_postor FROM conosce_postores cp JOIN convocatorias c ON c.ocid = cp.codigo_convocatoria
      WHERE cp.ruc_postor ~ '^(10|20)\d{9}$'
    ) x;
  CREATE INDEX ON _pp (ocid);

  -- Una fila por (proceso, postor, persona): con quién más compitió esa persona en el mismo proceso. Los
  -- postores son ofertas separadas (no miembros de un mismo consorcio: comprobado el 2026-10-14, ninguno de
  -- los pares figura junto en una misma adjudicación).
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT 'socio_comun', a.ruc, a.ocid, 'alta', ra.numero_documento, max(ra.nombre),
         string_agg(DISTINCT ra.tipo_rol, ', ' ORDER BY ra.tipo_rol),
         jsonb_build_object('otros_postores', jsonb_agg(DISTINCT b.ruc), 'rol_en_otros', jsonb_agg(DISTINCT rb.tipo_rol)),
         'rnp_conformacion_juridica', 'https://www.datosabiertos.gob.pe/'
  FROM _pp a JOIN _pp b ON b.ocid = a.ocid AND b.ruc <> a.ruc
  JOIN rnp_conformacion_juridica ra ON ra.ruc_empresa = a.ruc AND ra.tipo_documento LIKE 'DOC. NACIONAL%'
  JOIN rnp_conformacion_juridica rb ON rb.ruc_empresa = b.ruc AND rb.numero_documento = ra.numero_documento
  GROUP BY a.ocid, a.ruc, ra.numero_documento;

  -- Proveedor recurrente: cuántos otros procesos le ganó a la misma entidad desde 2018 (CONOSCE) y qué parte
  -- de lo que adjudicó la entidad se llevó. Desde 3 procesos.
  DROP TABLE IF EXISTS _ent;
  CREATE TEMP TABLE _ent ON COMMIT DROP AS
    SELECT a.entidad_ruc, count(DISTINCT a.codigo_convocatoria) AS procesos, sum(a.monto_adjudicado) AS monto
    FROM conosce_adjudicaciones a WHERE a.entidad_ruc IN (SELECT entidad_ruc FROM _cg) GROUP BY a.entidad_ruc;
  DROP TABLE IF EXISTS _rec;
  CREATE TEMP TABLE _rec ON COMMIT DROP AS
    SELECT a.entidad_ruc, a.ruc_proveedor AS ruc, array_agg(DISTINCT a.codigo_convocatoria) AS codigos,
           sum(a.monto_adjudicado) AS monto, min(a.fecha_buenapro) AS primera, max(a.fecha_buenapro) AS ultima
    FROM conosce_adjudicaciones a
    JOIN (SELECT DISTINCT entidad_ruc, ruc FROM _cg) g ON g.entidad_ruc = a.entidad_ruc AND g.ruc = a.ruc_proveedor
    GROUP BY a.entidad_ruc, a.ruc_proveedor;

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT 'recurrente', g.ruc, g.ocid,
         CASE WHEN r.procesos >= 10 OR r.monto >= 0.25 * NULLIF(t.monto, 0) THEN 'media' ELSE 'baja' END,
         r.ultima, r.monto,
         jsonb_build_object('procesos', r.procesos, 'desde', r.primera, 'hasta', r.ultima,
                            'participacion', round(r.monto / NULLIF(t.monto, 0), 4), 'procesos_entidad', t.procesos),
         'conosce_adjudicaciones', 'https://conosce.osce.gob.pe/buscador/'
  FROM (SELECT DISTINCT ocid, ruc, entidad_ruc FROM _cg) g
  JOIN LATERAL (
    -- Sin contar este proceso.
    SELECT cardinality(array_remove(x.codigos, g.ocid)) AS procesos, x.monto, x.primera, x.ultima
    FROM _rec x WHERE x.entidad_ruc = g.entidad_ruc AND x.ruc = g.ruc
  ) r ON r.procesos >= 3
  JOIN _ent t ON t.entidad_ruc = g.entidad_ruc;

  -- Contrato con adicionales o prórrogas (CONOSCE): por contrato, lo adicional sobre lo contratado. Los
  -- adicionales tienen tope legal (bienes y servicios 25 %; obras 15 % sin autorización de la Contraloría).
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT 'adicional', k.ruc, k.ocid,
         CASE WHEN k.adicional > 0.25 * k.total THEN 'alta' WHEN k.adicional >= 0.15 * k.total THEN 'media' ELSE 'baja' END,
         k.suscripcion, k.adicional,
         jsonb_build_object('contrato', k.num_contrato, 'contratado', k.total, 'adicional', k.adicional,
                            'reduccion', k.reduccion, 'prorroga', k.prorroga, 'complementario', k.complementario,
                            'porcentaje', round(100 * k.adicional / NULLIF(k.total, 0), 1), 'url_contrato', k.url),
         'conosce_contratos', COALESCE(k.url, 'https://conosce.osce.gob.pe/buscador/')
  FROM (
    SELECT c.ocid, k.ruc_contratista AS ruc, k.codigo_contrato, max(k.num_contrato) AS num_contrato,
           max(k.monto_contratado_total) AS total, sum(COALESCE(k.monto_adicional, 0)) AS adicional,
           sum(COALESCE(k.monto_reduccion, 0)) AS reduccion, sum(COALESCE(k.monto_prorroga, 0)) AS prorroga,
           sum(COALESCE(k.monto_complementario, 0)) AS complementario, max(k.url_contrato) AS url,
           max(k.fecha_suscripcion) AS suscripcion
    FROM conosce_contratos k JOIN convocatorias c ON c.ocid = k.codigo_convocatoria
    WHERE k.ruc_contratista ~ '^(10|20)\d{9}$' AND c.ocid NOT LIKE 'ocds-vigia-%'
    GROUP BY c.ocid, k.ruc_contratista, k.codigo_contrato
  ) k
  WHERE k.total > 0 AND (k.adicional > 0 OR k.prorroga > 0);

  -- Proveedor de campaña (ONPE, gastos de campaña): el ganador o un socio / representante le vendió a una
  -- organización política en campaña.
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, severidad, monto, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT 'proveedor_campana', q.ruc, 'media', sum(x.monto), q.dni, max(q.nombre), max(q.rol),
         jsonb_build_object('organizacion', x.organizacion, 'proceso', x.proceso),
         'onpe_gastos_proveedores', 'https://claridadportal.onpe.gob.pe/'
  FROM (
    SELECT DISTINCT ruc, ruc AS doc, NULL::text AS dni, NULL::text AS nombre, NULL::text AS rol FROM _cg
    UNION ALL
    SELECT ruc, dni, dni, nombre, rol FROM _cp
  ) q JOIN onpe_gastos_proveedores x ON x.documento = q.doc
  GROUP BY q.ruc, q.dni, x.organizacion, x.proceso;

  -- Quién gobernaba la entidad contratante cuando dio la buena pro (JNE): alcalde distrital o provincial,
  -- o gobernador regional, con su organización política.
  DROP TABLE IF EXISTS _cgob;
  CREATE TEMP TABLE _cgob ON COMMIT DROP AS
    SELECT DISTINCT g.ocid, g.ruc, j.organizacion_politica AS org, mef_norm(j.organizacion_politica) AS org_n, j.cargo
    FROM _cg g JOIN entidades e ON e.ruc::text = g.entidad_ruc
    JOIN jne_autoridades j ON (
         (e.nombre ILIKE 'MUNICIPALIDAD DISTRITAL%' AND j.cargo = 'ALCALDE DISTRITAL' AND j.ubigeo = e.ubigeo::text)
      OR (e.nombre ILIKE 'MUNICIPALIDAD PROVINCIAL%' AND j.cargo = 'ALCALDE PROVINCIAL' AND left(j.ubigeo, 4) = left(e.ubigeo::text, 4))
      OR (e.nombre ILIKE 'GOBIERNO REGIONAL%' AND j.cargo = 'GOBERNADOR REGIONAL' AND left(j.ubigeo, 2) = left(e.ubigeo::text, 2)))
     AND (j.periodo_inicio IS NULL OR g.f IS NULL OR g.f >= j.periodo_inicio)
     AND (j.periodo_fin IS NULL OR g.f IS NULL OR g.f <= j.periodo_fin)
    WHERE j.organizacion_politica IS NOT NULL;

  -- Partido gobernante: el ganador (o un socio) aportó o le vendió en campaña a la organización que gobernaba
  -- la entidad que le dio la buena pro. Nombres normalizados; uno puede ser prefijo del otro ("ALIANZA PARA
  -- EL PROGRESO" / "ALIANZA PARA EL PROGRESO DEL PERÚ").
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT 'partido_gobernante', k.ruc_empresa, gb.ocid, 'alta', k.fecha, k.monto, k.persona_doc, k.persona_nombre, k.persona_rol,
         k.detalle || jsonb_build_object('via', k.tipo, 'organizacion_gobernante', gb.org, 'cargo_gobernante', gb.cargo),
         k.fuente, k.fuente_url
  FROM (SELECT c.*, mef_norm(COALESCE(c.detalle->>'partido', c.detalle->>'organizacion')) AS org_n
        FROM cruces_proveedor c WHERE c.tipo IN ('aporte', 'aporte_empresa', 'proveedor_campana')) k
  JOIN _cgob gb ON gb.ruc = k.ruc_empresa
  WHERE k.org_n = gb.org_n
     OR (least(length(gb.org_n), length(k.org_n)) >= 15 AND (k.org_n LIKE gb.org_n || '%' OR gb.org_n LIKE k.org_n || '%'));

  -- Fraccionamiento (migración 51): el ganador recibió de la misma entidad, en un mismo día, varias órdenes
  -- "hasta 8 UIT" que juntas pasan el tope.
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT 'fraccionamiento', g.ruc, g.ocid, CASE WHEN bool_or(f.severidad = 'alta') THEN 'alta' ELSE 'media' END,
         max(f.fecha), sum(f.total),
         jsonb_build_object('dias', count(*), 'ordenes', sum(f.ordenes), 'total', sum(f.total), 'desde', min(f.fecha),
                            'hasta', max(f.fecha), 'misma_descripcion', count(*) FILTER (WHERE f.misma_descripcion)),
         'conosce_ordenes', 'https://conosce.osce.gob.pe/buscador/'
  FROM (SELECT DISTINCT ocid, ruc, entidad_ruc FROM _cg) g
  JOIN ordenes_fraccionadas f ON f.entidad_ruc = g.entidad_ruc AND f.ruc_contratista = g.ruc
  GROUP BY g.ocid, g.ruc;

  RETURN QUERY SELECT c.tipo, count(*)::int FROM cruces_proveedor c GROUP BY c.tipo ORDER BY c.tipo;
END $$;
ALTER FUNCTION refrescar_cruces() OWNER TO vigia_jobs;
