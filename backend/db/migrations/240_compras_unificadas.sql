-- 240: una sola lista de compras, sin repetidas (2026-11-03).
--
-- La pestaña de compras de una entidad (y las ventas de una empresa) mostraba cuatro listas que se repiten entre sí:
-- Contratos (procesos de selección, OCDS), Órdenes (CONOSCE), Menores (SEACE ≤ 8 UIT) y Catálogo (Perú Compras). Una
-- compra por catálogo deja su orden en Perú Compras y otra en el SEACE; un contrato menor, su contrato y su orden; un
-- proceso de selección se paga con órdenes. Esta migración junta cada compra con su orden del SEACE para que la lista
-- muestre una fila por compra:
--   · catálogo ↔ orden: el número de la orden en la entidad (perucompras_orden.nro_orden_fisica ↔ nro_orden), misma
--     entidad y proveedor, ±60 días; si no, el mismo monto (±S/ 1) y ±45 días. Medido en DEV (ene-jun 2025): 63 % por
--     número (98 % con el mismo monto) y 3 % más por monto; el resto la entidad no la registró en el SEACE.
--   · menor ↔ orden: seace_menores.numero_contrato ES el número de la orden («O/S Nº 639», «2026001245»).
--   · proceso ↔ orden: las órdenes «Deviene de procesos de selección / exoneraciones / regímenes especiales» son pagos
--     (muchas veces parciales). Se buscan los procesos que esa empresa ganó en esa entidad en los 3 años previos
--     (conosce_adjudicaciones): con uno solo, el pago es de ese proceso; con varios no se sabe de cuál (55 % de los casos,
--     y por monto exacto sólo el 4 %) y se guarda cuántos son. Sin ninguno (21 %), la orden queda como «pago de contrato».
-- Cada orden se junta con una sola compra y cada compra con una sola orden (la más cercana en fecha, primero por número).
--
--   compra_vinculo  la orden del SEACE (su llave efectiva: entidad, orden, fecha de emisión) y con qué se juntó.
--   compra_resumen  por entidad, forma de compra y año: cuántas compras (cada una una vez) y por cuánto. Es el número de
--                   la pestaña y de sus filtros. Las empresas se cuentan en vivo (tienen índice por proveedor).
--   refrescar_compras(desde, hasta)  rehace los años enteros de esas fechas (sin ellas, el año en curso).
--
-- Cómo aplicarla (DEV: bash infrastructure/deploy/dev.sh migrar backend/db/migrations/240_compras_unificadas.sql) y su
-- primer cálculo, un año por vez (cada año recorre millones de órdenes): python backend/scripts/aplicar_240.py dev|prod.
-- Después la llaman el Worker de scrapers tras cargar las órdenes de los sábados (conosce_ordenes.ts: el año en curso y
-- el anterior; ahí quedan juntos también los menores que llegaron el martes) y backend/scripts/cargar_perucompras.py al
-- terminar. Cada año tarda unos 4 minutos.

-- El número de una orden, como lo escriben los dos sistemas: el primer número sin ceros a la izquierda y sin el año
-- delante («OC. N° 1758 - 2026» → 1758, «O0C 525-2025» → 525, «OC-000229» → 229, «2026001245» → 1245). La misma regla
-- que numeroOrden() de la web (components/ordenes/ExpedienteSiaf.tsx).
CREATE OR REPLACE FUNCTION public.norm_nro_orden(t text, anio integer)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(ltrim(CASE WHEN length(d) >= 8 AND left(d, 4) = anio::text THEN substr(d, 5) ELSE d END, '0'), '')
    FROM (SELECT substring(t FROM '[1-9][0-9]*') AS d) x
$$;

