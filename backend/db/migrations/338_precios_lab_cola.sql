-- 338 · Laboratorio de precios a escala: una cola de contratos y referencias del Estado por texto.
--
-- Pedido del usuario (2026-11-17), tras revisar a AGROINDUSTRIA LA PERLA DEL HUASCARAN: «prepara todo lo necesario para
-- procesar… EXTRAER los ítems e intentar extraer los precios, sea mediante CUBSO, compras, internet… explotemos el
-- laboratorio de precios».
--
--   precios_lab_cola          contratos por investigar en el laboratorio (Worker vigia-precios-lab). La llenan el panel y
--                             scripts/procesar_proveedor.py; la vacía el cron de 10 min de la API (POST /admin/asignar →
--                             routes/admin_precios.ts), hasta 12 renglones por vuelta, escalonados. Sin token de panel:
--                             quien puede escribir en la base puede pedir.
--   precios_por_texto(q, u, f)   lo que pagó el Estado por un bien nombrado con esas palabras, cuando el renglón no trae CUBSO
--                             (los renglones leídos de las bases y del contrato no lo traen): catálogo de Perú Compras
--                             (con IGV), procesos adjudicados (CONOSCE), compras menores y otros contratos leídos por pieza.
--                             Cada fuente da p25, mediana y p75 en UNA unidad (la pedida si la hay, si no la más común).
--
-- Índice nuevo: trigramas sobre la descripción de conosce_adjudicaciones (325 mil filas; la búsqueda por palabras pasaba
-- de 3,8 s por secuencial).

CREATE TABLE IF NOT EXISTS precios_lab_cola (
  ocid        TEXT PRIMARY KEY,
  pedido_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  prioridad   INT NOT NULL DEFAULT 0,
  web         BOOLEAN NOT NULL DEFAULT true,
  repetir     BOOLEAN NOT NULL DEFAULT false,
  autor       TEXT,
  motivo      TEXT,
  estado      TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_curso', 'hecho', 'sin_items', 'error')),
  vueltas     INT NOT NULL DEFAULT 0,
  ultimo_at   TIMESTAMPTZ,
  lanzados    INT NOT NULL DEFAULT 0,
  detalle     JSONB
);
CREATE INDEX IF NOT EXISTS precios_lab_cola_turno ON precios_lab_cola (prioridad DESC, pedido_at)
  WHERE estado IN ('pendiente', 'en_curso');

CREATE INDEX IF NOT EXISTS conosce_adj_descripcion_trgm
  ON conosce_adjudicaciones USING gin (immutable_unaccent(lower(descripcion_item)) gin_trgm_ops);

-- Las palabras que identifican el bien: sin tildes, sin las vacías ni las de trámite («suministro», «adquisición»),
-- hasta 5. «ACEITE DE MOTOR 15W40 : MOBIL DELVAC» → {aceite, motor, 15w40, mobil, delvac}.
CREATE OR REPLACE FUNCTION palabras_de_bien(t text) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE((array_agg(w ORDER BY i))[1:5], '{}')
    FROM (SELECT w, min(i) AS i
            FROM regexp_split_to_table(regexp_replace(lower(immutable_unaccent(COALESCE(t, ''))), '[^a-z0-9ñ]+', ' ', 'g'), '\s+')
                 WITH ORDINALITY AS x(w, i)
           WHERE (length(w) >= 3 OR w ~ '^([a-z][0-9]|[0-9][a-z])$') AND w NOT IN (
             'del', 'las', 'los', 'para', 'con', 'por', 'una', 'que', 'sin', 'segun', 'tipo', 'otros', 'otras',
             'suministro', 'adquisicion', 'compra', 'contratacion', 'bienes', 'bien', 'producto', 'productos', 'insumo',
             'insumos', 'item', 'items', 'unidad', 'unidades', 'presentacion', 'marca', 'modelo', 'similar', 'equivalente',
             'programa', 'municipalidad', 'entidad', 'año', 'ano', 'fiscal', 'calidad', 'caracteristicas', 'tecnicas')
           GROUP BY w) p
$$;

