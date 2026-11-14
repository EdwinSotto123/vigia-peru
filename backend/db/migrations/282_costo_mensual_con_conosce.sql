-- Costo mensual de servicios: el histórico sale de los contratos de CONOSCE (2026-11-14).
--
-- La migración 280 tomó el plazo del lector de contratos, del OCDS y de las bases, y todo eso es de 2026: los procesos de
-- 2022 a 2025 no traen contrato en el OCDS. Sin años anteriores no hay «contrato anterior» con el que comparar una
-- renovación (medido en PROD: 2 534 servicios con costo mensual, todos de 2026, y ninguna renovación real).
-- `conosce_contratos` sí trae, desde 2018, el monto contratado y la vigencia (inicio y fin) de cada contrato. Se usa
-- cuando el proceso tiene UN solo contrato (con varios, el monto y el plazo no son del mismo servicio):
--   plazo = fin de vigencia − inicio de vigencia;  monto = monto contratado total.
-- Orden de preferencia: contrato leído por Vigía > contrato de CONOSCE > OCDS > bases.

ALTER TABLE servicio_costo_mensual DROP CONSTRAINT IF EXISTS servicio_costo_mensual_plazo_fuente_check;

CREATE OR REPLACE FUNCTION refrescar_servicio_costo_mensual() RETURNS integer
LANGUAGE plpgsql SET work_mem = '128MB' AS $$
DECLARE v_filas int;
BEGIN
  CREATE TEMP TABLE _sl ON COMMIT DROP AS
    SELECT ocid_corto(l.ocid) AS ocid,
           max((l.salida->>'plazo_dias')::numeric) FILTER (WHERE l.clase = 'contrato' AND (l.salida->>'plazo_dias') ~ '^[0-9]{1,5}(\.[0-9]+)?$') AS plazo_contrato,
           max((l.salida->>'monto_contratado')::numeric) FILTER (WHERE l.clase = 'contrato' AND (l.salida->>'monto_contratado') ~ '^[0-9]{1,13}(\.[0-9]+)?$') AS monto_contrato,
           max((l.salida->>'plazo_dias')::numeric) FILTER (WHERE l.clase = 'bases' AND (l.salida->>'plazo_dias') ~ '^[0-9]{1,5}(\.[0-9]+)?$') AS plazo_bases,
           max(jsonb_array_length(l.salida->'personal_clave')) FILTER (WHERE l.clase = 'bases' AND jsonb_typeof(l.salida->'personal_clave') = 'array') AS n_personal
      FROM documento_lectura l WHERE l.clase IN ('contrato', 'bases') GROUP BY 1;
  CREATE INDEX ON _sl (ocid);
  -- Un proceso con un solo contrato en CONOSCE, en soles, con su vigencia.
  CREATE TEMP TABLE _sc ON COMMIT DROP AS
    SELECT k.codigo_convocatoria AS codigo, max(k.monto_contratado_total) AS monto, min(k.fecha_vigencia_inicial) AS ini,
           max(COALESCE(k.fecha_vigencia_final, k.fecha_vigencia_fin_actualizada)) AS fin, max(k.ruc_contratista) AS ruc
      FROM conosce_contratos k
     WHERE k.anio >= 2021 AND k.moneda IN ('Soles', 'Nuevos Soles', 'PEN') AND k.monto_contratado_total > 0
     GROUP BY 1 HAVING count(DISTINCT k.codigo_contrato) = 1;
  CREATE INDEX ON _sc (codigo);

  DELETE FROM servicio_costo_mensual;
  INSERT INTO servicio_costo_mensual (ocid, entidad_ruc, entidad, tipo, objeto, objeto_norm, clase, region, fecha, monto, monto_base,
                                      plazo_dias, plazo_fuente, costo_mensual, proveedor_ruc, n_personal)
  WITH b AS (
    SELECT DISTINCT ON (c.ocid) c.ocid, c.entidad_ruc, e.nombre AS entidad, c.tipo_contratacion AS tipo, c.objeto, c.region, c.fecha_convocatoria AS fecha,
           left(c.ocds_payload->'tender'->'items'->0->'classification'->>'id', 8) AS clase,
           CASE WHEN COALESCE(c.proveedor_ruc, k.ruc) ~ '^20[0-9]{9}$' THEN COALESCE(c.proveedor_ruc, k.ruc) END AS proveedor_ruc,
           av.monto AS adj, l.monto_contrato, l.plazo_contrato, l.plazo_bases, l.n_personal,
           k.monto AS monto_conosce, CASE WHEN k.fin > k.ini THEN (k.fin - k.ini)::numeric END AS plazo_conosce,
           CASE WHEN (c.ocds_payload->'contracts'->0->'period'->>'durationInDays') ~ '^[0-9]{1,5}$'
                THEN (c.ocds_payload->'contracts'->0->'period'->>'durationInDays')::numeric END AS plazo_ocds
      FROM convocatorias c
      LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
      LEFT JOIN _sl l ON l.ocid = c.ocid
      LEFT JOIN _sc k ON k.codigo = c.codigo
      LEFT JOIN adjudicado_vigente av ON av.ocid = c.ocid
     WHERE c.tipo_contratacion IN ('servicios', 'consultoria') AND c.ocid NOT LIKE 'ocds-vigia-%'
       AND c.fecha_convocatoria >= DATE '2021-01-01' AND COALESCE(c.objeto, '') <> ''
     ORDER BY c.ocid
  ), m AS (
    SELECT b.*,
           CASE WHEN monto_contrato > 0 AND plazo_contrato >= 30 THEN monto_contrato
                WHEN monto_conosce > 0 AND plazo_conosce >= 30 THEN monto_conosce ELSE adj END AS monto,
           CASE WHEN monto_contrato > 0 AND plazo_contrato >= 30 THEN 'contrato'
                WHEN monto_conosce > 0 AND plazo_conosce >= 30 THEN 'contrato' ELSE 'adjudicado' END AS monto_base,
           CASE WHEN monto_contrato > 0 AND plazo_contrato >= 30 THEN plazo_contrato
                WHEN monto_conosce > 0 AND plazo_conosce >= 30 THEN plazo_conosce
                ELSE COALESCE(plazo_contrato, plazo_ocds, plazo_bases) END AS plazo,
           CASE WHEN monto_contrato > 0 AND plazo_contrato >= 30 THEN 'contrato'
                WHEN monto_conosce > 0 AND plazo_conosce >= 30 THEN 'conosce'
                WHEN plazo_contrato IS NOT NULL THEN 'contrato' WHEN plazo_ocds IS NOT NULL THEN 'ocds' ELSE 'bases' END AS plazo_fuente,
           COALESCE(NULLIF(monto_contrato, 0), monto_conosce) AS monto_doc
      FROM b
  )
  SELECT ocid, entidad_ruc, entidad, tipo, objeto, lower(objeto), NULLIF(clase, ''), region, fecha, monto, monto_base, plazo::int, plazo_fuente,
         round(monto / (plazo / 30.0), 2), proveedor_ruc, n_personal
    FROM m
   WHERE monto > 0 AND plazo BETWEEN 30 AND 1830
     AND NOT COALESCE(monto_doc > 0 AND adj > 0 AND (monto_doc > 3 * adj OR adj > 3 * monto_doc), false);
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  ANALYZE servicio_costo_mensual;
  RETURN v_filas;
END $$;
ALTER FUNCTION refrescar_servicio_costo_mensual() OWNER TO vigia_jobs;

SELECT refrescar_servicio_costo_mensual() AS servicios_con_costo_mensual;
