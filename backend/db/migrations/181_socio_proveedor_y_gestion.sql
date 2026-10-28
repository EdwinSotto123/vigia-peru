-- 181 · Locadores, fase 1B del plan del 2026-10-27:
--   · socio_proveedor (personas, media o baja): el locador es socio, representante o directivo (RNP de la OECE, por su DNI:
--     la misma persona, no un homónimo) de una empresa (RUC 20) que también le vende a su misma entidad (órdenes de compra
--     o de servicio, o una buena pro). Media si la empresa le vendió en un año en que él también tenía órdenes ahí; baja si
--     fue en otros años. Medido en producción (2026-10-27): 59,639 pares de 38,831 locadores; 37,205 en los mismos años.
--     En la planilla, la misma señal va por nombre (migración 179): ahí no hay DNI.
--   · entidad_gestion: desde cuándo gobierna la gestión actual de cada entidad, para el filtro «entró con la gestión» de
--     la lista de personas. La municipalidad o el gobierno regional y sus organismos (entidad_gobierno_amplia), por el
--     tramo de gobierno_periodo que cubre hoy; el Ejecutivo nacional (entidad_ejecutivo_nacional), desde que asumió el
--     Presidente en funciones (gobierno_nacional_inicio: todos los que asumieron, con o sin partido). Las demás (organismos
--     autónomos, universidades, empresas del Estado) no tienen gestión que las cambie: no entran.
--
-- refrescar_socio_proveedor_locador() y refrescar_entidad_gestion(): pasos aparte, después de refrescar_familia_estado()
-- (180) en los Workers conosce_ordenes y pte_personal. La primera rehace su tipo y parcha persona_entidad (como la 179).
-- Privacidad: de la empresa, su RUC 20, su nombre y lo que le vendió a la entidad; de la persona, nada que no esté en su
-- ficha. Un indicio para revisar (puede ser legal: la ley impide contratar a ciertos funcionarios y sus empresas, no a
-- todo locador), no una acusación.
--
-- Cómo aplicarla: python infrastructure/dev/dev.py migrar backend/db/migrations/181_socio_proveedor_y_gestion.sql (DEV) y
-- luego SELECT refrescar_entidad_gestion(); SELECT refrescar_socio_proveedor_locador(); SELECT refrescar_personas_resumen();
-- en producción, lo mismo con tunel_rds (backend/scripts/aplicar_181.py).

-- ── 1. Quién asumió la Presidencia, y cuándo ─────────────────────────────────────────────────────────────────────────
-- gobierno_nacional_periodo (177) sólo tiene los tramos con partido; aquí van todos, para saber desde cuándo gobierna la
-- gestión en funciones. El del 28 jul. 2026: el elegido en las EG 2026 (su resultado oficial no está en la base).
CREATE TABLE IF NOT EXISTS gobierno_nacional_inicio (
  desde       DATE PRIMARY KEY,
  presidente  TEXT NOT NULL,
  como        TEXT NOT NULL      -- 'eleccion' o 'sucesion'
);
ALTER TABLE gobierno_nacional_inicio OWNER TO vigia_jobs;
GRANT SELECT ON gobierno_nacional_inicio TO vigia_api, vigia_api_admin, vigia_mcp;
INSERT INTO gobierno_nacional_inicio (desde, presidente, como) VALUES
  ('2016-07-28', 'Pedro Pablo Kuczynski', 'eleccion'),
  ('2018-03-23', 'Martín Vizcarra', 'sucesion'),
  ('2020-11-10', 'Manuel Merino', 'sucesion'),
  ('2020-11-17', 'Francisco Sagasti', 'sucesion'),
  ('2021-07-28', 'Pedro Castillo', 'eleccion'),
  ('2022-12-07', 'Dina Boluarte', 'sucesion'),
  ('2025-10-10', 'José Jerí', 'sucesion'),
  ('2026-07-28', 'Elegido en las Elecciones Generales 2026', 'eleccion')
ON CONFLICT (desde) DO UPDATE SET presidente = EXCLUDED.presidente, como = EXCLUDED.como;

