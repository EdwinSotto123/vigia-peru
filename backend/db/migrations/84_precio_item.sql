-- 84 · Precios por ítem: cuánto se presupuestó y cuánto se pagó por cada ítem, y con qué compararlo.
--
-- Hasta ahora el precio unitario sólo lo veían los agentes, en los contratos financiados. El OCDS del OECE ya trae los
-- ítems de cada proceso desde 2015 (cantidad, unidad, valor referencial y código CUBSO) y CONOSCE, desde 2018, lo
-- adjudicado por ítem. Juntos dan un precio unitario por ítem para los ~830 mil contratos, sin leer un PDF:
--
--   · precio_item: un ítem del OCDS por fila, con lo adjudicado de CONOSCE (por código de convocatoria y número de ítem);
--     si CONOSCE no lo tiene, lo adjudicado del ítem en el OCDS; y en un proceso de un solo ítem con una sola
--     adjudicación, el monto de esa adjudicación. Sólo soles.
--   · precio_referencia: por código CUBSO, unidad y año (con el año anterior), el p25, la mediana y el p75 del precio
--     unitario de las demás compras del Estado, desde 5 entidades distintas. Una base con lo adjudicado y otra con lo
--     presupuestado (para los procesos que aún no se adjudican).
--   · cruce `sobreprecio` (cruces_proveedor, con ocid): bienes cuyo precio adjudicado pasa 1,5 veces la mediana y deja
--     más de S/ 5 mil sobre el p75. Más de 20 veces la mediana no cuenta: casi siempre es una cantidad o una unidad mal
--     cargada en la fuente.
--
-- refrescar_precio_item() lo llaman oece_ocds, conosce y conosce_ordenes (comun.ts, antes de los casos cruzados). Es
-- incremental: rehace los ítems de los contratos que cambiaron desde la última corrida (leer los payloads enteros son
-- 3,6 GB y tardaba más que el corte de ~10 min de Hyperdrive), aplica lo nuevo de CONOSCE y rehace las referencias y el
-- cruce. refrescar_precio_item(true) lo rehace todo.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/84_precio_item.sql
-- y después, una vez y fuera de Hyperdrive, año por año (cada uno en su transacción, con la memoria acotada):
--   DELETE FROM precio_item;  SELECT cargar_precio_item(<año>, NULL);  -- 2015 … hoy
--   SELECT refrescar_precio_referencia();  INSERT INTO precio_item_estado VALUES (1, now());

CREATE TABLE IF NOT EXISTS precio_item (
  ocid               TEXT NOT NULL,
  posicion           INT NOT NULL,
  codigo             TEXT,
  entidad_ruc        TEXT,
  departamento       TEXT,
  fecha              DATE,
  anio               SMALLINT,
  objeto             TEXT,          -- categoría del OCDS: goods | services | works
  cubso              TEXT,
  descripcion        TEXT,
  unidad             TEXT,
  cantidad           NUMERIC,
  referencial        NUMERIC,
  adjudicado         NUMERIC,
  fuente_adjudicado  TEXT,          -- conosce | ocds | proceso (un solo ítem y una sola adjudicación)
  ruc_proveedor      TEXT,
  proveedor          TEXT,
  unit_ref           NUMERIC,
  unit_adj           NUMERIC,
  PRIMARY KEY (ocid, posicion)
);
CREATE TABLE IF NOT EXISTS precio_referencia (
  cubso      TEXT NOT NULL,
  unidad     TEXT NOT NULL,
  anio       SMALLINT NOT NULL,
  base       TEXT NOT NULL CHECK (base IN ('adjudicado', 'referencial')),
  n          INT NOT NULL,
  entidades  INT NOT NULL,
  p25        NUMERIC NOT NULL,
  mediana    NUMERIC NOT NULL,
  p75        NUMERIC NOT NULL,
  cant_mediana NUMERIC,      -- cantidad típica del grupo: si es > 1, un ítem de cantidad 1 suele ser un lote
  PRIMARY KEY (cubso, unidad, anio, base)
);
ALTER TABLE precio_referencia ADD COLUMN IF NOT EXISTS cant_mediana NUMERIC;
ALTER TABLE precio_item OWNER TO vigia_jobs;
ALTER TABLE precio_referencia OWNER TO vigia_jobs;
GRANT SELECT ON precio_item, precio_referencia TO vigia_api, vigia_api_admin, vigia_mcp, vigia_agentes;

