-- 188 · Visitas 2.0 y la ola que sigue a un cambio de gestión (fases 2.2 y 3.4 del plan del 2026-10-27).
--
-- 1. «Visitó a quien decide». La visita previa (174: alguien del ganador visitó la entidad hasta 180 días antes de la buena
--    pro) era siempre grave, aunque lo recibiera la mesa de partes o un congresista. Ahora es grave sólo si quien recibió
--    decide la compra (titular, gerencia general o municipal, administración, logística, abastecimiento, contrataciones,
--    un comité) según su cargo o su área en el registro, y media si no. El detalle dice `decisor` y el área. Y el nombre de
--    quien recibió ya no se guarda en el cruce (la API nunca lo mostró: de quien recibe, sólo su cargo y su área).
--
-- 2. «Lo visitó el familiar de un funcionario». Una visita cuyo documento es el de un pariente que un funcionario de la
--    MISMA entidad declaró en su DJI (dji_vinculos). Bandera de la entidad con su evidencia: la fecha, el parentesco, el
--    cargo y el área de quien la recibió, y si el pariente además le vende o le presta servicios (un RUC 10 con su DNI).
--    Nunca quién es el pariente ni el funcionario. Un indicio para revisar: un familiar puede ir por un trámite.
--
-- 3. «La ola que siguió a un cambio de gestión». Las órdenes de servicio a personas (locadores) en los seis meses desde
--    que asumió una gestión (la local del JNE o, en el Ejecutivo, el Presidente) frente a los mismos seis meses del año
--    anterior (la misma época: un enero no se parece a un diciembre). Ola si se duplicaron y sumaron al menos 30 más; alta
--    si se cuadruplicaron. La misma regla que lib/historia.ts (olasDeGestion), sobre entidad_orden_mes (187).
--
-- Refrescos: refrescar_cruce_visita_previa() la llama el Worker de scrapers (comun.ts, siExiste) como antes;
-- refrescar_visita_pariente() tras las cargas de visitas y las rondas de la DJI (orquestar_dji.py); refrescar_ola_gestion()
-- tras refrescar_ordenes_mes (conosce_ordenes.ts).
--
-- Cómo aplicarla: python infrastructure/dev/dev.py migrar backend/db/migrations/188_visitas_y_olas.sql (DEV) y en
-- producción backend/scripts/aplicar_188.py (el SQL y los tres refrescos).

-- ── 1. Quién decide una compra, por su cargo o su área ───────────────────────────────────────────────────────────────
-- «ADMINISTRACION» suelta no basta: en el Congreso el área de la recepción es «ADMINISTRACION EDIFICIO MARIO VARGAS
-- LLOSA». Cuenta la oficina, gerencia o dirección de administración, y el cargo de administrador.
CREATE OR REPLACE FUNCTION visita_decisor(cargo TEXT, area TEXT) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT x ~ '\m(ALCALDE|ALCALDESA|GOBERNADOR|GOBERNADORA|MINISTRO|MINISTRA|VICEMINISTRO|VICEMINISTRA|SECRETARIO GENERAL|SECRETARIA GENERAL|GERENTE GENERAL|GERENTE MUNICIPAL|GERENCIA GENERAL|GERENCIA MUNICIPAL|PRESIDENTE EJECUTIVO|PRESIDENTA EJECUTIVA|DIRECTOR EJECUTIVO|DIRECTORA EJECUTIVA|JEFE INSTITUCIONAL|TITULAR DE LA ENTIDAD|ADMINISTRADOR|ADMINISTRADORA|LOGISTICA|ABASTECIMIENTO|ABASTECIMIENTOS|CONTRATACIONES|ADQUISICIONES|COMITE DE SELECCION|COMITE ESPECIAL|OFICIALIA MAYOR|OFICIAL MAYOR|ADMINISTRACION Y FINANZAS)\M'
      OR x ~ '\m(OFICINA|GERENCIA|DIRECCION|SUB ?GERENCIA|UNIDAD|DEPARTAMENTO)( GENERAL| REGIONAL| EJECUTIVA| MUNICIPAL)? DE ADMINISTRACION\M'
    FROM (SELECT mef_norm(COALESCE(cargo, '') || ' | ' || COALESCE(area, '')) AS x) t
$$;

