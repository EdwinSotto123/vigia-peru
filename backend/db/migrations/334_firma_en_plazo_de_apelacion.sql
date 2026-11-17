-- 334 · Contrato firmado dentro del plazo para apelar la buena pro (indicador EN OBSERVACIÓN, migración 329).
--
-- Con dos o más ofertas, la buena pro sólo queda consentida cuando vence el plazo para apelarla sin que nadie apele, y el
-- contrato se perfecciona recién después:
--   · Ley 30225: D.S. 344-2018-EF, art. 64 (consentimiento a los 8 días hábiles; 5 en adjudicación simplificada, subasta
--     inversa, comparación de precios y consultores individuales) y art. 141 (los requisitos para perfeccionar el contrato
--     se presentan dentro de los 8 días hábiles siguientes al registro del consentimiento).
--   · Ley 32069: D.S. 009-2025-EF, art. 304 (apelación dentro de 8 días hábiles; 5 en los abreviados, comparación de
--     precios y subasta inversa), art. 82 (consentimiento al día siguiente de vencido ese plazo) y art. 90 (perfeccionamiento
--     desde el registro del consentimiento).
-- Un contrato firmado antes del 5.º día hábil siguiente a la buena pro, en un ítem con dos o más ofertas, se firmó cuando
-- los otros postores todavía podían apelar. Se toma el plazo más corto de los dos regímenes y se cuentan sólo los días de
-- lunes a viernes (sin feriados, que alargarían el plazo): el umbral es conservador.
--
-- Qué queda fuera, porque el dato no alcanza para decirlo:
--   · los ítems con una sola oferta (su consentimiento es el mismo día de la buena pro) y los que no tienen postores en
--     CONOSCE;
--   · los ítems con más de una fecha de buena pro (una buena pro anulada y vuelta a otorgar);
--   · las firmas anteriores a la buena pro (error de carga o contrato de otro proceso);
--   · todo procedimiento que no sea de las leyes 30225 o 32069 por su nombre: directas, convenios, contrataciones
--     internacionales, regímenes especiales (con plazos propios) y los de la ley anterior que seguían en curso, como la
--     adjudicación selectiva;
--   · las buenas pro anteriores al reglamento de 2019 (30-01-2019), para citar bien la norma.
-- Las ofertas salen de `conosce_postores`: en 2 862 ítems que también tienen el reporte de presentación del SEACE, el
-- número coincide en 94 % y sólo en 1 CONOSCE da dos o más donde el SEACE da una (medido el 2026-11-17).
-- En PROD el 2026-11-17: 53 contratos desde 2019. Nace en observación: no puntúa hasta revisar a mano 40 casos.

CREATE OR REPLACE FUNCTION dias_habiles_entre(desde date, hasta date) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  -- Días de lunes a viernes después de `desde` y hasta `hasta` inclusive (0 si `hasta` no es posterior). Sin feriados.
  SELECT count(*)::int FROM generate_series(desde + 1, hasta, interval '1 day') d WHERE extract(isodow FROM d) < 6
$$;

INSERT INTO senal_en_observacion (tipo, motivo) VALUES
  ('firma_en_plazo_de_apelacion', 'Nueva (migración 334): falta medir su precisión con 40 casos revisados a mano.')
ON CONFLICT (tipo) DO NOTHING;

CREATE OR REPLACE FUNCTION refrescar_cruce_firma_apelacion() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n int;
  v_obs boolean := EXISTS (SELECT 1 FROM senal_en_observacion WHERE tipo = 'firma_en_plazo_de_apelacion');
