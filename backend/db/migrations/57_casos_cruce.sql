-- 57 · Casos cruzados: un proceso con buena pro cuyo ganador tiene cruces con otras fuentes, en una tabla propia.
--
-- Los cruces (`cruces_proveedor`, migraciones 48–56) sólo se veían dentro de la ficha de cada contrato y en la
-- pestaña de la entidad. Para listarlos a escala nacional con filtros (tipo de cruce, severidad, departamento,
-- entidad, tipo de contratación, fechas, monto) hace falta juntarlos por proceso × ganador, con lo que se filtra:
-- armar ese join en cada pedido costaría segundos (jsonb de awards × consorcios × cruces), así que se materializa.
--
--   casos_cruce   una fila por (ocid, ruc del ganador o integrante del consorcio) con al menos un cruce.
--                 `tipos` y `cruces` (tipo + severidad) para filtrar y pintar; `puntaje` para ordenar
--                 (alta 10, media 3, baja 1, por tipo distinto); `severidad` = la más alta.
--
-- `refrescar_casos_cruce()` rehace la tabla (segundos); la llama vigia-scrapers después de `refrescar_cruces()`.
-- No tiene datos personales: los nombres y el DNI siguen sólo en `cruces_proveedor`.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/57_casos_cruce.sql

CREATE TABLE IF NOT EXISTS casos_cruce (
  ocid               TEXT NOT NULL,
  ruc                TEXT NOT NULL,
  proveedor          TEXT,
  consorcio          TEXT,
  codigo             TEXT,
  objeto             TEXT,
  tipo_contratacion  TEXT,
  entidad_ruc        TEXT,
  entidad            TEXT,
  departamento       TEXT,          -- ubigeo de 2 dígitos
  fecha_buena_pro    DATE,
  monto              NUMERIC(18, 2),
  tipos              TEXT[] NOT NULL,
  cruces             JSONB NOT NULL,
  n_alta             INT NOT NULL,
  n_media            INT NOT NULL,
  n_baja             INT NOT NULL,
  severidad          TEXT NOT NULL,
  puntaje            INT NOT NULL,
  texto              TEXT,          -- búsqueda sin tildes: empresa, consorcio, entidad, objeto, código y RUCs (no personas)
  PRIMARY KEY (ocid, ruc)
);
CREATE INDEX IF NOT EXISTS casos_cruce_orden ON casos_cruce (puntaje DESC, fecha_buena_pro DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS casos_cruce_tipos ON casos_cruce USING gin (tipos);
CREATE INDEX IF NOT EXISTS casos_cruce_entidad ON casos_cruce (entidad_ruc);

ALTER TABLE casos_cruce OWNER TO vigia_jobs;
GRANT SELECT ON casos_cruce TO vigia_api;
GRANT SELECT ON entidades, zonas TO vigia_jobs;

CREATE OR REPLACE FUNCTION refrescar_casos_cruce() RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  -- Ganadores como en refrescar_cruces() (migración 56): suppliers del OCDS, consorcios abiertos en sus integrantes.
  DROP TABLE IF EXISTS _kc_sup;
  CREATE TEMP TABLE _kc_sup ON COMMIT DROP AS
    SELECT c.ocid, regexp_replace(s->>'id', '^PE-RUC-', '') AS sup, s->>'name' AS nombre,
           (aw->'value'->>'amount')::numeric AS monto, NULLIF(aw->>'date', '')::date AS f
    FROM convocatorias c,
         jsonb_array_elements(COALESCE(c.ocds_payload->'awards', '[]'::jsonb)) aw,
         jsonb_array_elements(COALESCE(aw->'suppliers', '[]'::jsonb)) s
    WHERE c.ocid NOT LIKE 'ocds-vigia-%';
  DROP TABLE IF EXISTS _kc_miem;
  CREATE TEMP TABLE _kc_miem ON COMMIT DROP AS
    SELECT DISTINCT ON (ruc_consorcio, ruc_miembro) ruc_consorcio, ruc_miembro, miembro
    FROM conosce_consorcios WHERE ruc_miembro ~ '^(10|20)\d{9}$' ORDER BY ruc_consorcio, ruc_miembro, anio DESC;
  CREATE INDEX ON _kc_miem (ruc_consorcio);
  ANALYZE _kc_sup;
  ANALYZE _kc_miem;
  DROP TABLE IF EXISTS _kc_g;
  CREATE TEMP TABLE _kc_g ON COMMIT DROP AS
    SELECT x.ocid, COALESCE(m.ruc_miembro, x.sup) AS ruc, max(COALESCE(m.miembro, x.nombre)) AS proveedor,
           max(CASE WHEN m.ruc_miembro IS NOT NULL THEN x.nombre END) AS consorcio, max(x.monto) AS monto, max(x.f) AS f
    FROM _kc_sup x LEFT JOIN _kc_miem m ON m.ruc_consorcio = x.sup AND x.sup !~ '^(10|20)\d{9}$'
    WHERE COALESCE(m.ruc_miembro, x.sup) ~ '^(10|20)\d{9}$'
    GROUP BY 1, 2;
  CREATE INDEX ON _kc_g (ruc);
  ANALYZE _kc_g;

  DELETE FROM casos_cruce;
  INSERT INTO casos_cruce (ocid, ruc, proveedor, consorcio, codigo, objeto, tipo_contratacion, entidad_ruc, entidad,
                           departamento, fecha_buena_pro, monto, tipos, cruces, n_alta, n_media, n_baja, severidad,
                           puntaje, texto)
  SELECT g.ocid, g.ruc, g.proveedor, g.consorcio, c.codigo, c.objeto,
         COALESCE(c.tipo_contratacion, CASE c.categoria WHEN 'goods' THEN 'bienes' WHEN 'services' THEN 'servicios'
                                                          WHEN 'works' THEN 'obras' END),
         c.entidad_ruc::text, e.nombre, left(c.ubigeo_zona, 2),
         COALESCE(c.fecha_buena_pro, g.f), g.monto,   -- la columna casi nunca viene: la fecha de la adjudicación del OCDS
         k.tipos, k.cruces, k.n_alta, k.n_media, k.n_baja,
         CASE WHEN k.n_alta > 0 THEN 'alta' WHEN k.n_media > 0 THEN 'media' ELSE 'baja' END,
         10 * k.n_alta + 3 * k.n_media + k.n_baja,
         -- Una persona natural (RUC 10) no se busca por su nombre ni su RUC: la API le tapa un apellido.
         lower(unaccent(concat_ws(' ', CASE WHEN g.ruc LIKE '20%' THEN g.proveedor END, g.consorcio, e.nombre, c.objeto,
                                  c.codigo, CASE WHEN g.ruc LIKE '20%' THEN g.ruc END, c.entidad_ruc)))
  FROM _kc_g g
  JOIN convocatorias c ON c.ocid = g.ocid
  LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
  CROSS JOIN LATERAL (
    -- Un tipo cuenta una vez, con su severidad más alta.
    SELECT array_agg(t.tipo ORDER BY t.rango, t.tipo) AS tipos,
           jsonb_agg(jsonb_build_object('tipo', t.tipo, 'severidad', t.severidad, 'n', t.n) ORDER BY t.rango, t.tipo) AS cruces,
           count(*) FILTER (WHERE t.severidad = 'alta')::int AS n_alta,
           count(*) FILTER (WHERE t.severidad = 'media')::int AS n_media,
           count(*) FILTER (WHERE t.severidad = 'baja')::int AS n_baja
    FROM (
      SELECT p.tipo, min(CASE p.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END) AS rango,
             (ARRAY['alta', 'media', 'baja'])[1 + min(CASE p.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END)] AS severidad,
             count(*)::int AS n
      FROM cruces_proveedor p
      WHERE p.ruc_empresa = g.ruc AND (p.ocid IS NULL OR p.ocid = g.ocid)
      GROUP BY p.tipo
    ) t
  ) k
  WHERE k.tipos IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE casos_cruce;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_casos_cruce() OWNER TO vigia_jobs;

SELECT refrescar_casos_cruce();
