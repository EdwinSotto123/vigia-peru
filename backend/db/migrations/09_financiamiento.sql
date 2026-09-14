-- ─────────────────────────────────────────────────────────────────────────────
-- 09 · "Financia una auditoría" — zonas, financiadores, contribuciones,
--      asignaciones, cola de auditoría, estado por zona y ranking de impacto.
-- Diseño: docs/design/FINANCIA_UNA_AUDITORIA.md
--
-- Principios codificados acá (no en el copy):
--   · La unidad es el CONTRATO (convocatorias.ocid); la zona es el ubigeo INEI.
--   · Los códigos de zona son de longitud variable: '15' Lima (dpto),
--     '1501' Lima (prov), '150135' San Martín de Porres (dist). Un aporte a
--     '15' se asigna a cualquier distrito 15xxxx → rollup por prefijo.
--   · La asignación es FIFO por fecha de convocatoria (fn asignar_contribucion).
--     Ninguna tabla guarda una preferencia de contrato del financiador.
--   · financiadores.visible = FALSE oculta del ranking/muro sin tocar el dinero.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS zonas (
  ubigeo        TEXT PRIMARY KEY CHECK (ubigeo ~ '^[0-9]{2}([0-9]{2}([0-9]{2})?)?$'),
  nivel         TEXT NOT NULL CHECK (nivel IN ('departamento','provincia','distrito')),
  nombre        TEXT NOT NULL,
  padre_ubigeo  TEXT REFERENCES zonas (ubigeo),
  lat           NUMERIC(9,5),
  lon           NUMERIC(9,5)
);
CREATE INDEX IF NOT EXISTS zonas_padre_idx ON zonas (padre_ubigeo);
CREATE INDEX IF NOT EXISTS zonas_nivel_idx ON zonas (nivel);

CREATE TABLE IF NOT EXISTS tarifas (
  id              SERIAL PRIMARY KEY,
  vigente_desde   DATE NOT NULL,
  costo_real_pen  NUMERIC(8,2) NOT NULL,   -- medido (Arize): ~1.00
  precio_pen      NUMERIC(8,2) NOT NULL,   -- público: 3.00
  precio_usd      NUMERIC(8,2) NOT NULL,   -- 1.00
  nota            TEXT
);
INSERT INTO tarifas (vigente_desde, costo_real_pen, precio_pen, precio_usd, nota)
SELECT '2026-09-14', 1.00, 3.00, 1.00, 'S/1 procesamiento · S/1 infraestructura y datos · S/1 reserva expedientes pesados'
WHERE NOT EXISTS (SELECT 1 FROM tarifas);