-- La 174 con dos cambios: la severidad por quién recibió y el detalle sin su nombre.
CREATE OR REPLACE FUNCTION refrescar_cruce_visita_previa() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  SET LOCAL work_mem = '128MB';

  CREATE TEMP TABLE _vpo ON COMMIT DROP AS
    SELECT DISTINCT ruc, nombre FROM (
      SELECT ruc::text AS ruc, nombre FROM entidades WHERE nombre IS NOT NULL
      UNION ALL SELECT DISTINCT entidad_ruc::text, entidad FROM empresa_orden_anual WHERE entidad IS NOT NULL
      UNION ALL SELECT DISTINCT entidad_ruc::text, entidad FROM conosce_adjudicaciones WHERE entidad IS NOT NULL) x
     WHERE ruc ~ '^\d{11}$';
  CREATE TEMP TABLE _vpn ON COMMIT DROP AS
    SELECT DISTINCT ruc, mef_norm(nombre) AS k, 0 AS nivel FROM _vpo
    UNION
    SELECT DISTINCT ruc, mef_norm(regexp_replace(nombre, '\s+-\s+.*$', '')), 1 FROM _vpo WHERE nombre ~ '\s-\s';
  DELETE FROM _vpn WHERE k = '';
  CREATE TEMP TABLE _vpk ON COMMIT DROP AS
    SELECT x.k, x.ruc
      FROM _vpn x
      JOIN (SELECT k, min(nivel) AS nivel FROM _vpn GROUP BY k) m ON m.k = x.k AND m.nivel = x.nivel
      JOIN (SELECT y.k FROM _vpn y JOIN (SELECT k, min(nivel) AS nivel FROM _vpn GROUP BY k) mm ON mm.k = y.k AND mm.nivel = y.nivel
              LEFT JOIN entidades e ON e.ruc::text = y.ruc
             GROUP BY y.k HAVING count(DISTINCT COALESCE(e.ubigeo, y.ruc)) = 1) ok ON ok.k = x.k;
  CREATE INDEX ON _vpk (k);

  CREATE TEMP TABLE _vpm ON COMMIT DROP AS
    SELECT DISTINCT v.t, k.ruc
      FROM (SELECT DISTINCT entidad_visitada AS t FROM visitas_entidades WHERE entidad_visitada IS NOT NULL) v
     CROSS JOIN LATERAL unnest(claves_entidad_visitada(v.t)) c(k)
      JOIN _vpk k ON k.k = c.k;
  CREATE INDEX ON _vpm (t);

  CREATE TEMP TABLE _vpg ON COMMIT DROP AS
    SELECT DISTINCT cv.ocid, COALESCE(m.ruc_miembro, a.ruc_proveedor) AS ruc, a.entidad_ruc::text AS entidad_ruc, a.fecha_buenapro AS f
      FROM conosce_adjudicaciones a
      JOIN (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
             WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid) cv
        ON cv.codigo = a.codigo_convocatoria AND cv.entidad_ruc = a.entidad_ruc
      LEFT JOIN conosce_consorcios m ON m.ruc_consorcio = a.ruc_proveedor AND a.ruc_proveedor !~ '^(10|20)\d{9}$'
     WHERE a.fecha_buenapro >= (SELECT min(fecha_visita) FROM visitas_entidades)
       AND a.fecha_buenapro <= (SELECT max(fecha_visita) FROM visitas_entidades) + 180
       AND COALESCE(m.ruc_miembro, a.ruc_proveedor) ~ '^(10|20)\d{9}$'
       -- Sólo las entidades cuyas visitas tenemos (con el Congreso desde 2020, el resto eran millones de filas inútiles).
       AND a.entidad_ruc::text IN (SELECT ruc FROM _vpm);
  CREATE INDEX ON _vpg (ruc);

  CREATE TEMP TABLE _vpp ON COMMIT DROP AS
    SELECT ruc, dni, max(nombre) AS nombre, string_agg(DISTINCT rol, ', ' ORDER BY rol) AS rol FROM (
      SELECT r.ruc_empresa::text AS ruc, r.numero_documento AS dni, r.nombre, r.tipo_rol AS rol
        FROM rnp_conformacion_juridica r
       WHERE r.tipo_documento LIKE 'DOC. NACIONAL%' AND r.numero_documento ~ '^\d{8}$'
         AND r.ruc_empresa::text IN (SELECT ruc FROM _vpg)
      UNION ALL
      SELECT DISTINCT g.ruc, substr(g.ruc, 3, 8), NULL, 'TITULAR' FROM _vpg g WHERE g.ruc LIKE '10%') x
     GROUP BY ruc, dni;
  CREATE INDEX ON _vpp (dni);

  DELETE FROM cruces_proveedor WHERE tipo = 'visita_previa';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (g.ocid, g.ruc, v.id)
         'visita_previa', g.ruc, g.ocid,
         CASE WHEN visita_decisor(v.funcionario_cargo, v.funcionario_area) THEN 'alta' ELSE 'media' END,
         v.fecha_visita, p.dni, COALESCE(p.nombre, v.visitante), p.rol,
         jsonb_build_object('entidad_visitada', v.entidad_visitada, 'misma_entidad', true,
                            'cargo_funcionario', v.funcionario_cargo, 'area_funcionario', v.funcionario_area,
                            'decisor', visita_decisor(v.funcionario_cargo, v.funcionario_area), 'motivo', v.motivo,
                            'dias_antes', g.f - v.fecha_visita, 'buena_pro', g.f),
         'visitas_entidades', 'https://www.datosabiertos.gob.pe/'
    FROM _vpg g
    JOIN _vpp p ON p.ruc = g.ruc
    JOIN visitas_entidades v ON v.numero_documento = p.dni AND v.fecha_visita BETWEEN g.f - 180 AND g.f
    JOIN _vpm m ON m.t = v.entidad_visitada AND m.ruc = g.entidad_ruc
   ORDER BY g.ocid, g.ruc, v.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_cruce_visita_previa() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_cruce_visita_previa() FROM PUBLIC;

