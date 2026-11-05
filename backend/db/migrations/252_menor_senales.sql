-- 252 · Las señales de cada contrato menor (≤8 UIT) → menor_senal (251). Cada una atada a su contrato, con la evidencia.
--
-- Hasta aquí un contrato menor sólo mostraba lo que dice la SUNAT del proveedor y si el Tribunal lo tenía inhabilitado.
-- Ahora, con las fechas de cotización, los ítems y lo que Claude leyó en sus PDF (migración 251):
--
--   menor_partido_mismo_dia    alta   dos o más contratos menores de la misma entidad al mismo proveedor el MISMO día
--                                     que juntos pasan el tope de 8 UIT de su año: la marca de partir una compra para no
--                                     hacer un procedimiento de selección (la ley prohíbe fraccionar)
--   menor_partido_en_el_anio   media  dos o más del mismo tipo (bien o servicio), misma entidad y mismo proveedor, en el
--                                     mismo año, que juntos pasan el tope. `detalle.mismo_item`: cuántos repiten el mismo
--                                     ítem del catálogo (CUBSO)
--   menor_sobre_tope           alta   el monto pasa el tope de 8 UIT (no debería existir un contrato menor así, o el monto
--                                     está mal registrado)
--   menor_borde_tope           baja   entre el 95 % y el 100 % del tope (la regla de «al borde del tope» de las órdenes, 207)
--   menor_ventana_corta        media  se pudo cotizar menos de 4 horas (alta con menos de 1 hora): con tan poco tiempo casi
--                                     sólo cotiza quien ya sabía
--   menor_invitacion_cerrada   media  la invitación a cotizar no fue abierta (con la justificación que registró la entidad)
--   menor_fin_de_semana        baja   firmado un sábado o un domingo
--   menor_orden_antes_de_cotizar alta la orden de compra o servicio (juntada por su número, 253) se emitió antes de que se
--                                     publicara el pedido de cotizaciones
--   menor_precio_alto          media  un bien pagado 2 veces o más la mediana de lo que pagan las demás entidades por el mismo
--                                     ítem del catálogo, unidad y año (precio_referencia, 84); alta con 3 veces y S/ 5 mil
--                                     de exceso. Las mismas guardas que el sobreprecio de los procesos
--   Lo leído (backend/lector/menor_*.py), SÓLO si dos lecturas independientes (v1 y v1-2) coinciden:
--   tdr_proveedor_nombrado     alta   el requerimiento dice a quién se contratará antes de las cotizaciones
--   tdr_marca_sin_equivalente  media  el requerimiento exige una marca sin admitir «o equivalente»
--   tdr_monto_distinto         media  el monto registrado es 5 veces mayor o menor que el que estima el requerimiento
--   tdr_experiencia_alta       baja   la experiencia exigida al proveedor es 3 veces o más el monto del contrato
--   contrato_monto_distinto    media  el contrato u orden dice otro monto que el registrado (más del 5 % y S/ 100)
--   contrato_ruc_distinto      alta   el contrato u orden es con otro RUC que el del proveedor registrado
--
-- Las citas que vienen de los PDF pasan sin DNI (8 dígitos) ni RUC 10 (lleva el DNI). La API tapa los nombres al publicar.
-- refrescar_menor_senales() rehace la tabla entera (segundos: son ~11 mil contratos); la llaman el Worker de scrapers
-- después de cargar los menores (fuentes/seace_menores.ts) y el lector al terminar (backend/lector/menores.py).

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION sin_dni(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(regexp_replace(t, '\m10\d{9}\M', 'RUC omitido', 'g'), '\m\d{8}\M', 'DNI omitido', 'g')
$$;

-- Los contratos menores cuyos ítems traen su propio precio. prod6 manda en `precioTotal` lo cotizado por el ganador:
-- con varios ítems, muchas veces repite en cada uno el total del contrato (dos ítems de S/ 29 925 en un contrato de
-- S/ 29 925), y dividirlo por la cantidad de cada ítem daba un galón de gasolina a S/ 170. El precio por ítem vale sólo si
-- hay un ítem o si los ítems suman el monto del contrato (±2 %).
CREATE OR REPLACE VIEW menor_item_con_precio AS
  SELECT i.id_contrato
    FROM seace_menor_item i JOIN seace_menores m ON m.id_contrato = i.id_contrato
   WHERE m.monto > 0
   GROUP BY i.id_contrato, m.monto
  HAVING count(*) = 1 OR abs(sum(i.precio_total) - m.monto) <= 0.02 * m.monto;

CREATE OR REPLACE FUNCTION refrescar_menor_senales() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_menor_senales'));
  DROP TABLE IF EXISTS pg_temp._xm;
  CREATE TEMP TABLE _xm ON COMMIT DROP AS
    SELECT m.id_contrato, m.codigo, m.objeto, left(m.descripcion, 200) AS descripcion, m.entidad_ruc, m.proveedor_ruc,
           m.monto, m.fecha_suscripcion, COALESCE(m.anio::int, extract(year FROM m.fecha_suscripcion)::int) AS anio,
           8 * uit_soles(COALESCE(m.anio::int, extract(year FROM m.fecha_suscripcion)::int)) AS tope,
           m.fec_ini_cotizacion, m.fec_fin_cotizacion, m.tipo_invitacion, m.justif_invitacion
      FROM seace_menores m
     WHERE m.moneda = 'PEN' AND m.monto > 0;
  CREATE INDEX ON _xm (entidad_ruc, proveedor_ruc);
  ANALYZE _xm;

  DELETE FROM menor_senal;

  -- El tope: lo pasa, o queda al borde.
  INSERT INTO menor_senal (id_contrato, tipo, severidad, monto, detalle)
  SELECT id_contrato, 'menor_sobre_tope', 'alta', monto - tope, jsonb_build_object('tope', tope, 'monto', monto)
    FROM _xm WHERE monto > tope;
  INSERT INTO menor_senal (id_contrato, tipo, severidad, monto, detalle)
  SELECT id_contrato, 'menor_borde_tope', 'baja', monto,
         jsonb_build_object('tope', tope, 'monto', monto, 'pct', round(100 * monto / tope, 1))
    FROM _xm WHERE monto >= 0.95 * tope AND monto <= tope;

  -- Partido el mismo día: misma entidad, mismo proveedor, misma fecha; juntos pasan el tope.
  INSERT INTO menor_senal (id_contrato, tipo, severidad, monto, grupo, detalle)
  SELECT x.id_contrato, 'menor_partido_mismo_dia', 'alta', g.suma, g.grupo,
         jsonb_build_object('contratos', g.n, 'tope', g.tope, 'fecha', g.fecha_suscripcion)
    FROM (SELECT entidad_ruc, proveedor_ruc, fecha_suscripcion, count(*)::int AS n, sum(monto) AS suma, max(tope) AS tope,
                 jsonb_agg(jsonb_build_object('id', id_contrato, 'codigo', codigo, 'fecha', fecha_suscripcion, 'monto', monto,
                                              'descripcion', descripcion) ORDER BY monto DESC, id_contrato) AS grupo
            FROM _xm WHERE entidad_ruc IS NOT NULL AND proveedor_ruc IS NOT NULL AND fecha_suscripcion IS NOT NULL
           GROUP BY 1, 2, 3 HAVING count(*) >= 2 AND sum(monto) > max(tope)) g
    JOIN _xm x ON x.entidad_ruc = g.entidad_ruc AND x.proveedor_ruc = g.proveedor_ruc AND x.fecha_suscripcion = g.fecha_suscripcion;

  -- Partido en el año: mismo tipo, misma entidad, mismo proveedor, mismo año; juntos pasan el tope.
  INSERT INTO menor_senal (id_contrato, tipo, severidad, monto, grupo, detalle)
  SELECT x.id_contrato, 'menor_partido_en_el_anio', 'media', g.suma, g.grupo,
         jsonb_build_object('contratos', g.n, 'tope', g.tope, 'anio', g.anio, 'objeto', g.objeto,
                            'mismo_item', (SELECT max(c) FROM (SELECT count(DISTINCT i.id_contrato) AS c
                                                                 FROM seace_menor_item i JOIN _xm y ON y.id_contrato = i.id_contrato
                                                                WHERE y.entidad_ruc = g.entidad_ruc AND y.proveedor_ruc = g.proveedor_ruc
                                                                  AND y.objeto IS NOT DISTINCT FROM g.objeto AND y.anio = g.anio
                                                                  AND i.cubso IS NOT NULL
                                                                GROUP BY i.cubso HAVING count(DISTINCT i.id_contrato) >= 2) z))
    FROM (SELECT entidad_ruc, proveedor_ruc, objeto, anio, count(*)::int AS n, sum(monto) AS suma, max(tope) AS tope,
                 jsonb_agg(jsonb_build_object('id', id_contrato, 'codigo', codigo, 'fecha', fecha_suscripcion, 'monto', monto,
                                              'descripcion', descripcion) ORDER BY fecha_suscripcion, id_contrato) AS grupo
            FROM _xm WHERE entidad_ruc IS NOT NULL AND proveedor_ruc IS NOT NULL
           GROUP BY 1, 2, 3, 4 HAVING count(*) >= 2 AND sum(monto) > max(tope)) g
    JOIN _xm x ON x.entidad_ruc = g.entidad_ruc AND x.proveedor_ruc = g.proveedor_ruc
              AND x.objeto IS NOT DISTINCT FROM g.objeto AND x.anio = g.anio;

  -- La ventana para cotizar, en horas.
  INSERT INTO menor_senal (id_contrato, tipo, severidad, detalle)
  SELECT id_contrato, 'menor_ventana_corta', CASE WHEN h < 1 THEN 'alta' ELSE 'media' END,
         jsonb_build_object('horas', round(h, 1), 'desde', fec_ini_cotizacion, 'hasta', fec_fin_cotizacion)
    FROM (SELECT id_contrato, fec_ini_cotizacion, fec_fin_cotizacion,
                 extract(epoch FROM fec_fin_cotizacion - fec_ini_cotizacion) / 3600 AS h FROM _xm) v
   WHERE h >= 0 AND h < 4;

  INSERT INTO menor_senal (id_contrato, tipo, severidad, detalle)
  SELECT id_contrato, 'menor_invitacion_cerrada', 'media',
         jsonb_build_object('tipo', tipo_invitacion, 'justificacion', left(sin_dni(justif_invitacion), 600))
    FROM _xm WHERE tipo_invitacion IS NOT NULL AND upper(tipo_invitacion) NOT LIKE '%ABIERTA%';

  INSERT INTO menor_senal (id_contrato, tipo, severidad, detalle)
  SELECT id_contrato, 'menor_fin_de_semana', 'baja',
         jsonb_build_object('fecha', fecha_suscripcion, 'dia', CASE extract(isodow FROM fecha_suscripcion) WHEN 6 THEN 'sábado' ELSE 'domingo' END)
    FROM _xm WHERE extract(isodow FROM fecha_suscripcion) IN (6, 7);

  -- La orden (juntada por su número y su monto, 240 y 253) se emitió antes de que se publicara el pedido de cotizaciones:
  -- la compra ya estaba decidida y la cotización fue un trámite.
  INSERT INTO menor_senal (id_contrato, tipo, severidad, detalle)
  SELECT x.id_contrato, 'menor_orden_antes_de_cotizar', 'alta',
         jsonb_build_object('orden', left(sin_dni(v.orden), 120), 'emitida', v.fecha_emision, 'publicado', m.fec_publica,
                            'dias', m.fec_publica::date - v.fecha_emision)
    FROM _xm x
    JOIN seace_menores m ON m.id_contrato = x.id_contrato
    JOIN compra_vinculo v ON v.clase = 'menor' AND v.ref = x.id_contrato::text AND v.regla = 'numero'
   WHERE m.fec_publica IS NOT NULL AND v.fecha_emision < m.fec_publica::date;

  -- El precio de los bienes frente a lo que pagan las demás entidades (84), con las guardas del sobreprecio de los procesos.
  INSERT INTO menor_senal (id_contrato, tipo, severidad, monto, detalle)
  SELECT k.id_contrato, 'menor_precio_alto', CASE WHEN k.peor_razon >= 3 AND k.exceso >= 5000 THEN 'alta' ELSE 'media' END,
         round(k.exceso, 2), jsonb_build_object('items', k.items, 'exceso', round(k.exceso, 2), 'peor', k.peor)
    FROM (SELECT y.id_contrato, count(*)::int AS items, sum(y.exceso) AS exceso, max(y.razon) AS peor_razon,
                 (array_agg(jsonb_build_object('n', y.n, 'descripcion', left(y.descripcion, 200), 'cubso', y.cubso,
                                               'cantidad', y.cantidad, 'unidad', y.unidad, 'unitario', y.precio_unitario,
                                               'mediana', round(y.mediana, 4), 'p75', round(y.p75, 4), 'razon', y.razon,
                                               'entidades', y.entidades, 'anio', y.anio) ORDER BY y.exceso DESC))[1] AS peor
            FROM (SELECT i.id_contrato, i.n, COALESCE(i.cubso_nombre, i.descripcion) AS descripcion, i.cubso, i.cantidad,
                         i.unidad, i.precio_unitario, r.mediana, r.p75, r.entidades, r.anio,
                         precio_razon(i.precio_unitario, r.mediana) AS razon, (i.precio_unitario - r.p75) * i.cantidad AS exceso
                    FROM seace_menor_item i
                    JOIN _xm x ON x.id_contrato = i.id_contrato AND x.objeto = 'BIEN'
                    -- Con varios ítems, prod6 suele repetir en cada uno el TOTAL de la cotización: el precio por ítem
                    -- sólo vale si es uno solo o si los ítems suman el monto del contrato (menor_item_con_precio).
                    JOIN menor_item_con_precio ok ON ok.id_contrato = i.id_contrato
                    JOIN precio_referencia r ON r.cubso = i.cubso AND r.anio = x.anio AND r.base = 'adjudicado'
                                            AND upper(immutable_unaccent(r.unidad)) = upper(immutable_unaccent(i.unidad))
                   WHERE i.precio_unitario > 0 AND i.cantidad > 0
                     AND (i.cantidad > 1 OR (r.cant_mediana <= 1 AND r.p75 <= 4 * r.p25))
                     AND COALESCE(i.descripcion, '') !~* '(tarjeta|vale|cup[oó]n|ticket)s?\s+(de\s+)?(consumo|combustible|alimentos?|canje|compra)') y
           WHERE y.razon >= 2 AND y.razon <= 20 AND y.exceso >= 1000
           GROUP BY y.id_contrato) k;

  -- Lo leído en el requerimiento y en el contrato: sólo lo que encuentran las dos lecturas.
  INSERT INTO menor_senal (id_contrato, tipo, severidad, monto, detalle)
  SELECT a.id_contrato, b,
         CASE b WHEN 'tdr_proveedor_nombrado' THEN 'alta' WHEN 'contrato_ruc_distinto' THEN 'alta'
                WHEN 'tdr_experiencia_alta' THEN 'baja' ELSE 'media' END,
         CASE b WHEN 'contrato_monto_distinto' THEN abs(NULLIF(a.salida->>'monto_total', '')::numeric - m.monto)
                WHEN 'tdr_experiencia_alta' THEN NULLIF(a.salida->'perfil_proveedor'->>'experiencia_monto', '')::numeric
                WHEN 'tdr_monto_distinto' THEN NULLIF(a.salida->>'monto_estimado', '')::numeric END,
         jsonb_strip_nulls(jsonb_build_object(
           'documento', CASE a.clase WHEN 'menor_tdr' THEN 'requerimiento' ELSE 'contrato u orden' END,
           'lector', a.clase || ' ' || a.version || ' + ' || z.version, 'modelo', a.modelo,
           'registrado', m.monto,
           'marcas', CASE WHEN b = 'tdr_marca_sin_equivalente' THEN (
                       SELECT jsonb_agg(jsonb_build_object('marca', k->>'marca', 'cita', left(sin_dni(k->>'cita'), 300)))
                         FROM jsonb_array_elements(COALESCE(a.salida->'marcas', '[]')) k
                        WHERE NOT COALESCE((k->>'con_equivalente')::boolean, false)) END,
           'cita', CASE b WHEN 'tdr_proveedor_nombrado' THEN left(sin_dni(a.salida->'proveedor_nombrado'->>'cita'), 300)
                          WHEN 'tdr_experiencia_alta' THEN left(sin_dni(a.salida->'perfil_proveedor'->>'cita'), 300) END,
           'estimado', CASE WHEN b = 'tdr_monto_distinto' THEN a.salida->'monto_estimado' END,
           'en_documento', CASE WHEN b = 'contrato_monto_distinto' THEN a.salida->'monto_total' END,
           'tipo_documento', CASE WHEN a.clase = 'menor_contrato' THEN a.salida->>'tipo_documento' END,
           'numero', CASE WHEN a.clase = 'menor_contrato' THEN left(sin_dni(a.salida->>'numero'), 80) END,
           'ruc_en_documento', CASE WHEN b = 'contrato_ruc_distinto' AND a.salida->>'proveedor_ruc' LIKE '20%'
                                    THEN a.salida->>'proveedor_ruc' END))
    FROM menor_lectura a
    JOIN menor_lectura z ON z.id_contrato = a.id_contrato AND z.clase = a.clase AND z.version = a.version || '-2' AND z.estado = 'ok'
    JOIN seace_menores m ON m.id_contrato = a.id_contrato
    CROSS JOIN LATERAL unnest(a.banderas) b
   WHERE a.version = 'v1' AND a.estado = 'ok' AND a.clase IN ('menor_tdr', 'menor_contrato') AND b = ANY (z.banderas)
  ON CONFLICT (id_contrato, tipo) DO NOTHING;

  SELECT count(*) INTO n FROM menor_senal;
  RETURN n;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER FUNCTION refrescar_menor_senales() OWNER TO vigia_jobs;
    ALTER FUNCTION sin_dni(text) OWNER TO vigia_jobs;
    ALTER VIEW menor_item_con_precio OWNER TO vigia_jobs;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_api') THEN
    GRANT SELECT ON menor_item_con_precio TO vigia_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_api_admin') THEN
    GRANT SELECT ON menor_item_con_precio TO vigia_api_admin;
  END IF;
END $$;

SELECT refrescar_menor_senales();
