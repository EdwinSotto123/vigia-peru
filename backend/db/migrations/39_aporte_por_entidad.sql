-- 39_aporte_por_entidad.sql — financiar por ENTIDAD (además de por zona) y el perfil público lo edita
-- quien aporta.
--
-- Hasta la 38 se financiaba sólo por ZONA (`contribuciones.ubigeo`, mínimo 5 contratos, FIFO por fecha).
-- Una persona que quiere que se audite "a la ONPE" o "al GORE Puno" tenía que elegir una zona y esperar
-- que le tocaran contratos de esa entidad. Ahora se puede financiar una entidad: se le asignan contratos
-- AL AZAR entre los suyos en cola (nadie elige cuáles), con documentos listos primero (como la 38).
-- Una entidad puede tener menos de 5 contratos en cola: el mínimo por entidad es 1.
--
-- Qué hace:
--   1. `contribuciones.entidad_ruc` (FK a entidades) + índice parcial. Un aporte por entidad guarda
--      TAMBIÉN `ubigeo` (sigue NOT NULL): la zona donde está la mayoría de sus contratos en cola
--      (`zona_de_entidad()`, la moda de cola_auditoria.ubigeo). Así las vistas y consultas que unen
--      contribuciones con `zonas` (recientes, impacto, aliados, ranking por región, procesamientos_publico,
--      panel admin…) siguen funcionando sin cambios: el aporte "vive" en la zona de su entidad.
--   2. CHECK de contratos: `contratos >= 5 OR (entidad_ruc IS NOT NULL AND contratos >= 1)`
--      (reemplaza a `contribuciones_contratos_check` = CHECK (contratos >= 5) de la 09).
--   3. `zona_de_entidad(ruc)`: la moda, con el código más específico que exista en `zonas`
--      (si un contrato trae un ubigeo que no está en `zonas`, cuenta para su provincia o departamento).
--      NULL si la entidad no tiene nada en cola. La usa la API al crear el aporte.
--   4. `asignar_contribucion()`: rama por entidad (filtra `c.entidad_ruc`, `ORDER BY random()` con los de
--      documentos listos primero) con la misma lógica de documentos listos / pedir_descarga de la 38.
--      La rama por zona no cambia (es la de la 38, línea por línea).
--   5. zona_estado (mapa): se vuelve a crear con las MISMAS columnas, tipos, índices y permisos, y un
--      solo cambio, que sólo toca a los aportes por entidad (sin ellos, los valores son idénticos a la 32):
--        · Problema: los contratos de una entidad no siempre están en una sola zona (un gobierno regional
--          contrata en muchos distritos). `pendientes` se cuenta por la zona de cada CONTRATO, pero
--          `asignados` (y procesados, señales, en revisión) y `financiados` se contaban por la zona del
--          APORTE. Un contrato de la entidad fuera de su zona derivada, al asignarse, salía de
--          `pendientes` de su zona y entraba a `asignados` de OTRA: `total_cola` bajaba en una zona y
--          subía en la otra, y el estado del mapa ("financiada", "procesada") mentía en las dos.
--        · Arreglo: para un aporte por entidad, cada asignación cuenta en la zona de SU contrato
--          (convocatorias.ubigeo_zona, la misma con la que estaba en la cola), y `financiados` suma lo
--          ya asignado en la zona de cada contrato y lo que falta asignar en la zona derivada. El aporte
--          (`contribuciones`, el número de aportes) cuenta una vez, en la zona derivada.
--        · Los aportes por zona siguen contando en la zona del aporte, como siempre.
--      Lo demás que agrupa por `contribuciones.ubigeo` (aliados de una zona en /financiamiento/zonas/:ubigeo,
--      ranking con ?region=, "regiones con auditoría", ranking_impacto.zonas) atribuye el aporte por entidad
--      a su zona derivada: está bien, es la zona de la mayoría de sus contratos y ahí se muestra el aporte.
--      `restantes` del formulario por zona es `zona_estado.pendientes` (la cola real), que no cambia.
--   6. Permisos del rol público (vigia_api, migración 37: escrituras por COLUMNA): crear un aporte con
--      `entidad_ruc` y editar desde la cuenta el perfil público (descripción, web, correo de contacto,
--      redes, portada). Sin esto, en producción esos INSERT/UPDATE fallan con "permission denied".
--      El panel (vigia_api_admin) tiene INSERT/UPDATE de tabla entera: ya cubre la columna nueva.
--
-- Requiere: 30 (perfil del aliado), 32 (ubigeo_zona, zona_estado O(N)), 35, 37 (roles) y 38.
--
-- Cómo aplicarla (psql como `postgres`, el dueño de zona_estado y de las funciones SECURITY DEFINER que la
-- refrescan; fuera del lote nocturno de ingesta). Una transacción; zona_estado se vuelve a crear adentro
-- (DROP + CREATE: los lectores esperan lo que tarda el CREATE, ~2 s):
--     psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/39_aporte_por_entidad.sql
-- lock_timeout 5 s: si algo tiene tomada `contribuciones` o `zona_estado`, falla en vez de dejar en cola
-- a la API; se reintenta.
--
-- Idempotente: ADD COLUMN / CREATE INDEX IF NOT EXISTS, DROP CONSTRAINT IF EXISTS + ADD, CREATE OR REPLACE,
-- DROP MATERIALIZED VIEW IF EXISTS + CREATE, GRANT repetible.
--
-- Verificación: al final del archivo.