-- ── 2. Visitas de familiares declarados de sus funcionarios ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entidad_visita_pariente (
  entidad_ruc  TEXT NOT NULL,
  visita_id    BIGINT NOT NULL,
  fecha        DATE NOT NULL,
  parentesco   TEXT,           -- como lo declaró el funcionario (HERMANO(A), PADRE, CONYUGE…)
  cargo        TEXT,           -- de quien la recibió (nunca su nombre)
  area         TEXT,
  decisor      BOOLEAN NOT NULL DEFAULT false,
  proveedor    BOOLEAN NOT NULL DEFAULT false,   -- el pariente le vende o le presta servicios (RUC 10 con su DNI)
  PRIMARY KEY (entidad_ruc, visita_id)
);
CREATE INDEX IF NOT EXISTS entidad_visita_pariente_visita ON entidad_visita_pariente (visita_id);

CREATE OR REPLACE FUNCTION refrescar_visita_pariente() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_visita_pariente'));
  DELETE FROM entidad_visita_pariente;
  INSERT INTO entidad_visita_pariente (entidad_ruc, visita_id, fecha, parentesco, cargo, area, decisor, proveedor)
  SELECT DISTINCT ON (m.ruc, v.id)
         m.ruc, v.id, v.fecha_visita, dv.parentesco, v.funcionario_cargo, v.funcionario_area,
         visita_decisor(v.funcionario_cargo, v.funcionario_area),
         EXISTS (SELECT 1 FROM persona_entidad pe WHERE pe.entidad_ruc = m.ruc AND pe.ruc LIKE '10%' AND substr(pe.ruc, 3, 8) = v.numero_documento)
    FROM visitas_entidades v
    JOIN visita_entidad_ruc m ON m.entidad_visitada = v.entidad_visitada
    JOIN dji_vinculos dv ON dv.pariente_doc = v.numero_documento AND dv.entidad_ruc = m.ruc
   WHERE v.numero_documento ~ '^\d{8}$' AND v.fecha_visita IS NOT NULL
   ORDER BY m.ruc, v.id, dv.grado NULLS LAST;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE entidad_visita_pariente;
  RETURN n;
END $$;
ALTER TABLE entidad_visita_pariente OWNER TO vigia_jobs;
GRANT SELECT ON entidad_visita_pariente TO vigia_api, vigia_api_admin;
ALTER FUNCTION refrescar_visita_pariente() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_visita_pariente() FROM PUBLIC;

-- ── 3. La ola de órdenes a personas que sigue a un cambio de gestión ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entidad_ola_gestion (
  entidad_ruc  TEXT NOT NULL,
  desde        DATE NOT NULL,          -- el día que asumió
  quien        TEXT NOT NULL,          -- «la gestión de Somos Perú», «Dina Boluarte»
  antes        INT NOT NULL,           -- órdenes a personas en los seis meses de un año antes
  despues      INT NOT NULL,           -- en sus primeros seis meses
  mes_desde    DATE NOT NULL,          -- el primer mes de los seis
  severidad    TEXT NOT NULL,
  PRIMARY KEY (entidad_ruc, desde)
);

