-- Vigía Perú · Convocatorias y adjudicaciones ─────────────────────
-- Modelo OCDS de OECE: una convocatoria → N items → N postores → N ofertas.
-- Para items y ofertas usamos PRIMARY KEY con BIGSERIAL para no acoplar
-- al schema OCDS (que tiene IDs internos).

-- ─── Convocatorias (releases OCDS) ────────────────────────────────
CREATE TABLE IF NOT EXISTS convocatorias (
  ocid                  TEXT PRIMARY KEY,
  codigo                TEXT NOT NULL,
  entidad_ruc           CHAR(11) REFERENCES entidades (ruc),
  objeto                TEXT NOT NULL,
  tipo_proceso          TEXT,
  modalidad_pago        TEXT,
  cuantia_referencial   NUMERIC,
  fuente_financiamiento TEXT,
  fecha_convocatoria    DATE,
  fecha_buena_pro       DATE,
  region                TEXT,
  ubicacion_geo         GEOGRAPHY(POINT, 4326),
  ocds_payload          JSONB,
  texto_busqueda        TSVECTOR
                          GENERATED ALWAYS AS (
                            to_tsvector('spanish',
                              coalesce(codigo,'') || ' ' ||
                              coalesce(objeto,'') || ' ' ||
                              coalesce(region,'')
                            )
                          ) STORED,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_busqueda  ON convocatorias USING GIN (texto_busqueda);
CREATE INDEX IF NOT EXISTS idx_conv_entidad   ON convocatorias (entidad_ruc);
CREATE INDEX IF NOT EXISTS idx_conv_fechabp   ON convocatorias (fecha_buena_pro DESC);
CREATE INDEX IF NOT EXISTS idx_conv_region    ON convocatorias (region);
CREATE INDEX IF NOT EXISTS idx_conv_codigo    ON convocatorias (codigo);


-- ─── Items por convocatoria ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS convocatoria_items (
  id                    BIGSERIAL PRIMARY KEY,
  ocid                  TEXT NOT NULL REFERENCES convocatorias (ocid) ON DELETE CASCADE,
  numero_item           INT NOT NULL,
  descripcion           TEXT,
  descripcion_corta     TEXT,
  cantidad              NUMERIC,
  unidad                TEXT,
  cuantia_referencial   NUMERIC,
  precio_unit_ref       NUMERIC,
  cubso                 TEXT,
  especs_tecnicas       JSONB,
  UNIQUE (ocid, numero_item)
);

CREATE INDEX IF NOT EXISTS idx_items_ocid     ON convocatoria_items (ocid);
CREATE INDEX IF NOT EXISTS idx_items_cubso    ON convocatoria_items (cubso);


-- ─── Postores que se presentaron ──────────────────────────────────
CREATE TABLE IF NOT EXISTS postores (
  id                    BIGSERIAL PRIMARY KEY,
  ocid                  TEXT NOT NULL REFERENCES convocatorias (ocid) ON DELETE CASCADE,
  empresa_ruc           CHAR(11) REFERENCES empresas (ruc),
  tipo                  TEXT NOT NULL CHECK (tipo IN (
                          'persona_juridica', 'consorcio', 'persona_natural'
                        )),
  rnp_vigente           BOOLEAN,
  UNIQUE (ocid, empresa_ruc)
);

CREATE INDEX IF NOT EXISTS idx_postores_empresa ON postores (empresa_ruc);


-- ─── Ofertas por (postor × item) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS ofertas (
  id                    BIGSERIAL PRIMARY KEY,
  postor_id             BIGINT NOT NULL REFERENCES postores (id) ON DELETE CASCADE,
  item_id               BIGINT NOT NULL REFERENCES convocatoria_items (id) ON DELETE CASCADE,
  monto_ofertado        NUMERIC,
  porcentaje_referencial NUMERIC(6,3),
  admitida              BOOLEAN DEFAULT FALSE,
  calificada            BOOLEAN DEFAULT FALSE,
  ganadora              BOOLEAN DEFAULT FALSE,
  UNIQUE (postor_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_ofertas_ganadora ON ofertas (ganadora) WHERE ganadora = TRUE;
CREATE INDEX IF NOT EXISTS idx_ofertas_item     ON ofertas (item_id);
