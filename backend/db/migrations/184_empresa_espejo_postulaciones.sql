-- 184 · Empresas, fase 2 del plan del 2026-10-27 (medido en producción antes de escribirla):
--   · empresa_espejo (cruce del contrato, alta o media): la empresa ganó el contrato mientras otra empresa con la que
--     comparte un socio, representante o directivo (RNP, por DNI) estaba inhabilitada por el Tribunal de Contrataciones.
--     Es la forma de seguir contratando con otra razón social. 641 empresas ganaron así (de 5,638 que comparten gente con
--     una sancionada). Fuera los representantes «profesionales» (la misma persona en más de 10 empresas del RNP: un
--     estudio, un apoderado de muchas): ahí compartir no dice nada. Alta si la empresa se fundó (alta en la SUNAT) desde
--     6 meses antes de la sanción o después; media si ya existía.
--   · conosce_proceso_resumen: cada proceso de CONOSCE con su entidad, su objeto, sus ganadores y su monto, ya juntado.
--     La pestaña «Postulaciones» de cada empresa lo armaba proceso por proceso (96 mil pedidos a ~260 ms: lo que más
--     tiempo de la base usaba en total, 25 mil segundos) y ahora lo lee por su llave.
--
-- refrescar_cruce_empresa_espejo() y refrescar_proceso_resumen(): pasos de la cadena de cruces (comun.ts,
-- refrescarCasosCruce), antes de dedup_cruces_proveedor.
-- Privacidad: de la persona compartida, como en «socio en la entidad», su documento (la API lo vuelve ref) y su nombre (la
-- API le tapa un apellido). Indicios para revisar, no acusaciones.
--
-- Cómo aplicarla: python infrastructure/dev/dev.py migrar backend/db/migrations/184_empresa_espejo_postulaciones.sql y
-- SELECT refrescar_proceso_resumen(); SELECT refrescar_cruce_empresa_espejo(); en producción, lo mismo con tunel_rds, y
-- después la cadena de casos_cruce y empresas (refrescar_casos_cruce_base, refrescar_empresas).

-- ── 1. La empresa espejo ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refrescar_cruce_empresa_espejo() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_cruce_empresa_espejo'));
  SET LOCAL work_mem = '256MB';
  DELETE FROM cruces_proveedor WHERE tipo = 'empresa_espejo';

  -- Las sanciones de inhabilitación de cada empresa (la más temprana y hasta cuándo; la definitiva, sin fin).
  CREATE TEMP TABLE _esan ON COMMIT DROP AS
    SELECT ruc, min(fecha_desde) AS desde,
           max(COALESCE(fecha_hasta, CASE WHEN tipo = 'definitivo' THEN DATE '9999-12-31' END)) AS hasta,
           (array_agg(resolucion ORDER BY fecha_desde DESC))[1] AS resolucion, max(razon_social) AS nombre,
           bool_or(tipo = 'definitivo') AS definitiva
      FROM osce_sancionados
     WHERE tipo IN ('temporal', 'definitivo') AND fecha_desde IS NOT NULL AND ruc ~ '^20[0-9]{9}$'
     GROUP BY ruc;
  -- La gente de cada empresa (RNP, por DNI), sin los que están en más de 10 empresas.
  CREATE TEMP TABLE _egen ON COMMIT DROP AS
    SELECT r.ruc_empresa::text AS ruc, r.numero_documento AS doc, max(r.nombre) AS nombre,
           string_agg(DISTINCT r.tipo_rol, ', ' ORDER BY r.tipo_rol) AS rol
      FROM rnp_conformacion_juridica r
     WHERE r.numero_documento ~ '^[0-9]{8}$' AND r.ruc_empresa::text ~ '^20[0-9]{9}$'
       AND r.numero_documento IN (SELECT numero_documento FROM rnp_conformacion_juridica
                                   WHERE numero_documento ~ '^[0-9]{8}$' GROUP BY 1 HAVING count(DISTINCT ruc_empresa) <= 10)
     GROUP BY 1, 2;
  CREATE INDEX ON _egen (doc);
  CREATE INDEX ON _egen (ruc);
  CREATE TEMP TABLE _epar ON COMMIT DROP AS
    SELECT DISTINCT ON (g2.ruc, s.ruc) g2.ruc AS espejo, s.ruc AS sancionada, s.desde, s.hasta, s.resolucion,
           s.nombre AS sancionada_nombre, s.definitiva, g1.doc, g1.nombre, g1.rol AS rol_alla, g2.rol AS rol_aqui
      FROM _esan s
      JOIN _egen g1 ON g1.ruc = s.ruc
      JOIN _egen g2 ON g2.doc = g1.doc AND g2.ruc <> s.ruc
     ORDER BY g2.ruc, s.ruc, g1.doc;

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  WITH c AS (
    -- Cada contrato que ganó la empresa espejo, con su ocid.
    SELECT cv.ocid, a.ruc_proveedor AS ruc, a.entidad_ruc, max(a.fecha_buenapro) AS f,
           sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS monto
      FROM conosce_adjudicaciones a
      JOIN (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
             WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid) cv
        ON cv.codigo = a.codigo_convocatoria AND cv.entidad_ruc = a.entidad_ruc
     WHERE a.ruc_proveedor IN (SELECT espejo FROM _epar)
     GROUP BY cv.ocid, a.ruc_proveedor, a.entidad_ruc
  )
  SELECT DISTINCT ON (c.ocid, c.ruc)
         'empresa_espejo', c.ruc, c.ocid,
         CASE WHEN e.fecha_alta_ruc >= p.desde - 180 THEN 'alta' ELSE 'media' END,
         c.f, c.monto, p.doc, p.nombre, p.rol_aqui,
         jsonb_build_object('sancionada_ruc', p.sancionada, 'sancionada', COALESCE(er.nombre, p.sancionada_nombre),
                            'resolucion', p.resolucion, 'desde', p.desde,
                            'hasta', CASE WHEN p.hasta = DATE '9999-12-31' THEN NULL ELSE p.hasta END,
                            'definitiva', p.definitiva, 'rol_alla', p.rol_alla, 'fundada', e.fecha_alta_ruc),
         'osce_sancionados', 'https://www.gob.pe/oece'
    FROM c
    JOIN _epar p ON p.espejo = c.ruc AND c.f BETWEEN p.desde AND p.hasta
    LEFT JOIN empresas e ON e.ruc = c.ruc
    LEFT JOIN empresa_resumen er ON er.ruc = p.sancionada
   WHERE c.f IS NOT NULL
   ORDER BY c.ocid, c.ruc, (e.fecha_alta_ruc >= p.desde - 180) DESC NULLS LAST, p.desde DESC;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_cruce_empresa_espejo() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_cruce_empresa_espejo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refrescar_cruce_empresa_espejo() TO vigia_jobs;

