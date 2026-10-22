-- 109 · Empresas: una ficha por cada empresa (RUC 20) que le vende al Estado, con su puntaje de antecedentes.
--
-- Pedido del usuario (2026-10-22): «modelemos EMPRESAS, score, visitas». Hasta acá la empresa sólo aparecía como
-- ganadora dentro de cada contrato. Ahora cada RUC 20 que ganó, postuló o recibió órdenes tiene su resumen:
--
--   · Contratos (CONOSCE, adjudicaciones 2018 en adelante): los que ganó sola y los que ganó en consorcio, aparte.
--     Una adjudicación de 20 veces el valor referencial del proceso (o con referencial de S/ 1) no entra en la suma: se
--     muestra con la bandera de posible error de carga, como en los contratos (migración 102).
--   · Órdenes de compra y de servicio (CONOSCE): en soles, sin las anuladas; las de monto dudoso van aparte.
--   · Postulaciones (postores de CONOSCE) y cuántas ganó.
--   · Socios, representantes y directivos (RNP), cuántas empresas comparten alguno, y las visitas de esas personas
--     (o de alguien que dijo venir de la empresa) a entidades públicas: empresa_visita.
--   · Antecedentes (cruces_proveedor) y el PUNTAJE DE ANTECEDENTES, de 0 a 100. Cada tipo de antecedente da puntos
--     según su severidad (empresa_puntaje_regla) y cada grupo tiene un tope (empresa_puntaje_grupo): ninguna sola
--     cosa repetida muchas veces llena el puntaje. La web muestra el desglose y las reglas. No es una acusación: dice
--     cuánto de lo que registran otras fuentes públicas pesa sobre la empresa.
--
-- Personas naturales (RUC 10) no: viven en «Personas contratadas» (migraciones 91 a 93) con sus reglas de privacidad.
--
-- Dos refrescos (cada uno por debajo de los 10 min de Hyperdrive): refrescar_empresa_ordenes() (~3 min: las órdenes
-- de 2018 en adelante agrupadas por empresa, entidad y año) y luego refrescar_empresas() (el resumen). Los corre el
-- Worker de scrapers después de los casos cruzados (comun.ts: refrescarCasosCruce).
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/109_empresas.sql
-- luego: SELECT refrescar_empresa_ordenes(); SELECT refrescar_empresas();

-- ── Reglas del puntaje ──────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empresa_puntaje_grupo (
  grupo   TEXT PRIMARY KEY,
  titulo  TEXT NOT NULL,
  explica TEXT NOT NULL,
  tope    INT NOT NULL,
  orden   INT NOT NULL
);
CREATE TABLE IF NOT EXISTS empresa_puntaje_regla (
  tipo      TEXT NOT NULL,
  severidad TEXT NOT NULL,
  grupo     TEXT NOT NULL REFERENCES empresa_puntaje_grupo (grupo),
  puntos    NUMERIC(5, 1) NOT NULL,
  PRIMARY KEY (tipo, severidad)
);

INSERT INTO empresa_puntaje_grupo (grupo, titulo, explica, tope, orden) VALUES
  ('inhabilitacion', 'Ganó estando inhabilitada', 'Obtuvo la buena pro mientras tenía una inhabilitación vigente del Tribunal de Contrataciones.', 40, 1),
  ('sanciones', 'Sanciones del Tribunal de Contrataciones', 'Multas e inhabilitaciones registradas por el OECE, vigentes o pasadas.', 24, 2),
  ('penalidades', 'Penalidades en sus contratos', 'Penalidades que le aplicaron entidades por incumplir un contrato.', 12, 3),
  ('gobernante', 'Vínculo con el partido que gobierna la entidad', 'Su gente aportó o le vendió a la campaña del partido que gobierna la entidad que la contrató.', 30, 4),
  ('autoridades', 'Autoridades y candidatos', 'Un socio, representante o la propia empresa figura como autoridad electa o candidato (JNE).', 20, 5),
  ('campanas', 'Aportes y ventas a campañas', 'Aportes a organizaciones políticas y ventas a campañas electorales (ONPE).', 8, 6),
  ('competencia', 'Postores relacionados', 'Compitió contra otra empresa con el mismo socio o representante, o se le dio la buena pro que antes era de otro postor.', 25, 7),
  ('visitas', 'Visitas antes de la buena pro', 'Alguien de la empresa visitó la entidad poco antes de que le dieran la buena pro.', 16, 8),
  ('fraccionamiento', 'Órdenes partidas', 'Recibió de una entidad, el mismo día, órdenes menores que juntas pasan el tope de 8 UIT.', 15, 9),
  ('sobreprecio', 'Precios altos', 'Cobró por un ítem bastante más que lo que pagaron otras entidades por lo mismo.', 15, 10),
  ('adicionales', 'Adicionales y prórrogas', 'Contratos que crecieron con adicionales, prórrogas o complementarios.', 8, 11),
  ('recurrencia', 'Proveedor frecuente', 'Gana a menudo en una misma entidad. Es común y pesa poco.', 4, 12)
ON CONFLICT (grupo) DO UPDATE SET titulo = EXCLUDED.titulo, explica = EXCLUDED.explica, tope = EXCLUDED.tope, orden = EXCLUDED.orden;

