-- 355 · Empresa recién creada que recibe órdenes directas: se inscribe en la SUNAT y a los pocos días una entidad ya le
-- compra sin proceso de selección.
--
-- La señal «recién fundada» de Vigía mira los contratos de procesos. Lo menudo pasa por las órdenes (2026-11-17), y ahí no
-- existía. Medido en PROD ese día, empresas (RUC 20, sin consorcios) con alta desde 2020 y órdenes directas («hasta 8
-- UIT» u «otras contrataciones sin proceso»): 11 539 pares entidad-empresa con su primera orden a 90 días o menos del alta
-- y S/ 30 mil o más en su primer año (10 433 empresas, 2 104 entidades, S/ 1 398 M); 4 003 a 30 días o menos; 5 179 viven
-- de esa entidad (80 % o más de lo que vendieron por órdenes). Ejemplo: tres E.I.R.L. creadas en 2025 que a las 2 a 4
-- semanas reciben de una misma municipalidad distrital 74, 68 y 41 órdenes (S/ 2,9 M, 2,6 M y 1,7 M): todo lo que venden.
--
-- Un consorcio nace con su RUC al ganar un proceso (y sus órdenes «devienen» de él): por eso fuera los consorcios y sólo
-- órdenes directas. Puede ser legítimo: un negocio que ya existía con otro RUC (una persona natural que se vuelve
-- E.I.R.L.), una sucursal. Es un motivo para mirar quién la creó y quién pidió la compra.
--
--   severidad  alta   primera orden a 30 días o menos del alta, S/ 100 mil o más en su primer año y la entidad es el 80 %
--                     o más de lo que la empresa vendió por órdenes (creada para ese cliente);
--              media  primera orden a 60 días o menos con S/ 50 mil o más, o vive de esa entidad (80 % o más);
--              baja   el resto.
-- La bandera de la orden (API) cubre las órdenes de la empresa en esa entidad durante su primer año desde el alta.

CREATE TABLE IF NOT EXISTS empresa_recien_creada_ordenes (
  entidad_ruc    TEXT NOT NULL,
  ruc_empresa    TEXT NOT NULL,
  empresa        TEXT,
  fecha_alta     DATE NOT NULL,             -- alta en la SUNAT (padrón)
  primera_orden  DATE NOT NULL,             -- primera orden directa de la entidad
  dias           INT NOT NULL,              -- del alta a esa orden
  ordenes_1a     INT NOT NULL,              -- órdenes directas en su primer año desde el alta
  monto_1a       NUMERIC(18, 2) NOT NULL,
  ordenes        INT NOT NULL,              -- órdenes directas de la entidad, todas
  monto          NUMERIC(18, 2) NOT NULL,
  parte_entidad  NUMERIC(6, 4),             -- lo de esta entidad / todo lo que vendió por órdenes al Estado
  severidad      TEXT NOT NULL,
  PRIMARY KEY (entidad_ruc, ruc_empresa)
);
CREATE INDEX IF NOT EXISTS empresa_recien_creada_ordenes_empresa ON empresa_recien_creada_ordenes (ruc_empresa);
CREATE INDEX IF NOT EXISTS empresa_recien_creada_ordenes_orden ON empresa_recien_creada_ordenes (severidad, monto_1a DESC);

CREATE OR REPLACE FUNCTION refrescar_empresa_recien_creada_ordenes(p_desde date DEFAULT DATE '2019-01-01') RETURNS integer
LANGUAGE plpgsql SET work_mem = '256MB' AS $$
DECLARE n int;
BEGIN
  CREATE TEMP TABLE _rce ON COMMIT DROP AS
    SELECT r.ruc, r.nombre, r.fecha_alta
      FROM empresa_resumen r
     WHERE r.fecha_alta >= p_desde AND r.ruc ~ '^20\d{9}$'
       AND r.nombre !~* '(CONSORCIO|CONSORCIADO|ASOCIACION EN PARTICIPACION|UNION TEMPORAL)';
  CREATE UNIQUE INDEX ON _rce (ruc); ANALYZE _rce;
  CREATE TEMP TABLE _rco ON COMMIT DROP AS
    SELECT o.entidad_ruc, e.ruc, e.nombre, e.fecha_alta, min(o.fecha_emision) AS primera,
           (count(DISTINCT o.orden) FILTER (WHERE o.fecha_emision <= e.fecha_alta + 365))::int AS ordenes_1a,
           COALESCE(sum(o.monto) FILTER (WHERE o.fecha_emision <= e.fecha_alta + 365), 0) AS monto_1a,
           count(DISTINCT o.orden)::int AS ordenes, sum(o.monto) AS monto
      FROM _rce e JOIN conosce_ordenes o ON o.ruc_contratista = e.ruc
     WHERE o.fecha_emision >= e.fecha_alta AND o.fecha_emision <= current_date
       AND o.estado IS DISTINCT FROM 'Anulada' AND o.moneda = 'Nuevos Soles' AND o.monto > 0 AND o.monto_dudoso IS NULL
       AND (o.tipo_contratacion ILIKE 'Contrataciones hasta%' OR o.tipo_contratacion ILIKE 'Otras contrataciones sin proceso%')
     GROUP BY 1, 2, 3, 4
    HAVING min(o.fecha_emision) - e.fecha_alta <= 90;
  CREATE INDEX ON _rco (ruc); ANALYZE _rco;
  CREATE TEMP TABLE _rct ON COMMIT DROP AS
    SELECT a.ruc, sum(a.monto) AS total FROM empresa_orden_anual a WHERE a.ruc IN (SELECT DISTINCT ruc FROM _rco) GROUP BY 1;
  CREATE UNIQUE INDEX ON _rct (ruc); ANALYZE _rct;

  DELETE FROM empresa_recien_creada_ordenes;
  INSERT INTO empresa_recien_creada_ordenes (entidad_ruc, ruc_empresa, empresa, fecha_alta, primera_orden, dias, ordenes_1a, monto_1a, ordenes, monto,
                                             parte_entidad, severidad)
  SELECT x.entidad_ruc, x.ruc, x.nombre, x.fecha_alta, x.primera, x.dias, x.ordenes_1a, x.monto_1a, x.ordenes, x.monto, x.parte,
         CASE WHEN x.dias <= 30 AND x.monto_1a >= 100000 AND COALESCE(x.parte, 0) >= 0.8 THEN 'alta'
              WHEN (x.dias <= 60 AND x.monto_1a >= 50000) OR COALESCE(x.parte, 0) >= 0.8 THEN 'media'
              ELSE 'baja' END
    FROM (SELECT o.*, (o.primera - o.fecha_alta)::int AS dias, LEAST(1, round(o.monto / NULLIF(t.total, 0), 4)) AS parte
            FROM _rco o LEFT JOIN _rct t ON t.ruc = o.ruc
           WHERE o.monto_1a >= 30000) x;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE empresa_recien_creada_ordenes;
  RETURN n;
END $$;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.empresa_recien_creada_ordenes OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_empresa_recien_creada_ordenes(date) OWNER TO vigia_jobs;
  END IF;
  REVOKE ALL ON public.empresa_recien_creada_ordenes FROM PUBLIC;
  -- Sólo la API (migración 353: una tabla nueva no se abre a los agentes ni a vigia_ab).
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'dev_api', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.empresa_recien_creada_ordenes TO %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_empresa_recien_creada_ordenes(date) FROM PUBLIC;
