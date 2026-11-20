-- 439 · Ganó pese al Tribunal (en observación).
--
-- El Tribunal revocó la buena pro de una empresa y se la otorgó al postor que apeló, sin anular el proceso; después la
-- misma empresa figura como ganadora de ese proceso. Medido el 2026-11-20 sobre 2 004 resoluciones leídas: 190 otorgan
-- la buena pro al impugnante sin anular ni retrotraer, 11 ya tienen un ganador posterior en el OCDS o CONOSCE, y en 1 es
-- la empresa revocada (1214248, Res. 4496-2026-TCP-S4: TRADING CEAR, 26 días después; el Tribunal pidió además informar
-- al titular de la entidad). Se distingue de las revocaciones con retrotracción: ahí la empresa puede subsanar y volver
-- a ganar con todo derecho (7 de los 8 casos de ese tipo). Va dentro de refrescar_cruce_tribunal (ya en la cadena de
-- cruces). Sale del Tribunal: fuera de su validación.

CREATE OR REPLACE FUNCTION tribunal_tipos_circulares() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ARRAY['otro_postor', 'tribunal_revoco_buena_pro', 'tribunal_sancionador', 'comite_corregido_tribunal',
               'tribunal_corrigio_otra_vez', 'gano_pese_al_tribunal']
$$;

INSERT INTO senal_en_observacion (tipo, desde, motivo) VALUES
  ('gano_pese_al_tribunal', current_date, 'Nueva (439): ganó un proceso cuya buena pro el Tribunal le había quitado para dársela al impugnante; revisar cada caso')
ON CONFLICT (tipo) DO NOTHING;