\set ON_ERROR_STOP on
SET lock_timeout = '5s';

BEGIN;

-- ── 1 · Columna, índice, CHECK ───────────────────────────────────────────────────────────────────
ALTER TABLE contribuciones ADD COLUMN IF NOT EXISTS entidad_ruc CHAR(11) REFERENCES entidades (ruc);
COMMENT ON COLUMN contribuciones.entidad_ruc IS
  'Aporte por ENTIDAD (migración 39): se asignan contratos al azar entre los de esta entidad en cola. '
  'NULL = aporte por zona (ubigeo). Con entidad, `ubigeo` es la zona derivada (zona_de_entidad al crearlo).';

CREATE INDEX IF NOT EXISTS contribuciones_entidad_idx
  ON contribuciones (entidad_ruc, estado) WHERE entidad_ruc IS NOT NULL;

-- Por zona, mínimo 5 (como siempre); por entidad, mínimo 1 (una entidad puede tener menos de 5 en cola).
ALTER TABLE contribuciones DROP CONSTRAINT IF EXISTS contribuciones_contratos_check;
ALTER TABLE contribuciones ADD CONSTRAINT contribuciones_contratos_check
  CHECK (contratos >= 5 OR (entidad_ruc IS NOT NULL AND contratos >= 1));

-- ── 2 · Zona derivada de una entidad ─────────────────────────────────────────────────────────────
-- La moda de la zona de sus contratos en cola. Cada contrato cuenta para el código más específico que
-- exista en `zonas` (su distrito, si no su provincia, si no su departamento): el resultado siempre sirve
-- para la FK contribuciones.ubigeo → zonas. Empate: la zona más específica, después el código.
-- Comparación bpchar = bpchar: usa el índice idx_conv_entidad.
CREATE OR REPLACE FUNCTION zona_de_entidad(p_ruc TEXT) RETURNS TEXT
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT z.ubigeo
  FROM cola_auditoria q
  JOIN convocatorias c ON c.ocid = q.ocid
  CROSS JOIN LATERAL (SELECT zz.ubigeo FROM zonas zz
                       WHERE zz.ubigeo IN (q.ubigeo, left(q.ubigeo, 4), left(q.ubigeo, 2))
                       ORDER BY length(zz.ubigeo) DESC LIMIT 1) z
  WHERE c.entidad_ruc = p_ruc::char(11)
  GROUP BY z.ubigeo
  ORDER BY count(*) DESC, length(z.ubigeo) DESC, z.ubigeo
  LIMIT 1
$$;
COMMENT ON FUNCTION zona_de_entidad(TEXT) IS
  'Zona (código de `zonas`) donde está la mayoría de los contratos en cola de la entidad; NULL si no tiene cola. Migración 39.';

-- ── 3 · Asignación: rama por entidad ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION asignar_contribucion(p_contribucion_id BIGINT) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ubigeo     TEXT;
  v_entidad    CHAR(11);   -- bpchar como convocatorias.entidad_ruc: la comparación usa su índice
  v_total      INT;
  v_solo       BOOLEAN;
  v_tipos      TEXT[];
  v_ya         INT;
  v_insertados INT;
  v_faltan     INT;
BEGIN
  SELECT ubigeo, entidad_ruc, contratos, solo_con_documentos, tipos
    INTO v_ubigeo, v_entidad, v_total, v_solo, v_tipos
  FROM contribuciones WHERE id = p_contribucion_id AND estado IN ('pagada','en_proceso');
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT count(*) INTO v_ya FROM asignaciones WHERE contribucion_id = p_contribucion_id;
  IF v_ya >= v_total THEN RETURN 0; END IF;

  IF v_entidad IS NULL THEN
    -- Por zona: igual que la 38 (FIFO dentro de lo elegible: "nadie elige contratos").
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
    -- Por entidad: al azar entre sus contratos en cola (tampoco los elige nadie), con documentos listos
    -- primero. Con solo_con_documentos, sólo entran los listos (el primer criterio es el mismo para todos).
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

  -- No alcanzaron los contratos listos: pedir al batch los que faltan, sin asignarlos (como la 38).
  -- pedir_descarga() no duplica pedidos abiertos, así que repetirlo en cada corrida del cron no suma.
  v_faltan := v_total - v_ya - v_insertados;
  IF v_solo AND v_faltan > 0 THEN
    IF v_entidad IS NULL THEN
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
      -- Orden al azar pero ESTABLE (md5 del aporte y el contrato), no random(): el cron corre cada
      -- 10 min y con random() pediría otros contratos en cada corrida hasta bajar la entidad entera.
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

