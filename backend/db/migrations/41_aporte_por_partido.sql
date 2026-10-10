-- 41_aporte_por_partido.sql: asociar cada contrato al PARTIDO que gobernaba la entidad cuando se convocó,
-- y poder financiar su lectura POR PARTIDO y período.
--
-- Idea: una entidad que es un gobierno regional o una municipalidad la gobierna, en cada período
-- (2015 a 2018, 2019 a 2022, 2023 a 2026), la autoridad que ganó esa elección (JNE). El contrato se asocia
-- al partido por la FECHA de su convocatoria: la fecha cae en el mes de un período, ese período tiene un
-- alcalde o gobernador de un partido, y ese partido queda asociado al contrato.
--
--   1. `gobierno_periodo`: quién gobierna cada región, provincia y distrito en cada período y de qué
--      organización política es. Se carga con backend/scripts/cargar_gobiernos.py desde los archivos del
--      JNE (los mismos que muestra el mapa de partidos).
--   2. `entidad_gobierno`: de qué gobierno es una entidad, por su nombre: «GOBIERNO REGIONAL DE …»
--      (también sus unidades ejecutoras: salud, educación…), «MUNICIPALIDAD PROVINCIAL/METROPOLITANA DE …»
--      y «MUNICIPALIDAD DISTRITAL DE …». Las demás entidades (ministerios, organismos) no tienen partido.
--   3. `contrato_partido`: contrato → partido y período, por la fecha de convocatoria.
--   4. `contribuciones.partido_clave` + `partido_anio`: un aporte por partido asigna contratos AL AZAR
--      entre los del partido en ese período (nadie elige cuáles), con documentos listos primero.
--      `zona_de_partido()` da la zona del aporte (la moda de su cola), como `zona_de_entidad()`.
--   5. `asignar_contribucion()` con rama por partido; zona_estado cuenta el aporte por partido como el de entidad.
--
-- No registra cambios dentro del período (vacancias, revocatorias, reemplazos): se asocia al ganador de la
-- elección. Es una limitación que la pantalla dice.
--
-- Requiere: 39. Aplicar como `postgres` (dueño de zona_estado y de las funciones SECURITY DEFINER):
--     psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/41_aporte_por_partido.sql
--     python backend/scripts/cargar_gobiernos.py        (carga gobierno_periodo)

\set ON_ERROR_STOP on
SET lock_timeout = '5s';

BEGIN;

-- ── 1 · Quién gobierna, por período ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gobierno_periodo (
  nivel          TEXT    NOT NULL CHECK (nivel IN ('regional', 'provincial', 'distrital')),
  ubigeo         TEXT    NOT NULL,                    -- 2 dígitos (región), 4 (provincia) o 6 (distrito)
  anio_eleccion  INT     NOT NULL,                    -- 2014, 2018, 2022
  desde          DATE    NOT NULL,
  hasta          DATE    NOT NULL,
  autoridad      TEXT,
  org_clave      TEXT    NOT NULL,                    -- identificador estable de la organización política
  org_nombre     TEXT    NOT NULL,
  org_tipo       TEXT,
  PRIMARY KEY (nivel, ubigeo, anio_eleccion)
);
CREATE INDEX IF NOT EXISTS gobierno_periodo_org_idx ON gobierno_periodo (org_clave, anio_eleccion);
CREATE INDEX IF NOT EXISTS gobierno_periodo_fechas_idx ON gobierno_periodo (nivel, ubigeo, desde, hasta);
COMMENT ON TABLE gobierno_periodo IS
  'Quién gobierna cada región, provincia y distrito en cada período (JNE, elecciones 2014, 2018 y 2022). Migración 41.';