-- Lo que un precio unitario dice frente a su referencia: NULL si no hay con qué comparar.
CREATE OR REPLACE FUNCTION precio_razon(p_unit NUMERIC, p_mediana NUMERIC) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN p_unit > 0 AND p_mediana > 0 THEN round(p_unit / p_mediana, 3) END $$;
ALTER FUNCTION precio_razon(NUMERIC, NUMERIC) OWNER TO vigia_jobs;
GRANT EXECUTE ON FUNCTION precio_razon(NUMERIC, NUMERIC) TO vigia_api, vigia_api_admin;

-- Desde dónde rehacer los ítems: la última corrida (incremental) o todo (p_completo).
CREATE TABLE IF NOT EXISTS precio_item_estado (
  id       INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ultima   TIMESTAMPTZ NOT NULL
);
ALTER TABLE precio_item_estado OWNER TO vigia_jobs;
CREATE INDEX IF NOT EXISTS precio_item_codigo ON precio_item (codigo, posicion);
CREATE INDEX IF NOT EXISTS precio_item_grupo ON precio_item (cubso, unidad, anio);
CREATE INDEX IF NOT EXISTS precio_item_ruc ON precio_item (ruc_proveedor);
DROP FUNCTION IF EXISTS refrescar_precio_item();
DROP FUNCTION IF EXISTS refrescar_precio_item(BOOLEAN);

-- Memoria acotada: con 1-2 GB de RAM, sorts grandes en paralelo tumbaron la base DEV (2026-10-20).
CREATE OR REPLACE FUNCTION _precio_memoria() RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('work_mem', '32MB', true), set_config('max_parallel_workers_per_gather', '0', true)
$$;
ALTER FUNCTION _precio_memoria() OWNER TO vigia_jobs;

