-- 49 · CONOSCE (OECE): adjudicaciones, postores y contratos de todo el país, por año.
--
-- El portal CONOSCE publica los reportes del SEACE como archivos sueltos, sin login, y los actualiza cada viernes:
--   https://conosce.osce.gob.pe/buscador/assets/67ae6c4a/reportes/<carpeta>/<año>/CONOSCE_<PREFIJO><año>_<n>.<csv|xlsx>
-- (adjudicaciones/ADJUDICACIONES, postor/POSTOR, contratos/CONTRATOS; desde 2018, algunos años sólo en XLSX).
-- La PNDA sólo trae los diccionarios. Antes de esto Vigía tenía postores de 385 procesos (los que leyeron los
-- agentes) y las adjudicaciones de la ventana del OCDS. El scraper `conosce` (backend/scrapers-worker) carga un año
-- por paso: borra el año y lo vuelve a copiar, en una transacción.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/49_conosce.sql

-- Fechas del SEACE como llegan: DD/MM/AAAA (adjudicaciones), AAAA-MM-DD[ hh:mm:ss] (contratos) o el número de
-- serie de Excel cuando el reporte vino en XLSX (46178 = 2026-06-05).
CREATE OR REPLACE FUNCTION conosce_fecha(t TEXT) RETURNS DATE LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN t ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN to_date(substring(t from '^\d{1,2}/\d{1,2}/\d{4}'), 'DD/MM/YYYY')
    WHEN t ~ '^\d{4}-\d{2}-\d{2}' THEN substring(t from '^\d{4}-\d{2}-\d{2}')::date
    WHEN t ~ '^\d{4,5}(\.\d+)?$' THEN DATE '1899-12-30' + floor(t::numeric)::int
  END
$$;

CREATE OR REPLACE FUNCTION conosce_num(t TEXT) RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN btrim(t) ~ '^-?\d+(\.\d+)?([eE][-+]?\d+)?$' THEN btrim(t)::numeric END
$$;

CREATE TABLE IF NOT EXISTS conosce_adjudicaciones (
  anio                  SMALLINT NOT NULL,
  codigo_entidad        TEXT,
  entidad_ruc           TEXT,
  entidad               TEXT,
  tipo_entidad          TEXT,
  entidad_departamento  TEXT,
  codigo_convocatoria   TEXT,
  objeto                TEXT,
  tipo_proceso          TEXT,
  nomenclatura          TEXT,
  descripcion_proceso   TEXT,
  n_item                INT,
  descripcion_item      TEXT,
  estado_item           TEXT,
  cantidad              NUMERIC,
  monto_referencial     NUMERIC(18, 2),
  monto_adjudicado      NUMERIC(18, 2),
  departamento_item     TEXT,
  moneda                TEXT,
  unidad_medida         TEXT,
  ruc_proveedor         TEXT,
  proveedor             TEXT,
  tipo_proveedor        TEXT,
  fecha_convocatoria    DATE,
  fecha_buenapro        DATE,
  fecha_consentimiento  DATE
);
CREATE INDEX IF NOT EXISTS conosce_adj_anio ON conosce_adjudicaciones (anio);
CREATE INDEX IF NOT EXISTS conosce_adj_proveedor ON conosce_adjudicaciones (ruc_proveedor, entidad_ruc);
CREATE INDEX IF NOT EXISTS conosce_adj_convocatoria ON conosce_adjudicaciones (codigo_convocatoria);

CREATE TABLE IF NOT EXISTS conosce_postores (
  anio                  SMALLINT NOT NULL,
  codigo_convocatoria   TEXT,
  fecha_convocatoria    DATE,
  n_item                INT,
  ruc_postor            TEXT,              -- RUC, o el código del consorcio en el SEACE
  postor                TEXT,
  fecha_propuesta       DATE
);
CREATE INDEX IF NOT EXISTS conosce_postores_anio ON conosce_postores (anio);
CREATE INDEX IF NOT EXISTS conosce_postores_convocatoria ON conosce_postores (codigo_convocatoria);
CREATE INDEX IF NOT EXISTS conosce_postores_ruc ON conosce_postores (ruc_postor);

CREATE TABLE IF NOT EXISTS conosce_contratos (
  anio                            SMALLINT NOT NULL,
  codigo_entidad                  TEXT,
  codigo_convocatoria             TEXT,
  descripcion_proceso             TEXT,
  n_cod_contrato                  TEXT,
  codigo_contrato                 TEXT,
  num_contrato                    TEXT,
  num_item                        INT,
  monto_contratado_total          NUMERIC(18, 2),
  monto_contratado_item           NUMERIC(18, 2),
  monto_adicional                 NUMERIC(18, 2),
  monto_reduccion                 NUMERIC(18, 2),
  monto_prorroga                  NUMERIC(18, 2),
  monto_complementario            NUMERIC(18, 2),
  moneda                          TEXT,
  ruc_contratista                 TEXT,
  ruc_destinatario_pago           TEXT,
  tiene_resolucion                TEXT,
  url_contrato                    TEXT,
  es_publicado                    TEXT,
  fecha_publicacion               DATE,
  fecha_suscripcion               DATE,
  fecha_vigencia_inicial          DATE,
  fecha_vigencia_final            DATE,
  fecha_vigencia_fin_actualizada  DATE
);
CREATE INDEX IF NOT EXISTS conosce_contratos_anio ON conosce_contratos (anio);
CREATE INDEX IF NOT EXISTS conosce_contratos_convocatoria ON conosce_contratos (codigo_convocatoria);
CREATE INDEX IF NOT EXISTS conosce_contratos_ruc ON conosce_contratos (ruc_contratista);

ALTER TABLE conosce_adjudicaciones OWNER TO vigia_jobs;
ALTER TABLE conosce_postores OWNER TO vigia_jobs;
ALTER TABLE conosce_contratos OWNER TO vigia_jobs;
ALTER FUNCTION conosce_fecha(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION conosce_num(TEXT) OWNER TO vigia_jobs;
GRANT SELECT ON conosce_adjudicaciones, conosce_postores, conosce_contratos TO vigia_api;
