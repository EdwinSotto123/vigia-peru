-- 253 · La orden de pago de los contratos menores registrados tarde en el SEACE, y la señal de la orden anterior a la
-- cotización.
--
-- Sólo 3 886 de los 11 015 contratos menores tenían su orden (compra_vinculo, 240). refrescar_compras buscaba la orden de
-- 20 días antes a 60 después de la firma que registra el SEACE (prod4), pero muchas entidades registran el contrato
-- meses después de emitir la orden: de mayo a setiembre de 2026, 1 971 contratos menores sin vínculo tienen una orden de
-- CONOSCE con el MISMO número y el MISMO monto, la mitad con más de 3 meses de diferencia (1 460 de Talara). Ahora la orden
-- puede ser hasta un año anterior cuando coinciden el número y el monto (los dos), y el menor puede caer en el año
-- siguiente al de la orden.
--
-- Con la orden juntada por su número se ve cuándo se compró de verdad: si la orden se emitió ANTES de que se publicara el
-- pedido de cotizaciones, la compra ya estaba decidida y la cotización fue un trámite (menor_orden_antes_de_cotizar,
-- alta, en refrescar_menor_senales; 65 casos en la medición del 2026-11-05).
--
-- Después de aplicarla: SELECT refrescar_compras('2025-01-01', current_date); SELECT refrescar_menor_senales();

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.refrescar_compras(p_desde date DEFAULT NULL, p_hasta date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_anio_ini integer := extract(year FROM COALESCE(p_desde, current_date))::int;
  v_anio_fin integer := extract(year FROM COALESCE(p_hasta, current_date))::int;
  -- Las órdenes: los años enteros, desde 2018 (CONOSCE) y hasta un mes adelante, como la lista.
  v_ini date := greatest(make_date(v_anio_ini, 1, 1), DATE '2018-01-01');
  v_fin date := least(make_date(v_anio_fin, 12, 31), current_date + 31);
  n_cat integer := 0; n_men integer := 0; n_pro integer := 0; n integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_compras'));
  SET LOCAL work_mem = '256MB';

  DELETE FROM compra_vinculo WHERE fecha_emision BETWEEN v_ini AND v_fin;

  -- Las órdenes de esos años, cada una una vez (su versión del archivo más nuevo), con su número.
  DROP TABLE IF EXISTS _co;
  CREATE TEMP TABLE _co ON COMMIT DROP AS
  SELECT DISTINCT ON (entidad_ruc, orden, fecha_emision)
         entidad_ruc, orden, fecha_emision, ruc_contratista, tipo_orden ILIKE '%compra%' AS de_compra, tipo_contratacion,
         COALESCE(monto, monto_dudoso) AS monto, monto_dudoso IS NULL AS monto_bueno,
         norm_nro_orden(nro_orden, extract(year FROM fecha_emision)::int) AS n
    FROM conosce_ordenes
   WHERE fecha_emision BETWEEN v_ini AND v_fin
     AND moneda = 'Nuevos Soles' AND estado IS DISTINCT FROM 'Anulada' AND (monto > 0 OR monto_dudoso IS NOT NULL)
     AND entidad_ruc ~ '^[0-9]{11}$'
   ORDER BY entidad_ruc, orden, fecha_emision, anio DESC, mes DESC;
  CREATE INDEX ON _co (entidad_ruc, ruc_contratista, fecha_emision);
  ANALYZE _co;

  IF v_ini <= v_fin THEN
    -- 1. Catálogo: las órdenes de Perú Compras de esas fechas (±60 días) que no quedaron juntas con una orden de otro año.
    DROP TABLE IF EXISTS _cp;
    CREATE TEMP TABLE _cp ON COMMIT DROP AS
    SELECT p.orden AS ref, p.entidad_ruc, p.proveedor_ruc, p.tipo = 'BIENES' AS de_compra, p.total AS monto,
           p.fecha_publicacion AS f, norm_nro_orden(p.nro_orden_fisica, extract(year FROM p.fecha_publicacion)::int) AS n
      FROM perucompras_orden p
     WHERE p.fecha_publicacion BETWEEN v_ini - 60 AND v_fin + 60
       AND p.estado NOT IN ('ORDEN DE COMPRA NULA', 'RECHAZADA') AND p.entidad_ruc IS NOT NULL AND p.proveedor_ruc IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM compra_vinculo v WHERE v.clase = 'catalogo' AND v.ref = p.orden);
    -- 2. Menores: el número del contrato es el de su orden.
    INSERT INTO _cp
    SELECT 'M' || m.id_contrato, m.entidad_ruc, m.proveedor_ruc, m.objeto ILIKE 'BIEN%', m.monto, m.fecha_suscripcion,
           norm_nro_orden(m.numero_contrato, extract(year FROM m.fecha_suscripcion)::int)
      FROM seace_menores m
     WHERE m.fecha_suscripcion BETWEEN v_ini - 60 AND v_fin + 365 AND m.monto > 0
       AND m.entidad_ruc IS NOT NULL AND m.proveedor_ruc IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM compra_vinculo v WHERE v.clase = 'menor' AND v.ref = m.id_contrato::text);
    ANALYZE _cp;

    -- Las parejas posibles: por número (rk 1) o, sin él, por monto (rk 2). Del catálogo, la orden puede ser anterior o
    -- posterior a la publicación; del menor, de 20 días antes a 60 después de suscrito.
    DROP TABLE IF EXISTS _cc;
    CREATE TEMP TABLE _cc ON COMMIT DROP AS
    SELECT p.ref, o.entidad_ruc, o.orden, o.fecha_emision, o.ruc_contratista,
           CASE WHEN p.n IS NOT NULL AND o.n = p.n THEN 1 ELSE 2 END AS rk,
           CASE WHEN o.de_compra = p.de_compra THEN 0 ELSE 1 END AS otro_tipo,
           abs(o.monto - p.monto) AS dif, abs(o.fecha_emision - p.f) AS dias
      FROM _cp p
      JOIN _co o ON o.entidad_ruc = p.entidad_ruc AND o.ruc_contratista = p.proveedor_ruc
                AND o.fecha_emision BETWEEN p.f - CASE WHEN p.ref LIKE 'M%' THEN 365 ELSE 60 END AND p.f + 60
     -- 253: un menor puede registrarse en el SEACE meses después de su orden (Talara registró 1 460 así en 2026): más de
     -- 20 días antes de la firma registrada, sólo si coinciden el número Y el monto.
     WHERE (p.n IS NOT NULL AND o.n = p.n
            AND (p.ref NOT LIKE 'M%' OR o.fecha_emision >= p.f - 20 OR abs(o.monto - p.monto) <= 1))
        OR (abs(o.monto - p.monto) <= 1 AND o.fecha_emision BETWEEN p.f - CASE WHEN p.ref LIKE 'M%' THEN 20 ELSE 45 END AND p.f + 45);

    -- Uno a uno: la mejor orden de cada compra y, de las que quedan, la mejor compra de cada orden. Dos vueltas: una compra
    -- que perdió su mejor orden toma la siguiente.
    FOR i IN 1..2 LOOP
      INSERT INTO compra_vinculo (entidad_ruc, orden, fecha_emision, proveedor_ruc, clase, ref, candidatos, regla)
      SELECT b.entidad_ruc, b.orden, b.fecha_emision, b.ruc_contratista,
             CASE WHEN b.ref LIKE 'M%' THEN 'menor' ELSE 'catalogo' END,
             CASE WHEN b.ref LIKE 'M%' THEN substr(b.ref, 2) ELSE b.ref END, 1,
             CASE b.rk WHEN 1 THEN 'numero' ELSE 'monto' END
        FROM (SELECT DISTINCT ON (a.entidad_ruc, a.orden, a.fecha_emision) a.*
                FROM (SELECT DISTINCT ON (c.ref) c.*
                        FROM _cc c
                       WHERE NOT EXISTS (SELECT 1 FROM compra_vinculo v
                                          WHERE v.entidad_ruc = c.entidad_ruc AND v.orden = c.orden AND v.fecha_emision = c.fecha_emision)
                         AND NOT EXISTS (SELECT 1 FROM compra_vinculo v
                                          WHERE v.clase = CASE WHEN c.ref LIKE 'M%' THEN 'menor' ELSE 'catalogo' END
                                            AND v.ref = CASE WHEN c.ref LIKE 'M%' THEN substr(c.ref, 2) ELSE c.ref END)
                       ORDER BY c.ref, c.rk, c.otro_tipo, c.dif, c.dias, c.orden) a
               ORDER BY a.entidad_ruc, a.orden, a.fecha_emision, a.rk, a.otro_tipo, a.dif, a.dias, a.ref) b
      ON CONFLICT DO NOTHING;
    END LOOP;
    SELECT count(*) FILTER (WHERE clase = 'catalogo'), count(*) FILTER (WHERE clase = 'menor') INTO n_cat, n_men
      FROM compra_vinculo WHERE fecha_emision BETWEEN v_ini AND v_fin;

    -- 3. Pagos de procesos: los procesos que esa empresa ganó en esa entidad en los 3 años previos a la orden.
    DROP TABLE IF EXISTS _ca;
    CREATE TEMP TABLE _ca ON COMMIT DROP AS
    SELECT entidad_ruc, ruc_proveedor, codigo_convocatoria, min(fecha_buenapro) AS f
      FROM conosce_adjudicaciones
     WHERE ruc_proveedor IS NOT NULL AND entidad_ruc IS NOT NULL AND codigo_convocatoria IS NOT NULL
       AND fecha_buenapro BETWEEN v_ini - 1095 AND v_fin
     GROUP BY 1, 2, 3;
    CREATE INDEX ON _ca (entidad_ruc, ruc_proveedor, f);
    ANALYZE _ca;
    INSERT INTO compra_vinculo (entidad_ruc, orden, fecha_emision, proveedor_ruc, clase, ref, candidatos, regla)
    SELECT o.entidad_ruc, o.orden, o.fecha_emision, o.ruc_contratista, 'proceso',
           CASE WHEN count(DISTINCT a.codigo_convocatoria) = 1 THEN min(a.codigo_convocatoria) END,
           least(count(DISTINCT a.codigo_convocatoria), 32767),
           CASE WHEN count(DISTINCT a.codigo_convocatoria) = 1 THEN 'unico' ELSE 'varios' END
      FROM _co o
      JOIN _ca a ON a.entidad_ruc = o.entidad_ruc AND a.ruc_proveedor = o.ruc_contratista
                AND a.f <= o.fecha_emision AND a.f >= o.fecha_emision - 1095
     WHERE o.tipo_contratacion ~* '^deviene de'
       AND NOT EXISTS (SELECT 1 FROM compra_vinculo v
                        WHERE v.entidad_ruc = o.entidad_ruc AND v.orden = o.orden AND v.fecha_emision = o.fecha_emision)
     GROUP BY 1, 2, 3, 4;
    GET DIAGNOSTICS n_pro = ROW_COUNT;
  END IF;

  -- 4. El resumen de esos años: cada compra una vez. Una orden junta con un catálogo o un menor cuenta en esa compra;
  -- un pago con algún proceso posible, en el proceso. Los procesos, por su convocatoria (como la lista de contratos).
  DELETE FROM compra_resumen WHERE anio BETWEEN v_anio_ini AND v_anio_fin OR anio = 0;
  INSERT INTO compra_resumen (entidad_ruc, clase, anio, compras, monto)
  SELECT entidad_ruc, clase, anio, count(*)::int, COALESCE(sum(monto), 0)
    FROM (
      SELECT o.entidad_ruc, clase_orden(o.tipo_contratacion) AS clase, extract(year FROM o.fecha_emision)::int AS anio,
             CASE WHEN o.monto_bueno THEN o.monto END AS monto
        FROM _co o
       WHERE NOT EXISTS (SELECT 1 FROM compra_vinculo v
                          WHERE v.entidad_ruc = o.entidad_ruc AND v.orden = o.orden AND v.fecha_emision = o.fecha_emision)
      UNION ALL
      SELECT p.entidad_ruc, 'catalogo', extract(year FROM p.fecha_publicacion)::int,
             CASE WHEN p.estado NOT IN ('ORDEN DE COMPRA NULA', 'RECHAZADA') THEN p.total END
        FROM perucompras_orden p
       WHERE p.entidad_ruc IS NOT NULL
         AND p.fecha_publicacion >= make_date(v_anio_ini, 1, 1) AND p.fecha_publicacion < make_date(v_anio_fin + 1, 1, 1)
      UNION ALL
      SELECT m.entidad_ruc, 'menor', extract(year FROM m.fecha_suscripcion)::int, m.monto
        FROM seace_menores m
       WHERE m.monto > 0 AND m.entidad_ruc IS NOT NULL
         AND m.fecha_suscripcion >= make_date(v_anio_ini, 1, 1) AND m.fecha_suscripcion < make_date(v_anio_fin + 1, 1, 1)
      UNION ALL
      SELECT ce.entidad_ruc, 'proceso', COALESCE(extract(year FROM ce.fecha_convocatoria)::int, 0),
             COALESCE(av.monto, ce.monto)
        FROM contrato_estado ce
        LEFT JOIN adjudicado_vigente av ON av.ocid = ce.ocid
       WHERE ce.ocid NOT LIKE 'ocds-vigia-%' AND ce.entidad_ruc IS NOT NULL
         AND (ce.fecha_convocatoria IS NULL
              OR (ce.fecha_convocatoria >= make_date(v_anio_ini, 1, 1) AND ce.fecha_convocatoria < make_date(v_anio_fin + 1, 1, 1)))
    ) x
   GROUP BY 1, 2, 3;
  GET DIAGNOSTICS n = ROW_COUNT;

  DROP TABLE IF EXISTS _co; DROP TABLE IF EXISTS _cp; DROP TABLE IF EXISTS _cc; DROP TABLE IF EXISTS _ca;
  RETURN jsonb_build_object('desde', v_anio_ini, 'hasta', v_anio_fin, 'catalogo', n_cat, 'menor', n_men, 'proceso', n_pro, 'resumen', n);
END $$;