-- ── 4 · zona_estado: asignaciones de un aporte por entidad en la zona de su contrato ─────────────
-- Copia de la 32 salvo los CTE `aportes` y `asig` (ver la cabecera, punto 5).
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
  WHERE c.estado IN ('pagada', 'en_proceso', 'procesada') AND c.entidad_ruc IS NULL
  GROUP BY 1
  UNION ALL
  -- Aporte por entidad (39): lo que todavía falta asignar, en la zona derivada (contribuciones.ubigeo);
  -- el aporte cuenta una vez, ahí.
  SELECT c.ubigeo, sum(greatest(c.contratos - COALESCE(k.n, 0), 0)), count(*)
  FROM contribuciones c
  LEFT JOIN (SELECT s.contribucion_id, count(*) AS n FROM asignaciones s GROUP BY 1) k ON k.contribucion_id = c.id
  WHERE c.estado IN ('pagada', 'en_proceso', 'procesada') AND c.entidad_ruc IS NOT NULL
  GROUP BY 1
  UNION ALL
  -- … y lo ya asignado, en la zona de cada contrato (de la que salió de `pendientes`).
  SELECT COALESCE(cv.ubigeo_zona, c.ubigeo), count(*), 0
  FROM asignaciones s
  JOIN contribuciones c ON c.id = s.contribucion_id
  JOIN convocatorias cv ON cv.ocid = s.ocid
  WHERE c.estado IN ('pagada', 'en_proceso', 'procesada') AND c.entidad_ruc IS NOT NULL
  GROUP BY 1
),
asig AS (
  -- Aporte por zona: en la zona del aporte (como en la 32). Aporte por entidad (39): en la zona del contrato.
  SELECT CASE WHEN c.entidad_ruc IS NULL THEN c.ubigeo ELSE COALESCE(cv.ubigeo_zona, c.ubigeo) END AS ubigeo,
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

-- DROP + CREATE pierde los permisos de la vista: los de la 37 (vigia_api lee; vigia_api_admin hereda).
GRANT SELECT ON zona_estado TO vigia_api;

-- ── 5 · Permisos ─────────────────────────────────────────────────────────────────────────────────
-- Rol público (37: por columnas). Alta de un aporte por entidad y perfil público editado desde la cuenta.
GRANT INSERT (entidad_ruc) ON contribuciones TO vigia_api;
GRANT UPDATE (descripcion, sitio_web, email_publico, redes, portada_url) ON financiadores TO vigia_api;

GRANT EXECUTE ON FUNCTION zona_de_entidad(TEXT) TO vigia_api, vigia_api_admin;
-- Mismos permisos que antes para la asignación (CREATE OR REPLACE los conserva; esto es por si se crea de cero).
REVOKE ALL ON FUNCTION asignar_contribucion(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION asignar_contribucion(BIGINT) TO vigia_api_admin;

COMMIT;

-- ── Verificación ─────────────────────────────────────────────────────────────────────────────────
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'contribuciones'::regclass AND conname = 'contribuciones_contratos_check';
--     → CHECK (contratos >= 5 OR (entidad_ruc IS NOT NULL AND contratos >= 1))
--   SELECT zona_de_entidad('20291973851'), (SELECT nombre FROM zonas WHERE ubigeo = zona_de_entidad('20291973851'));
--     → la zona de la ONPE (NULL si no tiene nada en cola)
--   SELECT has_column_privilege('vigia_api', 'contribuciones', 'entidad_ruc', 'INSERT'),
--          has_column_privilege('vigia_api', 'financiadores', 'redes', 'UPDATE'),
--          has_table_privilege('vigia_api', 'zona_estado', 'SELECT'),
--          pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'zona_estado'::regclass;       → t, t, t, postgres
--   -- Sin aportes por entidad, zona_estado da lo mismo que antes: comparar con una copia tomada ANTES de
--   -- aplicarla (CREATE TABLE zona_estado_antes AS SELECT * FROM zona_estado;) → 0 filas en los dos sentidos:
--   (SELECT * FROM zona_estado EXCEPT SELECT * FROM zona_estado_antes)
--   UNION ALL (SELECT * FROM zona_estado_antes EXCEPT SELECT * FROM zona_estado);
--   -- Un aporte por entidad asigna sólo contratos de esa entidad:
--   SELECT count(*) FROM asignaciones s JOIN contribuciones co ON co.id = s.contribucion_id
--     JOIN convocatorias c ON c.ocid = s.ocid
--    WHERE co.entidad_ruc IS NOT NULL AND c.entidad_ruc <> co.entidad_ruc;                     → 0
--   SELECT refresh_financiamiento();                                                           -- sin error
