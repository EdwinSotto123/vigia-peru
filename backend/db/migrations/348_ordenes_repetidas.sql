-- 348 · La misma compra repetida en semanas: órdenes directas del mismo proveedor, el mismo monto y el mismo objeto,
-- de 7 a 90 días entre la primera y la última.
--
-- Del caso de la UNI (2026-11-17): Pan American recibió la O/C-1883-2024 (11-09, emitida) y la O/C-2364-2024 (24-10,
-- devengada), las dos por S/ 28 190 por una refrigeradora y dos televisores. El fraccionamiento de Vigía (51) mira sólo
-- las órdenes del MISMO día. Medido en 2024 (bienes, contrataciones directas de hasta 8 UIT, S/ 5 mil o más): 956 casos,
-- S/ 55,7 M repetidos. Por ejemplo, dos servidores de S/ 41 188,83 en 27 días (el tope de 2024 era S/ 41 200), o
-- productos del Vaso de Leche del mismo monto cada mes. Puede ser:
--   · un fraccionamiento en el tiempo: una necesidad partida en órdenes que, cada una, queda bajo el tope;
--   · una orden repetida: la misma compra registrada dos veces (si las dos llegan a devengarse, un posible pago doble);
--   · una compra periódica legítima (un suministro mensual): el contexto lo dice.
-- Se excluye lo que es la misma orden registrada dos veces con otra oficina en el nombre («O/C-249-2024-ABASTECIMIENTO» y
-- «O/C-249-2024-GERENCIA GENERAL»): se cuenta una vez cada número de orden por entidad y año.
--
--   severidad  alta  si juntas pasan el tope y cada una está al borde (85 % o más del tope de su año);
--              media si juntas pasan el tope, o si todas llegaron a devengarse (posible pago doble);
--              baja  el resto.

CREATE TABLE IF NOT EXISTS ordenes_repetidas (
  entidad_ruc     TEXT NOT NULL,
  ruc_contratista TEXT NOT NULL,
  contratista     TEXT,
  monto           NUMERIC(18, 2) NOT NULL,     -- el de cada orden (es el mismo)
  ordenes         INT NOT NULL,
  total           NUMERIC(18, 2) NOT NULL,
  tope            NUMERIC(18, 2) NOT NULL,     -- 8 UIT del año de la primera
  desde           DATE NOT NULL,
  hasta           DATE NOT NULL,
  dias            INT NOT NULL,
  devengadas      INT NOT NULL,
  objeto          TEXT,
  severidad       TEXT NOT NULL,
  detalle         JSONB NOT NULL               -- [{orden, fecha, estado}]
);
CREATE INDEX IF NOT EXISTS ordenes_repetidas_entidad ON ordenes_repetidas (entidad_ruc, desde DESC);
CREATE INDEX IF NOT EXISTS ordenes_repetidas_contratista ON ordenes_repetidas (ruc_contratista);

CREATE OR REPLACE FUNCTION refrescar_ordenes_repetidas(p_desde date DEFAULT (date_trunc('year', current_date) - interval '2 years')::date) RETURNS integer
LANGUAGE plpgsql SET work_mem = '256MB' AS $$
DECLARE n int;
BEGIN
  CREATE TEMP TABLE _o ON COMMIT DROP AS
    SELECT DISTINCT ON (entidad_ruc, extract(year FROM fecha_emision), NULLIF(substring(nro_orden FROM '\d+'), ''))
           entidad_ruc, ruc_contratista, contratista, orden, fecha_emision, monto, estado, mef_norm(descripcion) AS d,
           left(descripcion, 200) AS descripcion,
           COALESCE(substring(tipo_contratacion FROM 'hasta (\d+) UIT')::int, 8) * uit_soles(extract(year FROM fecha_emision)::int) AS tope
      FROM conosce_ordenes
     WHERE fecha_emision >= p_desde AND monto >= 5000 AND moneda = 'Nuevos Soles'
       AND tipo_orden = 'Orden de Compra' AND tipo_contratacion ILIKE 'Contrataciones hasta%' AND estado IS DISTINCT FROM 'Anulada'
       AND ruc_contratista ~ '^(10|20)\d{9}$'
     ORDER BY entidad_ruc, extract(year FROM fecha_emision), NULLIF(substring(nro_orden FROM '\d+'), ''), anio DESC, mes DESC;
  DELETE FROM ordenes_repetidas;
  INSERT INTO ordenes_repetidas (entidad_ruc, ruc_contratista, contratista, monto, ordenes, total, tope, desde, hasta, dias, devengadas,
                                 objeto, severidad, detalle)
  SELECT entidad_ruc, ruc_contratista, max(contratista), monto, count(*), sum(monto), min(tope), min(fecha_emision), max(fecha_emision),
         max(fecha_emision) - min(fecha_emision), count(*) FILTER (WHERE estado = 'Devengada'), min(descripcion),
         CASE WHEN sum(monto) > min(tope) AND min(monto) >= 0.85 * min(tope) THEN 'alta'
              WHEN sum(monto) > min(tope) OR count(*) FILTER (WHERE estado = 'Devengada') = count(*) THEN 'media'
              ELSE 'baja' END,
         jsonb_agg(jsonb_build_object('orden', orden, 'fecha', fecha_emision, 'estado', estado) ORDER BY fecha_emision)
    FROM _o
   GROUP BY entidad_ruc, ruc_contratista, monto, d
  HAVING count(*) >= 2 AND max(fecha_emision) - min(fecha_emision) BETWEEN 7 AND 90 AND length(min(d)) >= 25;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE ordenes_repetidas;
  RETURN n;
END $$;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.ordenes_repetidas OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_ordenes_repetidas(date) OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab', 'dev_api', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.ordenes_repetidas TO %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_ordenes_repetidas(date) FROM PUBLIC;