-- Los ítems de los contratos de un año (p_anio) o de los que cambiaron desde p_desde: se borran y se vuelven a armar.
-- Lo adjudicado sale de CONOSCE (por código y número de ítem), del OCDS (records completos) o, en un proceso de un
-- solo ítem con una sola adjudicación, de esa adjudicación. Sólo soles.
CREATE OR REPLACE FUNCTION cargar_precio_item(p_anio INT, p_desde TIMESTAMPTZ) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  PERFORM _precio_memoria();
  -- 1 · Una sola pasada por los payloads (leerlos enteros es lo caro): sólo ítems y adjudicaciones.
  DROP TABLE IF EXISTS _pc;
  CREATE TEMP TABLE _pc ON COMMIT DROP AS
    SELECT c.ocid, c.codigo, c.entidad_ruc::text AS entidad_ruc, c.fecha_convocatoria AS fecha, c.categoria AS objeto,
           c.ocds_payload->'tender'->'items' AS items,
           CASE WHEN jsonb_typeof(c.ocds_payload->'awards') = 'array' THEN c.ocds_payload->'awards' END AS awards,
           COALESCE(c.ocds_payload->'awards', c.adjudicaciones) AS adjudicaciones
    FROM convocatorias c
    WHERE c.ocid NOT LIKE 'ocds-vigia-%' AND jsonb_typeof(c.ocds_payload->'tender'->'items') = 'array'
      AND (p_anio IS NULL OR (c.fecha_convocatoria >= make_date(p_anio, 1, 1) AND c.fecha_convocatoria < make_date(p_anio + 1, 1, 1)))
      AND (p_desde IS NULL OR c.updated_at >= p_desde);
  ANALYZE _pc;

  DROP TABLE IF EXISTS _pi;
  CREATE TEMP TABLE _pi ON COMMIT DROP AS
    SELECT c.ocid, COALESCE(NULLIF(i->>'position', '')::int, o.ord::int) AS posicion, c.codigo, c.entidad_ruc,
           left(e.ubigeo::text, 2) AS departamento, c.fecha, extract(year FROM c.fecha)::smallint AS anio, c.objeto,
           NULLIF(i->'classification'->>'id', '') AS cubso, i->>'description' AS descripcion, NULLIF(i->'unit'->>'name', '') AS unidad,
           CASE WHEN jsonb_typeof(i->'quantity') = 'number' THEN (i->>'quantity')::numeric END AS cantidad,
           CASE WHEN jsonb_typeof(i->'totalValue'->'amount') = 'number' THEN (i->'totalValue'->>'amount')::numeric END AS referencial,
           i->>'id' AS item_id, jsonb_array_length(c.items) AS n_items
    FROM _pc c
    LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
    CROSS JOIN LATERAL jsonb_array_elements(c.items) WITH ORDINALITY o(i, ord)
    WHERE COALESCE(i->'totalValue'->>'currency', 'PEN') = 'PEN';
  CREATE INDEX ON _pi (codigo, posicion);
  ANALYZE _pi;

  DROP TABLE IF EXISTS _po;
  CREATE TEMP TABLE _po ON COMMIT DROP AS
    SELECT c.ocid, it->>'id' AS item_id, sum((it->'totalValue'->>'amount')::numeric) AS monto,
           min(regexp_replace(aw->'suppliers'->0->>'id', '^PE-RUC-', '')) AS ruc, min(aw->'suppliers'->0->>'name') AS proveedor
    FROM _pc c, jsonb_array_elements(c.awards) aw, jsonb_array_elements(aw->'items') it
    WHERE c.awards IS NOT NULL AND jsonb_typeof(it->'totalValue'->'amount') = 'number'
      AND COALESCE(it->'totalValue'->>'currency', 'PEN') = 'PEN'
    GROUP BY 1, 2;
  DROP TABLE IF EXISTS _pu;
  CREATE TEMP TABLE _pu ON COMMIT DROP AS
    SELECT c.ocid, (array_agg((aw->'value'->>'amount')::numeric))[1] AS monto,
           (array_agg(regexp_replace(aw->'suppliers'->0->>'id', '^PE-RUC-', '')))[1] AS ruc, (array_agg(aw->'suppliers'->0->>'name'))[1] AS proveedor
    FROM _pc c, jsonb_array_elements(c.adjudicaciones) aw
    WHERE jsonb_array_length(c.items) = 1 AND jsonb_typeof(c.adjudicaciones) = 'array'
      AND jsonb_typeof(aw->'value'->'amount') = 'number' AND COALESCE(aw->'value'->>'currency', 'PEN') = 'PEN'
    GROUP BY c.ocid HAVING count(*) = 1;
  CREATE INDEX ON _po (ocid, item_id);
  CREATE INDEX ON _pu (ocid);

  -- 2 · Lo de CONOSCE sólo para los códigos de esta tanda (el agregado entero se hace en refrescar_precio_item).
  DROP TABLE IF EXISTS _pa;
  CREATE TEMP TABLE _pa ON COMMIT DROP AS
    SELECT a.codigo_convocatoria::text AS codigo, a.n_item AS posicion, sum(a.monto_adjudicado) AS monto,
           (array_agg(a.ruc_proveedor ORDER BY a.monto_adjudicado DESC NULLS LAST))[1] AS ruc,
           (array_agg(a.proveedor ORDER BY a.monto_adjudicado DESC NULLS LAST))[1] AS proveedor
    FROM conosce_adjudicaciones a
    WHERE a.codigo_convocatoria::text IN (SELECT DISTINCT codigo FROM _pc)
      AND a.monto_adjudicado > 0 AND COALESCE(a.moneda, 'Soles') ~* 'soles'   -- Soles y Nuevos Soles
    GROUP BY 1, 2;
  CREATE INDEX ON _pa (codigo, posicion);

  -- 3 · Los ítems de esta tanda, de nuevo (MVCC: quien lee ve los anteriores hasta el final).
  DELETE FROM precio_item p USING _pc c WHERE p.ocid = c.ocid;
  INSERT INTO precio_item
  SELECT DISTINCT ON (p.ocid, p.posicion)
         p.ocid, p.posicion, p.codigo, p.entidad_ruc, p.departamento, p.fecha, p.anio, p.objeto, p.cubso, p.descripcion, p.unidad,
         p.cantidad, p.referencial,
         COALESCE(a.monto, o.monto, u.monto),
         CASE WHEN a.monto IS NOT NULL THEN 'conosce' WHEN o.monto IS NOT NULL THEN 'ocds' WHEN u.monto IS NOT NULL THEN 'proceso' END,
         COALESCE(a.ruc, o.ruc, u.ruc), COALESCE(a.proveedor, o.proveedor, u.proveedor),
         CASE WHEN p.cantidad > 0 AND p.referencial > 0 THEN round(p.referencial / p.cantidad, 4) END,
         CASE WHEN p.cantidad > 0 AND COALESCE(a.monto, o.monto, u.monto) > 0 THEN round(COALESCE(a.monto, o.monto, u.monto) / p.cantidad, 4) END
  FROM _pi p
  LEFT JOIN _pa a ON a.codigo = p.codigo AND a.posicion = p.posicion
  LEFT JOIN _po o ON o.ocid = p.ocid AND o.item_id = p.item_id
  LEFT JOIN _pu u ON u.ocid = p.ocid AND p.n_items = 1
  WHERE p.posicion IS NOT NULL
  ORDER BY p.ocid, p.posicion;
  GET DIAGNOSTICS n = ROW_COUNT;
  DROP TABLE IF EXISTS _pc;
  DROP TABLE IF EXISTS _pi;
  RETURN n;
