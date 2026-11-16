-- 314 · Lo que la Contraloría observó, en cifras: una fila por observación leída, con su tema y su perjuicio (2026-11-16).
--
-- La lectura con IA de las Fichas Resumen (migración 304; cargar_contraloria_fichas.py, paso `leer`) deja en
-- informe_control_ficha.campos -> 'ia' el tema de cada observación y el perjuicio que cuantifica. Para sumar por
-- entidad, por región, por tema o por año había que abrir ese JSON de 14 mil fichas en cada consulta. Aquí queda plano:
--
--   informe_control_observacion             (codigo, n) con tema, perjuicio, moneda y `cuenta`
--   refrescar_informe_control_observacion() la rehace desde las fichas (segundos)
--
-- `cuenta`: si varias observaciones de un mismo informe traen EL MISMO monto, es el total del informe repetido en cada
-- una (medido: un informe con tres observaciones de S/ 136,7 millones cada una y S/ 56 millones examinados). Sólo la
-- primera cuenta para las sumas; las demás conservan su monto para mostrarlo, con cuenta = false.
--
-- La usan GET /informes-control/resumen (el mapa nacional: por tema, por año y las entidades con más perjuicio señalado),
-- los conteos de /corrupcion/* (lo que se le observó a una entidad, una región o un partido, por tema) y el MCP.
--
-- El perjuicio es el que CUANTIFICA la observación según una lectura automática, que puede equivocarse: es un orden de
-- magnitud para saber dónde mirar, no una liquidación. La responsabilidad que identifica un informe es PRESUNTA.
-- No lleva textos ni personas.

SET lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS informe_control_observacion (
  codigo     TEXT    NOT NULL REFERENCES informes_control (codigo) ON DELETE CASCADE,
  n          INT     NOT NULL,
  tema       TEXT    NOT NULL CHECK (tema IN ('seleccion_contratacion', 'ejecucion_contractual', 'pagos_adelantos', 'personal_planillas',
                                              'bienes_almacen', 'presupuesto_tesoreria', 'otros')),
  perjuicio  NUMERIC,                          -- lo que la observación cuantifica (NULL si no lo cuantifica)
  moneda     TEXT    CHECK (moneda IN ('PEN', 'USD')),
  cuenta     BOOLEAN NOT NULL DEFAULT false,   -- entra a las sumas (no es el total del informe repetido)
  PRIMARY KEY (codigo, n)
);
COMMENT ON TABLE informe_control_observacion IS
  'Una fila por observación de un informe de control leída con IA: tema, perjuicio que cuantifica y si entra a las sumas '
  '(cuenta = false cuando repite el monto de otra observación del mismo informe). La rehace '
  'refrescar_informe_control_observacion(). Sin textos ni personas. Responsabilidad PRESUNTA.';
CREATE INDEX IF NOT EXISTS informe_control_observacion_tema ON informe_control_observacion (tema);
ALTER TABLE informe_control_observacion OWNER TO vigia_jobs;
REVOKE ALL ON informe_control_observacion FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON informe_control_observacion FROM %I', r);
      EXECUTE format('GRANT SELECT ON informe_control_observacion TO %I', r);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION refrescar_informe_control_observacion() RETURNS integer
LANGUAGE plpgsql SET work_mem = '64MB' SET statement_timeout = '300s' AS $$
DECLARE v_filas int;
BEGIN
  DROP TABLE IF EXISTS _ico;
  CREATE TEMP TABLE _ico ON COMMIT DROP AS
    SELECT DISTINCT ON (f.codigo, (x ->> 'n')::int) f.codigo, (x ->> 'n')::int AS n,
           CASE WHEN x ->> 'tema' IN ('seleccion_contratacion', 'ejecucion_contractual', 'pagos_adelantos', 'personal_planillas',
                                      'bienes_almacen', 'presupuesto_tesoreria') THEN x ->> 'tema' ELSE 'otros' END AS tema,
           CASE WHEN (x ->> 'perjuicio') ~ '^[0-9]+(\.[0-9]+)?$' AND (x ->> 'perjuicio')::numeric > 0 THEN (x ->> 'perjuicio')::numeric END AS perjuicio,
           CASE WHEN x ->> 'moneda' = 'USD' THEN 'USD' ELSE 'PEN' END AS moneda
      FROM informe_control_ficha f
      JOIN informes_control i ON i.codigo = f.codigo
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(f.campos -> 'ia' -> 'observaciones') = 'array'
                                                   THEN f.campos -> 'ia' -> 'observaciones' ELSE '[]'::jsonb END) x
     WHERE (x ->> 'n') ~ '^\d{1,3}$'
     ORDER BY f.codigo, (x ->> 'n')::int;
  ANALYZE _ico;

  DELETE FROM informe_control_observacion;
  INSERT INTO informe_control_observacion (codigo, n, tema, perjuicio, moneda, cuenta)
  SELECT codigo, n, tema, perjuicio, CASE WHEN perjuicio IS NOT NULL THEN moneda END,
         perjuicio IS NOT NULL AND row_number() OVER (PARTITION BY codigo, perjuicio, moneda ORDER BY n) = 1
    FROM _ico;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  ANALYZE informe_control_observacion;
  RETURN v_filas;
END $$;
ALTER FUNCTION refrescar_informe_control_observacion() OWNER TO vigia_jobs;

SET statement_timeout = '300s';
SELECT refrescar_informe_control_observacion() AS observaciones;
RESET statement_timeout;
