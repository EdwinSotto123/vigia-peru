-- 48 · Cruces de los proveedores ganadores con las otras fuentes de la base.
--
-- Los datasets que cargan los scrapers (RNP, ONPE, JNE, visitas, penalidades, sanciones del OSCE) sólo los
-- usaban los agentes, y sólo sobre las alertas que procesaban. Estos cruces son deterministas y corren sobre
-- todos los procesos con buena pro (convocatorias.ocds_payload->awards):
--
--   aporte            el proveedor persona natural, o un socio / representante / directivo (RNP), aportó a
--                     una organización política (onpe_aportantes, por DNI)
--   aporte_empresa    la empresa ganadora aportó con su RUC
--   candidato         el proveedor o un socio fue candidato (onpe_candidatos, por DNI)
--   autoridad         el proveedor o un socio es autoridad electa (jne_autoridades, por DNI)
--   penalidad         la empresa tiene penalidades aplicadas en contratos (penalidades)
--   sancion           sanciones del Tribunal de Contrataciones (osce_sancionados)
--   sancion_vigente   ganó un proceso mientras tenía una inhabilitación temporal o definitiva vigente
--   visita_previa     un socio / representante visitó una entidad pública en los 180 días previos a la buena
--                     pro (visitas_entidades); `misma_entidad` si fue la entidad que contrató
--   socio_comun       dos postores del mismo proceso comparten socio o representante (postores × RNP)
--
-- Un cruce es un dato verificable en la fuente, no una acusación: la ficha lo muestra con su fuente.
-- `persona_doc` (DNI) se queda en la base: la API pública no lo devuelve y tapa un apellido del nombre
-- (backend/api/src/lib/privacidad.ts).
--
-- `refrescar_cruces()` rehace la tabla entera (≈ segundos); la llama el scraper `oece_ocds` después de cargar.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/48_cruces_proveedor.sql

CREATE TABLE IF NOT EXISTS cruces_proveedor (
  id              BIGSERIAL PRIMARY KEY,
  tipo            TEXT NOT NULL,
  ruc_empresa     TEXT NOT NULL,           -- RUC del proveedor ganador
  ocid            TEXT,                    -- sólo en los cruces de un proceso (sancion_vigente, visita_previa, socio_comun)
  severidad       TEXT NOT NULL CHECK (severidad IN ('alta', 'media', 'baja')),
  fecha           DATE,
  monto           NUMERIC(18, 2),
  persona_doc     TEXT,                    -- DNI: privado, nunca sale por la API pública
  persona_nombre  TEXT,
  persona_rol     TEXT,                    -- TITULAR (RUC 10) o roles del RNP separados por coma
  detalle         JSONB NOT NULL DEFAULT '{}'::jsonb,
  fuente          TEXT NOT NULL,
  fuente_url      TEXT,
  refrescado_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cruces_proveedor_ruc ON cruces_proveedor (ruc_empresa);
CREATE INDEX IF NOT EXISTS cruces_proveedor_ocid ON cruces_proveedor (ocid) WHERE ocid IS NOT NULL;

ALTER TABLE cruces_proveedor OWNER TO vigia_jobs;
ALTER SEQUENCE cruces_proveedor_id_seq OWNER TO vigia_jobs;
GRANT SELECT ON cruces_proveedor TO vigia_api;
-- Tablas de la base principal que la función lee y que vigia_jobs todavía no podía leer.
GRANT SELECT ON penalidades, postores TO vigia_jobs;

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

  -- Una fila por (proceso, postor, persona): con quién más compitió esa persona en el mismo proceso. Los
  -- postores llegan como partes separadas del registro OCDS (no son miembros de un mismo consorcio:
  -- comprobado el 2026-10-14, ninguno de los pares figura junto en una misma adjudicación).
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT 'socio_comun', a.empresa_ruc::text, a.ocid, 'alta', ra.numero_documento, max(ra.nombre),
         string_agg(DISTINCT ra.tipo_rol, ', ' ORDER BY ra.tipo_rol),
         jsonb_build_object('otros_postores', jsonb_agg(DISTINCT b.empresa_ruc::text), 'rol_en_otros', jsonb_agg(DISTINCT rb.tipo_rol)),
         'rnp_conformacion_juridica', 'https://www.datosabiertos.gob.pe/'
  FROM postores a JOIN postores b ON b.ocid = a.ocid AND b.empresa_ruc <> a.empresa_ruc
  JOIN rnp_conformacion_juridica ra ON ra.ruc_empresa = a.empresa_ruc AND ra.tipo_documento LIKE 'DOC. NACIONAL%'
  JOIN rnp_conformacion_juridica rb ON rb.ruc_empresa = b.empresa_ruc AND rb.numero_documento = ra.numero_documento
  WHERE a.ocid NOT LIKE 'ocds-vigia-%'
  GROUP BY a.ocid, a.empresa_ruc, ra.numero_documento;

  RETURN QUERY SELECT c.tipo, count(*)::int FROM cruces_proveedor c GROUP BY c.tipo ORDER BY c.tipo;
END $$;
ALTER FUNCTION refrescar_cruces() OWNER TO vigia_jobs;
