-- Vista del cruce de nepotismo: pariente declarado en la DJI que es locador (RUC-10) de la MISMA entidad.
--
-- Une dji_vinculos (parientes con identidad, del PDF del portal DJIC) con persona_orden_anual (locadores por
-- entidad) por el DNI (dígitos 3-10 del RUC-10 = DNI del pariente). Es un INDICIO para revisión humana, nunca una
-- acusación: la DJI es pública y el impedimento (art. 30, Ley 32069) depende del rol del declarante (ver cargo).
--
-- PRIVACIDAD: la vista tiene el detalle (declarante, DNI del pariente) SOLO para el panel admin/cola de revisión.
-- La API pública de la ficha expone únicamente el AGREGADO por entidad (cuántos, por grado, monto) — nunca el DNI
-- ni el nombre del pariente. El proveedor (RUC-10) ya es público como locador; su nombre va redactado por publicar().

CREATE OR REPLACE VIEW dji_nepotismo AS
SELECT v.entidad_ruc,
       v.declarante_norm,
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
GROUP BY v.entidad_ruc, v.declarante_norm, v.grado, v.parentesco, p.ruc, p.nombre;

COMMENT ON VIEW dji_nepotismo IS
  'Cruce nepotismo: pariente declarado (DJI) = locador de su misma entidad. Indicio, no acusación. API expone solo el agregado. Migración 136.';

GRANT SELECT ON dji_nepotismo TO vigia_api, vigia_api_admin, vigia_jobs;