CREATE OR REPLACE FUNCTION refrescar_cruce_tribunal() RETURNS integer
LANGUAGE plpgsql SET work_mem TO '128MB' AS $$
DECLARE n int := 0; v_m int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_cruce_tribunal'));
  DELETE FROM cruces_proveedor
   WHERE tipo IN ('tribunal_sancionador', 'tribunal_revoco_buena_pro', 'gana_con_sancionador_abierto',
                  'tribunal_corrigio_otra_vez', 'gano_pese_al_tribunal');

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

  -- 434 · El Tribunal corrigió el mismo proceso otra vez. Rondas: resoluciones que corrigen (tribunal_corrigio, 423) separadas
  -- por 7 días o más; las del mismo día o de la misma semana son apelaciones paralelas (otro ítem, otro postor), no una
  -- segunda vuelta. Entre una ronda y la siguiente la entidad volvió a decidir y el Tribunal la volvió a corregir. Pesa más
  -- si mantuvo a la misma empresa con la buena pro en dos rondas, o si el Tribunal dice que el comité no acató lo que le
  -- ordenó. Va a la empresa (RUC 20 comprobado, 424) que tenía la buena pro en la última ronda, o en una anterior si en la
  -- última no figura; un proceso sin adjudicatario identificado (desierto, por ejemplo) se cuenta en la ficha de la entidad.
  CREATE TEMP TABLE _tv ON COMMIT DROP AS
  SELECT x.*, 1 + count(*) FILTER (WHERE x.salto) OVER (PARTITION BY x.ocid ORDER BY x.fecha, x.id) AS ronda
    FROM (SELECT d.*, COALESCE(d.fecha - lag(d.fecha) OVER (PARTITION BY d.ocid ORDER BY d.fecha, d.id) >= 7, false) AS salto
            FROM (SELECT DISTINCT p.ocid, r.id, r.fecha, r.titulo, r.resultado, COALESCE(r.pdf, r.url) AS enlace,
                         left(r.motivo, 400) AS motivo, COALESCE(r.motivo ~* tribunal_patron_desacato(), false) AS desacato
                    FROM tribunal_proceso p JOIN tribunal_resolucion r ON r.id = p.resolucion_id
                   WHERE p.ocid IS NOT NULL AND r.fecha IS NOT NULL AND tribunal_corrigio(r)) d) x;
  DELETE FROM _tv v WHERE NOT EXISTS (SELECT 1 FROM _tv w WHERE w.ocid = v.ocid AND w.ronda >= 2);

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (e.ruc, v.ocid) 'tribunal_corrigio_otra_vez', e.ruc, v.ocid,
         CASE WHEN e.rondas_empresa >= 2 OR v.desacato THEN 'media' ELSE 'baja' END, v.ultima,
         jsonb_build_object('rondas', v.rondas, 'correcciones', v.correcciones, 'misma_empresa', e.rondas_empresa >= 2,
                            'desacato', v.desacato, 'motivo_desacato', v.motivo_desacato,
                            'resoluciones', v.resoluciones, 'resolucion', v.titulo_ultima, 'enlace', v.enlace_ultima),
         'tribunal_apelaciones', v.enlace_ultima
    FROM (SELECT ocid, max(ronda)::int AS rondas, count(*)::int AS correcciones, max(fecha) AS ultima,
                 bool_or(desacato AND ronda >= 2) AS desacato,
                 (array_agg(motivo ORDER BY fecha DESC, id DESC) FILTER (WHERE desacato AND ronda >= 2))[1] AS motivo_desacato,
                 (array_agg(titulo ORDER BY fecha DESC, id DESC))[1] AS titulo_ultima,
                 (array_agg(enlace ORDER BY fecha DESC, id DESC))[1] AS enlace_ultima,
                 jsonb_agg(jsonb_build_object('titulo', titulo, 'fecha', fecha, 'resultado', resultado, 'ronda', ronda,
                                              'enlace', enlace) ORDER BY fecha, id) AS resoluciones
            FROM _tv GROUP BY ocid) v
    -- La empresa con la buena pro en cada ronda; se prefiere la de la última y se cuenta en cuántas rondas la tuvo.
    CROSS JOIN LATERAL (
      SELECT pa.ruc, count(DISTINCT t.ronda)::int AS rondas_empresa, max(t.ronda) AS ultima_ronda
        FROM _tv t JOIN tribunal_parte pa ON pa.resolucion_id = t.id AND pa.rol = 'adjudicatario' AND pa.ruc IS NOT NULL
       WHERE t.ocid = v.ocid
       GROUP BY pa.ruc) e
   ORDER BY e.ruc, v.ocid, e.ultima_ronda DESC;
  GET DIAGNOSTICS v_m = ROW_COUNT; n := n + v_m;

  -- 439 · Ganó pese al Tribunal: el Tribunal revocó la buena pro de la empresa y se la OTORGÓ al postor que apeló (sin
  -- anular ni retrotraer el proceso), y después la empresa revocada figura igual como ganadora del mismo proceso
  -- (adjudicación del OCDS o de CONOSCE con fecha posterior a la resolución; sola o como integrante de un consorcio).
  -- Puede tener explicación (el impugnante no firmó y la buena pro pasó al siguiente en el orden), pero es lo primero que
  -- hay que revisar: la resolución es vinculante. Quien apeló no se nombra (puede ser una persona natural).
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (pa.ruc, q.ocid) 'gano_pese_al_tribunal', pa.ruc, q.ocid, 'media', g.fecha, g.monto,
         jsonb_build_object('resolucion', q.titulo, 'fecha_resolucion', q.fecha, 'enlace', q.enlace,
                            'buena_pro_despues', g.fecha, 'dias_despues', g.fecha - q.fecha, 'fuente_adjudicacion', g.fuente),
         'tribunal_apelaciones', q.enlace
    FROM (SELECT r.id, r.titulo, r.fecha, COALESCE(r.pdf, r.url) AS enlace, p.ocid, c.codigo, c.adjudicaciones
            FROM tribunal_resolucion r
            JOIN tribunal_proceso p ON p.resolucion_id = r.id AND p.ocid IS NOT NULL
            JOIN convocatorias c ON c.ocid = p.ocid
           WHERE r.resultado_ok AND r.fecha IS NOT NULL AND tribunal_corrigio(r)
             AND r.efectos @> ARRAY['otorga_buena_pro_al_impugnante'] AND NOT r.efectos && ARRAY['nulidad', 'retrotrae']) q
    JOIN tribunal_parte pa ON pa.resolucion_id = q.id AND pa.rol = 'adjudicatario' AND pa.ruc IS NOT NULL
    CROSS JOIN LATERAL (
      SELECT x.ruc, x.fecha, x.monto, x.fuente FROM (
        SELECT regexp_replace(s->>'id', '^PE-RUC-', '') AS ruc, (a->>'date')::date AS fecha,
               (a->'value'->>'amount')::numeric AS monto, 'ocds' AS fuente
          FROM jsonb_array_elements(COALESCE(q.adjudicaciones, '[]')) a, jsonb_array_elements(COALESCE(a->'suppliers', '[]')) s
         WHERE (a->>'date') ~ '^\d{4}-\d{2}-\d{2}'
        UNION ALL
        SELECT a.ruc_proveedor, a.fecha_buenapro, a.monto_adjudicado, 'conosce'
          FROM conosce_adjudicaciones a WHERE a.codigo_convocatoria = q.codigo) x
       WHERE x.fecha > q.fecha
         AND (x.ruc = pa.ruc OR EXISTS (SELECT 1 FROM conosce_consorcios m WHERE m.ruc_consorcio = x.ruc AND m.ruc_miembro = pa.ruc))
       ORDER BY x.fecha LIMIT 1) g
   ORDER BY pa.ruc, q.ocid, q.fecha DESC;
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
