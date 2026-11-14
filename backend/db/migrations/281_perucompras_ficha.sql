-- Los productos de los Catálogos de Perú Compras, buscables por su descripción (2026-11-14).
--
-- En bienes, 787 de 2 232 ítems analizados en 12 días quedaron «sin precios en mercado»: el agente busca en tiendas y en
-- las adjudicaciones de CONOSCE, pero no en la fuente con el producto mejor identificado que tiene la base: las órdenes
-- de los Catálogos Electrónicos (5,6 M de líneas con ficha-producto, marca, número de parte y precio unitario).
-- `perucompras_precio_ref` (migración 237) ya tiene la mediana por ficha y año, de 5 entidades o más; faltaba poder
-- llegar a la ficha desde la descripción de un ítem: `perucompras_item` no tiene índice de texto.
--
-- `perucompras_ficha`: una fila por ficha con referencia de precio, con su descripción (la más frecuente), marca,
-- número de parte, catálogo y categoría, y un índice de trigramas sobre la descripción sin tildes y en minúsculas.

CREATE TABLE IF NOT EXISTS perucompras_ficha (
  ficha            TEXT PRIMARY KEY,
  descripcion      TEXT NOT NULL,
  descripcion_norm TEXT NOT NULL,
  marca            TEXT,
  nro_parte        TEXT,
  catalogo         TEXT,
  categoria        TEXT,
  lineas           INT NOT NULL,
  ultima           DATE
);
CREATE INDEX IF NOT EXISTS perucompras_ficha_texto ON perucompras_ficha USING gin (descripcion_norm gin_trgm_ops);

CREATE OR REPLACE FUNCTION refrescar_perucompras_ficha() RETURNS integer
LANGUAGE plpgsql SET work_mem = '128MB' AS $$
DECLARE v_filas int;
BEGIN
  CREATE TEMP TABLE _pf ON COMMIT DROP AS
    SELECT regexp_replace(i.link_ficha, '(-[0-9]{8}-[0-9]{6})?[.]pdf$', '') AS ficha,
           mode() WITHIN GROUP (ORDER BY i.descripcion) AS descripcion, mode() WITHIN GROUP (ORDER BY i.marca) AS marca,
           mode() WITHIN GROUP (ORDER BY i.nro_parte) AS nro_parte, mode() WITHIN GROUP (ORDER BY i.catalogo) AS catalogo,
           mode() WITHIN GROUP (ORDER BY i.categoria) AS categoria, count(*)::int AS lineas, max(i.fecha_inicio_entrega) AS ultima
      FROM perucompras_item i
     WHERE i.version = 0 AND i.link_ficha IS NOT NULL AND COALESCE(i.descripcion, '') <> ''
       AND regexp_replace(i.link_ficha, '(-[0-9]{8}-[0-9]{6})?[.]pdf$', '') IN (SELECT ficha FROM perucompras_precio_ref)
     GROUP BY 1;
  DELETE FROM perucompras_ficha;
  INSERT INTO perucompras_ficha (ficha, descripcion, descripcion_norm, marca, nro_parte, catalogo, categoria, lineas, ultima)
  SELECT ficha, descripcion, lower(unaccent(descripcion)), NULLIF(marca, ''), NULLIF(nro_parte, ''), catalogo, categoria, lineas, ultima FROM _pf;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  ANALYZE perucompras_ficha;
  RETURN v_filas;
END $$;
ALTER FUNCTION refrescar_perucompras_ficha() OWNER TO vigia_jobs;
ALTER TABLE perucompras_ficha OWNER TO vigia_jobs;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.perucompras_ficha, public.perucompras_precio_ref TO %I', r);
    END IF;
  END LOOP;
END $$;

SELECT refrescar_perucompras_ficha() AS fichas;