INSERT INTO empresa_puntaje_regla (tipo, severidad, grupo, puntos) VALUES
  ('sancion_vigente', 'alta', 'inhabilitacion', 40), ('sancion_vigente', 'media', 'inhabilitacion', 20), ('sancion_vigente', 'baja', 'inhabilitacion', 10),
  ('sancion', 'alta', 'sanciones', 12), ('sancion', 'media', 'sanciones', 6), ('sancion', 'baja', 'sanciones', 2),
  ('penalidad', 'alta', 'penalidades', 4), ('penalidad', 'media', 'penalidades', 3), ('penalidad', 'baja', 'penalidades', 1),
  ('partido_gobernante', 'alta', 'gobernante', 15), ('partido_gobernante', 'media', 'gobernante', 8), ('partido_gobernante', 'baja', 'gobernante', 3),
  ('vendio_gobernante', 'alta', 'gobernante', 10), ('vendio_gobernante', 'media', 'gobernante', 6), ('vendio_gobernante', 'baja', 'gobernante', 2),
  ('autoridad', 'alta', 'autoridades', 15), ('autoridad', 'media', 'autoridades', 8), ('autoridad', 'baja', 'autoridades', 3),
  ('candidato', 'alta', 'autoridades', 6), ('candidato', 'media', 'autoridades', 4), ('candidato', 'baja', 'autoridades', 1),
  ('aporte', 'alta', 'campanas', 4), ('aporte', 'media', 'campanas', 3), ('aporte', 'baja', 'campanas', 1),
  ('aporte_empresa', 'alta', 'campanas', 4), ('aporte_empresa', 'media', 'campanas', 3), ('aporte_empresa', 'baja', 'campanas', 1),
  ('proveedor_campana', 'alta', 'campanas', 3), ('proveedor_campana', 'media', 'campanas', 2), ('proveedor_campana', 'baja', 'campanas', 1),
  ('socio_comun', 'alta', 'competencia', 10), ('socio_comun', 'media', 'competencia', 5), ('socio_comun', 'baja', 'competencia', 2),
  ('otro_postor', 'alta', 'competencia', 10), ('otro_postor', 'media', 'competencia', 5), ('otro_postor', 'baja', 'competencia', 2),
  ('visita_previa', 'alta', 'visitas', 10), ('visita_previa', 'media', 'visitas', 4), ('visita_previa', 'baja', 'visitas', 1),
  ('fraccionamiento', 'alta', 'fraccionamiento', 6), ('fraccionamiento', 'media', 'fraccionamiento', 3), ('fraccionamiento', 'baja', 'fraccionamiento', 1),
  ('sobreprecio', 'alta', 'sobreprecio', 6), ('sobreprecio', 'media', 'sobreprecio', 3), ('sobreprecio', 'baja', 'sobreprecio', 1),
  ('adicional', 'alta', 'adicionales', 4), ('adicional', 'media', 'adicionales', 2), ('adicional', 'baja', 'adicionales', 1),
  ('recurrente', 'alta', 'recurrencia', 2), ('recurrente', 'media', 'recurrencia', 1), ('recurrente', 'baja', 'recurrencia', 0)
ON CONFLICT (tipo, severidad) DO UPDATE SET grupo = EXCLUDED.grupo, puntos = EXCLUDED.puntos;

-- ── Órdenes por empresa, entidad y año ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empresa_orden_anual (
  ruc          TEXT NOT NULL,
  entidad_ruc  TEXT NOT NULL,
  anio         SMALLINT NOT NULL,
  entidad      TEXT,
  nombre       TEXT,              -- la razón social como la escribe CONOSCE
  departamento TEXT,
  ordenes      INT NOT NULL,      -- todas las no anuladas, con monto o con monto dudoso
  monto        NUMERIC(18, 2) NOT NULL,
  compras      INT NOT NULL,      -- órdenes de compra (bienes); el resto son de servicio
  dudosas      INT NOT NULL,      -- con monto dudoso (migración 98): su monto no entra en `monto`
  monto_dudoso NUMERIC(18, 2) NOT NULL,
  primera      DATE,
  ultima       DATE,
  PRIMARY KEY (ruc, entidad_ruc, anio)
);
CREATE INDEX IF NOT EXISTS empresa_orden_anual_entidad ON empresa_orden_anual (entidad_ruc);

