-- 246 · Banderas de lo que dicen el acta de buena pro y el pliego de consultas (leídos con Claude, migración 245)
--
-- refrescar_cruce_acta() pasa a cruces_proveedor (y de ahí a casos_cruce, las fichas y los filtros) sólo las banderas
-- que salen de REGLAS sobre los hechos extraídos, las estables entre lecturas (backend/evals/actas_buena_pro/informe.md):
--   acta_solo_queda_el_ganador          se presentaron dos o más y todos menos el ganador quedaron fuera
--   acta_descalificados_por_formalidad  a alguien lo sacaron por un documento o una formalidad (firma, foliado, formato)
--   acta_oferta_mas_baja_descartada     la oferta más baja quedó fuera y el ganador cobra 5 % o más (monto: la diferencia)
--   consultas_denuncia_direccionamiento un participante dijo por escrito que las bases favorecen a alguien
--   consultas_observaciones_a_requisitos_rechazadas  dos o más observaciones a los requisitos y la entidad no acogió ninguna
-- Las de consultas, sólo si DOS lecturas independientes (versiones v1 y v1-2) las encuentran: una sola coincide 0,5-0,67.
-- Las «observaciones» que el modelo elige por su cuenta no pasan: coinciden 0,29-0,47 entre lecturas.
-- Cada bandera va a cada ganador del proceso en CONOSCE (los integrantes de un consorcio, cada uno), con la evidencia:
-- quiénes quedaron fuera y por qué, o la cita del participante; y el enlace al documento en el SEACE.

CREATE OR REPLACE FUNCTION refrescar_cruce_acta() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_cruce_acta'));
  DROP TABLE IF EXISTS pg_temp._ag;
  CREATE TEMP TABLE _ag ON COMMIT DROP AS
    SELECT DISTINCT l.ocid, COALESCE(m.ruc_miembro, a.ruc_proveedor) AS ruc
      FROM (SELECT DISTINCT ocid FROM documento_lectura WHERE estado = 'ok' AND clase IN ('buena_pro', 'consultas')) l
      JOIN convocatorias v ON v.ocid = l.ocid
      JOIN conosce_adjudicaciones a ON a.codigo_convocatoria = v.codigo
      LEFT JOIN conosce_consorcios m ON m.ruc_consorcio = a.ruc_proveedor AND a.ruc_proveedor !~ '^(10|20)\d{9}$'
     WHERE COALESCE(m.ruc_miembro, a.ruc_proveedor) ~ '^(10|20)\d{9}$';
  CREATE INDEX ON _ag (ocid);
  ANALYZE _ag;

  DELETE FROM cruces_proveedor WHERE tipo LIKE 'acta\_%' OR tipo LIKE 'consultas\_%';

  -- El acta: quiénes quedaron fuera y por qué; en la de la oferta más baja, cuánto más cobra el ganador.
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT 'acta_' || b, g.ruc, l.ocid, 'media', COALESCE(c.fecha_buena_pro, l.leido_at::date),
         CASE WHEN b = 'oferta_mas_baja_descartada' THEN f.ganador_monto - f.menor_monto END,
         jsonb_build_object('fuera', f.fuera, 'postores', jsonb_array_length(COALESCE(l.salida->'postores', '[]')),
                            'menor_monto', f.menor_monto, 'ganador_monto', f.ganador_monto,
                            'documento', 'acta de buena pro', 'lector', l.clase || ' ' || l.version, 'modelo', l.modelo),
         'acta_buena_pro', d.url_origen
    FROM documento_lectura l
    CROSS JOIN LATERAL unnest(l.banderas) b
    JOIN _ag g ON g.ocid = l.ocid
    LEFT JOIN convocatorias c ON c.ocid = l.ocid
    LEFT JOIN documentos_gcs d ON d.id = l.documentos[1]
    CROSS JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('nombre', p->>'nombre', 'ruc', p->>'ruc', 'motivo', left(p->>'motivo_fuera', 400),
                                          'motivo_tipo', p->>'motivo_tipo', 'monto_ofertado', p->'monto_ofertado'))
               FILTER (WHERE NOT COALESCE((p->>'ganador')::boolean, false)
                         AND (p->>'admitida' = 'false' OR p->>'calificada' = 'false')) AS fuera,
             min((p->>'monto_ofertado')::numeric) FILTER (WHERE jsonb_typeof(p->'monto_ofertado') = 'number'
                                                            AND (p->>'monto_ofertado')::numeric > 0) AS menor_monto,
             max((p->>'monto_ofertado')::numeric) FILTER (WHERE COALESCE((p->>'ganador')::boolean, false)
                                                            AND jsonb_typeof(p->'monto_ofertado') = 'number') AS ganador_monto
        FROM jsonb_array_elements(COALESCE(l.salida->'postores', '[]')) p) f
   WHERE l.clase = 'buena_pro' AND l.estado = 'ok'
     AND b IN ('solo_queda_el_ganador', 'descalificados_por_formalidad', 'oferta_mas_baja_descartada');

  -- Las consultas: sólo lo que encuentran las dos lecturas.
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT 'consultas_' || CASE b WHEN 'denuncia_de_direccionamiento' THEN 'denuncia_direccionamiento' ELSE b END,
         g.ruc, a.ocid, CASE b WHEN 'denuncia_de_direccionamiento' THEN 'media' ELSE 'baja' END,
         COALESCE(c.fecha_convocatoria, a.leido_at::date), NULL,
         jsonb_build_object('denuncias', a.salida->'denuncias', 'n_consultas', a.salida->'n_consultas',
                            'observaciones', jsonb_array_length(COALESCE(a.salida->'observaciones', '[]')),
                            'documento', 'pliego de consultas y observaciones', 'lector', a.clase || ' ' || a.version || ' + ' || z.version,
                            'modelo', a.modelo),
         'consultas_bases', d.url_origen
    FROM documento_lectura a
    JOIN documento_lectura z ON z.ocid = a.ocid AND z.clase = a.clase AND z.version = a.version || '-2' AND z.estado = 'ok'
    CROSS JOIN LATERAL unnest(a.banderas) b
    JOIN _ag g ON g.ocid = a.ocid
    LEFT JOIN convocatorias c ON c.ocid = a.ocid
    LEFT JOIN documentos_gcs d ON d.id = a.documentos[1]
   WHERE a.clase = 'consultas' AND a.version = 'v1' AND a.estado = 'ok' AND b = ANY (z.banderas);

  SELECT count(*) INTO n FROM cruces_proveedor WHERE tipo LIKE 'acta\_%' OR tipo LIKE 'consultas\_%';
  RETURN n;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER FUNCTION refrescar_cruce_acta() OWNER TO vigia_jobs;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_cruce_acta() FROM PUBLIC;