CREATE OR REPLACE FUNCTION refrescar_ola_gestion() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_ola_gestion'));
  DELETE FROM entidad_ola_gestion;
  WITH cambios AS (
    -- Lo local: cada periodo del JNE de su nivel y su ubigeo.
    SELECT a.ruc, g.desde, 'la gestión de ' || COALESCE(g.org_nombre, 'una organización sin nombre en el registro') AS quien
      FROM entidad_gobierno_amplia a JOIN gobierno_periodo g ON g.nivel = a.nivel AND g.ubigeo = a.ubigeo
    UNION ALL
    -- El Ejecutivo: cada Presidente que asumió.
    SELECT eg.ruc, n.desde,
           CASE WHEN n.presidente ~* '^Elegido' THEN 'el Presidente ' || lower(left(n.presidente, 1)) || substr(n.presidente, 2) ELSE n.presidente END
      FROM entidad_gestion eg CROSS JOIN gobierno_nacional_inicio n WHERE eg.nivel = 'nacional'
  ), c AS (
    SELECT ruc, desde, quien,
           -- Si asumió pasado el día 15, su primer mes es el siguiente.
           (date_trunc('month', desde) + CASE WHEN extract(day FROM desde) > 15 THEN interval '1 month' ELSE interval '0' END)::date AS m0
      FROM cambios
  ), rango AS (
    SELECT entidad_ruc, min(mes) AS primero, max(mes) AS ultimo FROM entidad_orden_mes GROUP BY 1
  ), sumas AS (
    SELECT c.ruc, c.desde, c.quien, c.m0,
           (SELECT COALESCE(sum(o.a_personas), 0) FROM entidad_orden_mes o
             WHERE o.entidad_ruc = c.ruc AND o.mes >= (c.m0 - interval '12 months')::date AND o.mes < (c.m0 - interval '6 months')::date)::int AS antes,
           (SELECT COALESCE(sum(o.a_personas), 0) FROM entidad_orden_mes o
             WHERE o.entidad_ruc = c.ruc AND o.mes >= c.m0 AND o.mes < (c.m0 + interval '6 months')::date)::int AS despues
      FROM c JOIN rango r ON r.entidad_ruc = c.ruc
     -- Los dos tramos dentro de lo que hay: desde un año antes hasta seis meses después (el mes en curso, incompleto, no).
     WHERE r.primero <= (c.m0 - interval '12 months')::date
       AND (c.m0 + interval '5 months')::date <= LEAST(r.ultimo, (date_trunc('month', current_date) - interval '1 month')::date)
  )
  INSERT INTO entidad_ola_gestion (entidad_ruc, desde, quien, antes, despues, mes_desde, severidad)
  SELECT DISTINCT ON (ruc, desde) ruc, desde, quien, antes, despues, m0,
         CASE WHEN despues >= 4 * antes THEN 'alta' ELSE 'media' END
    FROM sumas
   WHERE despues >= 2 * antes AND despues - antes >= 30
   ORDER BY ruc, desde, despues DESC;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE entidad_ola_gestion;
  RETURN n;
END $$;
ALTER TABLE entidad_ola_gestion OWNER TO vigia_jobs;
GRANT SELECT ON entidad_ola_gestion TO vigia_api, vigia_api_admin;
ALTER FUNCTION refrescar_ola_gestion() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_ola_gestion() FROM PUBLIC;

-- ── 4. Lo que la pestaña Visitas cuenta de cada entidad, precalculado ────────────────────────────────────────────────
-- En vivo, el GORE Loreto (57 mil visitas) tardaba 12 s y el Congreso (cerca de un millón desde 2020) no habría
-- terminado: cada visita pasaba por visita_decisor() tres veces. Ahora la marca va en la visita (se llena una vez, las
-- nuevas en cada refresco) y el resumen, las organizaciones y las oficinas de cada entidad, en tres tablas.
ALTER TABLE visitas_entidades ADD COLUMN IF NOT EXISTS decisor BOOLEAN;
CREATE INDEX IF NOT EXISTS visitas_entidad_visitada_fecha_idx ON visitas_entidades (entidad_visitada, fecha_visita DESC);

