-- 340 · Sobreprecio por CUBSO sobre un ítem que agrupa varios productos: dato dudoso, no alerta alta.
--
-- Revisando a AGROINDUSTRIA LA PERLA DEL HUASCARAN (2026-11-17), varias señales de sobreprecio salían de ítems que el SEACE
-- registra como un paquete («ADQUISICIÓN DE INSUMOS PARA EL PROGRAMA DEL VASO DE LECHE», «PRODUCTOS ALIMENTICIOS PARA EL
-- PROGRAMA…») con el CUBSO de UNO de sus productos: el precio por kilo de la mezcla (leche, hojuelas, azúcar) se comparaba
-- con la mediana de un solo producto. En PROD eran 106 de 6 543 señales de sobreprecio (27 extremas).
--
-- No se borran (a veces el paquete sí está caro y el resto de la ficha lo dice): pasan a severidad baja con la marca
-- `posible_paquete` y la nota que la ficha muestra. Se reconocen por la descripción del ítem: empieza por un trámite y un
-- genérico («Adquisición de insumos / productos / alimentos / víveres / bienes…») sin nombrar después un producto
-- («…para el PCA - leche evaporada entera» sí lo nombra). Se probó también «los documentos traen más renglones que el
-- registro»: marcaba ítems puntuales (las hojuelas de avena de 1188740, a 3,35 veces, que sí estaban caras; un volquete;
-- una moto) y se descartó.
-- marcar_sobreprecio_paquete() corre en la cadena de refrescos después de refrescar_precio_item() (que rehace las señales).

CREATE OR REPLACE FUNCTION es_descripcion_paquete(t text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(t, '') ~* '^\W*(contrataci[oó]n|adquisici[oó]n|adquiisici[oó]n|suministro|compra)\s+(de(l|\s+los|\s+las|\s+la)?\s+)?(suministros?\s+de\s+)?(la\s+)?(canasta\s+de\s+)?(bienes|insumos|productos|alimentos|v[ií]veres)(\s+alimenticios)?\M'
     -- Nombra un producto después de un guion o dos puntos («insumos médicos - kit de ropa…», «alimentos para el PCA - leche…»).
     AND COALESCE(t, '') !~* '[-:–]\s*[a-záéíóúñ]{3,}'
     -- Un genérico que en verdad es un producto: alimento para animales, impresos (formatos FUA).
     AND COALESCE(t, '') !~* 'alimentos?\s+(balanceados?|para\s+(el\s+)?(ganado|canes|perros|animales|aves|equinos?|peces|mascotas|semovientes))|bienes\s+impresos'
$$;

CREATE OR REPLACE FUNCTION marcar_sobreprecio_paquete() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  UPDATE cruces_proveedor c
     SET severidad = 'baja',
         detalle = c.detalle || jsonb_build_object(
           'posible_paquete', true,
           'severidad_original', COALESCE(c.detalle->>'severidad_original', c.severidad),
           'nota_paquete', 'el ítem agrupa varios productos con el código de uno solo: el precio por unidad puede ser el de la mezcla')
   WHERE c.tipo IN ('sobreprecio', 'sobreprecio_alto', 'sobreprecio_extremo')
     AND NOT COALESCE((c.detalle->>'posible_paquete')::boolean, false)
     AND es_descripcion_paquete(c.detalle->'peor'->>'descripcion');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER FUNCTION public.marcar_sobreprecio_paquete() OWNER TO vigia_jobs;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION marcar_sobreprecio_paquete() FROM PUBLIC;

SELECT marcar_sobreprecio_paquete() AS marcadas;
