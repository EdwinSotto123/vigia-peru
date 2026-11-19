-- 390 · Sólo se admitió la oferta del ganador (indicador EN OBSERVACIÓN, migración 329).
--
-- En la admisión el comité revisa que CADA oferta traiga los documentos obligatorios (a diferencia de la calificación, que
-- en la adjudicación simplificada se hace en orden y se detiene en el primero que cumple). Que en un ítem con cuatro o más
-- ofertas se admita sólo la del ganador es el patrón de unas bases con un requisito formal a la medida: todos los demás
-- quedan fuera antes de comparar precios. Es un indicio para revisar, no una falta: puede haber postores improvisados.
--
-- Sale del reporte de evaluación que genera el propio SEACE, leído sin modelo (proceso_item y proceso_postor, migraciones
-- 326 y 384): admisión por postor, y quién ganó. Medido el 2026-11-18: con 3 ofertas pasa en el 14 % de los ítems, con 4
-- en el 10 %, con 5 en el 8 % y con 8 o más en el 1-4 %; la bandera del acta leída con modelo («sólo queda el ganador»)
-- concuerda 95 % con estos reportes. Umbral: 4 ofertas o más; grave con 6 o más (tasa base ≤ 7 %).
--
-- A quién se le pone: al ganador si es una empresa (RUC 20); si es un consorcio, a cada integrante con RUC 20
-- (conosce_consorcios). Los que quedaron fuera van en el detalle sólo si son empresas: una persona natural no se nombra.

INSERT INTO senal_en_observacion (tipo, motivo) VALUES
  ('solo_admitido_el_ganador', 'Nueva (migración 390): falta medir su precisión con 40 casos revisados a mano.')
ON CONFLICT (tipo) DO NOTHING;

CREATE OR REPLACE FUNCTION refrescar_cruce_solo_admitido() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n int;
  v_obs boolean := EXISTS (SELECT 1 FROM senal_en_observacion WHERE tipo = 'solo_admitido_el_ganador');
BEGIN
  -- Los ítems adjudicados con 4 o más ofertas y una sola admitida, que es la del ganador.
  CREATE TEMP TABLE _sa ON COMMIT DROP AS
    SELECT pi.ocid, pi.item, pi.ofertas, pi.admitidas, pi.monto_adjudicado, pi.descripcion, g.codigo AS ganador, g.nombre AS ganador_nombre,
           g.integrantes,
           (SELECT jsonb_agg(jsonb_build_object('ruc', o.codigo, 'nombre', o.nombre) ORDER BY o.nombre)
              FROM proceso_postor o
             WHERE o.ocid = pi.ocid AND o.item = pi.item AND NOT o.gano AND o.admitida = false AND o.codigo ~ '^20\d{9}$') AS fuera_empresas,
           (SELECT count(*)::int FROM proceso_postor o
             WHERE o.ocid = pi.ocid AND o.item = pi.item AND NOT o.gano AND o.admitida = false) AS fuera
      FROM proceso_item pi
      JOIN proceso_postor g ON g.ocid = pi.ocid AND g.item = pi.item AND g.gano AND g.admitida
     WHERE pi.resultado = 'adjudicado' AND pi.ofertas >= 4 AND pi.admitidas = 1;
  ANALYZE _sa;

  DELETE FROM cruces_proveedor WHERE tipo = 'solo_admitido_el_ganador';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (x.ocid, x.ruc)
         'solo_admitido_el_ganador', x.ruc, x.ocid, CASE WHEN x.ofertas >= 6 THEN 'alta' ELSE 'media' END,
         COALESCE(c.fecha_buena_pro, c.fecha_convocatoria), x.monto_adjudicado,
         jsonb_build_object('ofertas', x.ofertas, 'admitidas', x.admitidas, 'no_admitidas', x.fuera, 'item', x.item,
                            'descripcion_item', left(x.descripcion, 200), 'fuera_empresas', COALESCE(x.fuera_empresas, '[]'::jsonb),
                            'consorcio', x.consorcio, 'documento', 'reporte de evaluación del SEACE (leído sin modelo)',
                            'en_observacion', v_obs),
         'reporte_evaluacion', d.url
    FROM (SELECT s.*, CASE WHEN s.ganador ~ '^20\d{9}$' THEN s.ganador ELSE m.ruc_miembro END AS ruc,
                 CASE WHEN s.ganador ~ '^20\d{9}$' THEN NULL ELSE s.ganador_nombre END AS consorcio
            FROM _sa s
            LEFT JOIN conosce_consorcios m ON s.ganador !~ '^(10|20)\d{9}$' AND m.ruc_consorcio = s.ganador) x
    JOIN convocatorias c ON c.ocid = x.ocid
    LEFT JOIN LATERAL (
      SELECT g2.url_origen AS url FROM documento_pieza p JOIN documentos_gcs g2 ON g2.id = p.doc_id
       WHERE p.ocid = x.ocid AND p.tipo_documento = 'reporte_evaluacion' LIMIT 1) d ON true
   -- Sólo empresas (RUC 20): una persona natural no se muestra ni se enlaza.
   WHERE x.ruc ~ '^20\d{9}$'
   ORDER BY x.ocid, x.ruc, x.ofertas DESC;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER FUNCTION public.refrescar_cruce_solo_admitido() OWNER TO vigia_jobs;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_cruce_solo_admitido() FROM PUBLIC;
