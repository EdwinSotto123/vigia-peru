-- 139 · dji_nepotismo sin multiplicar las órdenes (arregla la 138).
--
-- La 138 traía el cargo del funcionario con un LEFT JOIN LATERAL (… LIMIT 5) DENTRO de la agregación: cada fila de
-- persona_orden_anual se repetía tantas veces como cargos encontraba el lateral (hasta 5), y sum(ordenes)/sum(monto)
-- salían multiplicados. Medido en producción el 2026-10-26: 296 de 388 pares inflados, S/ 34.5 M en la vista contra
-- S/ 10.2 M reales, hasta 9 veces. Ahora el cargo es una subconsulta escalar (una fila, el más reciente) fuera del GROUP BY.
--
-- CREATE OR REPLACE con las mismas columnas en el mismo orden: se mantiene el OID de la vista (sin la ventana de planes
-- cacheados obsoletos en Hyperdrive que da un DROP + CREATE). Después hay que correr refrescar_nepotismo_senal(): la
-- señal guardada en persona_senal copió los montos inflados.

CREATE OR REPLACE VIEW dji_nepotismo AS
SELECT v.entidad_ruc,
       v.declarante_norm,
       (SELECT f.cargo
          FROM dji_funcionarios f
         WHERE f.nombre_norm = v.declarante_norm AND f.cargo IS NOT NULL
         ORDER BY f.fecha_inicio_cargo DESC NULLS LAST
         LIMIT 1) AS cargo,
       v.grado,
       v.parentesco,
       p.ruc                 AS proveedor_ruc,
       p.nombre              AS proveedor_nombre,
       sum(p.ordenes)::int   AS ordenes,
       sum(p.monto)::float   AS monto,
       min(p.anio)           AS desde,
       max(p.anio)           AS hasta
FROM dji_vinculos v
JOIN persona_orden_anual p
  ON p.entidad_ruc = v.entidad_ruc
 AND p.ruc LIKE '10%'
 AND substr(p.ruc, 3, 8) = v.pariente_doc
GROUP BY v.entidad_ruc, v.declarante_norm, v.grado, v.parentesco, p.ruc, p.nombre;

COMMENT ON VIEW dji_nepotismo IS
  'Cruce nepotismo: pariente declarado (DJI) = locador de su misma entidad, con el cargo del funcionario (por nombre, subconsulta: no multiplica las órdenes). Indicio, no acusación. Migraciones 136-139.';

GRANT SELECT ON dji_nepotismo TO vigia_api, vigia_api_admin, vigia_jobs;