CREATE TABLE IF NOT EXISTS compra_vinculo (
  entidad_ruc   text NOT NULL,
  orden         text NOT NULL,             -- conosce_ordenes.orden («O/C-846-2025-SUB GERENCIA DE …»)
  fecha_emision date NOT NULL,
  proveedor_ruc text,
  clase         text NOT NULL CHECK (clase IN ('catalogo', 'menor', 'proceso')),
  ref           text,                      -- perucompras_orden.orden | seace_menores.id_contrato | codigo_convocatoria (NULL con varios)
  candidatos    smallint NOT NULL DEFAULT 1, -- procesos que pudo pagar (1 en catálogo y menor)
  regla         text NOT NULL,             -- numero | monto | unico | varios
  PRIMARY KEY (entidad_ruc, orden, fecha_emision)
);
CREATE INDEX IF NOT EXISTS compra_vinculo_ref ON compra_vinculo (clase, ref) WHERE ref IS NOT NULL;
-- Los pagos con varios procesos posibles, para el panel de cada proceso (misma entidad y ganador).
CREATE INDEX IF NOT EXISTS compra_vinculo_pagos ON compra_vinculo (entidad_ruc, proveedor_ruc, fecha_emision) WHERE clase = 'proceso';

CREATE TABLE IF NOT EXISTS compra_resumen (
  entidad_ruc text NOT NULL,
  clase       text NOT NULL,               -- proceso | catalogo | menor | directa | pago
  anio        smallint NOT NULL,           -- 0: sin fecha
  compras     integer NOT NULL,
  monto       numeric(18, 2) NOT NULL,
  PRIMARY KEY (entidad_ruc, clase, anio)
);

-- Las órdenes de las dos formas raras (pago de un proceso: ~6 %; compra por catálogo: ~2 %), para el filtro «Cómo se
-- compró» de la lista: sin estos índices parciales, buscarlas en una entidad grande recorría todas sus órdenes (20 s). La
-- lista las pide con estas mismas expresiones (routes/compras.ts). CREATE INDEX sin CONCURRENTLY: deja leer, frena sólo la
-- carga de órdenes (los sábados) mientras se arma cada uno, unos minutos.
CREATE INDEX IF NOT EXISTS conosce_ordenes_ent_pago ON conosce_ordenes (entidad_ruc, fecha_emision DESC)
  WHERE tipo_contratacion ~* '^deviene de';
CREATE INDEX IF NOT EXISTS conosce_ordenes_ent_catalogo ON conosce_ordenes (entidad_ruc, fecha_emision DESC)
  WHERE tipo_contratacion ~* '^derivad[oa] de contrataci.n por cat.logo';
CREATE INDEX IF NOT EXISTS conosce_ordenes_prov_pago ON conosce_ordenes (ruc_contratista, fecha_emision DESC)
  WHERE tipo_contratacion ~* '^deviene de';
CREATE INDEX IF NOT EXISTS conosce_ordenes_prov_catalogo ON conosce_ordenes (ruc_contratista, fecha_emision DESC)
  WHERE tipo_contratacion ~* '^derivad[oa] de contrataci.n por cat.logo';

-- Cómo se contrató una orden que no se juntó con nada (las mismas expresiones que COMO_ORDEN de routes/ordenes.ts).
CREATE OR REPLACE FUNCTION public.clase_orden(tipo_contratacion text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN tipo_contratacion ~* '^deviene de' THEN 'pago'
              WHEN tipo_contratacion ~* '^derivad[oa] de contrataci.n por cat.logo' THEN 'catalogo'
              ELSE 'directa' END
$$;

/** Rehace los vínculos y el resumen de los años enteros entre p_desde y p_hasta (sin p_hasta, hasta hoy; sin p_desde, el
    año en curso). Repetirla no duplica nada. Devuelve cuántas órdenes se juntaron con cada cosa. */
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
     WHERE m.fecha_suscripcion BETWEEN v_ini - 60 AND v_fin + 20 AND m.monto > 0
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
                AND o.fecha_emision BETWEEN p.f - CASE WHEN p.ref LIKE 'M%' THEN 20 ELSE 60 END AND p.f + 60
     WHERE (p.n IS NOT NULL AND o.n = p.n)
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

REVOKE EXECUTE ON FUNCTION public.refrescar_compras(date, date) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE compra_vinculo OWNER TO vigia_jobs;
    ALTER TABLE compra_resumen OWNER TO vigia_jobs;
    GRANT EXECUTE ON FUNCTION public.refrescar_compras(date, date) TO vigia_jobs;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_api') THEN
    GRANT SELECT ON compra_vinculo, compra_resumen TO vigia_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_api_admin') THEN
    GRANT SELECT ON compra_vinculo, compra_resumen TO vigia_api_admin;
  END IF;
END $$;
