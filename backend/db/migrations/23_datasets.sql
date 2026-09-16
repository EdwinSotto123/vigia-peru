-- 23 · Fuentes externas normalizadas (Frente D del plan 2026-09-16).
--
-- Principio: todo dataset que baja la laptop/VPS desde IP peruana queda registrado en
-- `datasets_cargas` (fuente, clave, sha256 del crudo, filas, GCS) para que los pipelines
-- sean idempotentes (no re-cargar un archivo cuyo sha256 ya está) y para que
-- /admin/cobertura pueda mostrar "Fuentes externas" sin tocar cada tabla.
--
-- Tablas afectadas:
--   · datasets_cargas        (nueva)  registro de cargas por fuente/clave
--   · visitas_entidades      (+cols)  fuente, periodo AAAA-MM, sha256, descargado_at + índices
--   · onpe_aportantes        (+cols)  proceso, sha256, descargado_at, ruc_organizacion, aporte_clave
--   · jne_autoridades        (nueva)  autoridades electas por ubigeo con DNI, partido y periodo
--   · dji_funcionarios/empleos (si no existen) — esquema de backend/db/schemas/dji_schema.sql
--   · datasets_cobertura     (vista)  una fila por fuente: filas, última fecha, última carga

-- ── registro de cargas ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS datasets_cargas (
    id             BIGSERIAL PRIMARY KEY,
    fuente         TEXT        NOT NULL,          -- pnda_visitas | onpe_claridad | jne_infogob | pnda_dji | …
    clave          TEXT        NOT NULL,          -- periodo AAAA-MM | proceso electoral | region | parte
    tabla          TEXT,                          -- tabla destino
    archivo        TEXT,                          -- nombre del crudo
    gcs_uri        TEXT,                          -- gs://vigia-peru-batch/raw/<fuente>/<clave>/<archivo>
    sha256         TEXT        NOT NULL,
    bytes          BIGINT,
    filas          INTEGER,                       -- filas cargadas en la tabla destino
    fuente_url     TEXT,                          -- página/endpoint de origen
    descargado_at  TIMESTAMPTZ,
    cargado_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado         TEXT        NOT NULL DEFAULT 'ok',   -- ok | error
    error          TEXT,
    UNIQUE (fuente, clave)
);
CREATE INDEX IF NOT EXISTS datasets_cargas_fuente_idx ON datasets_cargas (fuente, cargado_at DESC);

-- ── visitas_entidades: trazabilidad + índices que usa la regla lobby_visits_pre_convocatoria ──
ALTER TABLE visitas_entidades
    ADD COLUMN IF NOT EXISTS fuente        TEXT DEFAULT 'pnda_visitas',
    ADD COLUMN IF NOT EXISTS periodo       TEXT,            -- AAAA-MM del reporte mensual
    ADD COLUMN IF NOT EXISTS sha256        TEXT,            -- del XLSX crudo
    ADD COLUMN IF NOT EXISTS descargado_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS visitas_periodo_idx        ON visitas_entidades (periodo);