-- ── 2 · De qué gobierno es una entidad ───────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW entidad_gobierno AS
SELECT e.ruc,
       CASE WHEN e.nombre ~* '^\s*GOBIERNO REGIONAL'                         THEN 'regional'
            WHEN e.nombre ~* '^\s*MUNICIPALIDAD (PROVINCIAL|METROPOLITANA)'  THEN 'provincial'
            WHEN e.nombre ~* '^\s*MUNICIPALIDAD DISTRITAL'                   THEN 'distrital' END AS nivel,
       CASE WHEN e.nombre ~* '^\s*GOBIERNO REGIONAL'                         THEN left(e.ubigeo, 2)
            WHEN e.nombre ~* '^\s*MUNICIPALIDAD (PROVINCIAL|METROPOLITANA)'  THEN left(e.ubigeo, 4)
            WHEN e.nombre ~* '^\s*MUNICIPALIDAD DISTRITAL'                   THEN e.ubigeo END AS ubigeo
FROM entidades e
WHERE e.ubigeo IS NOT NULL AND length(e.ubigeo) = 6
  AND e.nombre ~* '^\s*(GOBIERNO REGIONAL|MUNICIPALIDAD (PROVINCIAL|METROPOLITANA|DISTRITAL))';

-- ── 3 · Contrato → partido y período, por la fecha de convocatoria ───────────────────────────────
CREATE OR REPLACE VIEW contrato_partido AS
SELECT c.ocid, c.entidad_ruc, c.fecha_convocatoria,
       g.org_clave, g.org_nombre, g.org_tipo, g.anio_eleccion, g.nivel, g.ubigeo AS gobierno_ubigeo, g.autoridad
FROM convocatorias c
JOIN entidad_gobierno eg ON eg.ruc = c.entidad_ruc
JOIN gobierno_periodo g  ON g.nivel = eg.nivel AND g.ubigeo = eg.ubigeo
                        AND c.fecha_convocatoria BETWEEN g.desde AND g.hasta;
COMMENT ON VIEW contrato_partido IS
  'Contrato asociado al partido que gobernaba la entidad el mes en que se convocó. Migración 41.';

-- ── 4 · Aporte por partido ───────────────────────────────────────────────────────────────────────
ALTER TABLE contribuciones ADD COLUMN IF NOT EXISTS partido_clave TEXT;
ALTER TABLE contribuciones ADD COLUMN IF NOT EXISTS partido_anio  INT;
COMMENT ON COLUMN contribuciones.partido_clave IS
  'Aporte por PARTIDO (migración 41): se asignan contratos al azar entre los de las entidades que ese partido gobernó en `partido_anio`.';

ALTER TABLE contribuciones DROP CONSTRAINT IF EXISTS contribuciones_partido_check;
ALTER TABLE contribuciones ADD CONSTRAINT contribuciones_partido_check CHECK (
  (partido_clave IS NULL AND partido_anio IS NULL)
  OR (partido_clave IS NOT NULL AND partido_anio IS NOT NULL AND entidad_ruc IS NULL));

CREATE INDEX IF NOT EXISTS contribuciones_partido_idx
  ON contribuciones (partido_clave, partido_anio, estado) WHERE partido_clave IS NOT NULL;

CREATE OR REPLACE FUNCTION zona_de_partido(p_clave TEXT, p_anio INT) RETURNS TEXT
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT z.ubigeo
  FROM cola_auditoria q
  JOIN contrato_partido cp ON cp.ocid = q.ocid
  CROSS JOIN LATERAL (SELECT zz.ubigeo FROM zonas zz
                       WHERE zz.ubigeo IN (q.ubigeo, left(q.ubigeo, 4), left(q.ubigeo, 2))
                       ORDER BY length(zz.ubigeo) DESC LIMIT 1) z
  WHERE cp.org_clave = p_clave AND cp.anio_eleccion = p_anio
  GROUP BY z.ubigeo
  ORDER BY count(*) DESC, length(z.ubigeo) DESC, z.ubigeo
  LIMIT 1
$$;
COMMENT ON FUNCTION zona_de_partido(TEXT, INT) IS
  'Zona donde está la mayoría de los contratos en cola del partido en ese período; NULL si no tiene cola. Migración 41.';