-- Una unidad comparable: «GALON», «galones», «GLN» → «galon»; «BALDE DE 05 GALONES» → «balde de 05 galones» (otra unidad).
CREATE OR REPLACE FUNCTION unidad_norm(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN u IS NULL OR u = '' THEN NULL
    WHEN u ~ '^(gal|gln|gl)(on|ones)?$' THEN 'galon'
    WHEN u ~ '^(kg|kgs|kilo|kilos|kilogramos?)$' THEN 'kilogramo'
    WHEN u ~ '^(l|lt|lts|litros?)$' THEN 'litro'
    WHEN u ~ '^(und|unid|unidad|unidades|u|un|pza|pieza|piezas)$' THEN 'unidad'
    WHEN u ~ '^(caja|cajas|cja)$' THEN 'caja'
    WHEN u ~ '^(paquete|paquetes|paq|pqte)$' THEN 'paquete'
    WHEN u ~ '^(bolsa|bolsas)$' THEN 'bolsa'
    WHEN u ~ '^(lata|latas)$' THEN 'lata'
    WHEN u ~ '^(sobre|sobres)$' THEN 'sobre'
    WHEN u ~ '^(saco|sacos)$' THEN 'saco'
    WHEN u ~ '^(millar|millares)$' THEN 'millar'
    ELSE u END
  FROM (SELECT btrim(regexp_replace(lower(immutable_unaccent(COALESCE(t, ''))), '[^a-z0-9 ]+', ' ', 'g')) AS u) x
$$;

CREATE OR REPLACE FUNCTION precios_por_texto(consulta text, en_unidad text DEFAULT NULL, hasta date DEFAULT CURRENT_DATE)
RETURNS TABLE (fuente text, detalle text, unidad text, n int, p25 numeric, mediana numeric, p75 numeric)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  ws text[] := palabras_de_bien(consulta);
  u text := unidad_norm(en_unidad);
  total int := COALESCE(array_length(ws, 1), 0);
  fuentes text[] := ARRAY['perucompras', 'procesos', 'compras_menores', 'contratos_leidos'];
  -- La columna de texto de cada fuente y su consulta: %1$s = condición, %2$L = etiqueta, %3$L = unidad pedida,
  -- %4$L = fecha tope. Una condición LIKE por palabra (con «LIKE ALL» el índice de trigramas no se usa).
  columnas text[] := ARRAY[
    'f.descripcion_norm',
    'immutable_unaccent(lower(a.descripcion_item))',
    'immutable_unaccent(lower(i.descripcion))',
    $c$immutable_unaccent(lower(COALESCE(e->>'descripcion', '') || ' ' || COALESCE(e->>'marca', '')))$c$];
  consultas text[] := ARRAY[
    -- Catálogo de Perú Compras: cada producto (ficha) con lo que pagaron 5 entidades o más en el año; van sin IGV y un
    -- contrato se pacta con IGV.
    $q$SELECT 'perucompras'::text,
              format('%%s productos del catálogo de Perú Compras con %%s (%%s órdenes, con IGV)', count(*), %2$L, sum(r.lineas)),
              NULL::text, count(*)::int,
              round((percentile_cont(0.25) WITHIN GROUP (ORDER BY r.mediana) * 1.18)::numeric, 2),
              round((percentile_cont(0.5) WITHIN GROUP (ORDER BY r.mediana) * 1.18)::numeric, 2),
              round((percentile_cont(0.75) WITHIN GROUP (ORDER BY r.mediana) * 1.18)::numeric, 2)
         FROM perucompras_ficha f JOIN perucompras_precio_ref r ON r.ficha = f.ficha
        WHERE r.anio >= extract(year FROM %4$L::date)::int - 1 AND r.mediana > 0 AND %1$s
       HAVING count(*) >= 1$q$,
    -- Procesos adjudicados (CONOSCE, en soles): monto entre cantidad, de los tres años previos.
    $q$WITH c AS (
         SELECT unidad_norm(a.unidad_medida) AS un, a.monto_adjudicado / a.cantidad AS pu
           FROM conosce_adjudicaciones a
          WHERE %1$s AND a.cantidad > 0 AND a.monto_adjudicado > 0 AND COALESCE(a.moneda, 'Soles') ILIKE '%%sol%%'
            AND COALESCE(a.fecha_buenapro, a.fecha_convocatoria) BETWEEN %4$L::date - 1095 AND %4$L::date),
       g AS (SELECT un FROM c WHERE un IS NOT NULL GROUP BY un ORDER BY (un = %3$L) DESC NULLS LAST, count(*) DESC LIMIT 1)
       SELECT 'procesos'::text, format('%%s ítems adjudicados en procesos del Estado con %%s, por %%s (3 años)', count(*), %2$L, g.un),
              g.un, count(*)::int,
              round(percentile_cont(0.25) WITHIN GROUP (ORDER BY c.pu)::numeric, 2),
              round(percentile_cont(0.5) WITHIN GROUP (ORDER BY c.pu)::numeric, 2),
              round(percentile_cont(0.75) WITHIN GROUP (ORDER BY c.pu)::numeric, 2)
         FROM c JOIN g ON g.un = c.un GROUP BY g.un HAVING count(*) >= 3$q$,
    -- Compras menores (≤ 8 UIT) de los dos años previos.
    $q$WITH c AS (
         SELECT unidad_norm(i.unidad) AS un, i.precio_unitario AS pu
           FROM seace_menor_item i JOIN seace_menores m USING (id_contrato)
          WHERE %1$s AND i.precio_unitario > 0 AND m.fecha_suscripcion BETWEEN %4$L::date - 730 AND %4$L::date),
       g AS (SELECT un FROM c WHERE un IS NOT NULL GROUP BY un ORDER BY (un = %3$L) DESC NULLS LAST, count(*) DESC LIMIT 1)
       SELECT 'compras_menores'::text, format('%%s compras menores con %%s, por %%s (2 años)', count(*), %2$L, g.un),
              g.un, count(*)::int,
              round(percentile_cont(0.25) WITHIN GROUP (ORDER BY c.pu)::numeric, 2),
              round(percentile_cont(0.5) WITHIN GROUP (ORDER BY c.pu)::numeric, 2),
              round(percentile_cont(0.75) WITHIN GROUP (ORDER BY c.pu)::numeric, 2)
         FROM c JOIN g ON g.un = c.un GROUP BY g.un HAVING count(*) >= 3$q$,
    -- Otros contratos leídos por pieza: el renglón con su precio unitario, sólo si cuadra con su total.
    $q$WITH c AS (
         SELECT unidad_norm(e->>'unidad') AS un, (e->>'precio_unitario')::numeric AS pu
           FROM pieza_lectura l
           CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(l.salida->'items') = 'array' THEN l.salida->'items' ELSE '[]'::jsonb END) e
          WHERE l.lector = 'contrato' AND l.estado IN ('ok', 'parcial')
            AND (e->>'precio_unitario') ~ '^[0-9]+(\.[0-9]+)?$' AND (e->>'precio_unitario')::numeric > 0
            AND COALESCE(e->>'cuadra', 'true') <> 'false' AND %1$s),
       g AS (SELECT un FROM c WHERE un IS NOT NULL GROUP BY un ORDER BY (un = %3$L) DESC NULLS LAST, count(*) DESC LIMIT 1)
       SELECT 'contratos_leidos'::text, format('%%s renglones de otros contratos leídos con %%s, por %%s', count(*), %2$L, g.un),
              g.un, count(*)::int,
              round(percentile_cont(0.25) WITHIN GROUP (ORDER BY c.pu)::numeric, 2),
              round(percentile_cont(0.5) WITHIN GROUP (ORDER BY c.pu)::numeric, 2),
              round(percentile_cont(0.75) WITHIN GROUP (ORDER BY c.pu)::numeric, 2)
         FROM c JOIN g ON g.un = c.un GROUP BY g.un HAVING count(*) >= 3$q$];
  k int;
  j int;
  cond text;
  filas int;
BEGIN
  IF total < 2 THEN RETURN; END IF;   -- con una palabra sale cualquier cosa
  FOR j IN 1 .. array_length(fuentes, 1) LOOP
    -- Todas las palabras primero; si nada calza, las tres primeras (las que nombran el bien: «hojuela quinua avena»).
    FOR k IN SELECT DISTINCT x FROM unnest(ARRAY[total, least(total, 3)]) x ORDER BY x DESC LOOP
      SELECT string_agg(format('%s LIKE %L', columnas[j], '%' || w || '%'), ' AND ') INTO cond FROM unnest(ws[1:k]) w;
      RETURN QUERY EXECUTE format(consultas[j], cond, '«' || array_to_string(ws[1:k], ' ') || '»', u, hasta);
      GET DIAGNOSTICS filas = ROW_COUNT;
      EXIT WHEN filas > 0;
    END LOOP;
  END LOOP;
END $$;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.precios_lab_cola OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api_admin', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.precios_lab_cola TO %I', r);
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab', 'dev_api', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.precios_lab_cola TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.precios_por_texto(text, text, date), public.palabras_de_bien(text), public.unidad_norm(text) TO %I', r);
    END IF;
  END LOOP;
END $$;