-- ── 2. La gestión actual de cada entidad ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entidad_gestion (
  ruc         TEXT PRIMARY KEY,
  desde       DATE NOT NULL,
  nivel       TEXT NOT NULL,     -- distrital, provincial, regional o nacional
  org_nombre  TEXT,              -- el partido que gobierna (lo local; en el Ejecutivo, NULL: va el Presidente)
  quien       TEXT               -- «Gestión 2023-2026» o el Presidente
);
ALTER TABLE entidad_gestion OWNER TO vigia_jobs;
GRANT SELECT ON entidad_gestion TO vigia_api, vigia_api_admin, vigia_mcp;

CREATE OR REPLACE FUNCTION refrescar_entidad_gestion() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_entidad_gestion'));
  CREATE TEMP TABLE _eg ON COMMIT DROP AS
    SELECT DISTINCT ON (a.ruc) a.ruc, g.desde, g.nivel, g.org_nombre,
           'Gestión ' || extract(year FROM g.desde)::int || '-' || extract(year FROM g.hasta)::int AS quien
      FROM entidad_gobierno_amplia a
      JOIN gobierno_periodo g ON g.nivel = a.nivel AND g.ubigeo = a.ubigeo
     WHERE g.desde <= current_date AND g.hasta >= current_date
     ORDER BY a.ruc, g.desde DESC;
  -- El Ejecutivo nacional, salvo lo que ya es de un gobierno local.
  INSERT INTO _eg
  SELECT en.ruc, p.desde, 'nacional', NULL, p.presidente
    FROM entidad_ejecutivo_nacional en
    CROSS JOIN (SELECT desde, presidente FROM gobierno_nacional_inicio WHERE desde <= current_date ORDER BY desde DESC LIMIT 1) p
   WHERE NOT EXISTS (SELECT 1 FROM _eg x WHERE x.ruc = en.ruc);
  DELETE FROM entidad_gestion e WHERE NOT EXISTS (SELECT 1 FROM _eg x WHERE x.ruc = e.ruc);
  INSERT INTO entidad_gestion (ruc, desde, nivel, org_nombre, quien)
  SELECT ruc, desde, nivel, org_nombre, quien FROM _eg
  ON CONFLICT (ruc) DO UPDATE SET desde = EXCLUDED.desde, nivel = EXCLUDED.nivel, org_nombre = EXCLUDED.org_nombre, quien = EXCLUDED.quien;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_entidad_gestion() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_entidad_gestion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refrescar_entidad_gestion() TO vigia_jobs;

