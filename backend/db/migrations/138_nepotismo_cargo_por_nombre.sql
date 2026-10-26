-- 138 · El cargo del funcionario en dji_nepotismo, cruzando por NOMBRE (no por codigo_ddjj, que viene NULL en
-- dji_vinculos: procesar_dji no lo captura). Por nombre_norm empatan ~4,321 declarantes, todos con cargo.
--
-- Índice btree para que el cruce f.nombre_norm = v.declarante_norm sea un seek (dji_funcionarios tiene 1.83M filas y solo
-- un GIN de trigramas, inútil para igualdad exacta). Sin el índice el cruce escanea y la vista se vuelve lenta.
--
-- CREATE OR REPLACE (NO DROP): las columnas de la vista no cambian (cargo ya iba en la 3.ª posición en la migr. 137), así
-- que se mantiene el OID de la vista → no hay ventana de planes cacheados obsoletos en Hyperdrive (el 500 de ~segundos
-- que da un DROP+CREATE). Solo cambia CÓMO se calcula `cargo`.

CREATE INDEX IF NOT EXISTS dji_funcionarios_nombre_norm_btree ON dji_funcionarios (nombre_norm);
ANALYZE dji_funcionarios;

CREATE OR REPLACE VIEW dji_nepotismo AS
SELECT v.entidad_ruc,
       v.declarante_norm,
       (array_agg(fc.cargo ORDER BY fc.fecha_inicio_cargo DESC NULLS LAST) FILTER (WHERE fc.cargo IS NOT NULL))[1] AS cargo,
       v.grado,
       v.parentesco,
       p.ruc              AS proveedor_ruc,
       p.nombre           AS proveedor_nombre,
       sum(p.ordenes)::int   AS ordenes,
       sum(p.monto)::float   AS monto,
       min(p.anio)           AS desde,
       max(p.anio)           AS hasta
FROM dji_vinculos v
JOIN persona_orden_anual p
  ON p.entidad_ruc = v.entidad_ruc
 AND p.ruc LIKE '10%'
 AND substr(p.ruc, 3, 8) = v.pariente_doc
LEFT JOIN LATERAL (
  SELECT f.cargo, f.fecha_inicio_cargo
    FROM dji_funcionarios f
   WHERE f.nombre_norm = v.declarante_norm AND f.cargo IS NOT NULL
   LIMIT 5
) fc ON true
GROUP BY v.entidad_ruc, v.declarante_norm, v.grado, v.parentesco, p.ruc, p.nombre;

COMMENT ON VIEW dji_nepotismo IS
  'Cruce nepotismo: pariente declarado (DJI) = locador de su misma entidad, con el cargo del funcionario (por nombre). Indicio, no acusación. Migración 136/137/138.';

GRANT SELECT ON dji_nepotismo TO vigia_api, vigia_api_admin, vigia_jobs;
