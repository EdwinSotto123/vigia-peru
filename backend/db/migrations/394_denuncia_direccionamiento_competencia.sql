-- 394 · La denuncia de bases dirigidas pesa según lo que pasó después con la competencia.
--
-- `consultas_denuncia_direccionamiento` (pliego de consultas leído dos veces con modelo, puntúa) sale en el 15,2 % de los
-- procesos con el pliego leído, siempre «media». Medido el 2026-11-18: donde hay denuncia hubo MÁS competencia, no menos
-- (3,17 ofertas de media contra 2,65; una sola oferta en el 29,7 % contra el 40,4 %). La denuncia marca procesos
-- disputados; por sí sola no dice que las bases funcionaron como se denunció. Lo que sí dice algo es la denuncia seguida
-- de una competencia que desapareció: una sola oferta, o una sola admitida (reporte de evaluación del SEACE). Ahí sigue
-- «media»; si se admitieron dos o más ofertas en todos los ítems adjudicados, «baja». Sin reporte, como antes («media»).
-- El detalle guarda `competencia` (desaparecio | se_mantuvo | null), `ofertas` y `admitidas`.
--
-- La función es la de la 393 con eso; nada más cambia.
-- Cómo aplicarla: después de la 393. Luego `python backend/lector/publicar.py prod`.

