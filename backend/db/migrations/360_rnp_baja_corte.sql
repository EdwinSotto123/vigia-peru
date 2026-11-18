-- 360 · Los socios y representantes del RNP dejan de ser una foto de mayo.
--
-- rnp_conformacion_juridica (socios, representantes y órganos de administración de cada proveedor; la base de las redes de
-- dueños) se cargó una vez, con el corte del 2026-05-04. El OECE reemplaza ese archivo el primer día hábil de cada mes en
-- su wiki de datos abiertos (65 versiones desde 2021; la del 2026-11-02 trae 54 mil vínculos nuevos y 13 mil proveedores
-- nuevos, y 3 984 vínculos que ya no figuran). Desde hoy lo carga backend/scripts/cargar_rnp.py, cada mes.
--
-- La carga sólo AGREGA los vínculos nuevos y anota los que dejaron de figurar; no reescribe los 1,4 millones que siguen
-- igual. Así:
--   fecha_corte   el corte en que el vínculo entró a la tabla (2026-05-04 para lo cargado al inicio);
--   baja_corte    el primer corte en que dejó de figurar (NULL: sigue en el último archivo). Un socio que salió sigue
--                 contando para los contratos de cuando estaba: no se borra.
ALTER TABLE rnp_conformacion_juridica ADD COLUMN IF NOT EXISTS baja_corte DATE;
COMMENT ON COLUMN rnp_conformacion_juridica.fecha_corte IS 'Corte del archivo del OECE en que este vínculo entró a la tabla';
COMMENT ON COLUMN rnp_conformacion_juridica.baja_corte IS 'Primer corte del archivo del OECE en que el vínculo ya no figura; NULL si sigue';
