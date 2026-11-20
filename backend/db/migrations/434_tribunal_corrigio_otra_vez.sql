-- 434 · El Tribunal corrigió el mismo proceso otra vez, y un buscador de las resoluciones leídas.
--
-- 1. Señal en observación `tribunal_corrigio_otra_vez` (dentro de refrescar_cruce_tribunal, que ya corre en la cadena de
--    cruces): el Tribunal corrigió el proceso en una ronda y, 7 días o más después, lo volvió a corregir. Medido el 11-20
--    sobre 2 004 resoluciones leídas: 86 procesos de 983 corregidos alguna vez; en 13 la entidad mantuvo a la misma empresa
--    con la buena pro en dos rondas y en varios el Tribunal escribe que el comité «no acató» o «desacató» su mandato.
-- 2. tribunal_tipos_circulares(): las señales que salen del Tribunal, que no se miden contra él (419, 429). Una sola lista.
-- 3. Índice de texto en español, sin tildes, sobre título, entidad y motivo (GET /patrones/tribunal/resoluciones y la
--    herramienta buscar_resoluciones_tribunal del MCP), y uno por fecha para la lista sin palabras.

CREATE OR REPLACE FUNCTION tribunal_patron_desacato() RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  -- Lo que escribe el lector en el motivo cuando el Tribunal dice que el comité no cumplió lo que le ordenó antes.
  SELECT 'desacat|no acat|incumpli\w* (lo dispuesto|lo ordenado|el mandato)|contradici\w* lo (ya )?resuelto|'
      || 'mandato (de retroacci|del tribunal|de (la|esta) (sala|resoluci))|ordenad[oa] por (la resoluci|el tribunal)|'
      || 'volvi[oó] a (no admitir|descalificar|declarar desiert|desestimar|otorgar)'
$$;

CREATE OR REPLACE FUNCTION tribunal_tipos_circulares() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  -- Señales que son CONSECUENCIA de la etiqueta de la validación contra el Tribunal (fundada o nulidad): fuera de ella.
  SELECT ARRAY['otro_postor', 'tribunal_revoco_buena_pro', 'tribunal_sancionador', 'comite_corregido_tribunal',
               'tribunal_corrigio_otra_vez']
$$;

INSERT INTO senal_en_observacion (tipo, desde, motivo) VALUES
  ('tribunal_corrigio_otra_vez', current_date, 'Nueva (434): el Tribunal corrigió el mismo proceso en dos rondas; revisar 40 casos')
ON CONFLICT (tipo) DO NOTHING;

CREATE INDEX IF NOT EXISTS tribunal_resolucion_busqueda ON tribunal_resolucion
  USING gin (to_tsvector('spanish', immutable_unaccent(COALESCE(titulo, '') || ' ' || COALESCE(entidad, '') || ' ' || COALESCE(motivo, ''))));
