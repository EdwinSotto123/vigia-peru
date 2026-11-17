-- 339 · precios_por_texto: las medidas con número calzan aunque se escriban con separador.
--
-- En el laboratorio, los lubricantes de 2026-397-20 no hallaron compras del Estado: se buscaba «15w40» y el registro
-- escribe «15W-40» o «SAE 15W 40». Una palabra con letras y números se busca ahora por expresión regular con un
-- separador opcional entre letras y números (15[^a-z0-9]?w[^a-z0-9]?40); el índice de trigramas de la 338 la atiende.
-- El resto de la función es la de la 338.

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
      -- Una medida con número («15w40», «b5», «a4») calza con o sin separador («15W-40», «B 5»): por expresión regular,
      -- que el índice de trigramas también atiende. Una palabra sola, por LIKE.
      SELECT string_agg(CASE WHEN w ~ '[0-9]' AND w ~ '[a-z]'
                             THEN format('%s ~ %L', columnas[j], regexp_replace(w, '(?<=[0-9])(?=[a-z])|(?<=[a-z])(?=[0-9])', '[^a-z0-9]?', 'g'))
                             ELSE format('%s LIKE %L', columnas[j], '%' || w || '%') END, ' AND ')
        INTO cond FROM unnest(ws[1:k]) w;
      RETURN QUERY EXECUTE format(consultas[j], cond, '«' || array_to_string(ws[1:k], ' ') || '»', u, hasta);
      GET DIAGNOSTICS filas = ROW_COUNT;
      EXIT WHEN filas > 0;
    END LOOP;
  END LOOP;
END $$;
