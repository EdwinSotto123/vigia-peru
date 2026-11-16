-- El socio de una empresa inhabilitada gana con OTRA empresa mientras dura la sanción (cruce `socio_de_inhabilitada`, 2026-11-15).
--
-- `sancion_vigente` mira el RUC del ganador. Pero la inhabilitación también alcanza a las empresas de los mismos dueños:
-- es impedimento contratar con una persona jurídica del mismo rubro cuyos socios (con más del 30 % del capital),
-- representantes o directivos formen o hayan formado parte, cuando se cometió la infracción, de otra que está inhabilitada,
-- y dura lo que dura la sanción (Ley 32069, art. 30, impedimento 3.E; antes, art. 11 de la Ley 30225). Es la forma más
-- simple de esquivar una sanción: seguir vendiendo con otra razón social.
--
-- Red: rnp_conformacion_juridica, sólo SOCIOS por documento (como `mismo_dueno`), de hasta 10 empresas. La persona debe
-- figurar en la sancionada desde antes de que empiece la sanción y en la ganadora desde antes de la buena pro (cuando el
-- RNP da la fecha). Ganadores: conosce_adjudicaciones desde 2018, también como integrante de un consorcio.
--
--   alta   la sanción es definitiva, o la empresa ganadora se fundó (o la persona entró a ella) desde 180 días antes del
--          inicio de la sanción: una empresa hecha para seguir;
--   media  lo demás.
--
-- Lo que la base NO sabe y hay que confirmar: el porcentaje de participación (más de 30 %), que las dos empresas sean del
-- mismo rubro y que la persona estuviera en la sancionada el día de la infracción. Es un hecho para revisar.
--
-- Medido antes de escribirla (sin los filtros de fecha de ingreso): 2 136 procesos desde 2018, de 486 personas y 456
-- empresas, por S/ 1 729 millones; 1 034 procesos desde 2023.