CREATE INDEX IF NOT EXISTS tribunal_resolucion_fecha ON tribunal_resolucion (fecha DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS tribunal_parte_resolucion ON tribunal_parte (resolucion_id) INCLUDE (rol, ruc);

CREATE OR REPLACE FUNCTION refrescar_cruce_tribunal() RETURNS integer
LANGUAGE plpgsql SET work_mem TO '128MB' AS $$
DECLARE n int := 0; v_m int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_cruce_tribunal'));
  DELETE FROM cruces_proveedor
   WHERE tipo IN ('tribunal_sancionador', 'tribunal_revoco_buena_pro', 'gana_con_sancionador_abierto',
                  'tribunal_corrigio_otra_vez');

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
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION refrescar_validacion_tribunal() RETURNS bigint
LANGUAGE plpgsql SET work_mem = '256MB' AS $$
DECLARE
  v_id bigint;
  n1 int; n0 int; n int;
BEGIN
  CREATE TEMP TABLE _tu ON COMMIT DROP AS
  SELECT cn.ocid, cn.tipo, cn.anio, COALESCE(c.cuantia_referencial, 0)::numeric AS monto,
         CASE WHEN COALESCE(c.cuantia_referencial, 0) < 400000 THEN 1 WHEN c.cuantia_referencial < 2000000 THEN 2
              WHEN c.cuantia_referencial < 10000000 THEN 3 ELSE 4 END AS banda,
         EXISTS (SELECT 1 FROM tribunal_proceso p JOIN tribunal_resolucion r ON r.id = p.resolucion_id
                  WHERE p.ocid = cn.ocid AND tribunal_corrigio(r)) AS observado,
         0::float AS esperado
    FROM convocatoria_nomenclatura cn
    JOIN convocatorias c ON c.ocid = cn.ocid
   WHERE cn.tipo IN ('LP', 'CP', 'AS') AND cn.anio >= 2024
     AND (SELECT count(DISTINCT p.ruc_postor) FROM conosce_postores p WHERE p.codigo_convocatoria = c.codigo) >= 2;
  CREATE INDEX ON _tu (ocid);
  UPDATE _tu u SET esperado = s.tasa
    FROM (SELECT tipo, banda, anio, avg(observado::int)::float AS tasa FROM _tu GROUP BY 1, 2, 3) s
   WHERE s.tipo = u.tipo AND s.banda = u.banda AND s.anio = u.anio;
  ANALYZE _tu;

  CREATE TEMP TABLE _tb ON COMMIT DROP AS
  SELECT k.ocid, k.tipo, min(CASE k.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END) AS sev
    FROM cruces_proveedor k JOIN _tu u ON u.ocid = k.ocid
   -- Fuera las señales que son CONSECUENCIA de la etiqueta (419).
   WHERE k.tipo <> ALL (tribunal_tipos_circulares())
   GROUP BY 1, 2;
  CREATE INDEX ON _tb (ocid);
  ANALYZE _tb;
  CREATE TEMP TABLE _ts ON COMMIT DROP AS
  SELECT u.ocid, u.observado, u.monto, COALESCE(p.puntaje, 0) AS puntaje
    FROM _tu u
    LEFT JOIN (SELECT b.ocid, sum(CASE b.sev WHEN 0 THEN 10 WHEN 1 THEN 3 ELSE 1 END) AS puntaje
                 FROM _tb b WHERE NOT EXISTS (SELECT 1 FROM senal_en_observacion o WHERE o.tipo = b.tipo)
                GROUP BY b.ocid) p ON p.ocid = u.ocid;

  SELECT count(*) FILTER (WHERE observado), count(*) FILTER (WHERE NOT observado), count(*) INTO n1, n0, n FROM _ts;
  IF n1 = 0 OR n0 = 0 THEN
    RAISE NOTICE 'validación del Tribunal sin apelaciones fundadas unidas todavía: nada que medir';
    RETURN NULL;
  END IF;

  INSERT INTO validacion_corrida (etiqueta, desde, hasta, universo, observados, entidades, auc_puntaje, auc_monto,
                                  top1_puntaje, top1_monto, top1_azar, top5_puntaje, top5_monto, top5_azar)
  SELECT 'tribunal', DATE '2024-01-01', current_date, n, n1,
         (SELECT count(DISTINCT btrim(c.entidad_ruc::text)) FROM _tu u JOIN convocatorias c ON c.ocid = u.ocid),
         (SELECT ((sum(r) FILTER (WHERE observado)) - n1 * (n1 + 1) / 2.0) / (n1::numeric * n0)
            FROM (SELECT observado, rank() OVER (ORDER BY puntaje) + (count(*) OVER (PARTITION BY puntaje) - 1) / 2.0 AS r FROM _ts) x),
         (SELECT ((sum(r) FILTER (WHERE observado)) - n1 * (n1 + 1) / 2.0) / (n1::numeric * n0)
            FROM (SELECT observado, rank() OVER (ORDER BY monto) + (count(*) OVER (PARTITION BY monto) - 1) / 2.0 AS r FROM _ts) x),
         (SELECT count(*) FILTER (WHERE observado) FROM (SELECT observado FROM _ts ORDER BY puntaje DESC, md5(ocid) LIMIT n / 100) t),
         (SELECT count(*) FILTER (WHERE observado) FROM (SELECT observado FROM _ts ORDER BY monto DESC, md5(ocid) LIMIT n / 100) t),
         round(n1 * 0.01, 1),
         (SELECT count(*) FILTER (WHERE observado) FROM (SELECT observado FROM _ts ORDER BY puntaje DESC, md5(ocid) LIMIT n / 20) t),
         (SELECT count(*) FILTER (WHERE observado) FROM (SELECT observado FROM _ts ORDER BY monto DESC, md5(ocid) LIMIT n / 20) t),
         round(n1 * 0.05, 1)
  RETURNING id INTO v_id;

  INSERT INTO validacion_senal (corrida_id, tipo, procesos, observados, esperados, oe, oe_min, oe_max)
  SELECT v_id, b.tipo, count(*), count(*) FILTER (WHERE u.observado), sum(u.esperado),
         CASE WHEN sum(u.esperado) > 0 THEN (count(*) FILTER (WHERE u.observado)) / sum(u.esperado) END,
         CASE WHEN sum(u.esperado) > 0 AND count(*) FILTER (WHERE u.observado) > 0
              THEN power(greatest(sqrt(count(*) FILTER (WHERE u.observado)) - 0.98, 0), 2) / sum(u.esperado) ELSE 0 END,
         CASE WHEN sum(u.esperado) > 0 THEN power(sqrt(count(*) FILTER (WHERE u.observado) + 1) + 0.98, 2) / sum(u.esperado) END
    FROM _tb b JOIN _tu u ON u.ocid = b.ocid
   GROUP BY b.tipo;
  RETURN v_id;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER FUNCTION public.refrescar_cruce_tribunal() OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_validacion_tribunal() OWNER TO vigia_jobs;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_validacion_tribunal() FROM PUBLIC;

SELECT refrescar_cruce_tribunal();
