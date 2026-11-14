-- Costo mensual de cada servicio, para poder decir si un servicio salió caro (2026-11-14).
--
-- En servicios el agente sólo comparaba el monto TOTAL contra la cuantía total de convocatorias «parecidas»: un servicio
-- de 3 meses contra otro de 36. Por eso nunca daba veredicto y la red de servicios no tenía análisis de sobrecosto.
-- Lo que sí se puede comparar es el costo POR MES, y el plazo ya está en la base: lo leyó el lector de contratos
-- (8 514 contratos con plazo), el de bases (2 801) y lo trae el OCDS en parte de los contratos.
--
-- `servicio_costo_mensual`: una fila por proceso de servicios o consultoría con monto y plazo (de 30 días a 5 años).
--   · Si el contrato leído trae su monto y su plazo, mandan los dos juntos (son del mismo documento).
--   · Si no, el monto adjudicado del proceso y el plazo del contrato (lector u OCDS) o de las bases.
--   · Si el monto del contrato leído y el adjudicado difieren en más de 3 veces, el proceso no entra (es un contrato
--     de varios, o una lectura mala): mejor sin dato que un costo mensual inventado.
-- Con esto el agente compara contra el MISMO servicio de la MISMA entidad en su contrato anterior, y contra servicios
-- parecidos de otras entidades. Sólo empresas: el RUC de una persona natural no se guarda.

CREATE TABLE IF NOT EXISTS servicio_costo_mensual (
  ocid           TEXT PRIMARY KEY,
  entidad_ruc    TEXT,
  entidad        TEXT,
  tipo           TEXT NOT NULL,            -- servicios | consultoria
  objeto         TEXT NOT NULL,
  objeto_norm    TEXT NOT NULL,            -- en minúsculas, para la similitud por trigramas
  clase          TEXT,                     -- los 8 primeros dígitos del CUBSO del primer ítem
  region         TEXT,
  fecha          DATE,
  monto          NUMERIC NOT NULL,
  monto_base     TEXT NOT NULL,            -- contrato | adjudicado
  plazo_dias     INT NOT NULL,
  plazo_fuente   TEXT NOT NULL,            -- contrato | ocds | bases
  costo_mensual  NUMERIC NOT NULL,
  proveedor_ruc  TEXT,                     -- sólo RUC 20
  n_personal     INT,                      -- cargos de personal clave que piden las bases
  refrescado_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS servicio_costo_mensual_entidad ON servicio_costo_mensual (entidad_ruc, fecha DESC);
CREATE INDEX IF NOT EXISTS servicio_costo_mensual_objeto ON servicio_costo_mensual USING gin (objeto_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS servicio_costo_mensual_clase ON servicio_costo_mensual (clase);

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

  DELETE FROM servicio_costo_mensual;
  INSERT INTO servicio_costo_mensual (ocid, entidad_ruc, entidad, tipo, objeto, objeto_norm, clase, region, fecha, monto, monto_base,
                                      plazo_dias, plazo_fuente, costo_mensual, proveedor_ruc, n_personal)
  WITH b AS (
    SELECT c.ocid, c.entidad_ruc, e.nombre AS entidad, c.tipo_contratacion AS tipo, c.objeto, c.region, c.fecha_convocatoria AS fecha,
           left(c.ocds_payload->'tender'->'items'->0->'classification'->>'id', 8) AS clase,
           CASE WHEN c.proveedor_ruc ~ '^20[0-9]{9}$' THEN c.proveedor_ruc END AS proveedor_ruc,
           av.monto AS adj, l.monto_contrato, l.plazo_contrato, l.plazo_bases, l.n_personal,
           CASE WHEN (c.ocds_payload->'contracts'->0->'period'->>'durationInDays') ~ '^[0-9]{1,5}$'
                THEN (c.ocds_payload->'contracts'->0->'period'->>'durationInDays')::numeric END AS plazo_ocds
      FROM convocatorias c
      LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
      LEFT JOIN _sl l ON l.ocid = c.ocid
      LEFT JOIN adjudicado_vigente av ON av.ocid = c.ocid
     WHERE c.tipo_contratacion IN ('servicios', 'consultoria') AND c.ocid NOT LIKE 'ocds-vigia-%'
       AND c.fecha_convocatoria >= DATE '2022-01-01' AND COALESCE(c.objeto, '') <> ''
  ), m AS (
    SELECT b.*,
           CASE WHEN monto_contrato > 0 AND plazo_contrato >= 30 THEN monto_contrato ELSE adj END AS monto,
           CASE WHEN monto_contrato > 0 AND plazo_contrato >= 30 THEN 'contrato' ELSE 'adjudicado' END AS monto_base,
           COALESCE(plazo_contrato, plazo_ocds, plazo_bases) AS plazo,
           CASE WHEN plazo_contrato IS NOT NULL THEN 'contrato' WHEN plazo_ocds IS NOT NULL THEN 'ocds' ELSE 'bases' END AS plazo_fuente
      FROM b
  )
  SELECT ocid, entidad_ruc, entidad, tipo, objeto, lower(objeto), NULLIF(clase, ''), region, fecha, monto, monto_base, plazo::int, plazo_fuente,
         round(monto / (plazo / 30.0), 2), proveedor_ruc, n_personal
    FROM m
   WHERE monto > 0 AND plazo BETWEEN 30 AND 1830
     AND NOT COALESCE(monto_contrato > 0 AND adj > 0 AND (monto_contrato > 3 * adj OR adj > 3 * monto_contrato), false);
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  ANALYZE servicio_costo_mensual;
  RETURN v_filas;
END $$;
ALTER FUNCTION refrescar_servicio_costo_mensual() OWNER TO vigia_jobs;
ALTER TABLE servicio_costo_mensual OWNER TO vigia_jobs;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.servicio_costo_mensual TO %I', r);
    END IF;
  END LOOP;
END $$;

SELECT refrescar_servicio_costo_mensual() AS servicios_con_costo_mensual;
