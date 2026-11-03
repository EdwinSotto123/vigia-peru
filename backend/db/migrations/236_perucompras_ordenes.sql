-- 236: las órdenes de los Catálogos Electrónicos de Perú Compras, con sus ítems y precios unitarios (2026-11-02).
--
-- Fuente: el reporte detallado público de https://catalogos.perucompras.gob.pe/ConsultaOrdenesPub (POST
-- consultaOrdenesDetallado, por acuerdo marco y rango de fechas; sin captcha ni cuenta). Lo baja y lo carga
-- backend/scripts/cargar_perucompras.py. CONOSCE y el SEACE registran cada orden sólo por su monto total; ésta es la única
-- fuente nacional con QUÉ se compró: la ficha-producto (descripción, marca, número de parte), la cantidad y el precio
-- unitario, más el estado (aceptada, entregada con retraso, pagada, resuelta) y los PDF de la orden y de su sustento.
--
-- Cada orden llega en versiones (OCAM-2026-88-393-0, -1…): la -0 es lo pedido (ítem, cantidad, subtotal; el precio
-- unitario viene en 0) y la siguiente, las entregas (número de entrega, fechas, plazo, precio unitario). Aquí la orden
-- es una fila por OCAM sin la versión, con el estado de la versión más reciente; los ítems guardan su versión.
--
-- Privacidad (docs/PRIVACIDAD.md): NO se guardan «Usuario Creación OC» (DNI e IP del funcionario que la creó), la
-- dirección ni el ubigeo del proveedor, ni la dirección de entrega (sí su ubigeo). El script los descarta al bajar: ni
-- en disco quedan. El proveedor puede ser una persona natural (RUC 10, ~1 de cada 5 líneas): la API lo tapa como en las
-- demás tablas (publicar).
--
-- DEV: bash infrastructure/deploy/dev.sh migrar backend/db/migrations/236_perucompras_ordenes.sql

CREATE TABLE IF NOT EXISTS perucompras_orden (
  orden               text PRIMARY KEY,          -- OCAM-2026-88-393 (sin la versión)
  acuerdo_id          integer NOT NULL,          -- id del acuerdo marco en el portal (324)
  acuerdo_codigo      text,                      -- EXT-CE-2024-3
  acuerdo             text,                      -- MATERIALES E INSUMOS DE LIMPIEZA…
  tipo                text NOT NULL,             -- BIENES | SERVICIOS
  entidad_ruc         text,
  entidad             text,
  unidad_ejecutora    text,                      -- código SIAF de la ejecutora (88, 300334)
  proveedor_ruc       text,
  proveedor           text,
  procedimiento       text,                      -- COMPRA ORDINARIA | GRAN COMPRA
  tipo_compra         text,                      -- INDIVIDUAL | CORPORATIVA…
  estado              text,                      -- de la versión más reciente: PAGADA, ACEPTADA, RESUELTA…
  estado_motivo       text,
  estado_descripcion  text,
  nro_orden_fisica    text,                      -- el número de la orden en el SIGA de la entidad ("OC 199-2026")
  fecha_publicacion   date,
  fecha_aceptacion    date,
  fecha_ultimo_estado timestamp,
  subtotal            numeric(18, 2),
  igv                 numeric(18, 2),
  total               numeric(18, 2),
  pdf_orden           text,                      -- nombre del archivo en el blob de Perú Compras (orden física)
  pdf_sustento        text,                      -- «Informe Sustento» (cuadro comparativo de proformas)
  cesion              text,                      -- cesión de derechos de cobro, si la hubo
  versiones           smallint,
  cargado_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS perucompras_orden_entidad ON perucompras_orden (entidad_ruc, fecha_publicacion DESC);
CREATE INDEX IF NOT EXISTS perucompras_orden_proveedor ON perucompras_orden (proveedor_ruc, fecha_publicacion DESC);
CREATE INDEX IF NOT EXISTS perucompras_orden_fecha ON perucompras_orden (fecha_publicacion DESC);
CREATE INDEX IF NOT EXISTS perucompras_orden_acuerdo ON perucompras_orden (acuerdo_id);

CREATE TABLE IF NOT EXISTS perucompras_item (
  orden               text NOT NULL REFERENCES perucompras_orden (orden) ON DELETE CASCADE,
  version             smallint NOT NULL,         -- 0 = lo pedido; 1… = las entregas
  linea               smallint NOT NULL,         -- orden de la fila dentro de la versión
  nro_entrega         smallint,
  catalogo            text,
  categoria           text,
  descripcion         text,                      -- la ficha-producto: lo que se compró
  marca               text,
  nro_parte           text,                      -- el mismo número de parte se repite entre entidades: compara precios
  link_ficha          text,
  flete_unitario      numeric(18, 5),
  fecha_inicio_entrega date,
  plazo_entrega       integer,                   -- días
  fecha_fin_entrega   date,
  ubigeo_entrega      text,
  cantidad            numeric(18, 4),
  afecto_igv          boolean,
  precio_unitario     numeric(18, 5),            -- en la versión 0 viene en 0: usar subtotal / cantidad
  subtotal            numeric(18, 5),
  igv                 numeric(18, 5),
  total               numeric(18, 5),
  PRIMARY KEY (orden, version, linea)
);
CREATE INDEX IF NOT EXISTS perucompras_item_parte ON perucompras_item (nro_parte) WHERE version = 0;
CREATE INDEX IF NOT EXISTS perucompras_item_categoria ON perucompras_item (categoria) WHERE version = 0;

-- Qué tramo (acuerdo, tipo, desde-hasta) entró y con qué huella: la carga sólo reescribe lo que cambió.
CREATE TABLE IF NOT EXISTS perucompras_tramo (
  acuerdo_id   integer NOT NULL,
  tipo         text NOT NULL,
  desde        date NOT NULL,
  hasta        date NOT NULL,
  sha256       text NOT NULL,
  ordenes      integer NOT NULL,
  lineas       integer NOT NULL,
  cargado_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (acuerdo_id, tipo, desde, hasta)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE perucompras_orden OWNER TO vigia_jobs;
    ALTER TABLE perucompras_item OWNER TO vigia_jobs;
    ALTER TABLE perucompras_tramo OWNER TO vigia_jobs;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_api') THEN
    GRANT SELECT ON perucompras_orden, perucompras_item TO vigia_api;
  END IF;
END $$;