CREATE INDEX IF NOT EXISTS visitas_doc_fecha_idx      ON visitas_entidades (numero_documento, fecha_visita);
CREATE INDEX IF NOT EXISTS visitas_entidad_fecha_idx  ON visitas_entidades (entidad_visitada_norm, fecha_visita);
CREATE INDEX IF NOT EXISTS visitas_visitante_trgm     ON visitas_entidades USING gin (visitante_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS visitas_ent_visitante_idx  ON visitas_entidades (upper(entidad_visitante))
    WHERE entidad_visitante IS NOT NULL;

-- ── onpe_aportantes: proceso electoral + trazabilidad ──────────────────────────────────────
-- Mapeo con el esquema pedido en el plan:
--   proceso → proceso · organizacion_politica → partido · aportante_nombre → nombre_original
--   aportante_doc → numero_documento (DNI 8 / RUC 11, completo) · tipo_aporte · monto
--   fecha → fecha_aporte · fuente_url · sha256
ALTER TABLE onpe_aportantes
    ADD COLUMN IF NOT EXISTS proceso          TEXT,        -- EG2021 | ERM2022 | EG2026 | IFA2023 …
    ADD COLUMN IF NOT EXISTS ruc_organizacion TEXT,        -- RUC de la organización política receptora
    ADD COLUMN IF NOT EXISTS tipo_receptor    TEXT,        -- organizacion | candidato
    ADD COLUMN IF NOT EXISTS receptor         TEXT,        -- candidato (si el aporte fue a un candidato)
    ADD COLUMN IF NOT EXISTS aporte_clave     TEXT,        -- hash estable de la fila (dedup)
    ADD COLUMN IF NOT EXISTS sha256           TEXT,        -- del JSON crudo del que salió
    ADD COLUMN IF NOT EXISTS descargado_at    TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS onpe_apt_proceso_idx   ON onpe_aportantes (proceso);
CREATE INDEX IF NOT EXISTS onpe_apt_ruc_org_idx   ON onpe_aportantes (ruc_organizacion);
CREATE INDEX IF NOT EXISTS onpe_apt_nombre_trgm   ON onpe_aportantes USING gin (nombre gin_trgm_ops);
CREATE UNIQUE INDEX IF NOT EXISTS onpe_apt_clave_uq ON onpe_aportantes (aporte_clave) WHERE aporte_clave IS NOT NULL;

-- ── jne_autoridades: quién gobierna cada ubigeo hoy (y antes) ─────────────────────────────
CREATE TABLE IF NOT EXISTS jne_autoridades (
    id                    BIGSERIAL PRIMARY KEY,
    proceso               TEXT NOT NULL,             -- ERM2022 | ERM2018 | EG2021 …
    ubigeo                TEXT,                      -- INEI 2/4/6 dígitos (región/provincia/distrito)
    departamento          TEXT,
    provincia             TEXT,
    distrito              TEXT,
    cargo                 TEXT NOT NULL,             -- GOBERNADOR REGIONAL | ALCALDE PROVINCIAL | REGIDOR DISTRITAL …
    nombre                TEXT NOT NULL,             -- tal como viene
    nombre_norm           TEXT NOT NULL,             -- UPPER sin tildes (APELLIDOS NOMBRES)
    dni                   TEXT,
    organizacion_politica TEXT,
    periodo_inicio        DATE,
    periodo_fin           DATE,
    id_hoja_vida          BIGINT,                    -- id en la Plataforma Electoral del JNE (si se conoce)
    fuente                TEXT NOT NULL DEFAULT 'jne_infogob',
    fuente_url            TEXT,
    sha256                TEXT,
    descargado_at         TIMESTAMPTZ,
    cargado_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS jne_aut_uq ON jne_autoridades (proceso, cargo, nombre_norm, COALESCE(ubigeo, ''));
CREATE INDEX IF NOT EXISTS jne_aut_dni_idx      ON jne_autoridades (dni);
CREATE INDEX IF NOT EXISTS jne_aut_ubigeo_idx   ON jne_autoridades (ubigeo);
CREATE INDEX IF NOT EXISTS jne_aut_nombre_trgm  ON jne_autoridades USING gin (nombre_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS jne_aut_org_idx      ON jne_autoridades (organizacion_politica);
CREATE INDEX IF NOT EXISTS jne_aut_vigente_idx  ON jne_autoridades (periodo_inicio, periodo_fin);

-- jne_candidaturas: índice trigram sobre `nombre` (query_jne_candidaturas usa `nombre % q`).
CREATE INDEX IF NOT EXISTS idx_jne_nombre_trgm ON jne_candidaturas USING gin (nombre gin_trgm_ops);

-- ── DJI (Contraloría) — mismo esquema que backend/db/schemas/dji_schema.sql + trazabilidad ─
CREATE TABLE IF NOT EXISTS dji_funcionarios (
    codigo_ddjj         BIGINT,
    tipo_documento      TEXT,
    apellido_paterno    TEXT,
    apellido_materno    TEXT,
    nombres             TEXT,
    entidad             TEXT,
    cargo               TEXT,
    fecha_elaboracion   TEXT,
    fecha_presentacion  TEXT,
    fecha_inicio_cargo  TEXT,
    fecha_cese_cargo    TEXT,
    nombre_norm         TEXT GENERATED ALWAYS AS (
        upper(immutable_unaccent(coalesce(apellido_paterno,'') || ' ' || coalesce(apellido_materno,'') || ' ' || coalesce(nombres,'')))
    ) STORED
);
CREATE INDEX IF NOT EXISTS dji_funcionarios_codigo_idx  ON dji_funcionarios (codigo_ddjj);
CREATE INDEX IF NOT EXISTS dji_funcionarios_nombre_trgm ON dji_funcionarios USING gin (nombre_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS dji_funcionarios_entidad_idx ON dji_funcionarios (upper(entidad));

CREATE TABLE IF NOT EXISTS dji_empleos (
    codigo_ddjj         BIGINT,
    ruc_entidad_raw     TEXT,
    ruc_entidad         TEXT,
    nombre_entidad      TEXT,
    cargo               TEXT,
    fecha_inicio        TEXT,
    fecha_cese          TEXT,
    fecha_elaboracion   TEXT,
    fecha_presentacion  TEXT
);
CREATE INDEX IF NOT EXISTS dji_empleos_codigo_idx ON dji_empleos (codigo_ddjj);
CREATE INDEX IF NOT EXISTS dji_empleos_ruc_idx    ON dji_empleos (ruc_entidad);

CREATE OR REPLACE VIEW dji_puerta_giratoria AS
SELECT f.codigo_ddjj, f.nombre_norm, f.entidad AS entidad_actual, f.cargo AS cargo_actual,
       e.ruc_entidad AS ruc_empleador_previo, e.nombre_entidad AS empleador_previo,
       e.cargo AS cargo_previo, e.fecha_inicio, e.fecha_cese
FROM dji_funcionarios f
JOIN dji_empleos e USING (codigo_ddjj)
WHERE e.ruc_entidad LIKE '20%';

-- ── vista para /admin/cobertura · "Fuentes externas" ───────────────────────────────────────
CREATE OR REPLACE VIEW datasets_cobertura AS
SELECT fuente,
       max(tabla)                                      AS tabla,
       count(*)                                        AS cargas,
       count(*) FILTER (WHERE estado <> 'ok')          AS cargas_con_error,
       sum(filas)                                      AS filas,
       max(clave)                                      AS ultima_clave,
       max(descargado_at)                              AS ultima_descarga,
       max(cargado_at)                                 AS ultima_carga,
       (array_agg(error ORDER BY cargado_at DESC) FILTER (WHERE error IS NOT NULL))[1] AS ultimo_error
FROM datasets_cargas
GROUP BY fuente;