-- ── 5 · Asignación: tres ramas (zona, entidad, partido) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION asignar_contribucion(p_contribucion_id BIGINT) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ubigeo     TEXT;
  v_entidad    CHAR(11);
  v_partido    TEXT;
  v_anio       INT;
  v_total      INT;
  v_solo       BOOLEAN;
  v_tipos      TEXT[];
  v_ya         INT;
  v_insertados INT;
  v_faltan     INT;
BEGIN
  SELECT ubigeo, entidad_ruc, partido_clave, partido_anio, contratos, solo_con_documentos, tipos
    INTO v_ubigeo, v_entidad, v_partido, v_anio, v_total, v_solo, v_tipos
  FROM contribuciones WHERE id = p_contribucion_id AND estado IN ('pagada','en_proceso');
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT count(*) INTO v_ya FROM asignaciones WHERE contribucion_id = p_contribucion_id;
  IF v_ya >= v_total THEN RETURN 0; END IF;

  IF v_partido IS NOT NULL THEN
    -- Por partido: al azar entre los contratos en cola de las entidades que gobernó en ese período.
    INSERT INTO asignaciones (contribucion_id, ocid)
    SELECT p_contribucion_id, q.ocid
    FROM cola_auditoria q
    JOIN convocatorias c ON c.ocid = q.ocid
    JOIN contrato_partido cp ON cp.ocid = q.ocid
    WHERE cp.org_clave = v_partido AND cp.anio_eleccion = v_anio
      AND (v_tipos IS NULL OR c.tipo_contratacion = ANY (v_tipos))
      AND (NOT v_solo OR documentos_listos(q.ocid))
    ORDER BY documentos_listos(q.ocid) DESC, random()
    LIMIT (v_total - v_ya)
    ON CONFLICT (ocid) DO NOTHING;
    GET DIAGNOSTICS v_insertados = ROW_COUNT;
  ELSIF v_entidad IS NULL THEN
    -- Por zona: FIFO dentro de lo elegible (igual que la 38 y la 39).
    INSERT INTO asignaciones (contribucion_id, ocid)
    SELECT p_contribucion_id, q.ocid
    FROM cola_auditoria q
    JOIN convocatorias c ON c.ocid = q.ocid
    WHERE q.ubigeo LIKE v_ubigeo || '%'
      AND (v_tipos IS NULL OR c.tipo_contratacion = ANY (v_tipos))
      AND (NOT v_solo OR documentos_listos(q.ocid))
    ORDER BY q.fecha_convocatoria NULLS LAST, q.ocid
    LIMIT (v_total - v_ya)
    ON CONFLICT (ocid) DO NOTHING;
    GET DIAGNOSTICS v_insertados = ROW_COUNT;
  ELSE
    -- Por entidad (39).
    INSERT INTO asignaciones (contribucion_id, ocid)
    SELECT p_contribucion_id, q.ocid
    FROM cola_auditoria q
    JOIN convocatorias c ON c.ocid = q.ocid
    WHERE c.entidad_ruc = v_entidad
      AND (v_tipos IS NULL OR c.tipo_contratacion = ANY (v_tipos))
      AND (NOT v_solo OR documentos_listos(q.ocid))
    ORDER BY documentos_listos(q.ocid) DESC, random()
    LIMIT (v_total - v_ya)
    ON CONFLICT (ocid) DO NOTHING;
    GET DIAGNOSTICS v_insertados = ROW_COUNT;
  END IF;

  -- No alcanzaron los contratos listos: pedir al batch los que faltan, sin asignarlos (como la 38 y la 39).
  v_faltan := v_total - v_ya - v_insertados;
  IF v_solo AND v_faltan > 0 THEN
    IF v_partido IS NOT NULL THEN
      PERFORM pedir_descarga(s.ocid, 'financiado')
      FROM (SELECT q.ocid
            FROM cola_auditoria q
            JOIN convocatorias c ON c.ocid = q.ocid
            JOIN contrato_partido cp ON cp.ocid = q.ocid
            WHERE cp.org_clave = v_partido AND cp.anio_eleccion = v_anio
              AND (v_tipos IS NULL OR c.tipo_contratacion = ANY (v_tipos))
              AND NOT documentos_listos(q.ocid)
            ORDER BY md5(p_contribucion_id::text || ':' || q.ocid)
            LIMIT v_faltan) s;
    ELSIF v_entidad IS NULL THEN
      PERFORM pedir_descarga(s.ocid, 'financiado')
      FROM (SELECT q.ocid
            FROM cola_auditoria q
            JOIN convocatorias c ON c.ocid = q.ocid
            WHERE q.ubigeo LIKE v_ubigeo || '%'
              AND (v_tipos IS NULL OR c.tipo_contratacion = ANY (v_tipos))
              AND NOT documentos_listos(q.ocid)
            ORDER BY q.fecha_convocatoria NULLS LAST, q.ocid
            LIMIT v_faltan) s;
    ELSE
      PERFORM pedir_descarga(s.ocid, 'financiado')
      FROM (SELECT q.ocid
            FROM cola_auditoria q
            JOIN convocatorias c ON c.ocid = q.ocid
            WHERE c.entidad_ruc = v_entidad
              AND (v_tipos IS NULL OR c.tipo_contratacion = ANY (v_tipos))
              AND NOT documentos_listos(q.ocid)
            ORDER BY md5(p_contribucion_id::text || ':' || q.ocid)
            LIMIT v_faltan) s;
    END IF;
  END IF;

  IF v_insertados > 0 THEN
    UPDATE contribuciones SET estado = 'en_proceso' WHERE id = p_contribucion_id AND estado = 'pagada';
  END IF;
  RETURN v_insertados;
