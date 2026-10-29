-- 208: dji_nepotismo con LATERAL: una búsqueda en el índice por cada pariente declarado.
--
-- La 182 cruzó dji_vinculos con persona_orden_anual por el rango de la llave ('10' || DNI || dígito), pero como JOIN: el
-- planificador estima `length(pariente_doc) = 8` en unas 13 filas (el Minsa tiene 6,756) y elige recorrer TODAS las
-- órdenes de la entidad (38 mil) por cada pariente, filtrando el rango en el JOIN: unos 260 millones de comparaciones.
-- Con la DJI del tier 3 cargada, la ficha del Minsa y la de 20131370998 pasaban los 10 s del rol vigia_api: GET
-- /entidades/:ruc respondía 500 y la ficha salía sin nombre ni banderas (2026-10-29). Con LATERAL y OFFSET 0 (que no la
-- aplane en un JOIN) cada pariente es una búsqueda por el rango en el índice (entidad_ruc, ruc, anio): Minsa de más de
-- 30 s a 0,2-0,6 s, EsSalud de 1,5-2,3 s a 0,3-0,5 s, INEN igual; las mismas filas.
--
-- Las mismas columnas, en el mismo orden: CREATE OR REPLACE la cambia sin tocar sus permisos (170 se los quita a los
-- roles de los modelos) ni lo que depende de ella.
--
-- Cómo aplicarla: python infrastructure/dev/dev.py migrar backend/db/migrations/208_nepotismo_lateral.sql (DEV); en
-- producción, el mismo archivo por el túnel (tunel_rds.conexion("prod")). Nada que refrescar.

CREATE OR REPLACE VIEW dji_nepotismo AS
 SELECT v.entidad_ruc,
    v.declarante_norm,
    ( SELECT f.cargo
           FROM dji_funcionarios f
          WHERE f.nombre_norm = v.declarante_norm AND f.cargo IS NOT NULL
          ORDER BY f.fecha_inicio_cargo DESC NULLS LAST
         LIMIT 1) AS cargo,
    v.grado,
    v.parentesco,
    p.ruc AS proveedor_ruc,
    p.nombre AS proveedor_nombre,
    sum(p.ordenes)::integer AS ordenes,
    sum(p.monto)::double precision AS monto,
    min(p.anio) AS desde,
    max(p.anio) AS hasta
   FROM dji_vinculos v
     CROSS JOIN LATERAL (
       SELECT x.ruc, x.nombre, x.ordenes, x.monto, x.anio
         FROM persona_orden_anual x
        WHERE x.entidad_ruc = v.entidad_ruc
          AND x.ruc BETWEEN '10' || v.pariente_doc || '0' AND '10' || v.pariente_doc || '9'
       OFFSET 0  -- que no se aplane en un JOIN: así es una búsqueda por pariente
     ) p
  WHERE length(v.pariente_doc) = 8
  GROUP BY v.entidad_ruc, v.declarante_norm, v.grado, v.parentesco, p.ruc, p.nombre;
