-- 237: el precio de referencia de cada producto de los Catálogos de Perú Compras y las compras que lo pagaron al doble
-- o más (2026-11-03).
--
-- El producto es la ficha-producto del catálogo: el nombre de su archivo («link_ficha») sin «.pdf» ni la marca de cuándo
-- se actualizó (80022.pdf → 80022; 842505-20220928-183320.pdf → 842505, la misma ficha). Hasta ~2019 el archivo es un
-- hash (5a0c49572a0746ee9f0a567b7ca5edde.pdf): la ficha es el hash entero, nunca sus primeras cifras («5» juntaba un
-- tóner con una computadora). Es más precisa que el número de parte, que se repite entre marcas y a veces viene vacío. El precio unitario es subtotal / cantidad de lo pedido (la versión 0:
-- su precio_unitario viene en 0), sin IGV, en soles, en las órdenes que no se anularon ni se rechazaron.
--
-- La referencia es por ficha y año (los precios suben con los años): cuántas líneas y cuántas entidades distintas la
-- compraron, y el precio del cuartil 1, la mediana y el cuartil 3. Una compra se marca cuando:
--   · al menos 5 entidades distintas compraron esa ficha ese año (la mediana no es la de una sola entidad),
--   · pagó el doble de la mediana o más,
--   · y la diferencia, por la cantidad comprada, es de S/ 1 000 o más (no un lapicero a S/ 1,20 en vez de S/ 0,45).
-- En DEV (2017-2026): 4 815 líneas de 2 711 órdenes en 782 entidades, S/ 28,8 millones por encima de la mediana.
-- Es un indicio, no una prueba: el precio de catálogo incluye la entrega en el lugar (un distrito lejano cuesta más) y
-- una compra chica no tiene el precio de una grande.
--
-- La recalcula refrescar_perucompras_precios(), al final de cada carga (backend/scripts/cargar_perucompras.py).
--
-- DEV: bash infrastructure/deploy/dev.sh migrar backend/db/migrations/237_perucompras_precios.sql

-- Las líneas de una ficha, para comparar quién la compró y a cuánto (GET /catalogo/ficha/:ficha).
CREATE INDEX IF NOT EXISTS perucompras_item_ficha ON perucompras_item ((regexp_replace(link_ficha, '(-[0-9]{8}-[0-9]{6})?[.]pdf$', ''))) WHERE version = 0;

CREATE TABLE IF NOT EXISTS perucompras_precio_ref (
  ficha      text NOT NULL,
  anio       smallint NOT NULL,
  lineas     integer NOT NULL,
  entidades  integer NOT NULL,
  p25        numeric(18, 5),
  mediana    numeric(18, 5),
  p75        numeric(18, 5),
  PRIMARY KEY (ficha, anio)
);

CREATE TABLE IF NOT EXISTS perucompras_sobreprecio (
  orden         text NOT NULL,
  linea         smallint NOT NULL,
  ficha         text NOT NULL,
  anio          smallint NOT NULL,
  entidad_ruc   text,
  proveedor_ruc text,
  fecha         date,
  cantidad      numeric(18, 4),
  precio        numeric(18, 5),               -- lo que pagó por unidad, sin IGV
  mediana       numeric(18, 5),               -- la mediana de esa ficha ese año
  entidades     integer,                      -- cuántas entidades la compraron ese año
  veces         numeric(10, 2),               -- precio / mediana
  exceso        numeric(18, 2),               -- (precio - mediana) × cantidad
  PRIMARY KEY (orden, linea)
);
CREATE INDEX IF NOT EXISTS perucompras_sobreprecio_entidad ON perucompras_sobreprecio (entidad_ruc);
CREATE INDEX IF NOT EXISTS perucompras_sobreprecio_proveedor ON perucompras_sobreprecio (proveedor_ruc);

/** Rehace la referencia y las marcas (en una transacción: quien lee ve las de antes hasta que termina). Devuelve cuántas
    líneas quedaron marcadas. */
CREATE OR REPLACE FUNCTION public.refrescar_perucompras_precios()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  DROP TABLE IF EXISTS _pc_lineas;
  CREATE TEMP TABLE _pc_lineas ON COMMIT DROP AS
    SELECT i.orden, i.linea, regexp_replace(i.link_ficha, '(-[0-9]{8}-[0-9]{6})?[.]pdf$', '') AS ficha,
           extract(year FROM o.fecha_publicacion)::smallint AS anio, o.entidad_ruc, o.proveedor_ruc,
           o.fecha_publicacion AS fecha, i.cantidad, i.subtotal / i.cantidad AS precio
      FROM perucompras_item i
      JOIN perucompras_orden o USING (orden)
     WHERE i.version = 0 AND i.cantidad > 0 AND i.subtotal > 0 AND regexp_replace(i.link_ficha, '(-[0-9]{8}-[0-9]{6})?[.]pdf$', '') IS NOT NULL
       AND o.fecha_publicacion IS NOT NULL AND o.estado NOT IN ('ORDEN DE COMPRA NULA', 'RECHAZADA');

  DELETE FROM perucompras_precio_ref;
  INSERT INTO perucompras_precio_ref (ficha, anio, lineas, entidades, p25, mediana, p75)
  SELECT ficha, anio, count(*), count(DISTINCT entidad_ruc),
         percentile_cont(0.25) WITHIN GROUP (ORDER BY precio)::numeric,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY precio)::numeric,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY precio)::numeric
    FROM _pc_lineas GROUP BY ficha, anio;

  DELETE FROM perucompras_sobreprecio;
  INSERT INTO perucompras_sobreprecio (orden, linea, ficha, anio, entidad_ruc, proveedor_ruc, fecha, cantidad, precio,
                                       mediana, entidades, veces, exceso)
  SELECT l.orden, l.linea, l.ficha, l.anio, l.entidad_ruc, l.proveedor_ruc, l.fecha, l.cantidad, l.precio,
         r.mediana, r.entidades, round(l.precio / r.mediana, 2), round((l.precio - r.mediana) * l.cantidad, 2)
    FROM _pc_lineas l
    JOIN perucompras_precio_ref r USING (ficha, anio)
   WHERE r.entidades >= 5 AND r.mediana > 0 AND l.precio >= 2 * r.mediana AND (l.precio - r.mediana) * l.cantidad >= 1000;
  GET DIAGNOSTICS n = ROW_COUNT;
  DROP TABLE IF EXISTS _pc_lineas;
  RETURN n;
END $$;

REVOKE EXECUTE ON FUNCTION public.refrescar_perucompras_precios() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE perucompras_precio_ref OWNER TO vigia_jobs;
    ALTER TABLE perucompras_sobreprecio OWNER TO vigia_jobs;
    GRANT EXECUTE ON FUNCTION public.refrescar_perucompras_precios() TO vigia_jobs;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_api') THEN
    GRANT SELECT ON perucompras_precio_ref, perucompras_sobreprecio TO vigia_api;
  END IF;
END $$;

-- El primer cálculo, ya (con las tablas vacías no marca nada; la carga lo repite al terminar).
SELECT refrescar_perucompras_precios();