END $$;
ALTER FUNCTION cargar_precio_item(INT, TIMESTAMPTZ) OWNER TO vigia_jobs;

-- Las referencias (cada año con el anterior, desde 5 entidades distintas; sin "Servicio" ni "Global", donde el CUBSO
-- junta trabajos que no se comparan por unidad) y el cruce `sobreprecio`. Sólo lee precio_item: sin JSON.
CREATE OR REPLACE FUNCTION refrescar_precio_referencia() RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  PERFORM _precio_memoria();
  -- Muchas entidades cargan un lote entero como "1 unidad" (p. ej. arroz por S/ 122 mil): en un grupo que se compra por
  -- cantidad, un ítem de cantidad 1 no es un precio unitario y no entra en la referencia.
  DROP TABLE IF EXISTS _pq;
  CREATE TEMP TABLE _pq ON COMMIT DROP AS
    SELECT cubso, unidad, anio, percentile_cont(0.5) WITHIN GROUP (ORDER BY cantidad) AS cant_mediana
    FROM precio_item
    WHERE cubso IS NOT NULL AND unidad IS NOT NULL AND unidad NOT IN ('Servicio', 'Global') AND cantidad > 0
    GROUP BY 1, 2, 3;
  CREATE INDEX ON _pq (cubso, unidad, anio);
  DELETE FROM precio_referencia;
  INSERT INTO precio_referencia
  SELECT p.cubso, p.unidad, y.anio, b.base, count(*)::int, count(DISTINCT p.entidad_ruc)::int,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY b.unit), percentile_cont(0.5) WITHIN GROUP (ORDER BY b.unit),
         percentile_cont(0.75) WITHIN GROUP (ORDER BY b.unit), percentile_cont(0.5) WITHIN GROUP (ORDER BY p.cantidad)
  FROM precio_item p
  JOIN _pq q ON q.cubso = p.cubso AND q.unidad = p.unidad AND q.anio = p.anio
  CROSS JOIN LATERAL (VALUES ('adjudicado', p.unit_adj), ('referencial', p.unit_ref)) b(base, unit)
  JOIN generate_series(2015, extract(year FROM now())::int) y(anio) ON p.anio IN (y.anio, y.anio - 1)
  WHERE b.unit > 0 AND NOT (p.cantidad <= 1 AND q.cant_mediana > 1)
  GROUP BY p.cubso, p.unidad, y.anio, b.base
  HAVING count(DISTINCT p.entidad_ruc) >= 5;
  ANALYZE precio_referencia;

  -- Bienes pagados muy por encima de lo que pagan las demás entidades.
  DELETE FROM cruces_proveedor WHERE tipo = 'sobreprecio';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT 'sobreprecio', k.ruc, k.ocid,
         CASE WHEN k.peor_razon >= 3 AND k.exceso >= 50000 THEN 'alta' ELSE 'media' END,
         k.fecha, round(k.exceso, 2),
         jsonb_build_object('items', k.items, 'exceso', round(k.exceso, 2), 'peor', k.peor),
         'precio_item', 'https://contratacionesabiertas.oece.gob.pe/'
  FROM (
    SELECT x.ocid, x.ruc, min(x.fecha) AS fecha, count(*)::int AS items, sum(x.exceso) AS exceso, max(x.razon) AS peor_razon,
           (array_agg(jsonb_build_object('posicion', x.posicion, 'descripcion', x.descripcion, 'cantidad', x.cantidad, 'unidad', x.unidad,
                                         'unitario', x.unit_adj, 'mediana', round(x.mediana, 4), 'p75', round(x.p75, 4), 'razon', x.razon,
                                         'entidades', x.entidades, 'anio', x.anio, 'cubso', x.cubso) ORDER BY x.exceso DESC))[1] AS peor
    FROM (
      SELECT p.ocid, p.ruc_proveedor AS ruc, p.fecha, p.posicion, p.descripcion, p.cantidad, p.unidad, p.unit_adj, p.anio, p.cubso,
             r.mediana, r.p75, r.entidades, precio_razon(p.unit_adj, r.mediana) AS razon, (p.unit_adj - r.p75) * p.cantidad AS exceso
      FROM precio_item p
      JOIN precio_referencia r ON r.cubso = p.cubso AND r.unidad = p.unidad AND r.anio = p.anio AND r.base = 'adjudicado'
      WHERE p.unit_adj > 0 AND p.ruc_proveedor ~ '^\d{11}$' AND p.objeto = 'goods'
        -- Cantidad 1: sólo en grupos que se compran de a uno (equipos) y con un rango habitual estrecho; si no, es un lote.
        AND (p.cantidad > 1 OR (r.cant_mediana <= 1 AND r.p75 <= 4 * r.p25))
        -- Vales y tarjetas de consumo: su "precio" es el valor cargado, no se compara.
        AND p.descripcion !~* '(tarjeta|vale|cup[oó]n|ticket)s?\s+(de\s+)?(consumo|combustible|alimentos?|canje|compra)'
    ) x
    WHERE x.razon >= 1.5 AND x.razon <= 20 AND x.exceso >= 5000
    GROUP BY x.ocid, x.ruc
  ) k;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_precio_referencia() OWNER TO vigia_jobs;