BEGIN
  SET LOCAL work_mem = '256MB';

  -- Cada ítem adjudicado de un procedimiento competitivo con una sola fecha de buena pro, desde el reglamento de 2019.
  CREATE TEMP TABLE _fa_a ON COMMIT DROP AS
    SELECT a.codigo_convocatoria, a.ruc_proveedor, a.n_item, min(a.entidad_ruc) AS entidad_ruc, min(a.fecha_buenapro) AS bp,
           min(a.fecha_consentimiento) AS cons, min(a.fecha_convocatoria) AS convocada, min(a.tipo_proceso) AS tipo,
           max(a.proveedor) AS proveedor
      FROM conosce_adjudicaciones a
     WHERE a.fecha_buenapro >= DATE '2019-01-30' AND a.n_item IS NOT NULL
       AND a.tipo_proceso IN ('Licitación Pública', 'Concurso Público', 'Adjudicación Simplificada', 'Subasta Inversa Electrónica',
                              'Comparación de Precios', 'Selección de Consultores Individuales', 'Licitación Pública Abreviada',
                              'Concurso Público Abreviado', 'Concurso Público de Servicios')
     GROUP BY 1, 2, 3
    HAVING min(a.fecha_buenapro) = max(a.fecha_buenapro);
  CREATE INDEX ON _fa_a (codigo_convocatoria, ruc_proveedor, n_item);
  ANALYZE _fa_a;

  -- Su contrato firmado entre la buena pro y el 5.º día hábil siguiente (la última versión de cada contrato e ítem).
  CREATE TEMP TABLE _fa_k ON COMMIT DROP AS
    SELECT a.*, k.codigo_contrato, k.fecha_suscripcion AS firma, dias_habiles_entre(a.bp, k.fecha_suscripcion) AS dias,
           CASE WHEN k.moneda ~* 'sol' THEN k.monto_contratado_item END AS monto, k.url_contrato
      FROM (SELECT DISTINCT ON (codigo_convocatoria, ruc_contratista, num_item) codigo_convocatoria, ruc_contratista, num_item,
                   codigo_contrato, fecha_suscripcion, moneda, monto_contratado_item, url_contrato
              FROM conosce_contratos
             WHERE fecha_suscripcion >= DATE '2019-01-30' AND num_item IS NOT NULL
             ORDER BY codigo_convocatoria, ruc_contratista, num_item, anio DESC) k
      JOIN _fa_a a ON a.codigo_convocatoria = k.codigo_convocatoria AND a.ruc_proveedor = k.ruc_contratista AND a.n_item = k.num_item
     WHERE k.fecha_suscripcion >= a.bp AND dias_habiles_entre(a.bp, k.fecha_suscripcion) < 5;
  ANALYZE _fa_k;

  DELETE FROM cruces_proveedor WHERE tipo = 'firma_en_plazo_de_apelacion';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (cv.ocid, x.ruc)
         'firma_en_plazo_de_apelacion', x.ruc, cv.ocid, 'media', x.firma, x.monto, NULL, NULL, NULL,
         jsonb_build_object('buena_pro', x.bp, 'firma', x.firma, 'dias_habiles', x.dias, 'plazo_minimo', 5,
                            'consentimiento_registrado', x.cons, 'ofertas', x.ofertas, 'item', x.n_item, 'tipo_proceso', x.tipo,
                            'contrato', x.codigo_contrato, 'consorcio', x.consorcio,
                            'norma', CASE WHEN x.convocada >= DATE '2025-04-22'
                                          THEN 'Reglamento de la Ley 32069 (D.S. 009-2025-EF), arts. 82, 90 y 304'
                                          ELSE 'Reglamento de la Ley 30225 (D.S. 344-2018-EF), arts. 64 y 141' END,
                            'en_observacion', v_obs),
         'conosce_contratos', COALESCE(NULLIF(x.url_contrato, ''), 'https://conosce.osce.gob.pe/buscador/')
    FROM (SELECT k.*, o.ofertas, COALESCE(m.ruc_miembro, k.ruc_proveedor) AS ruc,
                 CASE WHEN m.ruc_miembro IS NOT NULL THEN k.proveedor END AS consorcio
            FROM _fa_k k
            -- Ofertas presentadas en el mismo ítem (CONOSCE): con una sola, el consentimiento es el mismo día.
            JOIN LATERAL (SELECT count(DISTINCT p.ruc_postor)::int AS ofertas FROM conosce_postores p
                           WHERE p.codigo_convocatoria = k.codigo_convocatoria AND p.n_item = k.n_item) o ON o.ofertas >= 2
            LEFT JOIN conosce_consorcios m ON m.ruc_consorcio = k.ruc_proveedor AND k.ruc_proveedor !~ '^(10|20)\d{9}$') x
    JOIN (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
           WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid) cv
      ON cv.codigo = x.codigo_convocatoria AND cv.entidad_ruc = x.entidad_ruc::char(11)
   -- Sólo empresas (RUC 20): una persona natural no se muestra ni se enlaza.
   WHERE x.ruc ~ '^20\d{9}$'
   ORDER BY cv.ocid, x.ruc, x.dias, x.firma;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER FUNCTION public.refrescar_cruce_firma_apelacion() OWNER TO vigia_jobs;
    ALTER FUNCTION public.dias_habiles_entre(date, date) OWNER TO vigia_jobs;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_cruce_firma_apelacion() FROM PUBLIC;