-- ── 2. Cada proceso de CONOSCE, ya juntado ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conosce_proceso_resumen (
  codigo       TEXT PRIMARY KEY,
  entidad      TEXT,
  entidad_ruc  TEXT,
  descripcion  TEXT,
  objeto       TEXT,
  ganadores    JSONB,      -- [{ruc (sólo RUC 10 o 20), nombre}]
  rucs         TEXT[],     -- todos los RUC adjudicados (para saber si ganó una empresa o su consorcio)
  monto        NUMERIC     -- lo adjudicado en soles
);
ALTER TABLE conosce_proceso_resumen OWNER TO vigia_jobs;
GRANT SELECT ON conosce_proceso_resumen TO vigia_api, vigia_api_admin, vigia_mcp;

CREATE OR REPLACE FUNCTION refrescar_proceso_resumen() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_proceso_resumen'));
  SET LOCAL work_mem = '256MB';
  -- DELETE y no TRUNCATE: quien lee la tabla mientras se rehace ve la versión anterior, sin esperar.
  DELETE FROM conosce_proceso_resumen;
  INSERT INTO conosce_proceso_resumen (codigo, entidad, entidad_ruc, descripcion, objeto, ganadores, rucs, monto)
  SELECT a.codigo_convocatoria::text, max(a.entidad), max(a.entidad_ruc::text), max(a.descripcion_proceso), max(a.objeto),
         -- Con su RUC también si es una persona (RUC 10): así publicar() la reconoce y le tapa un apellido.
         jsonb_agg(DISTINCT jsonb_build_object('ruc', CASE WHEN a.ruc_proveedor ~ '^(10|20)[0-9]{9}$' THEN a.ruc_proveedor END,
                                               'nombre', a.proveedor)),
         array_agg(DISTINCT a.ruc_proveedor) FILTER (WHERE a.ruc_proveedor IS NOT NULL),
         sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles'))
    FROM conosce_adjudicaciones a
   WHERE a.codigo_convocatoria IS NOT NULL
   GROUP BY a.codigo_convocatoria;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE conosce_proceso_resumen;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_proceso_resumen() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_proceso_resumen() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refrescar_proceso_resumen() TO vigia_jobs;

-- ── 3. Lo que los funcionarios declararon sobre cada empresa (DJI, secciones 1 a 4) ──────────────────────────────────
-- Para la ficha de la empresa: quién (cargo, entidad y primer apellido; nunca el nombre completo) declaró tener acciones
-- (1), un poder (2), un asiento en el directorio (3) o haber trabajado o asesorado (4) a la empresa. NUNCA la sección 5
-- (organizaciones privadas: trae la afiliación a partidos) ni la 6. La API lee esta vista, no dji_intereses.
CREATE OR REPLACE VIEW empresa_dji_declarada AS
SELECT i.ruc, i.entidad_ruc, COALESCE(e.nombre, i.entidad_ruc) AS entidad, i.seccion,
       split_part(i.declarante_norm, ' ', 1) AS apellido,
       (SELECT f.cargo FROM dji_funcionarios f
         WHERE f.nombre_norm = i.declarante_norm AND f.cargo IS NOT NULL
         ORDER BY f.fecha_inicio_cargo DESC NULLS LAST LIMIT 1) AS cargo,
       min(i.desde) AS desde, max(i.hasta) AS hasta, max(i.ejercicio) AS ejercicio
  FROM dji_intereses i
  LEFT JOIN entidades e ON e.ruc::text = i.entidad_ruc
 WHERE i.seccion IN (1, 2, 3, 4) AND i.ruc ~ '^20[0-9]{9}$' AND i.declarante_norm IS NOT NULL
 GROUP BY i.ruc, i.entidad_ruc, e.nombre, i.seccion, i.declarante_norm;
GRANT SELECT ON empresa_dji_declarada TO vigia_api, vigia_api_admin;
