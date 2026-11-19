-- 424 · A quién le revocó el Tribunal la buena pro y contra quién ordenó abrir un procedimiento sancionador.
--
-- El lector del Tribunal v2 (lector/tribunal.py) lee de cada apelación dos partes más, cada nombre comprobado en el texto:
--   adjudicatario    el postor que tenía la buena pro cuando se apeló;
--   sancionador      cada proveedor contra el que la parte resolutiva ordena abrir un procedimiento sancionador (casi
--                    siempre por documentación falsa o información inexacta en su oferta; `infraccion`).
-- Medido el 2026-11-19 en las primeras 998 apelaciones bajadas: 80 ordenan un sancionador (8 %) y 348 revocan una buena pro.
--
-- Cada nombre se une a un RUC, de lo más seguro a lo menos (tribunal_ruc_de):
--   postor        un postor del mismo proceso con el mismo nombre (razon_norm: sin tildes ni forma societaria);
--   consorcio     el postor es un consorcio: cada integrante con RUC 20;
--   integrante    un integrante de un consorcio postor del proceso con ese nombre;
--   nombre_unico  el nombre identifica a una sola empresa del país (empresa_nombre_unico, migración 241).
-- Sólo se guardan RUC 20. Una persona natural (RUC 10) queda sin RUC, y su nombre nunca sale de la base.
-- `tribunal_parte` (con los nombres) no se da a la API; la API lee la vista `tribunal_parte_empresa`.
--
-- Tres señales, EN OBSERVACIÓN hasta revisar 40 casos de cada una en /admin/senales:
--   tribunal_sancionador        (media) en el proceso de la resolución: el Tribunal ordenó abrir un sancionador contra
--                               la empresa por lo que presentó en su oferta.
--   tribunal_revoco_buena_pro   (baja)  en el proceso: el comité le dio la buena pro y el Tribunal se la quitó (revocó o
--                               la descalificó). Una vez es un error; varias, en entidades distintas, un patrón.
--   gana_con_sancionador_abierto (media) en cada proceso que la empresa gana DESPUÉS de esa orden y antes de que el
--                               Tribunal la sancione (osce_sancionados), hasta dos años: la entidad contrató con quien
--                               estaba bajo un procedimiento por presentar documentos falsos o inexactos.
-- La cadena diaria de cruces (scrapers-worker, fuentes/comun.ts) la rehace; también tribunal_cargar.py al terminar.

ALTER TABLE tribunal_resolucion ADD COLUMN IF NOT EXISTS adjudicatario text;
ALTER TABLE tribunal_resolucion ADD COLUMN IF NOT EXISTS infraccion text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS tribunal_parte (
  resolucion_id bigint NOT NULL REFERENCES tribunal_resolucion (id) ON DELETE CASCADE,
  rol           text NOT NULL CHECK (rol IN ('adjudicatario', 'sancionador')),
  n             smallint NOT NULL,
  nombre        text NOT NULL,
  ruc           text CHECK (ruc IS NULL OR ruc ~ '^20\d{9}$'),
  via           text
);
CREATE UNIQUE INDEX IF NOT EXISTS tribunal_parte_unica ON tribunal_parte (resolucion_id, rol, n, COALESCE(ruc, ''));
CREATE INDEX IF NOT EXISTS tribunal_parte_ruc ON tribunal_parte (ruc) WHERE ruc IS NOT NULL;
COMMENT ON TABLE tribunal_parte IS 'Adjudicatario y destinatarios de un sancionador en cada resolución del Tribunal, con su RUC 20 si se pudo unir. Con nombres: no se da a la API (migración 424).';

CREATE OR REPLACE VIEW tribunal_parte_empresa AS
SELECT resolucion_id, rol, ruc, via FROM tribunal_parte WHERE ruc IS NOT NULL;
COMMENT ON VIEW tribunal_parte_empresa IS 'Las partes de las resoluciones del Tribunal que son empresas (RUC 20), sin el nombre leído. Migración 424.';

CREATE OR REPLACE FUNCTION tribunal_ruc_de(p_nombre text, p_ocids text[]) RETURNS TABLE (ruc text, via text)
LANGUAGE plpgsql STABLE AS $$
DECLARE v_k text := razon_norm(p_nombre);
BEGIN
  IF v_k IS NULL OR length(v_k) < 4 THEN RETURN; END IF;
  -- Un postor del proceso con ese nombre: empresa, o consorcio (sus integrantes RUC 20).
  RETURN QUERY
  WITH cod AS (SELECT DISTINCT c.codigo FROM convocatorias c WHERE c.ocid = ANY (p_ocids) AND c.codigo IS NOT NULL),
       pp AS (SELECT DISTINCT p.ruc_postor::text AS r FROM conosce_postores p
               WHERE p.codigo_convocatoria IN (SELECT codigo FROM cod) AND razon_norm(p.postor) = v_k)
  SELECT pp.r, 'postor'::text FROM pp WHERE pp.r ~ '^20\d{9}$'
  UNION
  SELECT DISTINCT m.ruc_miembro::text, 'consorcio'::text
    FROM pp JOIN conosce_consorcios m ON m.ruc_consorcio = pp.r
   WHERE pp.r !~ '^(10|20)\d{9}$' AND m.ruc_miembro ~ '^20\d{9}$';
  IF FOUND THEN RETURN; END IF;
  -- Un integrante de un consorcio postor del proceso.
  RETURN QUERY
  SELECT DISTINCT m.ruc_miembro::text, 'integrante'::text
    FROM conosce_consorcios m
   WHERE m.ruc_consorcio IN (SELECT p.ruc_postor FROM conosce_postores p JOIN convocatorias c ON c.codigo = p.codigo_convocatoria
                              WHERE c.ocid = ANY (p_ocids))
     AND razon_norm(m.miembro) = v_k AND m.ruc_miembro ~ '^20\d{9}$';
  IF FOUND THEN RETURN; END IF;
  -- El nombre identifica a una sola empresa del país.
  RETURN QUERY SELECT u.ruc::text, 'nombre_unico'::text FROM empresa_nombre_unico u WHERE u.k = v_k AND u.ruc ~ '^20\d{9}$';
END $$;

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
         (array_agg(t.infraccion ORDER BY t.fecha))[1] AS infraccion
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

INSERT INTO senal_en_observacion (tipo, desde, motivo) VALUES
  ('tribunal_sancionador', current_date, 'Nueva (424): el Tribunal ordenó abrir un sancionador contra la empresa; revisar 40 casos'),
  ('tribunal_revoco_buena_pro', current_date, 'Nueva (424): el Tribunal le quitó la buena pro; revisar 40 casos'),
  ('gana_con_sancionador_abierto', current_date, 'Nueva (424): ganó con un sancionador del Tribunal abierto; revisar 40 casos')
ON CONFLICT DO NOTHING;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.tribunal_parte OWNER TO vigia_jobs;
    ALTER VIEW public.tribunal_parte_empresa OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_cruce_tribunal() OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'dev_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.tribunal_parte_empresa TO %I', r);
    END IF;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION refrescar_cruce_tribunal() TO vigia_jobs;