CREATE TABLE IF NOT EXISTS financiadores (
  id                BIGSERIAL PRIMARY KEY,
  tipo              TEXT NOT NULL CHECK (tipo IN ('empresa','persona','organizacion')),
  nombre_publico    TEXT,                       -- NULL = anónimo
  slug              TEXT UNIQUE,                -- /aliado/<slug>
  ruc               CHAR(11),                   -- empresa/organización; validado con SUNAT
  logo_url          TEXT,
  email             TEXT NOT NULL,              -- privado
  firebase_uid      TEXT UNIQUE,
  visible           BOOLEAN NOT NULL DEFAULT TRUE,
  motivo_no_visible TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS financiadores_ruc_idx ON financiadores (ruc);

CREATE TABLE IF NOT EXISTS contribuciones (
  id               BIGSERIAL PRIMARY KEY,
  codigo           TEXT UNIQUE NOT NULL,        -- VIG-2026-00417 (público)
  financiador_id   BIGINT NOT NULL REFERENCES financiadores (id),
  ubigeo           TEXT NOT NULL REFERENCES zonas (ubigeo),
  contratos        INT NOT NULL CHECK (contratos >= 5),
  tarifa_id        INT NOT NULL REFERENCES tarifas (id),
  monto_pen        NUMERIC(10,2) NOT NULL,
  moneda_pago      TEXT NOT NULL DEFAULT 'PEN',
  estado           TEXT NOT NULL DEFAULT 'pendiente_pago'
                   CHECK (estado IN ('pendiente_pago','pagada','en_proceso','procesada','reembolsada','rechazada')),
  pasarela         TEXT,                        -- 'transferencia' | 'yape' | 'mercadopago' | 'culqi'
  pasarela_ref     TEXT,
  comprobante_url  TEXT,                        -- foto/PDF de la transferencia (GCS)
  validada_por     TEXT,
  pagada_at        TIMESTAMPTZ,
  mensaje_publico  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS contribuciones_zona_estado_idx ON contribuciones (ubigeo, estado);
CREATE INDEX IF NOT EXISTS contribuciones_financiador_idx ON contribuciones (financiador_id);

CREATE TABLE IF NOT EXISTS asignaciones (
  id               BIGSERIAL PRIMARY KEY,
  contribucion_id  BIGINT NOT NULL REFERENCES contribuciones (id),
  ocid             TEXT NOT NULL UNIQUE REFERENCES convocatorias (ocid),   -- un contrato se financia una sola vez
  asignada_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  procesada_at     TIMESTAMPTZ,
  alerta_id        UUID REFERENCES alertas (id),
  costo_real_pen   NUMERIC(8,4)
);
CREATE INDEX IF NOT EXISTS asignaciones_contrib_idx ON asignaciones (contribucion_id);

-- Código público secuencial por año: VIG-2026-00001
CREATE SEQUENCE IF NOT EXISTS contribuciones_codigo_seq;
CREATE OR REPLACE FUNCTION next_codigo_contribucion() RETURNS TEXT LANGUAGE sql AS $$
  SELECT 'VIG-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('contribuciones_codigo_seq')::text, 5, '0');
$$;

-- ── Zona de cada convocatoria ────────────────────────────────────────────────
-- Prioridad: ubigeo de la entidad (6 dígitos) → si falta, el departamento por
-- nombre de región. Devuelve el código más específico que se pueda.
-- Nota: hoy entidades.ubigeo está vacío y convocatorias.region trae nombres de
-- PROVINCIA ("Huamanga", "Cañete") o de departamento ("Piura") según la fuente →
-- se busca primero provincia, después departamento. TODO: poblar entidades.ubigeo
-- desde SUNAT (decolecta devuelve distrito/provincia/departamento) en ingest_oece_one.
CREATE OR REPLACE VIEW convocatoria_zona AS
SELECT c.ocid, c.fecha_convocatoria,
       COALESCE(
         NULLIF(e.ubigeo, ''),
         (SELECT z.ubigeo FROM zonas z
           WHERE z.nivel IN ('provincia','departamento')
             AND upper(unaccent(z.nombre)) = upper(unaccent(COALESCE(NULLIF(c.region,''), e.region, e.provincia, '')))
           ORDER BY CASE z.nivel WHEN 'provincia' THEN 0 ELSE 1 END
           LIMIT 1)
       ) AS ubigeo
FROM convocatorias c
LEFT JOIN entidades e ON e.ruc = c.entidad_ruc;

-- ── Cola de auditoría: ingresadas, sin alerta y sin asignación ───────────────
CREATE OR REPLACE VIEW cola_auditoria AS
SELECT cz.ocid, cz.ubigeo, cz.fecha_convocatoria
FROM convocatoria_zona cz
WHERE cz.ubigeo IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM alertas a WHERE a.ocid = cz.ocid)
  AND NOT EXISTS (SELECT 1 FROM asignaciones s WHERE s.ocid = cz.ocid);

-- ── Estado por zona (lo que pinta el mapa). Rollup por prefijo de ubigeo. ────
DROP MATERIALIZED VIEW IF EXISTS zona_estado;
CREATE MATERIALIZED VIEW zona_estado AS
SELECT z.ubigeo, z.nivel, z.nombre, z.padre_ubigeo, z.lat, z.lon,
       t.precio_pen, t.precio_usd,
       q.pendientes,
       f.financiados,
       f.contribuciones,
       p.asignados,
       p.procesados,
       p.senales,
       (q.pendientes + p.asignados)                       AS total_cola,   -- en cola + ya asignados (procesados o no)
       CASE
         WHEN q.pendientes + p.asignados = 0               THEN 'sin_datos'
         WHEN p.procesados >= q.pendientes + p.asignados   THEN 'procesada'
         WHEN f.financiados >= q.pendientes + p.asignados  THEN 'financiada'
         WHEN f.financiados > 0                            THEN 'parcial'
         ELSE 'pendiente'
       END AS estado
FROM zonas z
CROSS JOIN LATERAL (SELECT precio_pen, precio_usd FROM tarifas ORDER BY vigente_desde DESC LIMIT 1) t
CROSS JOIN LATERAL (
  SELECT count(*)::int AS pendientes FROM cola_auditoria q WHERE q.ubigeo LIKE z.ubigeo || '%'
) q
CROSS JOIN LATERAL (
  SELECT COALESCE(sum(contratos), 0)::int AS financiados, count(*)::int AS contribuciones
  FROM contribuciones c
  WHERE c.ubigeo LIKE z.ubigeo || '%' AND c.estado IN ('pagada','en_proceso','procesada')
) f
CROSS JOIN LATERAL (
  SELECT count(*)::int AS asignados,
         count(*) FILTER (WHERE s.procesada_at IS NOT NULL)::int AS procesados,
         count(s.alerta_id)::int AS senales
  FROM asignaciones s JOIN contribuciones c ON c.id = s.contribucion_id
  WHERE c.ubigeo LIKE z.ubigeo || '%'
) p;
CREATE UNIQUE INDEX IF NOT EXISTS zona_estado_ubigeo_idx ON zona_estado (ubigeo);

-- ── Ranking de impacto: contratos, no soles ──────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS ranking_impacto;
CREATE MATERIALIZED VIEW ranking_impacto AS
-- Sin JOIN a asignaciones en el agregado principal: multiplicaría los contratos.
SELECT f.id AS financiador_id, f.tipo,
       COALESCE(f.nombre_publico, 'Anónimo') AS nombre, f.slug, f.logo_url,
       sum(c.contratos)::int                                            AS contratos_financiados,
       count(DISTINCT c.ubigeo)::int                                     AS zonas,
       (SELECT count(s.alerta_id) FROM asignaciones s JOIN contribuciones c2 ON c2.id = s.contribucion_id WHERE c2.financiador_id = f.id)::int AS senales_halladas,
       (SELECT count(s.procesada_at) FROM asignaciones s JOIN contribuciones c2 ON c2.id = s.contribucion_id WHERE c2.financiador_id = f.id)::int AS contratos_procesados,
       min(c.pagada_at)                                                  AS desde,
       max(c.pagada_at)                                                  AS ultimo_aporte
FROM financiadores f
JOIN contribuciones c ON c.financiador_id = f.id AND c.estado IN ('pagada','en_proceso','procesada')
WHERE f.visible
GROUP BY f.id;
CREATE UNIQUE INDEX IF NOT EXISTS ranking_impacto_id_idx ON ranking_impacto (financiador_id);

CREATE OR REPLACE FUNCTION refresh_financiamiento() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY zona_estado;
  REFRESH MATERIALIZED VIEW CONCURRENTLY ranking_impacto;
END $$;

-- ── Asignación FIFO ──────────────────────────────────────────────────────────
-- Toma de la cola de la zona (y sus hijas) los N contratos más antiguos que la
-- contribución todavía no cubrió. Idempotente: se puede llamar cuantas veces
-- haga falta (p. ej. cuando entran contratos nuevos a una zona vaciada).
CREATE OR REPLACE FUNCTION asignar_contribucion(p_contribucion_id BIGINT) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  v_ubigeo    TEXT;
  v_total     INT;
  v_ya        INT;
  v_insertados INT;
BEGIN
  SELECT ubigeo, contratos INTO v_ubigeo, v_total
  FROM contribuciones WHERE id = p_contribucion_id AND estado IN ('pagada','en_proceso');
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT count(*) INTO v_ya FROM asignaciones WHERE contribucion_id = p_contribucion_id;
  IF v_ya >= v_total THEN RETURN 0; END IF;

  INSERT INTO asignaciones (contribucion_id, ocid)
  SELECT p_contribucion_id, q.ocid
  FROM cola_auditoria q
  WHERE q.ubigeo LIKE v_ubigeo || '%'
  ORDER BY q.fecha_convocatoria NULLS LAST, q.ocid
  LIMIT (v_total - v_ya)
  ON CONFLICT (ocid) DO NOTHING;
  GET DIAGNOSTICS v_insertados = ROW_COUNT;

  IF v_insertados > 0 THEN
    UPDATE contribuciones SET estado = 'en_proceso' WHERE id = p_contribucion_id AND estado = 'pagada';
  END IF;
  RETURN v_insertados;
END $$;

-- Cuando el pipeline persiste una alerta de un contrato asignado, cerramos la asignación.
CREATE OR REPLACE FUNCTION cerrar_asignacion_por_alerta() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- El orquestador persiste alertas con el OCID corto ('1216608'); la cola puede tener el largo
  -- ('ocds-dgv273-seacev3-1216608'). Comparamos por sufijo para cubrir ambos (ver 12_procesamientos.sql).
  UPDATE asignaciones SET procesada_at = COALESCE(procesada_at, now()), alerta_id = COALESCE(alerta_id, NEW.id)
  WHERE ocid = NEW.ocid OR regexp_replace(ocid, '^ocds-dgv273-seacev3-', '') = regexp_replace(NEW.ocid, '^ocds-dgv273-seacev3-', '');
  UPDATE contribuciones c SET estado = 'procesada'
  WHERE c.estado = 'en_proceso'
    AND (SELECT count(*) FROM asignaciones s WHERE s.contribucion_id = c.id AND s.procesada_at IS NOT NULL) >= c.contratos;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_alertas_cerrar_asignacion ON alertas;
CREATE TRIGGER trg_alertas_cerrar_asignacion
  AFTER INSERT ON alertas FOR EACH ROW EXECUTE FUNCTION cerrar_asignacion_por_alerta();