END $$;

-- ── 6 · zona_estado (mapa): el aporte por partido cuenta como el de entidad ──────────────────────
DROP MATERIALIZED VIEW IF EXISTS zona_estado;

CREATE MATERIALIZED VIEW zona_estado AS
WITH alcance AS MATERIALIZED (
  SELECT (SELECT valor->'tipos_activos'  FROM ajustes WHERE clave = 'procesamiento') AS tipos,
         (SELECT valor->'etapas_activas' FROM ajustes WHERE clave = 'procesamiento') AS etapas
),
cola AS (
  SELECT q.ubigeo, count(*)::int AS n FROM cola_auditoria q GROUP BY 1
),
docs AS (
  -- Tipos/etapas fuera del alcance activo (NOT procesamiento_activo ≡ … IS FALSE), con documentos
  -- vigentes en GCS y sin alerta.
  SELECT c.ubigeo_zona AS ubigeo, count(*)::int AS n
  FROM convocatorias c CROSS JOIN alcance al
  WHERE c.ubigeo_zona IS NOT NULL
    AND ((al.tipos ? COALESCE(c.tipo_contratacion, '')) AND (al.etapas ? COALESCE(c.etapa, ''))) IS FALSE
    AND EXISTS (SELECT 1 FROM documentos_gcs d
                 WHERE ocid_corto(d.ocid) = ocid_corto(c.ocid) AND d.borrado_at IS NULL AND d.expira_at > now())
    AND NOT EXISTS (SELECT 1 FROM alertas a WHERE ocid_corto(a.ocid) = ocid_corto(c.ocid))
  GROUP BY 1
),
aportes AS (
  -- Aporte por zona: todos sus contratos, en su zona (como en la 32).
  SELECT c.ubigeo, sum(c.contratos) AS contratos, count(*) AS n
  FROM contribuciones c
  WHERE c.estado IN ('pagada', 'en_proceso', 'procesada') AND (c.entidad_ruc IS NULL AND c.partido_clave IS NULL)
  GROUP BY 1
  UNION ALL
  -- Aporte por entidad (39): lo que todavía falta asignar, en la zona derivada (contribuciones.ubigeo);
  -- el aporte cuenta una vez, ahí.
  SELECT c.ubigeo, sum(greatest(c.contratos - COALESCE(k.n, 0), 0)), count(*)
  FROM contribuciones c
  LEFT JOIN (SELECT s.contribucion_id, count(*) AS n FROM asignaciones s GROUP BY 1) k ON k.contribucion_id = c.id
  WHERE c.estado IN ('pagada', 'en_proceso', 'procesada') AND (c.entidad_ruc IS NOT NULL OR c.partido_clave IS NOT NULL)
  GROUP BY 1
  UNION ALL
  -- … y lo ya asignado, en la zona de cada contrato (de la que salió de `pendientes`).
  SELECT COALESCE(cv.ubigeo_zona, c.ubigeo), count(*), 0
  FROM asignaciones s
  JOIN contribuciones c ON c.id = s.contribucion_id
  JOIN convocatorias cv ON cv.ocid = s.ocid
  WHERE c.estado IN ('pagada', 'en_proceso', 'procesada') AND (c.entidad_ruc IS NOT NULL OR c.partido_clave IS NOT NULL)
  GROUP BY 1
),
asig AS (
  -- Aporte por zona: en la zona del aporte (como en la 32). Aporte por entidad (39): en la zona del contrato.
  SELECT CASE WHEN (c.entidad_ruc IS NULL AND c.partido_clave IS NULL) THEN c.ubigeo ELSE COALESCE(cv.ubigeo_zona, c.ubigeo) END AS ubigeo,
         count(*)                                                                  AS asignados,
         count(*) FILTER (WHERE s.procesada_at IS NOT NULL)                        AS procesados,
         count(*) FILTER (WHERE a.id IS NOT NULL AND alerta_publicada(a.estado)
                            AND EXISTS (SELECT 1 FROM banderas b WHERE b.alerta_id = a.id)) AS senales,
         count(*) FILTER (WHERE a.estado = 'revision')                             AS en_revision
  FROM asignaciones s
  JOIN contribuciones c ON c.id = s.contribucion_id
  LEFT JOIN convocatorias cv ON cv.ocid = s.ocid
  LEFT JOIN alertas a ON a.id = s.alerta_id
  GROUP BY 1
),
cola_z AS (
  SELECT p.z AS ubigeo, sum(x.n) AS n
  FROM cola x CROSS JOIN LATERAL (VALUES (left(x.ubigeo, 2)),
                                         (CASE WHEN length(x.ubigeo) >= 4 THEN left(x.ubigeo, 4) END),
                                         (CASE WHEN length(x.ubigeo) >= 6 THEN left(x.ubigeo, 6) END)) p(z)
  WHERE p.z IS NOT NULL GROUP BY 1
),
docs_z AS (
  SELECT p.z AS ubigeo, sum(x.n) AS n
  FROM docs x CROSS JOIN LATERAL (VALUES (left(x.ubigeo, 2)),
                                         (CASE WHEN length(x.ubigeo) >= 4 THEN left(x.ubigeo, 4) END),
                                         (CASE WHEN length(x.ubigeo) >= 6 THEN left(x.ubigeo, 6) END)) p(z)
  WHERE p.z IS NOT NULL GROUP BY 1
),
aportes_z AS (
  SELECT p.z AS ubigeo, sum(x.contratos) AS contratos, sum(x.n) AS n
  FROM aportes x CROSS JOIN LATERAL (VALUES (left(x.ubigeo, 2)),
                                            (CASE WHEN length(x.ubigeo) >= 4 THEN left(x.ubigeo, 4) END),
                                            (CASE WHEN length(x.ubigeo) >= 6 THEN left(x.ubigeo, 6) END)) p(z)
  WHERE p.z IS NOT NULL GROUP BY 1
),
asig_z AS (
  SELECT p.z AS ubigeo, sum(x.asignados) AS asignados, sum(x.procesados) AS procesados,
         sum(x.senales) AS senales, sum(x.en_revision) AS en_revision
  FROM asig x CROSS JOIN LATERAL (VALUES (left(x.ubigeo, 2)),
                                         (CASE WHEN length(x.ubigeo) >= 4 THEN left(x.ubigeo, 4) END),
                                         (CASE WHEN length(x.ubigeo) >= 6 THEN left(x.ubigeo, 6) END)) p(z)
  WHERE p.z IS NOT NULL GROUP BY 1
),
tarifa AS (SELECT precio_pen, precio_usd FROM tarifas ORDER BY vigente_desde DESC LIMIT 1),
base AS (
  SELECT z.ubigeo, z.nivel, z.nombre, z.padre_ubigeo, z.lat, z.lon, t.precio_pen, t.precio_usd,
         COALESCE(q.n, 0)::int            AS pendientes,
         COALESCE(f.contratos, 0)::int    AS financiados,
         COALESCE(f.n, 0)::int            AS contribuciones,
         COALESCE(p.asignados, 0)::int    AS asignados,
         COALESCE(p.procesados, 0)::int   AS procesados,
         COALESCE(p.senales, 0)::int      AS senales,
         COALESCE(p.en_revision, 0)::int  AS en_revision,
         COALESCE(d.n, 0)::int            AS documentos_listos
  FROM zonas z
  CROSS JOIN tarifa t
  LEFT JOIN cola_z    q ON q.ubigeo = z.ubigeo
  LEFT JOIN docs_z    d ON d.ubigeo = z.ubigeo
  LEFT JOIN aportes_z f ON f.ubigeo = z.ubigeo
  LEFT JOIN asig_z    p ON p.ubigeo = z.ubigeo
)
SELECT ubigeo, nivel, nombre, padre_ubigeo, lat, lon,
       precio_pen, precio_usd,
       pendientes,
       financiados,
       contribuciones,
       asignados,
       procesados,
       senales,
       (pendientes + asignados)                        AS total_cola,   -- en cola + ya asignados (procesados o no)
       CASE
         WHEN pendientes + asignados = 0               THEN 'sin_datos'
         WHEN procesados >= pendientes + asignados     THEN 'procesada'
         WHEN financiados >= pendientes + asignados    THEN 'financiada'
         WHEN financiados > 0                          THEN 'parcial'
         ELSE 'pendiente'
       END AS estado,
       en_revision,
       documentos_listos
