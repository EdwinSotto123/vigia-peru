-- 428 · refrescar_cruce_tribunal() (424) fallaba en la cadena de cruces del 2026-11-20: «cannot accumulate empty arrays».
-- array_agg sobre `infraccion` (text[]) no junta arreglos vacíos ni de distinto largo; con un solo sancionador (el 11-19)
-- pasaba, con 171 no. La infracción de la primera orden por empresa va ahora como jsonb. Nada más cambia.

CREATE OR REPLACE FUNCTION refrescar_cruce_tribunal() RETURNS integer
LANGUAGE plpgsql SET work_mem TO '128MB' AS $$
DECLARE n int := 0; v_m int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_cruce_tribunal'));
  DELETE FROM cruces_proveedor
   WHERE tipo IN ('tribunal_sancionador', 'tribunal_revoco_buena_pro', 'gana_con_sancionador_abierto');

  CREATE TEMP TABLE _tr ON COMMIT DROP AS
  SELECT DISTINCT r.id, r.fecha, r.titulo, r.infraccion, COALESCE(r.pdf, r.url) AS enlace, pa.rol, pa.ruc, pa.via, p.ocid,
         r.efectos, tribunal_corrigio(r) AS corrigio
    FROM tribunal_parte pa
    JOIN tribunal_resolucion r ON r.id = pa.resolucion_id
    JOIN tribunal_proceso p ON p.resolucion_id = r.id AND p.ocid IS NOT NULL
   WHERE pa.ruc IS NOT NULL AND r.fecha IS NOT NULL;

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (t.ruc, t.ocid) 'tribunal_sancionador', t.ruc, t.ocid, 'media', t.fecha,
         jsonb_build_object('resolucion', t.titulo, 'infraccion', t.infraccion, 'via', t.via, 'enlace', t.enlace),
         'tribunal_apelaciones', t.enlace
    FROM _tr t WHERE t.rol = 'sancionador'
   ORDER BY t.ruc, t.ocid, t.fecha DESC;
  GET DIAGNOSTICS v_m = ROW_COUNT; n := n + v_m;

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (t.ruc, t.ocid) 'tribunal_revoco_buena_pro', t.ruc, t.ocid, 'baja', t.fecha,
         jsonb_build_object('resolucion', t.titulo, 'efectos', t.efectos, 'via', t.via, 'enlace', t.enlace),
         'tribunal_apelaciones', t.enlace
    FROM _tr t
   WHERE t.rol = 'adjudicatario' AND t.corrigio
     AND t.efectos && ARRAY['revoca_buena_pro', 'descalifica_al_adjudicatario']
   ORDER BY t.ruc, t.ocid, t.fecha DESC;
  GET DIAGNOSTICS v_m = ROW_COUNT; n := n + v_m;

  -- Lo que gana después: adjudicaciones de CONOSCE (RUC 20 o integrante RUC 20 de un consorcio) entre la orden y la
  -- primera sanción posterior del Tribunal, hasta dos años.
  CREATE TEMP TABLE _ts ON COMMIT DROP AS
  SELECT t.ruc, min(t.fecha) AS desde, (array_agg(t.titulo ORDER BY t.fecha))[1] AS titulo,
         (array_agg(t.enlace ORDER BY t.fecha))[1] AS enlace, (array_agg(t.ocid ORDER BY t.fecha))[1] AS ocid_origen,
         (array_agg(to_jsonb(t.infraccion) ORDER BY t.fecha))[1] AS infraccion
    FROM _tr t WHERE t.rol = 'sancionador' GROUP BY t.ruc;
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (s.ruc, cv.ocid) 'gana_con_sancionador_abierto', s.ruc, cv.ocid, 'media', a.fecha_buenapro,
         CASE WHEN a.moneda IN ('Soles', 'Nuevos Soles') THEN a.monto_adjudicado END,
         jsonb_build_object('resolucion', s.titulo, 'orden_desde', s.desde, 'infraccion', s.infraccion,
                            'ocid_origen', s.ocid_origen, 'enlace', s.enlace,
                            'dias_despues', a.fecha_buenapro - s.desde),
         'tribunal_apelaciones', s.enlace
    FROM _ts s
    -- Por el índice de ruc_proveedor: lo que gana sola y lo que gana su consorcio.
    CROSS JOIN LATERAL (
      SELECT a.codigo_convocatoria, a.entidad_ruc, a.fecha_buenapro, a.moneda, a.monto_adjudicado
        FROM conosce_adjudicaciones a
       WHERE a.ruc_proveedor = s.ruc AND a.fecha_buenapro > s.desde AND a.fecha_buenapro <= s.desde + 730
      UNION ALL
      SELECT a.codigo_convocatoria, a.entidad_ruc, a.fecha_buenapro, a.moneda, a.monto_adjudicado
        FROM conosce_consorcios m JOIN conosce_adjudicaciones a ON a.ruc_proveedor = m.ruc_consorcio
       WHERE m.ruc_miembro = s.ruc AND m.ruc_consorcio !~ '^(10|20)\d{9}$'
         AND a.fecha_buenapro > s.desde AND a.fecha_buenapro <= s.desde + 730) a
    JOIN convocatorias cv ON cv.codigo = a.codigo_convocatoria AND cv.entidad_ruc = a.entidad_ruc AND cv.ocid NOT LIKE 'ocds-vigia-%'
   WHERE cv.ocid <> s.ocid_origen
     AND NOT EXISTS (SELECT 1 FROM osce_sancionados o
                      WHERE o.ruc = s.ruc AND o.fecha_resolucion > s.desde AND o.fecha_resolucion < a.fecha_buenapro)
   ORDER BY s.ruc, cv.ocid, a.fecha_buenapro;
  GET DIAGNOSTICS v_m = ROW_COUNT; n := n + v_m;
  RETURN n;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER FUNCTION public.refrescar_cruce_tribunal() OWNER TO vigia_jobs;
  END IF;
END $$;

SELECT refrescar_cruce_tribunal();