-- ── Resumen por empresa ─────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empresa_resumen (
  ruc                 TEXT PRIMARY KEY,
  nombre              TEXT NOT NULL,
  estado_sunat        TEXT,
  fecha_alta          DATE,
  domicilio           TEXT,
  actividad           TEXT,
  departamento        TEXT,                   -- donde más le pagaron (nombre del departamento, en mayúsculas)
  objeto              TEXT,                   -- lo que más vende: Bien, Servicio, Obra, Consultoría de Obra
  -- Contratos (CONOSCE, adjudicaciones): sola y en consorcio. El monto del consorcio es el de todo el consorcio.
  adj_procesos        INT NOT NULL DEFAULT 0,
  adj_monto           NUMERIC(18, 2) NOT NULL DEFAULT 0,
  cons_procesos       INT NOT NULL DEFAULT 0,
  cons_monto          NUMERIC(18, 2) NOT NULL DEFAULT 0,
  adj_dudosos         INT NOT NULL DEFAULT 0, -- procesos con un monto que parece mal cargado: fuera de las sumas
  adj_monto_dudoso    NUMERIC(18, 2) NOT NULL DEFAULT 0,
  adj_otra_moneda     INT NOT NULL DEFAULT 0, -- ítems en dólares, euros…: fuera de las sumas en soles
  -- Postulaciones (CONOSCE, postores) y cuántas de ellas ganó (sola o en consorcio).
  postulaciones       INT NOT NULL DEFAULT 0,
  ganadas             INT NOT NULL DEFAULT 0,
  -- Órdenes (empresa_orden_anual).
  ord_n               INT NOT NULL DEFAULT 0,
  ord_monto           NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ord_dudosas         INT NOT NULL DEFAULT 0,
  ord_monto_dudoso    NUMERIC(18, 2) NOT NULL DEFAULT 0,
  entidades           INT NOT NULL DEFAULT 0, -- entidades distintas que le adjudicaron o le compraron
  primera             DATE,
  ultima              DATE,
  -- Gente de la empresa (RNP) y sus visitas.
  socios              INT NOT NULL DEFAULT 0,
  representantes      INT NOT NULL DEFAULT 0,
  directivos          INT NOT NULL DEFAULT 0,
  vinculadas          INT NOT NULL DEFAULT 0, -- otras empresas con un mismo socio, representante o directivo
  visitas             INT NOT NULL DEFAULT 0,
  visitas_clientes    INT NOT NULL DEFAULT 0, -- a entidades que le adjudicaron o le compraron
  -- Tribunal de Contrataciones: inhabilitación vigente hoy.
  inhabilitada        TEXT,                   -- temporal | definitiva
  inhabilitada_hasta  DATE,
  -- Antecedentes (cruces_proveedor) y el puntaje.
  tipos               TEXT[] NOT NULL DEFAULT '{}',
  n_alta              INT NOT NULL DEFAULT 0,
  n_media             INT NOT NULL DEFAULT 0,
  n_baja              INT NOT NULL DEFAULT 0,
  puntaje             SMALLINT NOT NULL DEFAULT 0,
  nivel               TEXT NOT NULL DEFAULT 'sin', -- sin | bajo | medio | alto
  antecedentes        JSONB NOT NULL DEFAULT '[]', -- [{grupo, puntos, tope, cruces: [{tipo, severidad, n, puntos}]}]
  texto               TEXT NOT NULL,          -- búsqueda: mef_norm(nombre) y el RUC
  actualizado         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS empresa_resumen_puntaje ON empresa_resumen (puntaje DESC, ruc);
-- Lo que recibió: contratos que ganó sola y órdenes (lo de consorcio es de todo el consorcio: no se suma).
CREATE INDEX IF NOT EXISTS empresa_resumen_monto ON empresa_resumen ((adj_monto + ord_monto) DESC, ruc);
CREATE INDEX IF NOT EXISTS empresa_resumen_texto ON empresa_resumen USING gin (texto gin_trgm_ops);
CREATE INDEX IF NOT EXISTS empresa_resumen_tipos ON empresa_resumen USING gin (tipos);

-- Una visita registrada de alguien de la empresa: un socio, representante o directivo del RNP (por su DNI), o alguien
-- que dijo venir de la empresa (el nombre de la empresa, único entre los proveedores). `entidad_ruc`: si la entidad
-- visitada le adjudicó o le compró algo alguna vez (por el nombre de la entidad).
CREATE TABLE IF NOT EXISTS empresa_visita (
  ruc         TEXT NOT NULL,
  visita_id   BIGINT NOT NULL,
  via         TEXT NOT NULL,      -- socio | representante | directivo | nombre
  entidad_ruc TEXT,
  PRIMARY KEY (ruc, visita_id)
);

ALTER TABLE empresa_puntaje_grupo OWNER TO vigia_jobs;
ALTER TABLE empresa_puntaje_regla OWNER TO vigia_jobs;
ALTER TABLE empresa_orden_anual OWNER TO vigia_jobs;
ALTER TABLE empresa_resumen OWNER TO vigia_jobs;
ALTER TABLE empresa_visita OWNER TO vigia_jobs;
GRANT SELECT ON empresa_puntaje_grupo, empresa_puntaje_regla, empresa_orden_anual, empresa_resumen, empresa_visita
  TO vigia_api, vigia_api_admin;
-- El refresco (como vigia_jobs) lee la razón social de la SUNAT, las visitas y las sanciones.
GRANT SELECT ON empresas, visitas_entidades, osce_sancionados, rnp_conformacion_juridica TO vigia_jobs;

-- Hay filas de `empresas` con el objeto del contrato en la razón social («Servicio», «Bien», «Obra», «Consultoría de
-- Obra»: 2 278 el 2026-10-22, sin fuente): no son nombres. Se leen como sin dato (el nombre sale de CONOSCE o del OCDS);
-- nada se borra. La usan también las listas de contratos y alertas de la API.
CREATE OR REPLACE FUNCTION razon_social_de(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN t IS NULL OR btrim(t) IN ('', 'Bien', 'Servicio', 'Obra', 'Consultoría de Obra') THEN NULL ELSE t END
$$;

-- "CONSTRUCTORA ABC S.A.C." → "CONSTRUCTORA ABC": para reconocer a la empresa por el nombre que alguien escribió.
CREATE OR REPLACE FUNCTION razon_norm(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(mef_norm(t),
    '\s+(S\s?A\s?C|S\s?A\s?A|S\s?A|E\s?I\s?R\s?L|S\s?R\s?L|S\s?C\s?R\s?L|SOCIEDAD ANONIMA CERRADA|SOCIEDAD ANONIMA ABIERTA|SOCIEDAD ANONIMA|SOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA|EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA)$', ''))
$$;

-- Cómo puede llamarse en CONOSCE la entidad que anotó el registro de visitas: tal cual, sin la sigla final entre
-- paréntesis («MINISTERIO DE ECONOMÍA Y FINANZAS (MEF)») y, para un gobierno regional, su sede central.
CREATE OR REPLACE FUNCTION entidad_visita_claves(t TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[mef_norm(t), mef_norm(regexp_replace(t, '\s*\([^)]*\)\s*$', '')),
               mef_norm(regexp_replace(t, '\s*\([^)]*\)\s*$', '')) || ' SEDE CENTRAL']
$$;

-- ── 1. Órdenes ──────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refrescar_empresa_ordenes() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_empresas'));
  SET LOCAL work_mem = '256MB';
  -- Una vez cada orden (un mismo archivo mensual puede repetirla; vale la del archivo más nuevo), como las personas.
  CREATE TEMP TABLE _eo ON COMMIT DROP AS
    SELECT DISTINCT ON (entidad_ruc, orden, fecha_emision)
           entidad_ruc, ruc_contratista AS ruc, entidad, contratista, departamento, fecha_emision, tipo_orden, monto, monto_dudoso
      FROM conosce_ordenes
     WHERE ruc_contratista ~ '^20\d{9}$' AND fecha_emision >= DATE '2018-01-01' AND fecha_emision <= current_date + 31
       AND estado IS DISTINCT FROM 'Anulada' AND moneda = 'Nuevos Soles' AND entidad_ruc ~ '^\d{11}$'
       AND (monto > 0 OR monto_dudoso IS NOT NULL)
     ORDER BY entidad_ruc, orden, fecha_emision, anio DESC, mes DESC;

  DELETE FROM empresa_orden_anual;
  INSERT INTO empresa_orden_anual (ruc, entidad_ruc, anio, entidad, nombre, departamento, ordenes, monto, compras, dudosas,
                                   monto_dudoso, primera, ultima)
  SELECT ruc, entidad_ruc, extract(year FROM fecha_emision)::smallint, max(entidad), max(replace(contratista, '¿', 'Ñ')),
         max(departamento), count(*), COALESCE(sum(monto) FILTER (WHERE monto_dudoso IS NULL), 0),
         count(*) FILTER (WHERE tipo_orden ILIKE '%compra%'), count(*) FILTER (WHERE monto_dudoso IS NOT NULL),
         COALESCE(sum(monto_dudoso), 0), min(fecha_emision), max(fecha_emision)
    FROM _eo GROUP BY 1, 2, 3;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE empresa_orden_anual;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_empresa_ordenes() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_empresa_ordenes() FROM PUBLIC;

-- ── 2. El resumen ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refrescar_empresas() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n INT; t0 TIMESTAMPTZ := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_empresas'));
  SET LOCAL work_mem = '256MB';

  -- Integrantes de cada consorcio (su código no es un RUC), como en los casos cruzados.
  CREATE TEMP TABLE _em ON COMMIT DROP AS
    SELECT DISTINCT ON (ruc_consorcio, ruc_miembro) ruc_consorcio, ruc_miembro, miembro
      FROM conosce_consorcios WHERE ruc_miembro ~ '^20\d{9}$' ORDER BY ruc_consorcio, ruc_miembro, anio DESC;
  CREATE INDEX ON _em (ruc_consorcio);
  ANALYZE _em;

  -- Procesos con un monto que parece mal cargado (la regla de los contratos, migración 102): la adjudicación más grande
  -- de 20 veces el referencial de todo el proceso y más de S/ 1 M, o un referencial de S/ 1 o menos y más de S/ 100 mil.
  CREATE TEMP TABLE _ed ON COMMIT DROP AS
    SELECT codigo_convocatoria, entidad_ruc
      FROM (SELECT codigo_convocatoria, entidad_ruc, sum(ref) AS ref, max(adj) AS adj
              FROM (SELECT codigo_convocatoria, entidad_ruc, n_item, max(monto_referencial) AS ref, max(monto_adjudicado) AS adj
                      FROM conosce_adjudicaciones WHERE moneda IN ('Soles', 'Nuevos Soles')
                     GROUP BY 1, 2, 3) i
             GROUP BY 1, 2) p
     WHERE ref > 0 AND ((ref <= 1 AND adj > 100000) OR (ref > 1 AND adj >= 20 * ref AND adj > 1000000));
  CREATE INDEX ON _ed (codigo_convocatoria, entidad_ruc);
  ANALYZE _ed;

  -- Cada ítem adjudicado a una empresa: directo, o a un consorcio del que es parte.
  CREATE TEMP TABLE _ea ON COMMIT DROP AS
    SELECT COALESCE(m.ruc_miembro, a.ruc_proveedor) AS ruc, (m.ruc_miembro IS NOT NULL) AS en_consorcio,
           COALESCE(m.miembro, a.proveedor) AS nombre, a.codigo_convocatoria || '|' || COALESCE(a.entidad_ruc, '') AS proc,
           a.entidad_ruc, a.entidad, a.entidad_departamento AS departamento, a.objeto, a.fecha_buenapro AS fecha,
           a.monto_adjudicado AS monto, a.moneda IN ('Soles', 'Nuevos Soles') AS soles, (d.codigo_convocatoria IS NOT NULL) AS dudoso
      FROM conosce_adjudicaciones a
      LEFT JOIN _em m ON m.ruc_consorcio = a.ruc_proveedor AND a.ruc_proveedor !~ '^(10|20)\d{9}$'
      LEFT JOIN _ed d ON d.codigo_convocatoria = a.codigo_convocatoria AND d.entidad_ruc = a.entidad_ruc
     WHERE COALESCE(m.ruc_miembro, a.ruc_proveedor) ~ '^20\d{9}$';
  ANALYZE _ea;

  CREATE TEMP TABLE _eadj ON COMMIT DROP AS
    SELECT ruc,
           count(DISTINCT proc) FILTER (WHERE NOT en_consorcio) AS adj_procesos,
           COALESCE(sum(monto) FILTER (WHERE NOT en_consorcio AND soles AND NOT dudoso), 0) AS adj_monto,
           count(DISTINCT proc) FILTER (WHERE en_consorcio) AS cons_procesos,
           COALESCE(sum(monto) FILTER (WHERE en_consorcio AND soles AND NOT dudoso), 0) AS cons_monto,
           count(DISTINCT proc) FILTER (WHERE dudoso) AS adj_dudosos,
           COALESCE(sum(monto) FILTER (WHERE dudoso), 0) AS adj_monto_dudoso,
           count(*) FILTER (WHERE NOT soles) AS adj_otra_moneda,
           min(fecha) AS primera, max(fecha) AS ultima,
           (array_agg(nombre ORDER BY en_consorcio, fecha DESC NULLS LAST))[1] AS nombre,
           (array_agg(objeto ORDER BY monto DESC NULLS LAST))[1] AS objeto
      FROM _ea GROUP BY ruc;
  CREATE INDEX ON _eadj (ruc);

  -- Postulaciones: los procesos en que fue postor (sola o en consorcio) y, de esos, en cuántos ganó.
  CREATE TEMP TABLE _epo ON COMMIT DROP AS
    SELECT DISTINCT COALESCE(m.ruc_miembro, p.ruc_postor) AS ruc, p.codigo_convocatoria
      FROM conosce_postores p
      LEFT JOIN _em m ON m.ruc_consorcio = p.ruc_postor AND p.ruc_postor !~ '^(10|20)\d{9}$'
     WHERE COALESCE(m.ruc_miembro, p.ruc_postor) ~ '^20\d{9}$';
  CREATE TEMP TABLE _ega ON COMMIT DROP AS
    SELECT DISTINCT ruc, split_part(proc, '|', 1) AS codigo_convocatoria FROM _ea;
  CREATE TEMP TABLE _ep ON COMMIT DROP AS
    SELECT p.ruc, count(*) AS postulaciones, count(g.ruc) AS ganadas
      FROM _epo p LEFT JOIN _ega g ON g.ruc = p.ruc AND g.codigo_convocatoria = p.codigo_convocatoria
     GROUP BY p.ruc;
  CREATE INDEX ON _ep (ruc);
  RAISE NOTICE 'empresas: contratos y postulaciones (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- Órdenes.
  CREATE TEMP TABLE _eord ON COMMIT DROP AS
    SELECT ruc, sum(ordenes)::int AS ord_n, sum(monto) AS ord_monto, sum(dudosas)::int AS ord_dudosas,
           sum(monto_dudoso) AS ord_monto_dudoso, min(primera) AS primera, max(ultima) AS ultima,
           (array_agg(nombre ORDER BY ultima DESC NULLS LAST))[1] AS nombre
      FROM empresa_orden_anual GROUP BY ruc;
  CREATE INDEX ON _eord (ruc);

  -- Sus clientes: cada entidad que le adjudicó o le compró, con el nombre para reconocerla en las visitas.
  CREATE TEMP TABLE _ecli ON COMMIT DROP AS
    SELECT ruc, entidad_ruc, max(ent_n) AS ent_n, sum(monto) AS monto, max(departamento) AS departamento
      FROM (SELECT ruc, entidad_ruc, mef_norm(entidad) AS ent_n, CASE WHEN soles AND NOT dudoso THEN monto ELSE 0 END AS monto,
                   departamento
              FROM _ea WHERE entidad_ruc IS NOT NULL
            UNION ALL
            SELECT ruc, entidad_ruc, mef_norm(entidad), monto, departamento FROM empresa_orden_anual) x
     GROUP BY ruc, entidad_ruc;
  CREATE INDEX ON _ecli (ruc, ent_n);
  ANALYZE _ecli;
  CREATE TEMP TABLE _ecl ON COMMIT DROP AS
    SELECT c.ruc, c.entidades, d.departamento
      FROM (SELECT ruc, count(*) AS entidades FROM _ecli GROUP BY ruc) c
      LEFT JOIN (SELECT DISTINCT ON (ruc) ruc, departamento
                   FROM (SELECT ruc, mef_norm(departamento) AS departamento, sum(monto) AS m FROM _ecli
                          WHERE departamento IS NOT NULL GROUP BY 1, 2) z
                  ORDER BY ruc, m DESC NULLS LAST) d ON d.ruc = c.ruc;
  CREATE INDEX ON _ecl (ruc);
  RAISE NOTICE 'empresas: órdenes y clientes (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- Antecedentes y puntaje. La misma venta o aporte no cuenta dos veces (como en la ficha del contrato, migración 87):
  -- si ya está como «partido que gobierna», la genérica no suma.
  CREATE TEMP TABLE _ecp ON COMMIT DROP AS
    SELECT ruc_empresa AS ruc, tipo, severidad, COALESCE(persona_doc, '') AS doc,
           upper(COALESCE(detalle->>'organizacion', detalle->>'partido', '')) AS org, COALESCE(detalle->>'proceso', '') AS proc,
           upper(COALESCE(detalle->>'partido', '')) AS partido
      FROM cruces_proveedor WHERE ruc_empresa ~ '^20\d{9}$';
  CREATE TEMP TABLE _egob ON COMMIT DROP AS
    SELECT DISTINCT ruc, doc, org, proc FROM _ecp WHERE tipo IN ('vendio_gobernante', 'partido_gobernante');
  DELETE FROM _ecp c USING _egob g
   WHERE c.tipo = 'proveedor_campana' AND g.ruc = c.ruc AND g.doc = c.doc AND g.org = c.org AND g.proc = c.proc;
  DELETE FROM _ecp c USING _egob g
   WHERE c.tipo IN ('aporte', 'aporte_empresa') AND g.ruc = c.ruc AND g.doc = c.doc AND g.org = c.partido AND g.proc = '';

  CREATE TEMP TABLE _ecg ON COMMIT DROP AS
    SELECT x.ruc, r.grupo, g.orden, g.tope, least(g.tope, sum(r.puntos * x.n)) AS puntos,
           jsonb_agg(jsonb_build_object('tipo', x.tipo, 'severidad', x.severidad, 'n', x.n, 'puntos', r.puntos * x.n)
                     ORDER BY CASE x.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, x.tipo) AS cruces
      FROM (SELECT ruc, tipo, severidad, count(*)::int AS n FROM _ecp GROUP BY 1, 2, 3) x
      JOIN empresa_puntaje_regla r ON r.tipo = x.tipo AND r.severidad = x.severidad
      JOIN empresa_puntaje_grupo g ON g.grupo = r.grupo
     GROUP BY x.ruc, r.grupo, g.orden, g.tope;
  CREATE TEMP TABLE _ecs ON COMMIT DROP AS
    SELECT t.ruc, COALESCE(least(100, round(s.puntos)), 0)::smallint AS puntaje, COALESCE(s.antecedentes, '[]') AS antecedentes,
           t.tipos, t.n_alta, t.n_media, t.n_baja
      FROM (SELECT ruc, array_agg(DISTINCT tipo ORDER BY tipo) AS tipos,
                   count(*) FILTER (WHERE severidad = 'alta')::int AS n_alta,
                   count(*) FILTER (WHERE severidad = 'media')::int AS n_media,
                   count(*) FILTER (WHERE severidad = 'baja')::int AS n_baja
              FROM _ecp GROUP BY ruc) t
      LEFT JOIN (SELECT ruc, sum(puntos) AS puntos,
                        jsonb_agg(jsonb_build_object('grupo', grupo, 'puntos', puntos, 'tope', tope, 'cruces', cruces) ORDER BY orden) AS antecedentes
                   FROM _ecg GROUP BY ruc) s ON s.ruc = t.ruc;
  CREATE INDEX ON _ecs (ruc);
  RAISE NOTICE 'empresas: antecedentes (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- Su gente en el RNP: socios, representantes y directivos; y las otras empresas que comparten a alguno.
  CREATE TEMP TABLE _er ON COMMIT DROP AS
    SELECT ruc_empresa::text AS ruc, numero_documento AS doc, tipo_rol
      FROM rnp_conformacion_juridica WHERE ruc_empresa ~ '^20\d{9}$' AND numero_documento IS NOT NULL;
  CREATE INDEX ON _er (doc);
  ANALYZE _er;
  CREATE TEMP TABLE _ers ON COMMIT DROP AS
    SELECT r.ruc,
           count(DISTINCT r.doc) FILTER (WHERE r.tipo_rol = 'SOCIO_ACCIONISTA_TITULAR') AS socios,
           count(DISTINCT r.doc) FILTER (WHERE r.tipo_rol = 'REPRESENTANTE_LEGAL') AS representantes,
           count(DISTINCT r.doc) FILTER (WHERE r.tipo_rol = 'ORGANO_ADMINISTRACION') AS directivos
      FROM _er r GROUP BY r.ruc;
  CREATE INDEX ON _ers (ruc);
  CREATE TEMP TABLE _erv ON COMMIT DROP AS
    SELECT a.ruc, count(DISTINCT b.ruc) AS vinculadas
      FROM (SELECT DISTINCT ruc, doc FROM _er) a JOIN (SELECT DISTINCT ruc, doc FROM _er) b ON b.doc = a.doc AND b.ruc <> a.ruc
     GROUP BY a.ruc;
  CREATE INDEX ON _erv (ruc);
  RAISE NOTICE 'empresas: socios (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- Nombres: SUNAT si lo tenemos; si no, el de su última adjudicación, sus órdenes, sus postulaciones o su consorcio.
  CREATE TEMP TABLE _en ON COMMIT DROP AS
    SELECT DISTINCT ON (ruc) ruc, nombre
      FROM (SELECT ruc::text AS ruc, razon_social_de(razon_social) AS nombre, 0 AS p FROM empresas
             WHERE ruc ~ '^20\d{9}$' AND razon_social_de(razon_social) IS NOT NULL
            UNION ALL SELECT ruc, nombre, 1 FROM _eadj WHERE nombre IS NOT NULL
            UNION ALL SELECT ruc, nombre, 2 FROM _eord WHERE nombre IS NOT NULL
            UNION ALL SELECT ruc_postor, max(postor), 3 FROM conosce_postores WHERE ruc_postor ~ '^20\d{9}$' AND postor IS NOT NULL GROUP BY 1
            UNION ALL SELECT ruc_miembro, max(miembro), 4 FROM _em WHERE miembro IS NOT NULL GROUP BY 1
            -- Las que sólo tienen antecedentes (ganaron antes de 2018): el nombre del OCDS, en los casos cruzados.
            UNION ALL SELECT ruc, max(proveedor), 5 FROM casos_cruce WHERE ruc ~ '^20\d{9}$' AND proveedor IS NOT NULL GROUP BY 1
            UNION ALL SELECT ruc, max(razon_social), 6 FROM osce_sancionados WHERE ruc ~ '^20\d{9}$' AND razon_social IS NOT NULL GROUP BY 1) x
     ORDER BY ruc, p;
  CREATE INDEX ON _en (ruc);
  -- Todas las empresas de la ficha: ganó, recibió órdenes, postuló o tiene antecedentes.
  CREATE TEMP TABLE _eu ON COMMIT DROP AS
    SELECT ruc FROM _eadj UNION SELECT ruc FROM _eord UNION SELECT ruc FROM _ep UNION SELECT ruc FROM _ecs;
  -- Las que siguen sin nombre (ganaron en el SEACE fuera de los datos de CONOSCE): el del proveedor en el OCDS.
  INSERT INTO _en
  SELECT u.ruc, (SELECT sp->>'name'
                   FROM convocatorias c
                   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(COALESCE(c.ocds_payload->'awards', c.adjudicaciones)) = 'array'
                                                                THEN COALESCE(c.ocds_payload->'awards', c.adjudicaciones) ELSE '[]'::jsonb END) aw
                   CROSS JOIN LATERAL jsonb_array_elements(COALESCE(aw->'suppliers', '[]'::jsonb)) sp
                  -- proveedor_ruc es CHAR(11): con el RUC como CHAR usa su índice (como TEXT recorría la tabla por cada uno).
                  WHERE c.proveedor_ruc = u.ruc::char(11) AND regexp_replace(sp->>'id', '^PE-RUC-', '') = u.ruc AND sp->>'name' IS NOT NULL
                  LIMIT 1)
    FROM _eu u WHERE NOT EXISTS (SELECT 1 FROM _en n WHERE n.ruc = u.ruc);
  DELETE FROM _en WHERE nombre IS NULL;
  ANALYZE _en;

  -- Visitas de su gente (por el DNI) o de alguien que dijo venir de la empresa (el nombre, si es de una sola).
  CREATE TEMP TABLE _ev ON COMMIT DROP AS
    SELECT DISTINCT ON (ruc, visita_id) ruc, visita_id, via, claves
      FROM (SELECT r.ruc, v.id AS visita_id,
                   CASE r.tipo_rol WHEN 'SOCIO_ACCIONISTA_TITULAR' THEN 'socio' WHEN 'REPRESENTANTE_LEGAL' THEN 'representante' ELSE 'directivo' END AS via,
                   CASE r.tipo_rol WHEN 'REPRESENTANTE_LEGAL' THEN 0 WHEN 'SOCIO_ACCIONISTA_TITULAR' THEN 1 ELSE 2 END AS p,
                   entidad_visita_claves(v.entidad_visitada) AS claves
              FROM visitas_entidades v JOIN _er r ON r.doc = v.numero_documento
             WHERE length(v.numero_documento) = 8
            UNION ALL
            SELECT n.ruc, v.id, 'nombre', 3, entidad_visita_claves(v.entidad_visitada)
              FROM visitas_entidades v
              JOIN (SELECT k, min(ruc) AS ruc FROM (SELECT razon_norm(nombre) AS k, ruc FROM _en) z
                     WHERE length(k) >= 6 GROUP BY k HAVING count(*) = 1) n
                ON n.k = razon_norm(v.entidad_visitante)
             WHERE v.tipo_entidad_visitante = 'privada') x
     ORDER BY ruc, visita_id, p;
  DELETE FROM empresa_visita;
  INSERT INTO empresa_visita (ruc, visita_id, via, entidad_ruc)
  SELECT v.ruc, v.visita_id, v.via, (SELECT c.entidad_ruc FROM _ecli c WHERE c.ruc = v.ruc AND c.ent_n = ANY (v.claves) LIMIT 1)
    FROM _ev v;
  CREATE TEMP TABLE _evs ON COMMIT DROP AS
    SELECT ruc, count(*) AS visitas, count(entidad_ruc) AS visitas_clientes FROM empresa_visita GROUP BY ruc;
  CREATE INDEX ON _evs (ruc);
  RAISE NOTICE 'empresas: visitas (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- Inhabilitación vigente hoy: la definitiva que no figura como no vigente, o la temporal que no ha terminado.
  CREATE TEMP TABLE _ei ON COMMIT DROP AS
    SELECT DISTINCT ON (ruc) ruc, CASE WHEN tipo = 'definitivo' THEN 'definitiva' ELSE 'temporal' END AS inhabilitada,
           CASE WHEN tipo = 'definitivo' THEN NULL ELSE fecha_hasta END AS hasta
      FROM osce_sancionados
     WHERE ruc ~ '^20\d{9}$'
       AND ((tipo = 'definitivo' AND estado IS DISTINCT FROM 'NO VIGENTE')
            OR (tipo = 'temporal' AND fecha_hasta >= current_date AND (fecha_desde IS NULL OR fecha_desde <= current_date)))
     ORDER BY ruc, (tipo = 'definitivo') DESC, fecha_hasta DESC NULLS LAST;

  DELETE FROM empresa_resumen;
  INSERT INTO empresa_resumen (ruc, nombre, estado_sunat, fecha_alta, domicilio, actividad, departamento, objeto,
                               adj_procesos, adj_monto, cons_procesos, cons_monto, adj_dudosos, adj_monto_dudoso, adj_otra_moneda,
                               postulaciones, ganadas, ord_n, ord_monto, ord_dudosas, ord_monto_dudoso, entidades, primera, ultima,
                               socios, representantes, directivos, vinculadas, visitas, visitas_clientes, inhabilitada, inhabilitada_hasta,
                               tipos, n_alta, n_media, n_baja, puntaje, nivel, antecedentes, texto)
  SELECT u.ruc, replace(COALESCE(nm.nombre, u.ruc), '¿', 'Ñ'),
         e.estado_sunat, e.fecha_alta_ruc, e.domicilio_fiscal, e.actividad_economica,
         cl.departamento, a.objeto,
         COALESCE(a.adj_procesos, 0), COALESCE(a.adj_monto, 0), COALESCE(a.cons_procesos, 0), COALESCE(a.cons_monto, 0),
         COALESCE(a.adj_dudosos, 0), COALESCE(a.adj_monto_dudoso, 0), COALESCE(a.adj_otra_moneda, 0),
         COALESCE(p.postulaciones, 0), COALESCE(p.ganadas, 0),
         COALESCE(o.ord_n, 0), COALESCE(o.ord_monto, 0), COALESCE(o.ord_dudosas, 0), COALESCE(o.ord_monto_dudoso, 0),
         COALESCE(cl.entidades, 0), least(a.primera, o.primera), greatest(a.ultima, o.ultima),
         COALESCE(s.socios, 0), COALESCE(s.representantes, 0), COALESCE(s.directivos, 0), COALESCE(rv.vinculadas, 0),
         COALESCE(vs.visitas, 0), COALESCE(vs.visitas_clientes, 0), i.inhabilitada, i.hasta,
         COALESCE(c.tipos, '{}'), COALESCE(c.n_alta, 0), COALESCE(c.n_media, 0), COALESCE(c.n_baja, 0), COALESCE(c.puntaje, 0),
         CASE WHEN COALESCE(c.puntaje, 0) >= 50 THEN 'alto' WHEN c.puntaje >= 20 THEN 'medio' WHEN c.puntaje > 0 THEN 'bajo' ELSE 'sin' END,
         COALESCE(c.antecedentes, '[]'),
         mef_norm(replace(COALESCE(nm.nombre, ''), '¿', 'Ñ')) || ' ' || u.ruc
    FROM _eu u
    LEFT JOIN _en nm ON nm.ruc = u.ruc
    LEFT JOIN empresas e ON e.ruc = u.ruc
    LEFT JOIN _eadj a ON a.ruc = u.ruc
    LEFT JOIN _ep p ON p.ruc = u.ruc
    LEFT JOIN _eord o ON o.ruc = u.ruc
    LEFT JOIN _ecl cl ON cl.ruc = u.ruc
    LEFT JOIN _ers s ON s.ruc = u.ruc
    LEFT JOIN _erv rv ON rv.ruc = u.ruc
    LEFT JOIN _evs vs ON vs.ruc = u.ruc
    LEFT JOIN _ei i ON i.ruc = u.ruc
    LEFT JOIN _ecs c ON c.ruc = u.ruc;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE empresa_resumen;
  ANALYZE empresa_visita;
  RAISE NOTICE 'empresas: % filas (% s)', n, round(extract(epoch FROM clock_timestamp() - t0));
  RETURN n;
END $$;
ALTER FUNCTION refrescar_empresas() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_empresas() FROM PUBLIC;