FROM base;

CREATE UNIQUE INDEX IF NOT EXISTS zona_estado_ubigeo_idx ON zona_estado (ubigeo);
CREATE INDEX IF NOT EXISTS zona_estado_nivel_idx ON zona_estado (nivel);
CREATE INDEX IF NOT EXISTS zona_estado_padre_idx ON zona_estado (padre_ubigeo);

-- (41: el aporte por partido cuenta como el de entidad)
-- DROP + CREATE pierde los permisos de la vista: los de la 37 (vigia_api lee; vigia_api_admin hereda).
GRANT SELECT ON zona_estado TO vigia_api;


-- ── 7 · Permisos ─────────────────────────────────────────────────────────────────────────────────
GRANT SELECT ON gobierno_periodo, entidad_gobierno, contrato_partido TO vigia_api, vigia_api_admin;
GRANT INSERT (partido_clave, partido_anio) ON contribuciones TO vigia_api;
GRANT EXECUTE ON FUNCTION zona_de_partido(TEXT, INT) TO vigia_api, vigia_api_admin;
REVOKE ALL ON FUNCTION asignar_contribucion(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION asignar_contribucion(BIGINT) TO vigia_api_admin;

COMMIT;

-- ── Verificación ─────────────────────────────────────────────────────────────────────────────────
--   SELECT count(*) FROM gobierno_periodo;                                  -- tras cargar_gobiernos.py
--   SELECT anio_eleccion, org_nombre, count(*) FROM contrato_partido GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10;
--   SELECT refresh_financiamiento();                                       -- sin error
