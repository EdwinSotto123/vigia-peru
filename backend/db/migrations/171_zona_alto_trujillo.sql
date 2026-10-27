-- 171 · Alto Trujillo (La Libertad), distrito creado después de la carga de `zonas`: faltaba, y su municipalidad
-- (RUC 20481036420) quedaba sin ubigeo, fuera del mapa y de la ficha de su región. El código lo da el MEF
-- (mef_ejecutora_anual, unidad 301903: departamento 13, provincia 01, distrito 12 → 130112) y el registro del OECE
-- (entidad_siaf: LA LIBERTAD / TRUJILLO / ALTO TRUJILLO). Sin coordenadas, como otros 18 distritos: el mapa los salta.
INSERT INTO zonas (ubigeo, nivel, nombre, padre_ubigeo)
VALUES ('130112', 'distrito', 'Alto Trujillo', '1301')
ON CONFLICT (ubigeo) DO NOTHING;

UPDATE entidades SET ubigeo = '130112'
 WHERE ruc = '20481036420' AND ubigeo IS NULL;
