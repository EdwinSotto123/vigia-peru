-- 129 · Contratos menores (≤8 UIT) del SEACE: la fase de contratación directa que NO está en el reporte de órdenes de
-- CONOSCE ni en los datos abiertos OCDS (que excluyen las ≤8 UIT). Dos fuentes del SEACE, unidas por el código CM:
--   · prod4 (Buscador de Contratos del Estado, api …:9000/api/bus/contrato/query/{anio}): el CONTRATO ya registrado —
--     entidad+RUC, proveedor+RUC, monto, objeto, estado, fechas y el PDF del contrato/orden. Es la fuente principal.
--   · prod6 (buscador público de procesos, …/s8uit-services/…): enriquece con el REQUERIMIENTO/TDR en PDF y la ventana
--     de cotización. Se une por `codigo` (nomenclaturaProceso de prod4 == desContratacion de prod6), match exacto.
-- Como prod4 trae los DOS RUC, esta tabla alimenta tres superficies de forma confiable (sin cruce difuso):
-- la sección «Contratos Menores», la ficha de la EMPRESA (por proveedor_ruc) y la de la ENTIDAD (por entidad_ruc).
-- OJO: el módulo de menores es FACULTATIVO para las entidades (Décima Sétima DCT del Reglamento de la Ley 32069), así
-- que esto NO es el universo de todas las ≤8 UIT del país, sino lo que las entidades registraron en el SEACE.
CREATE TABLE IF NOT EXISTS seace_menores (
  id_contrato            INTEGER PRIMARY KEY,   -- idContrato de prod4 (el contrato)
  codigo                 TEXT NOT NULL,         -- nomenclaturaProceso / código CM (llave con prod6), p.ej. CM-119-2026-ULO/MPT
  numero_contrato        TEXT,
  objeto                 TEXT,                  -- BIEN | SERVICIO
  descripcion            TEXT,
  entidad                TEXT,
  entidad_ruc            TEXT,
  proveedor              TEXT,
  proveedor_ruc          TEXT,
  monto                  NUMERIC(18, 2),
  moneda                 TEXT,
  estado                 TEXT,                  -- Publicado, etc. (estado del contrato en prod4)
  fecha_suscripcion      DATE,
  fecha_inicio           DATE,
  fecha_fin              DATE,
  anio                   SMALLINT NOT NULL,
  id_documento_contrato  TEXT,                  -- idDocumento del PDF del contrato/orden en prod4
  -- enriquecimiento prod6 (por código CM) --------------------------------------------------------------------------
  id_contrato_prod6      INTEGER,               -- idContrato en prod6 (otro sistema, otro id)
  estado_prod6           TEXT,                  -- Vigente | En Evaluación | Culminado
  fec_publica            DATE,
  fec_ini_cotizacion     DATE,
  fec_fin_cotizacion     DATE,
  id_requerimiento       TEXT,                  -- idContratoArchivo del requerimiento/TDR en prod6 (categoría 1)
  requerimiento_nombre   TEXT,
  match_prod6            TEXT,                  -- exacto | parcial | sin_match | pendiente
  capturado              TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE seace_menores IS 'Contratos menores ≤8 UIT del SEACE (prod4 contrato + prod6 requerimiento, unidos por código CM). Migración 129.';

-- Ficha de empresa: «contratos menores que ganó este proveedor».
CREATE INDEX IF NOT EXISTS seace_menores_proveedor ON seace_menores (proveedor_ruc, fecha_suscripcion DESC);
-- Ficha de entidad: «contratos menores de esta entidad».
CREATE INDEX IF NOT EXISTS seace_menores_entidad ON seace_menores (entidad_ruc, fecha_suscripcion DESC);
-- Sección general: las más recientes por año.
CREATE INDEX IF NOT EXISTS seace_menores_fecha ON seace_menores (fecha_suscripcion DESC);
-- Unir/actualizar por código CM (enriquecimiento prod6 e idempotencia de la carga).
CREATE INDEX IF NOT EXISTS seace_menores_codigo ON seace_menores (codigo);