-- ── 3. El locador, socio de un proveedor de su entidad ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refrescar_socio_proveedor_locador() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int := 0; t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_socio_proveedor_locador'));
  SET LOCAL work_mem = '256MB';

  CREATE TEMP TABLE _spar ON COMMIT DROP AS
    SELECT DISTINCT entidad_ruc, ruc FROM persona_senal WHERE tipo = 'socio_proveedor';
  DELETE FROM persona_senal WHERE tipo = 'socio_proveedor';

  -- Sus papeles en cada empresa (RNP, conformación jurídica), por su DNI.
  CREATE TEMP TABLE _srnp ON COMMIT DROP AS
    SELECT r.numero_documento AS dni, r.ruc_empresa::text AS ruc, string_agg(DISTINCT r.tipo_rol, ', ' ORDER BY r.tipo_rol) AS rol
      FROM rnp_conformacion_juridica r
     WHERE r.tipo_documento LIKE 'DOC. NACIONAL%' AND r.numero_documento ~ '^[0-9]{8}$' AND r.ruc_empresa::text ~ '^20[0-9]{9}$'
     GROUP BY 1, 2;
  CREATE INDEX ON _srnp (dni);
  ANALYZE _srnp;

  -- Lo que cada empresa le vendió a cada entidad cada año: órdenes y buenas pro (en soles).
  CREATE TEMP TABLE _sven ON COMMIT DROP AS
    SELECT ruc, entidad_ruc, anio, sum(monto) AS monto, sum(nv)::int AS nv FROM (
      SELECT ruc, entidad_ruc, anio::int AS anio, monto, ordenes AS nv FROM empresa_orden_anual
      UNION ALL
      SELECT a.ruc_proveedor, a.entidad_ruc::text, extract(year FROM a.fecha_buenapro)::int,
             CASE WHEN a.moneda IN ('Soles', 'Nuevos Soles') THEN a.monto_adjudicado ELSE 0 END, 1
        FROM conosce_adjudicaciones a WHERE a.ruc_proveedor ~ '^20[0-9]{9}$') v
     WHERE anio IS NOT NULL AND ruc IN (SELECT ruc FROM _srnp)
     GROUP BY 1, 2, 3;
  CREATE INDEX ON _sven (ruc, entidad_ruc);
  ANALYZE _sven;
  RAISE NOTICE 'socio de un proveedor: RNP y ventas (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  WITH x AS (
    SELECT pe.entidad_ruc, pe.ruc, r.ruc AS emp, r.rol,
           sum(v.monto) AS monto, sum(v.nv)::int AS ventas, min(v.anio) AS desde, max(v.anio) AS hasta,
           -- Los años en que la empresa le vendió a la entidad mientras él también tenía órdenes ahí.
           array_agg(v.anio ORDER BY v.anio) FILTER (WHERE v.anio = ANY (pe.anios)) AS mismos
      FROM persona_entidad pe
      JOIN _srnp r ON r.dni = substr(pe.ruc, 3, 8)
      JOIN _sven v ON v.ruc = r.ruc AND v.entidad_ruc = pe.entidad_ruc
     WHERE pe.ruc LIKE '10%'
     GROUP BY pe.entidad_ruc, pe.ruc, r.ruc, r.rol)
  SELECT x.entidad_ruc, x.ruc, 'socio_proveedor',
         CASE WHEN bool_or(x.mismos IS NOT NULL) THEN 'media' ELSE 'baja' END,
         jsonb_build_object(
           'empresas', jsonb_agg(jsonb_build_object('ruc', x.emp, 'nombre', er.nombre, 'rol', x.rol, 'monto', x.monto,
                                                    'ventas', x.ventas, 'desde', x.desde, 'hasta', x.hasta,
                                                    'mismos', to_jsonb(x.mismos))
                                 ORDER BY (x.mismos IS NOT NULL) DESC, x.monto DESC NULLS LAST),
           'monto', sum(x.monto), 'mismos_anios', bool_or(x.mismos IS NOT NULL)),
         'oece_rnp', 'https://apps.osce.gob.pe/perfilprov-ui/'
    FROM x LEFT JOIN empresa_resumen er ON er.ruc = x.emp
   GROUP BY x.entidad_ruc, x.ruc;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'socio de un proveedor: % pares (% s)', n, round(extract(epoch FROM clock_timestamp() - t0));

  -- El resumen de cada par tocado (antes y después), desde persona_senal (como la 179).
  INSERT INTO _spar SELECT DISTINCT entidad_ruc, ruc FROM persona_senal WHERE tipo = 'socio_proveedor';
  CREATE TEMP TABLE _spar2 ON COMMIT DROP AS SELECT DISTINCT entidad_ruc, ruc FROM _spar;
  UPDATE persona_entidad pe SET tipos = '{}', senales = '[]', n_senales = 0, sev = 0
    FROM _spar2 p WHERE pe.entidad_ruc = p.entidad_ruc AND pe.ruc = p.ruc;
  UPDATE persona_entidad pe
     SET tipos = s.tipos, senales = s.senales, n_senales = s.n, sev = s.sev
    FROM (SELECT ps.entidad_ruc, ps.ruc, array_agg(ps.tipo ORDER BY ps.tipo) AS tipos, count(*)::int AS n,
                 max(CASE ps.severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END)::smallint AS sev,
                 jsonb_agg(jsonb_build_object('tipo', ps.tipo, 'severidad', ps.severidad)
                           ORDER BY CASE ps.severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, ps.tipo) AS senales
            FROM persona_senal ps JOIN _spar2 p ON p.entidad_ruc = ps.entidad_ruc AND p.ruc = ps.ruc
           GROUP BY ps.entidad_ruc, ps.ruc) s
   WHERE pe.entidad_ruc = s.entidad_ruc AND pe.ruc = s.ruc;
  RAISE NOTICE 'socio de un proveedor: persona_entidad al día (% s)', round(extract(epoch FROM clock_timestamp() - t0));
  RETURN n;
END $$;
ALTER FUNCTION refrescar_socio_proveedor_locador() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_socio_proveedor_locador() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refrescar_socio_proveedor_locador() TO vigia_jobs;
