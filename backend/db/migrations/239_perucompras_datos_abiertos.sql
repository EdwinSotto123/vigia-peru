-- 239: el índice mensual de órdenes de los Catálogos que Perú Compras publica en la PNDA (2026-11-03).
--
-- Fuente: https://www.datosabiertos.gob.pe/dataset/órdenes-de-compra-realizadas-través-de-los-catálogos-electrónicos-central-de-compras
-- (ReportePCBienes<AAAAMM>.csv y ReportePCServicios<AAAAMM>.csv, desde 2022-01, `;`, Latin-1). No trae ítems, pero suma
-- dos cosas que el reporte detallado (migración 236) no tiene:
--   · el enlace a la orden electrónica que genera la plataforma (obtenerPdfOrdenPublico?ID_OrdenCompra=…, con su id), en
--     unas 3 de cada 4 órdenes de bienes;
--   · las órdenes de SERVICIOS (la emisión de boletos aéreos, ~700 al mes), que el reporte detallado devuelve vacías.
-- Las de servicios entran también a perucompras_orden, sin ítems, con acuerdo_id = -1 (la carga del reporte detallado
-- borra y reescribe por acuerdo_id, así que nunca las toca).
--
-- Privacidad: la orden de un boleto aéreo lleva el nombre y el documento del pasajero; sus enlaces se guardan aquí pero la
-- API no los publica. El proveedor puede ser una persona natural: la API lo tapa como en las demás tablas.
--
-- DEV: bash infrastructure/deploy/dev.sh migrar backend/db/migrations/239_perucompras_datos_abiertos.sql

CREATE TABLE IF NOT EXISTS perucompras_dab (
  orden               text PRIMARY KEY,          -- OCAM-2026-1556-14 (sin la versión)
  version             smallint,
  tipo                text NOT NULL,             -- BIENES | SERVICIOS
  id_orden_compra     bigint,                    -- el id interno de la plataforma (del enlace a la orden electrónica)
  url_orden           text,                      -- la orden electrónica generada (PDF)
  url_digitalizada    text,                      -- la orden física digitalizada (bienes) o publicada (servicios)
  entidad_ruc         text,
  entidad             text,
  proveedor_ruc       text,
  proveedor           text,
  procedimiento       text,
  estado              text,
  descripcion_estado  text,
  fecha_formalizacion timestamp,
  fecha_ultimo_estado timestamp,
  subtotal            numeric(18, 2),
  igv                 numeric(18, 2),
  total               numeric(18, 2),
  acuerdo             text,
  fecha_proceso       timestamp,                 -- cuándo Perú Compras armó el archivo (vale la del archivo más reciente)
  archivo             text NOT NULL,
  cargado_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS perucompras_dab_entidad ON perucompras_dab (entidad_ruc);
CREATE INDEX IF NOT EXISTS perucompras_dab_tipo ON perucompras_dab (tipo);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE perucompras_dab OWNER TO vigia_jobs;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_api') THEN
    GRANT SELECT ON perucompras_dab TO vigia_api;
  END IF;
END $$;