CREATE OR REPLACE FUNCTION refrescar_cruce_acta() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_cruce_acta'));
  DROP TABLE IF EXISTS pg_temp._ag;
  CREATE TEMP TABLE _ag ON COMMIT DROP AS
    SELECT DISTINCT l.ocid, COALESCE(m.ruc_miembro, a.ruc_proveedor) AS ruc
      FROM (SELECT DISTINCT ocid FROM documento_lectura WHERE estado = 'ok' AND clase IN ('buena_pro', 'consultas', 'bases')) l
      JOIN convocatorias v ON v.ocid = l.ocid
      JOIN conosce_adjudicaciones a ON a.codigo_convocatoria = v.codigo
      LEFT JOIN conosce_consorcios m ON m.ruc_consorcio = a.ruc_proveedor AND a.ruc_proveedor !~ '^(10|20)\d{9}$'
     WHERE COALESCE(m.ruc_miembro, a.ruc_proveedor) ~ '^(10|20)\d{9}$';
  CREATE INDEX ON _ag (ocid);
  ANALYZE _ag;

  DELETE FROM cruces_proveedor WHERE tipo LIKE 'acta\_%' OR tipo LIKE 'consultas\_%' OR tipo LIKE 'bases\_%';

  -- El acta: quiénes quedaron fuera y por qué; en la de la oferta más baja, cuánto más cobra el ganador.
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT 'acta_' || b, g.ruc, l.ocid,
         -- Migración 392: con dos postores, que uno quede fuera pasa en la mitad de los procesos (50,6 %): baja.
         -- Migración 393: con dos postores, «fuera por formalidad» es ese mismo hecho (el único otro postor): baja también.
         CASE WHEN b IN ('solo_queda_el_ganador', 'descalificados_por_formalidad')
                   AND jsonb_array_length(COALESCE(l.salida->'postores', '[]')) <= 2 THEN 'baja'
              ELSE 'media' END,
         COALESCE(c.fecha_buena_pro, l.leido_at::date),
         CASE WHEN b = 'oferta_mas_baja_descartada' THEN f.ganador_monto - f.menor_monto END,
         jsonb_build_object('fuera', f.fuera, 'postores', jsonb_array_length(COALESCE(l.salida->'postores', '[]')),
                            'menor_monto', f.menor_monto, 'ganador_monto', f.ganador_monto,
                            'documento', 'acta de buena pro',
                            'lector', l.clase || ' ' || l.version || COALESCE(' + ' || z.version, ''), 'modelo', l.modelo),
         'acta_buena_pro', d.url_origen
    FROM documento_lectura l
    CROSS JOIN LATERAL unnest(l.banderas) b
    JOIN _ag g ON g.ocid = l.ocid
    LEFT JOIN documento_lectura z ON z.ocid = l.ocid AND z.clase = l.clase AND z.version = l.version || '-2' AND z.estado = 'ok'
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
   WHERE l.clase = 'buena_pro' AND l.version = 'v2' AND l.estado = 'ok'
     AND b IN ('solo_queda_el_ganador', 'descalificados_por_formalidad', 'oferta_mas_baja_descartada')
     -- Con segunda lectura, sólo si también la encuentra; sin ella (aún no se leyó dos veces), como antes.
     AND (z.ocid IS NULL OR b = ANY (z.banderas));

  -- Las consultas: sólo lo que encuentran las dos lecturas.
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT 'consultas_' || CASE b WHEN 'denuncia_de_direccionamiento' THEN 'denuncia_direccionamiento' ELSE b END,
         g.ruc, a.ocid,
         -- Migración 394: la denuncia pesa «media» si después la competencia desapareció (una oferta, o sólo se admitió
         -- una) o no hay reporte de evaluación para saberlo; si se admitieron dos o más, «baja».
         CASE WHEN b <> 'denuncia_de_direccionamiento' THEN 'baja'
              WHEN k.competencia = 'se_mantuvo' THEN 'baja' ELSE 'media' END,
         COALESCE(c.fecha_convocatoria, a.leido_at::date), NULL,
         jsonb_build_object('denuncias', a.salida->'denuncias', 'n_consultas', a.salida->'n_consultas',
                            'observaciones', jsonb_array_length(COALESCE(a.salida->'observaciones', '[]')),
                            'documento', 'pliego de consultas y observaciones', 'lector', a.clase || ' ' || a.version || ' + ' || z.version,
                            'modelo', a.modelo, 'competencia', k.competencia, 'ofertas', k.ofertas, 'admitidas', k.admitidas),
         'consultas_bases', d.url_origen
    FROM documento_lectura a
    JOIN documento_lectura z ON z.ocid = a.ocid AND z.clase = a.clase AND z.version = a.version || '-2' AND z.estado = 'ok'
    CROSS JOIN LATERAL unnest(a.banderas) b
    JOIN _ag g ON g.ocid = a.ocid
    LEFT JOIN convocatorias c ON c.ocid = a.ocid
    LEFT JOIN documentos_gcs d ON d.id = a.documentos[1]
    -- La competencia que quedó, del reporte de evaluación del SEACE (proceso_item, sin modelo; migraciones 326 y 384).
    LEFT JOIN LATERAL (
      SELECT CASE WHEN count(*) = 0 THEN NULL
                  WHEN bool_or(pi.ofertas = 1 OR pi.admitidas = 1) THEN 'desaparecio'
                  WHEN bool_and(pi.admitidas >= 2) THEN 'se_mantuvo' END AS competencia,
             max(pi.ofertas) AS ofertas, min(pi.admitidas) AS admitidas
        FROM proceso_item pi WHERE pi.ocid = a.ocid AND pi.resultado = 'adjudicado') k ON true
   WHERE a.clase = 'consultas' AND a.version = 'v1' AND a.estado = 'ok' AND b = ANY (z.banderas);

  -- Las bases: sólo lo que encuentran las dos lecturas (versiones v1 y v1-2).
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT b, g.ruc, a.ocid, CASE b WHEN 'bases_marca_sin_equivalente' THEN 'media' ELSE 'baja' END,
         COALESCE(c.fecha_convocatoria, a.leido_at::date),
         CASE WHEN b = 'bases_experiencia_alta' THEN NULLIF(a.salida->'experiencia_postor'->>'monto_minimo', '')::numeric END,
         jsonb_build_object('marcas', (SELECT jsonb_agg(m) FROM jsonb_array_elements(COALESCE(a.salida->'marcas', '[]')) m
                                        WHERE NOT COALESCE((m->>'con_equivalente')::boolean, false)),
                            'experiencia', a.salida->'experiencia_postor', 'valor_referencial', a.salida->'valor_referencial',
                            'documento', 'bases del procedimiento', 'lector', a.clase || ' ' || a.version || ' + ' || z.version,
                            'modelo', a.modelo),
         'bases_seace', d.url_origen
    FROM documento_lectura a
    JOIN documento_lectura z ON z.ocid = a.ocid AND z.clase = a.clase AND z.version = a.version || '-2' AND z.estado = 'ok'
    CROSS JOIN LATERAL unnest(a.banderas) b
    JOIN _ag g ON g.ocid = a.ocid
    LEFT JOIN convocatorias c ON c.ocid = a.ocid
    LEFT JOIN documentos_gcs d ON d.id = a.documentos[1]
   WHERE a.clase = 'bases' AND a.version = 'v1' AND a.estado = 'ok' AND b = ANY (z.banderas)
     AND b <> 'bases_experiencia_alta';        -- la experiencia va aparte, con el referencial del registro (abajo)

  -- La experiencia exigida al postor frente al valor referencial DEL REGISTRO (migración 322). El lector de bases casi
  -- nunca trae el referencial (nulo en 77 % de las lecturas: no está en las páginas que lee), así que la bandera que
  -- calculaba con el suyo salía en un centenar de procesos; con el del registro son unos 350. En vez de una segunda
  -- lectura, una prueba sin modelo: la cita que el lector copió de las bases tiene que traer ese mismo monto. Si hay
  -- segunda lectura, además tiene que coincidir. Veinte veces o más es un error de lectura, no una exigencia.
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT 'bases_experiencia_alta', g.ruc, a.ocid, 'baja', COALESCE(c.fecha_convocatoria, a.leido_at::date), e.monto,
         jsonb_build_object('experiencia', a.salida->'experiencia_postor', 'valor_referencial', c.cuantia_referencial,
                            'valor_referencial_de', 'registro', 'veces', round(e.monto / c.cuantia_referencial, 2),
                            'verificado', 'la cita de las bases trae el monto' || CASE WHEN e.monto2 IS NOT NULL THEN ' y dos lecturas coinciden' ELSE '' END,
                            'documento', 'bases del procedimiento', 'lector', a.clase || ' ' || a.version, 'modelo', a.modelo),
         'bases_seace', d.url_origen
    FROM documento_lectura a
    JOIN convocatorias c ON c.ocid = a.ocid
    JOIN _ag g ON g.ocid = a.ocid
    LEFT JOIN documento_lectura z ON z.ocid = a.ocid AND z.clase = a.clase AND z.version = a.version || '-2' AND z.estado = 'ok'
    LEFT JOIN documentos_gcs d ON d.id = a.documentos[1]
    CROSS JOIN LATERAL (
      SELECT CASE WHEN jsonb_typeof(a.salida->'experiencia_postor'->'monto_minimo') = 'number'
                  THEN (a.salida->'experiencia_postor'->>'monto_minimo')::numeric END AS monto,
             CASE WHEN jsonb_typeof(z.salida->'experiencia_postor'->'monto_minimo') = 'number'
                  THEN (z.salida->'experiencia_postor'->>'monto_minimo')::numeric END AS monto2,
             COALESCE(a.salida->'experiencia_postor'->>'cita', '') AS cita) e
   WHERE a.clase = 'bases' AND a.version = 'v1' AND a.estado = 'ok'
     AND c.cuantia_referencial > 0 AND e.monto >= 3 * c.cuantia_referencial AND e.monto < 20 * c.cuantia_referencial
     AND regexp_replace(e.cita, '[^0-9]', '', 'g') LIKE '%' || trunc(e.monto)::text || '%'
     AND (e.monto2 IS NULL OR abs(e.monto - e.monto2) <= 0.01 * e.monto);

  SELECT count(*) INTO n FROM cruces_proveedor WHERE tipo LIKE 'acta\_%' OR tipo LIKE 'consultas\_%' OR tipo LIKE 'bases\_%';
  RETURN n;
END $$;