-- La corrida diaria: los contratos que cambiaron desde la anterior, lo nuevo de CONOSCE, las referencias y el cruce.
-- Con p_completo (o la primera vez), año por año desde 2015: mejor desde fuera de Hyperdrive, que corta a los ~10 min.
CREATE OR REPLACE FUNCTION refrescar_precio_item(p_completo BOOLEAN DEFAULT false) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  n INT := 0;
  desde TIMESTAMPTZ;
  ahora TIMESTAMPTZ := now();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_precio_item'));
  PERFORM _precio_memoria();
  SELECT ultima INTO desde FROM precio_item_estado;
  IF p_completo OR desde IS NULL THEN
    DELETE FROM precio_item;
    FOR a IN 2015..extract(year FROM now())::int LOOP
      n := n + cargar_precio_item(a, NULL);
    END LOOP;
  ELSE
    n := cargar_precio_item(NULL, desde - interval '1 hour');
    -- Lo que CONOSCE cambió (los sábados, también hacia atrás) en contratos que no cambiaron en el OECE.
    DROP TABLE IF EXISTS _pa;
    CREATE TEMP TABLE _pa ON COMMIT DROP AS
      SELECT a.codigo_convocatoria::text AS codigo, a.n_item AS posicion, sum(a.monto_adjudicado) AS monto,
             (array_agg(a.ruc_proveedor ORDER BY a.monto_adjudicado DESC NULLS LAST))[1] AS ruc,
             (array_agg(a.proveedor ORDER BY a.monto_adjudicado DESC NULLS LAST))[1] AS proveedor
      FROM conosce_adjudicaciones a
      WHERE a.monto_adjudicado > 0 AND COALESCE(a.moneda, 'Soles') ~* 'soles'
      GROUP BY 1, 2;
    UPDATE precio_item p
       SET adjudicado = a.monto, fuente_adjudicado = 'conosce', ruc_proveedor = a.ruc, proveedor = a.proveedor,
           unit_adj = CASE WHEN p.cantidad > 0 THEN round(a.monto / p.cantidad, 4) END
      FROM _pa a
     WHERE a.codigo = p.codigo AND a.posicion = p.posicion
       AND (p.adjudicado IS DISTINCT FROM a.monto OR p.fuente_adjudicado IS DISTINCT FROM 'conosce');
  END IF;
  ANALYZE precio_item;
  PERFORM refrescar_precio_referencia();
  INSERT INTO precio_item_estado (id, ultima) VALUES (1, ahora) ON CONFLICT (id) DO UPDATE SET ultima = EXCLUDED.ultima;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_precio_item(BOOLEAN) OWNER TO vigia_jobs;