CREATE TABLE IF NOT EXISTS entidad_visita_resumen (
  entidad_ruc   TEXT PRIMARY KEY,
  total         INT NOT NULL,
  desde         DATE,
  hasta         DATE,
  privadas      INT NOT NULL,
  publicas      INT NOT NULL,
  personas      INT NOT NULL,
  visitantes    INT NOT NULL,
  decisores     INT NOT NULL,
  fuera_de_hora INT NOT NULL,
  largas        INT NOT NULL,
  fuentes       TEXT[]
);
CREATE TABLE IF NOT EXISTS entidad_visita_org (
  entidad_ruc  TEXT NOT NULL,
  org          TEXT NOT NULL,
  tipo         TEXT,
  visitas      INT NOT NULL,
  visitantes   INT NOT NULL,
  primera      DATE,
  ultima       DATE,
  decisores    INT NOT NULL,
  ruc          TEXT,          -- la empresa (RUC 20) que se reconoce en esas visitas (empresa_visita), si alguna
  PRIMARY KEY (entidad_ruc, org)
);
CREATE INDEX IF NOT EXISTS entidad_visita_org_visitas ON entidad_visita_org (entidad_ruc, visitas DESC);
CREATE TABLE IF NOT EXISTS entidad_visita_area (
  entidad_ruc  TEXT NOT NULL,
  area         TEXT NOT NULL,
  cargo        TEXT NOT NULL,
  visitas      INT NOT NULL,
  privadas     INT NOT NULL,
  decisor      BOOLEAN NOT NULL,
  PRIMARY KEY (entidad_ruc, area, cargo)
);

CREATE OR REPLACE FUNCTION refrescar_visitas_entidad() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_visitas_entidad'));
  SET LOCAL work_mem = '256MB';
  -- La marca de quien decide, en las visitas que todavía no la tienen (las nuevas de cada carga).
  UPDATE visitas_entidades SET decisor = visita_decisor(funcionario_cargo, funcionario_area) WHERE decisor IS NULL;

  CREATE TEMP TABLE _ve ON COMMIT DROP AS
    SELECT r.ruc AS entidad_ruc, v.id, v.fecha_visita, v.tipo_entidad_visitante, v.numero_documento, v.decisor, v.duracion_min,
           v.fuente, v.funcionario_area, v.funcionario_cargo, v.entidad_visitante,
           (v.hora_ingreso < TIME '07:00' OR v.hora_ingreso >= TIME '19:00' OR extract(isodow FROM v.fecha_visita) IN (6, 7)) AS fuera
      FROM visitas_entidades v JOIN visita_entidad_ruc r ON r.entidad_visitada = v.entidad_visitada;

  DELETE FROM entidad_visita_resumen;
  INSERT INTO entidad_visita_resumen
  SELECT entidad_ruc, count(*), min(fecha_visita), max(fecha_visita),
         count(*) FILTER (WHERE tipo_entidad_visitante = 'privada'), count(*) FILTER (WHERE tipo_entidad_visitante = 'publica'),
         count(*) FILTER (WHERE tipo_entidad_visitante = 'persona_natural'), count(DISTINCT numero_documento),
         count(*) FILTER (WHERE decisor), count(*) FILTER (WHERE fuera), count(*) FILTER (WHERE duracion_min >= 240),
         array_agg(DISTINCT fuente)
    FROM _ve GROUP BY 1;
  GET DIAGNOSTICS n = ROW_COUNT;

  DELETE FROM entidad_visita_org;
  INSERT INTO entidad_visita_org
  SELECT x.entidad_ruc, x.org, max(x.tipo_entidad_visitante), count(*), count(DISTINCT x.numero_documento), min(x.fecha_visita),
         max(x.fecha_visita), count(*) FILTER (WHERE x.decisor), mode() WITHIN GROUP (ORDER BY ev.ruc)
    FROM (SELECT _ve.*, upper(btrim(entidad_visitante)) AS org FROM _ve
           WHERE entidad_visitante IS NOT NULL AND btrim(entidad_visitante) <> '' AND tipo_entidad_visitante <> 'persona_natural') x
    LEFT JOIN empresa_visita ev ON ev.visita_id = x.id AND ev.ruc ~ '^20\d{9}$'
   GROUP BY 1, 2;

  DELETE FROM entidad_visita_area;
  INSERT INTO entidad_visita_area
  SELECT entidad_ruc, COALESCE(NULLIF(btrim(funcionario_area), ''), 'Sin área en el registro'), COALESCE(btrim(funcionario_cargo), ''),
         count(*), count(*) FILTER (WHERE tipo_entidad_visitante = 'privada'), bool_or(COALESCE(decisor, false))
    FROM _ve GROUP BY 1, 2, 3;

  ANALYZE entidad_visita_resumen;
  ANALYZE entidad_visita_org;
  ANALYZE entidad_visita_area;
  RETURN n;
END $$;
ALTER TABLE entidad_visita_resumen OWNER TO vigia_jobs;
ALTER TABLE entidad_visita_org OWNER TO vigia_jobs;
ALTER TABLE entidad_visita_area OWNER TO vigia_jobs;
GRANT SELECT ON entidad_visita_resumen, entidad_visita_org, entidad_visita_area TO vigia_api, vigia_api_admin;
ALTER FUNCTION refrescar_visitas_entidad() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_visitas_entidad() FROM PUBLIC;