CREATE OR REPLACE FUNCTION refrescar_cruce_socio_de_inhabilitada() RETURNS integer
LANGUAGE plpgsql SET work_mem = '64MB' SET statement_timeout = '300s' AS $$
DECLARE v_filas int;
BEGIN
  -- Socios de empresas inhabilitadas (no las multas: una multa no impide contratar).
  DROP TABLE IF EXISTS _si_p;
  CREATE TEMP TABLE _si_p ON COMMIT DROP AS
    SELECT s.ruc AS sancionada, max(s.razon_social) AS sancionada_nombre, s.tipo, s.fecha_desde AS desde, s.fecha_hasta AS hasta, max(s.resolucion) AS resolucion,
           r.numero_documento AS doc,
           -- Una sucesión figura con dos nombres completos («SUCESION … REPRESENTADA POR …»): no se guarda.
           CASE WHEN max(r.nombre) ~* 'SUCESI|REPRESENTAD|VIUDA DE|HEREDER|INDIVISA' THEN 'Sucesión (nombre reservado)' ELSE max(r.nombre) END AS nombre
      FROM osce_sancionados s
      JOIN rnp_conformacion_juridica r ON r.ruc_empresa = s.ruc AND r.tipo_rol = 'SOCIO_ACCIONISTA_TITULAR' AND r.tipo_documento LIKE 'DOC. NACIONAL%'
     WHERE s.ruc ~ '^20[0-9]{9}$' AND s.tipo IN ('temporal', 'definitivo') AND s.fecha_desde IS NOT NULL
       AND (r.fecha_inicio_vigencia IS NULL OR r.fecha_inicio_vigencia <= s.fecha_desde)
     GROUP BY s.ruc, s.tipo, s.fecha_desde, s.fecha_hasta, r.numero_documento;
  CREATE INDEX ON _si_p (doc);
  ANALYZE _si_p;

  -- Las otras empresas de esas personas.
  DROP TABLE IF EXISTS _si_h;
  CREATE TEMP TABLE _si_h ON COMMIT DROP AS
    SELECT p.sancionada, p.sancionada_nombre, p.tipo, p.desde, p.hasta, p.resolucion, p.doc, p.nombre, r.ruc_empresa::text AS otra, min(r.fecha_inicio_vigencia) AS entro
      FROM _si_p p
      JOIN rnp_conformacion_juridica r ON r.numero_documento = p.doc AND r.tipo_rol = 'SOCIO_ACCIONISTA_TITULAR' AND r.tipo_documento LIKE 'DOC. NACIONAL%'
                                      AND r.ruc_empresa <> p.sancionada AND r.ruc_empresa ~ '^20[0-9]{9}$'
     WHERE p.doc IN (SELECT numero_documento FROM rnp_conformacion_juridica
                      WHERE tipo_documento LIKE 'DOC. NACIONAL%' AND tipo_rol = 'SOCIO_ACCIONISTA_TITULAR'
                        AND numero_documento IN (SELECT doc FROM _si_p)
                      GROUP BY 1 HAVING count(DISTINCT ruc_empresa) <= 10)
     GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9;
  CREATE INDEX ON _si_h (otra);
  ANALYZE _si_h;

  -- Lo que ganaron esas empresas, solas o dentro de un consorcio (CONOSCE da al consorcio un código propio).
  DROP TABLE IF EXISTS _si_g;
  CREATE TEMP TABLE _si_g ON COMMIT DROP AS
    SELECT a.codigo_convocatoria::text AS codigo, a.ruc_proveedor AS ruc, NULL::text AS consorcio, min(a.fecha_buenapro) AS fecha, sum(a.monto_adjudicado) AS monto
      FROM conosce_adjudicaciones a
     WHERE a.anio >= 2018 AND a.monto_adjudicado > 0 AND a.fecha_buenapro IS NOT NULL AND a.ruc_proveedor IN (SELECT otra FROM _si_h)
     GROUP BY 1, 2
    UNION ALL
    SELECT a.codigo_convocatoria::text, q.ruc_miembro, max(q.consorcio), min(a.fecha_buenapro), sum(a.monto_adjudicado)
      FROM conosce_consorcios q
      JOIN conosce_adjudicaciones a ON a.ruc_proveedor = q.ruc_consorcio
     WHERE q.ruc_miembro IN (SELECT otra FROM _si_h) AND q.ruc_consorcio !~ '^(10|20)[0-9]{9}$'
       AND a.anio >= 2018 AND a.monto_adjudicado > 0 AND a.fecha_buenapro IS NOT NULL
     GROUP BY 1, 2;
  CREATE INDEX ON _si_g (ruc);
  ANALYZE _si_g;

  DELETE FROM cruces_proveedor WHERE tipo = 'socio_de_inhabilitada';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (c.ocid, g.ruc) 'socio_de_inhabilitada', g.ruc, c.ocid,
         CASE WHEN h.tipo = 'definitivo' OR e.fecha_alta_ruc >= h.desde - 180 OR h.entro >= h.desde - 180 THEN 'alta' ELSE 'media' END,
         g.fecha, g.monto, h.doc, h.nombre, 'SOCIO_ACCIONISTA_TITULAR',
         jsonb_build_object('sancionada_ruc', h.sancionada, 'sancionada', h.sancionada_nombre, 'sancion', h.tipo,
                            'sancion_desde', to_char(h.desde, 'YYYY-MM-DD'), 'sancion_hasta', to_char(h.hasta, 'YYYY-MM-DD'), 'resolucion', h.resolucion,
                            'fundada', to_char(e.fecha_alta_ruc, 'YYYY-MM-DD'), 'socio_desde', to_char(h.entro, 'YYYY-MM-DD'),
                            'hecha_para_seguir', COALESCE(e.fecha_alta_ruc >= h.desde - 180 OR h.entro >= h.desde - 180, false),
                            'consorcio', g.consorcio,
                            'norma', CASE WHEN g.fecha >= DATE '2025-04-22' THEN 'Art. 30 Ley 32069 — impedimento 3.E (integrantes de una persona jurídica inhabilitada)'
                                          ELSE 'Art. 11 Ley 30225 — impedimento por integrantes de una persona jurídica inhabilitada' END),
         'osce_sancionados + rnp_conformacion_juridica', 'https://www.gob.pe/oece'
    FROM _si_g g
    JOIN _si_h h ON h.otra = g.ruc AND g.fecha >= h.desde AND (h.hasta IS NULL OR g.fecha <= h.hasta) AND (h.entro IS NULL OR h.entro <= g.fecha)
    JOIN convocatorias c ON c.codigo::text = g.codigo
    LEFT JOIN empresas e ON e.ruc = g.ruc
   ORDER BY c.ocid, g.ruc, (h.tipo = 'definitivo') DESC, (e.fecha_alta_ruc >= h.desde - 180 OR h.entro >= h.desde - 180) DESC NULLS LAST, h.desde DESC;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas;
END $$;
ALTER FUNCTION refrescar_cruce_socio_de_inhabilitada() OWNER TO vigia_jobs;

-- Tablas chicas (unos miles de filas): tarda segundos. Si pasa de 3 minutos algo anda mal y se corta.
SET statement_timeout = '180s';
SELECT refrescar_cruce_socio_de_inhabilitada() AS socio_de_inhabilitada;
RESET statement_timeout;
