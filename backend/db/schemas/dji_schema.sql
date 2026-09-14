-- Declaraciones Juradas de Intereses (Contraloría General de la República)
-- Fuente: PNDA — datasets "declaraciones-juradas-de-intereses-…", "empleos-declarados-…"
-- Pipeline: backend/scrapers/pnda_dji/pipeline.py (COPY directo; fechas como TEXT, se castean al consultar)
--
-- Cruces que habilita:
--   · C8  funcionario rota de entidad → mismo proveedor gana donde llega (entidad + cargo + fechas)
--   · C9  puerta giratoria: funcionario que evaluó/firmó una adjudicación trabajó antes en la
--         empresa ganadora (dji_empleos.ruc_entidad = adjudicacion.ruc_proveedor) — o al revés.

CREATE TABLE IF NOT EXISTS dji_funcionarios (
    codigo_ddjj         BIGINT,
    tipo_documento      TEXT,
    apellido_paterno    TEXT,
    apellido_materno    TEXT,
    nombres             TEXT,
    entidad             TEXT,
    cargo               TEXT,
    fecha_elaboracion   TEXT,   -- DD/MM/YY
    fecha_presentacion  TEXT,
    fecha_inicio_cargo  TEXT,
    fecha_cese_cargo    TEXT,
    nombre_norm         TEXT GENERATED ALWAYS AS (
        upper(unaccent(coalesce(apellido_paterno,'') || ' ' || coalesce(apellido_materno,'') || ' ' || coalesce(nombres,'')))
    ) STORED
);

CREATE INDEX IF NOT EXISTS dji_funcionarios_codigo_idx ON dji_funcionarios (codigo_ddjj);
CREATE INDEX IF NOT EXISTS dji_funcionarios_nombre_trgm ON dji_funcionarios USING gin (nombre_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS dji_funcionarios_entidad_idx ON dji_funcionarios (upper(entidad));

CREATE TABLE IF NOT EXISTS dji_empleos (
    codigo_ddjj         BIGINT,
    ruc_entidad_raw     TEXT,   -- 'RUC:20100211034' tal cual viene
    ruc_entidad         TEXT,   -- 11 dígitos, lo llena el pipeline
    nombre_entidad      TEXT,
    cargo               TEXT,
    fecha_inicio        TEXT,   -- DD/MM/YYYY
    fecha_cese          TEXT,
    fecha_elaboracion   TEXT,
    fecha_presentacion  TEXT
);

CREATE INDEX IF NOT EXISTS dji_empleos_codigo_idx ON dji_empleos (codigo_ddjj);
CREATE INDEX IF NOT EXISTS dji_empleos_ruc_idx ON dji_empleos (ruc_entidad);

-- Vista de conveniencia: empleos previos de cada funcionario con nombre.
CREATE OR REPLACE VIEW dji_puerta_giratoria AS
SELECT f.codigo_ddjj, f.nombre_norm, f.entidad AS entidad_actual, f.cargo AS cargo_actual,
       e.ruc_entidad AS ruc_empleador_previo, e.nombre_entidad AS empleador_previo,
       e.cargo AS cargo_previo, e.fecha_inicio, e.fecha_cese
FROM dji_funcionarios f
JOIN dji_empleos e USING (codigo_ddjj)
WHERE e.ruc_entidad LIKE '20%';   -- solo empleadores empresa (RUC 20…), no entidades públicas
