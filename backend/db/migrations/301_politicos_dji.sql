-- 301 · Lo que el político declara en SU declaración jurada de intereses (DJI) y sus informes de control (2026-11-16).
--
-- Pregunta del dueño: «En estos cruces, ¿estamos considerando todas las declaraciones juradas? ¿O hay algún político que
-- no la tenga? (donde declara familiares y demás)». La 299 cruzaba la DJI en un solo sentido: un FUNCIONARIO declaró al
-- político como su familiar. Faltaba el otro: los familiares que el político declara en la suya y lo que obtuvieron.
--
-- 1 · Su DJI. Sólo de quien GANÓ desde 2022 (jne_autoridades: ERM2022 y sus complementarias, EG2026): la DJI es de quien
--     ejerce un cargo. Se empata por el nombre completo exacto (cuatro palabras casi siempre; con menos de tres no se
--     empata) Y la entidad que gobierna: su municipalidad, la sede central de su gobierno regional, el Congreso (diputados
--     y senadores) o el Despacho Presidencial. Una entidad del registro de la Contraloría sin RUC asignado
--     (dji_entidad_ruc) se reconoce por su nombre. Si dos autoridades con el mismo nombre caen en la misma entidad, no se
--     empata a ninguna. Es un empate por NOMBRE: la interfaz lo dice («confirmar que es la misma persona»).
--     Fuentes: dji_funcionarios (el registro de declarantes), dji_secciones (la DJI ya leída) y dji_vinculos (sus
--     familiares, con su DNI, que nunca sale de la base). Un mismo declarante tiene varios codigo_ddjj (una DJI por año y
--     por cambio de cargo): no es ambigüedad, es la misma persona.
--     Medido en PROD (2026-11-16, sólo lectura): 12 650 autoridades en alcance, 5 671 con su DJI en el registro, 2 859 con
--     su DJI ya leída y 2 824 que declaran familiares con documento (26 797 familiares); 2 descartadas por nombre corto y 0
--     por homónimo en la misma entidad.
-- 2 · Lo que obtuvieron sus familiares, sin nombre ni documento del familiar (sólo el parentesco):
--       órdenes de servicio como persona natural (persona_entidad por su RUC 10 = '10' + DNI + dígito; el RUC no sale);
--       en la entidad que él gobierna, las del indicio de nepotismo que ya calcula la vista dji_nepotismo (migraciones
--       136-138): las mismas cifras que la bandera «Posible nepotismo» de la entidad;
--       empresas (RNP, por DNI; sólo RUC 20) que ganaron buenas pro: en total, en la entidad que él gobierna desde que asumió
--       (conosce_adjudicaciones) y en gobiernos del partido (partido_proceso).
--     La planilla no trae documento (el Portal de Transparencia publica sólo el nombre): un familiar en la planilla de su
--     entidad no se cruza (sería por nombre).
-- 3 · Informes de control de la Contraloría en que figura con responsabilidad PRESUNTA (informe_control_persona, migración
--     302, por su DNI). Si esa tabla todavía no existe en la base, el cruce queda vacío (to_regclass).
--
-- Los cruces nuevos (hechos para revisar, ninguno prueba una falta):
--   familia_su_entidad  alta   un familiar declarado recibió órdenes de la entidad que él gobierna, o una empresa del
--                              familiar le ganó buenas pro a esa entidad, durante su gestión;
--   familia_partido     media  un familiar recibió órdenes de entidades que gobernaba el partido, o su empresa ganó en
--                              gobiernos del partido (después del primer aporte o candidatura del político con él);
--   familia_estado      baja   un familiar recibió órdenes del Estado o tiene una empresa que ganó buenas pro;
--   control_penal       alta   un informe de control le señala responsabilidad penal PRESUNTA;
--   control             media  un informe le señala otra responsabilidad presunta (civil o administrativa).
--
-- Tablas nuevas (sin documentos; las lee la API): politico_dji (su DJI empatada), politico_familiar (lo que obtuvo cada
-- familiar, numerado 1, 2, 3… dentro de cada político) y politico_informe (sus informes). partido_politico suma el estado
-- de su DJI y los conteos. La función refrescar_partido_politicos() es la de la 299 más los pasos 6b a 6e.
--
-- Permisos: los privilegios por omisión daban lectura (y escritura a vigia_agentes) en partido_politico y politico_codigo,
-- que llevan DNI. Aquí se quitan a todos menos a su dueño y a la API, como en la 302.
--
-- Cómo aplicarla: bash scratchpad/migrar.sh backend/db/migrations/301_politicos_dji.sql (DEV y luego PROD).

ALTER TABLE partido_politico
  ADD COLUMN IF NOT EXISTS dji_estado         TEXT,               -- leida | registro | no_encontrada | ambigua; NULL: no ganó desde 2022
  ADD COLUMN IF NOT EXISTS fam_n              INT     NOT NULL DEFAULT 0,  -- familiares que declara en su DJI
  ADD COLUMN IF NOT EXISTS fam_ordenes_n      INT     NOT NULL DEFAULT 0,  -- … con órdenes de servicio del Estado
  ADD COLUMN IF NOT EXISTS fam_ordenes_monto  NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fam_empresas_n     INT     NOT NULL DEFAULT 0,  -- … socios o representantes de empresas que ganaron buenas pro
  ADD COLUMN IF NOT EXISTS fam_su_entidad_n   INT     NOT NULL DEFAULT 0,  -- … que obtuvieron algo de la entidad que él gobierna, en su gestión
  ADD COLUMN IF NOT EXISTS fam_su_entidad_monto NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fam_partido_n      INT     NOT NULL DEFAULT 0,  -- … que obtuvieron algo de gobiernos de ESTE partido
  ADD COLUMN IF NOT EXISTS fam_partido_monto  NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS control_n          INT     NOT NULL DEFAULT 0,  -- informes de control con responsabilidad presunta
  ADD COLUMN IF NOT EXISTS control_penal      INT     NOT NULL DEFAULT 0;  -- … de ellos, con responsabilidad penal presunta

CREATE TABLE IF NOT EXISTS politico_dji (
  codigo        TEXT    NOT NULL,       -- el político (politico_codigo)
  entidad_ruc   TEXT    NOT NULL,       -- la entidad que gobierna, donde está su DJI
  entidad       TEXT,
  org_clave     TEXT,                   -- el partido con que ganó
  cargo_electo  TEXT,                   -- el cargo del JNE
  proceso       TEXT,                   -- ERM2022, EG2026…
  desde         DATE,                   -- su gestión
  hasta         DATE,
  cargo_dji     TEXT,                   -- el cargo con que figura en el registro de la Contraloría
  presentada    DATE,                   -- su última DJI presentada
  declaraciones INT     NOT NULL DEFAULT 0,  -- cuántas DJI tiene en el registro (una por año o por cambio de cargo)
  leida         BOOLEAN NOT NULL DEFAULT false,  -- Vigía ya leyó su DJI (secciones y familiares)
  familiares    INT     NOT NULL DEFAULT 0,      -- familiares que declara
  PRIMARY KEY (codigo, entidad_ruc)
);
COMMENT ON TABLE politico_dji IS
  'La DJI de cada autoridad elegida desde 2022, empatada por nombre completo exacto y la entidad que gobierna (migración 301). Sin documentos.';

CREATE TABLE IF NOT EXISTS politico_familiar (
  codigo       TEXT     NOT NULL,       -- el político
  pariente     SMALLINT NOT NULL,       -- 1, 2, 3…: qué familiar, sin su nombre ni su documento
  parentesco   TEXT,
  grado        TEXT,
  tipo         TEXT     NOT NULL,       -- orden | empresa
  entidad_ruc  TEXT,                    -- orden: la entidad que le dio órdenes
  entidad      TEXT,
  empresa_ruc  TEXT,                    -- empresa: RUC 20 de la empresa en que es socio, representante o directivo
  empresa      TEXT,
  rol          TEXT,
  ordenes      INT,
  procesos     INT,                     -- empresa: buenas pro que ganó en todo el Estado
  monto        NUMERIC,
  desde        INT,                     -- años de sus órdenes
  hasta        INT,
  su_entidad   BOOLEAN  NOT NULL DEFAULT false,  -- en la entidad que el político gobierna, durante su gestión
  su_entidad_procesos INT,
  su_entidad_monto    NUMERIC,
  nepotismo    BOOLEAN  NOT NULL DEFAULT false,  -- es el indicio «Posible nepotismo» de esa entidad (dji_nepotismo)
  partidos     TEXT[]   NOT NULL DEFAULT '{}'    -- los partidos que gobernaban donde obtuvo las órdenes o donde ganó la empresa
);
CREATE INDEX IF NOT EXISTS politico_familiar_codigo ON politico_familiar (codigo, pariente);
COMMENT ON TABLE politico_familiar IS
  'Lo que obtuvo cada familiar que un político declara en su DJI (órdenes, empresas que ganaron), sin nombre ni documento del familiar (migración 301).';

CREATE TABLE IF NOT EXISTS politico_informe (
  codigo            TEXT   NOT NULL,     -- el político
  informe           TEXT   NOT NULL,     -- informes_control.codigo
  numero            TEXT,
  titulo            TEXT,
  entidad           TEXT,
  entidad_ruc       TEXT,
  fecha             DATE,
  responsabilidades TEXT[] NOT NULL DEFAULT '{}',  -- PRESUNTAS: penal, civil, administrativa_entidad, administrativa_pas, administrativa
  PRIMARY KEY (codigo, informe)
);
COMMENT ON TABLE politico_informe IS
  'Informes de control en que figura un político (por su DNI, informe_control_persona) con responsabilidad PRESUNTA, no una condena (migración 301).';

CREATE OR REPLACE FUNCTION refrescar_partido_politicos() RETURNS integer
LANGUAGE plpgsql SET work_mem = '128MB' SET statement_timeout = '900s' AS $$
DECLARE
  v_filas int;
  v_rucs  text[];
BEGIN
  -- 1 · Cada nombre de organización de las cuatro fuentes, a la clave del partido (la de gobierno_periodo). Unos 800 nombres.
  DROP TABLE IF EXISTS _pp_org;
  CREATE TEMP TABLE _pp_org ON COMMIT DROP AS
    WITH claves AS (SELECT DISTINCT org_clave FROM gobierno_periodo)
    SELECT x.p, COALESCE((SELECT c.org_clave FROM claves c WHERE c.org_clave = x.k),
                         (SELECT c.org_clave FROM claves c WHERE c.org_clave = regexp_replace(x.k, '-del-peru$', '')),
                         (SELECT c.org_clave FROM claves c WHERE c.org_clave = regexp_replace(x.k, '^partido-politico-', ''))) AS org_clave
      FROM (SELECT s.p, left(lower(replace(mef_norm(s.p), ' ', '-')), 80) AS k
              FROM (SELECT DISTINCT partido AS p FROM jne_candidaturas UNION SELECT DISTINCT organizacion FROM onpe_candidatos
                    UNION SELECT DISTINCT organizacion_politica FROM jne_autoridades UNION SELECT DISTINCT partido FROM onpe_aportantes) s
             WHERE s.p IS NOT NULL) x;
  DELETE FROM _pp_org WHERE org_clave IS NULL;
  CREATE INDEX ON _pp_org (p);
  ANALYZE _pp_org;

  -- 2 · Los hechos: una fila por candidatura, cargo o aporte. El documento sólo si es un DNI (o el RUC 20 de una empresa
  -- que aporta; de un RUC 10, su DNI).
  DROP TABLE IF EXISTS _pp_h0;
  CREATE TEMP TABLE _pp_h0 ON COMMIT DROP AS
    SELECT n.org_clave, CASE WHEN j.numero_documento ~ '^\d{8}$' THEN j.numero_documento END AS doc, j.nombre, mef_norm(j.nombre) AS nom_n,
           'cand'::text AS que, j."año"::int AS anio, j.cargo, (j.resultado = 'electo') AS electo,
           concat_ws(', ', NULLIF(j.distrito, ''), NULLIF(j.provincia, ''), NULLIF(j.region, '')) AS lugar, NULL::numeric AS monto, NULL::date AS fecha
      FROM jne_candidaturas j JOIN _pp_org n ON n.p = j.partido
     WHERE j.nombre IS NOT NULL AND j."año" IS NOT NULL
    UNION ALL
    SELECT n.org_clave, CASE WHEN c.dni ~ '^\d{8}$' THEN c.dni END, btrim(c.apellidos || ' ' || c.nombres), mef_norm(c.apellidos || ' ' || c.nombres),
           'onpe', substring(c.proceso FROM '\d{4}')::int, NULL, false, NULLIF(c.departamento, ''), NULL, NULL
      FROM onpe_candidatos c JOIN _pp_org n ON n.p = c.organizacion
     WHERE c.apellidos IS NOT NULL AND c.nombres IS NOT NULL AND c.proceso ~ '\d{4}'
    UNION ALL
    SELECT n.org_clave, CASE WHEN a.dni ~ '^\d{8}$' THEN a.dni END, a.nombre, mef_norm(a.nombre),
           'aut', COALESCE(substring(a.proceso FROM '\d{4}')::int, extract(year FROM a.periodo_inicio)::int - 1), a.cargo, true,
           concat_ws(', ', NULLIF(a.distrito, ''), NULLIF(a.provincia, ''), NULLIF(a.departamento, '')), NULL, NULL
      FROM jne_autoridades a JOIN _pp_org n ON n.p = a.organizacion_politica
     WHERE a.nombre IS NOT NULL
    UNION ALL
    SELECT n.org_clave,
           CASE WHEN a.numero_documento ~ '^\d{8}$' THEN a.numero_documento
                WHEN a.numero_documento ~ '^10\d{9}$' THEN substr(a.numero_documento, 3, 8)
                WHEN a.numero_documento ~ '^20\d{9}$' THEN a.numero_documento END,
           a.nombre, mef_norm(a.nombre), 'aporte', a."año"::int, NULL, false, NULL, a.monto, a.fecha_aporte
      FROM onpe_aporte_unico a JOIN _pp_org n ON n.p = a.partido
     WHERE a.nombre IS NOT NULL;
  DELETE FROM _pp_h0 WHERE nom_n = '';
  CREATE INDEX ON _pp_h0 (org_clave, nom_n);
  ANALYZE _pp_h0;

  -- El documento de quien no lo trae: el del mismo nombre completo en el mismo partido, si ahí ese nombre tiene uno solo.
  DROP TABLE IF EXISTS _pp_prestado;
  CREATE TEMP TABLE _pp_prestado ON COMMIT DROP AS
    SELECT org_clave, nom_n, min(doc) AS doc FROM _pp_h0 WHERE doc ~ '^\d{8}$' GROUP BY 1, 2 HAVING count(DISTINCT doc) = 1;
  CREATE INDEX ON _pp_prestado (org_clave, nom_n);
  ANALYZE _pp_prestado;

  DROP TABLE IF EXISTS _pp_h;
  CREATE TEMP TABLE _pp_h ON COMMIT DROP AS
    SELECT h.org_clave, COALESCE(h.doc, d.doc) AS doc, COALESCE(h.doc, d.doc, 'N:' || h.nom_n || '|' || h.org_clave) AS llave,
           h.nombre, h.nom_n, h.que, h.anio, h.cargo, h.electo, h.lugar, h.monto, h.fecha
      FROM _pp_h0 h LEFT JOIN _pp_prestado d ON h.doc IS NULL AND d.org_clave = h.org_clave AND d.nom_n = h.nom_n;
  CREATE INDEX ON _pp_h (org_clave, llave, anio);
  ANALYZE _pp_h;

  -- 3 · Sus candidaturas, una vez: la del JNE; el cargo que ejerce si no hay candidatura elegida ese año (un reemplazo);
  -- la de la ONPE sólo si el JNE no trae ninguna ese año.
  DROP TABLE IF EXISTS _pp_c;
  CREATE TEMP TABLE _pp_c ON COMMIT DROP AS
    SELECT DISTINCT h.org_clave, h.llave, h.anio, h.cargo, h.lugar,
           CASE WHEN h.que = 'onpe' THEN NULL WHEN h.electo THEN 'electo' ELSE 'no_electo' END AS resultado,
           CASE h.que WHEN 'cand' THEN 'JNE' WHEN 'aut' THEN 'JNE (autoridades)' ELSE 'ONPE' END AS fuente
      FROM _pp_h h
     WHERE h.que = 'cand'
        OR (h.que = 'aut' AND NOT EXISTS (SELECT 1 FROM _pp_h c WHERE c.org_clave = h.org_clave AND c.llave = h.llave AND c.anio = h.anio
                                                                  AND c.que = 'cand' AND c.electo))
        OR (h.que = 'onpe' AND NOT EXISTS (SELECT 1 FROM _pp_h c WHERE c.org_clave = h.org_clave AND c.llave = h.llave AND c.anio = h.anio
                                                                   AND c.que IN ('cand', 'aut')));
  CREATE INDEX ON _pp_c (org_clave, llave);
  ANALYZE _pp_c;

  DROP TABLE IF EXISTS _pp_ca;
  CREATE TEMP TABLE _pp_ca ON COMMIT DROP AS
    SELECT org_clave, llave, count(*)::int AS n, COALESCE(bool_or(resultado = 'electo'), false) AS gano,
           array_agg(DISTINCT anio ORDER BY anio) AS anios,
           (array_agg(cargo ORDER BY anio DESC, (resultado = 'electo') DESC NULLS LAST) FILTER (WHERE cargo IS NOT NULL))[1] AS cargo,
           (array_agg(lugar ORDER BY anio DESC, (resultado = 'electo') DESC NULLS LAST) FILTER (WHERE COALESCE(lugar, '') <> ''))[1] AS lugar,
           jsonb_agg(jsonb_build_object('anio', anio, 'cargo', cargo, 'lugar', NULLIF(lugar, ''), 'resultado', resultado, 'fuente', fuente)
                     ORDER BY anio DESC, (resultado = 'electo') DESC NULLS LAST, cargo) AS candidaturas
      FROM _pp_c GROUP BY 1, 2;
  CREATE INDEX ON _pp_ca (org_clave, llave);
  ANALYZE _pp_ca;

  -- 4 · Cada persona (o empresa aportante) en cada partido.
  DROP TABLE IF EXISTS _pp_p;
  CREATE TEMP TABLE _pp_p ON COMMIT DROP AS
    SELECT org_clave, llave, max(doc) AS doc,
           (array_agg(nombre ORDER BY CASE que WHEN 'cand' THEN 0 WHEN 'aut' THEN 1 WHEN 'onpe' THEN 2 ELSE 3 END, anio DESC NULLS LAST, nombre))[1] AS nombre,
           (array_agg(nom_n ORDER BY CASE que WHEN 'cand' THEN 0 WHEN 'aut' THEN 1 WHEN 'onpe' THEN 2 ELSE 3 END, anio DESC NULLS LAST, nombre))[1] AS nom_n,
           bool_or(que <> 'aporte') AS candidato, bool_or(que = 'aporte') AS aportante,
           (count(*) FILTER (WHERE que = 'aporte'))::int AS aportes_n, COALESCE(sum(monto) FILTER (WHERE que = 'aporte'), 0) AS aportes_monto,
           min(COALESCE(fecha, make_date(anio, 1, 1))) FILTER (WHERE que = 'aporte' AND anio BETWEEN 1990 AND 2100) AS aporte_desde,
           max(COALESCE(fecha, make_date(anio, 1, 1))) FILTER (WHERE que = 'aporte' AND anio BETWEEN 1990 AND 2100) AS aporte_hasta,
           least(min(COALESCE(fecha, make_date(anio, 1, 1))) FILTER (WHERE que = 'aporte' AND anio BETWEEN 1990 AND 2100),
                 min(make_date(anio, 1, 1)) FILTER (WHERE que <> 'aporte' AND anio BETWEEN 1990 AND 2100)) AS desde
      FROM _pp_h GROUP BY 1, 2;
  CREATE INDEX ON _pp_p (doc);
  CREATE INDEX ON _pp_p (org_clave, llave);
  CREATE INDEX ON _pp_p (llave);
  ANALYZE _pp_p;

  -- 5 · Los cruces, por documento. Primero los documentos distintos (unos 50 000) y de ahí cada registro por igualdad.
  DROP TABLE IF EXISTS _pp_dd;
  CREATE TEMP TABLE _pp_dd ON COMMIT DROP AS SELECT DISTINCT doc FROM _pp_p WHERE doc IS NOT NULL;
  CREATE UNIQUE INDEX ON _pp_dd (doc);
  ANALYZE _pp_dd;

  -- Sus empresas (RNP, sólo RUC 20: el RNP tipa como «RUC» a personas con su DNI, auditoría del 2026-10-29); una empresa
  -- que aporta es su propia empresa.
  DROP TABLE IF EXISTS _pp_emp;
  CREATE TEMP TABLE _pp_emp ON COMMIT DROP AS
    SELECT DISTINCT r.numero_documento AS doc, r.ruc_empresa::text AS ruc
      FROM rnp_conformacion_juridica r JOIN _pp_dd d ON d.doc = r.numero_documento
     WHERE d.doc ~ '^\d{8}$' AND (r.tipo_documento LIKE 'DOC. NACIONAL%' OR r.tipo_documento = 'REG. UNICO DE CONTRIBUYENTES')
       AND r.ruc_empresa::text ~ '^20[0-9]{9}$'
    UNION
    SELECT d.doc, d.doc FROM _pp_dd d WHERE d.doc ~ '^20\d{9}$';
  CREATE INDEX ON _pp_emp (doc);
  CREATE INDEX ON _pp_emp (ruc);
  ANALYZE _pp_emp;

  DROP TABLE IF EXISTS _pp_emp_tot;
  CREATE TEMP TABLE _pp_emp_tot ON COMMIT DROP AS
    SELECT e.doc, count(*)::int AS n, COALESCE(sum(COALESCE(er.adj_monto, 0) + COALESCE(er.ord_monto, 0)), 0) AS monto,
           (count(*) FILTER (WHERE er.inhabilitada IS NOT NULL))::int AS inhab
      FROM _pp_emp e LEFT JOIN empresa_resumen er ON er.ruc = e.ruc GROUP BY 1;
  CREATE UNIQUE INDEX ON _pp_emp_tot (doc);
  ANALYZE _pp_emp_tot;

  -- Sus empresas en los gobiernos del partido, después de su primer aporte o candidatura. Primero persona × empresa
  -- (pocas decenas de miles) y recién después los procesos, por igualdad de partido y RUC.
  DROP TABLE IF EXISTS _pp_pe;
  CREATE TEMP TABLE _pp_pe ON COMMIT DROP AS
    SELECT p.org_clave, p.llave, p.desde, e.ruc FROM _pp_p p JOIN _pp_emp e ON e.doc = p.doc WHERE p.desde IS NOT NULL;
  CREATE INDEX ON _pp_pe (ruc, org_clave);
  ANALYZE _pp_pe;

  DROP TABLE IF EXISTS _pp_emp_gob;
  CREATE TEMP TABLE _pp_emp_gob ON COMMIT DROP AS
    SELECT x.org_clave, x.llave, count(DISTINCT pp.codigo_convocatoria)::int AS n, COALESCE(sum(pp.monto_adjudicado_pen), 0) AS monto
      FROM _pp_pe x JOIN partido_proceso pp ON pp.ruc_proveedor = x.ruc AND pp.org_clave = x.org_clave AND pp.fecha_convocatoria >= x.desde
     GROUP BY 1, 2;
  CREATE INDEX ON _pp_emp_gob (org_clave, llave);
  ANALYZE _pp_emp_gob;

  -- Sus órdenes de servicio como persona natural: su RUC 10 lleva su DNI en las cifras 3 a 10.
  DROP TABLE IF EXISTS _pp_pc;
  CREATE TEMP TABLE _pp_pc ON COMMIT DROP AS
    SELECT d.doc, c.ruc, c.codigo FROM persona_codigo c JOIN _pp_dd d ON d.doc = substr(c.ruc, 3, 8) WHERE c.ruc LIKE '10%';
  CREATE INDEX ON _pp_pc (ruc);
  ANALYZE _pp_pc;

  DROP TABLE IF EXISTS _pp_loc_e;
  CREATE TEMP TABLE _pp_loc_e ON COMMIT DROP AS
    SELECT c.doc, c.codigo, pe.entidad_ruc, pe.monto, pe.gobiernos FROM _pp_pc c JOIN persona_entidad pe ON pe.ruc = c.ruc;
  CREATE INDEX ON _pp_loc_e (doc);
  ANALYZE _pp_loc_e;

  DROP TABLE IF EXISTS _pp_loc;
  CREATE TEMP TABLE _pp_loc ON COMMIT DROP AS
    SELECT doc, min(codigo) AS codigo, count(*)::int AS entidades, COALESCE(sum(monto), 0) AS monto FROM _pp_loc_e GROUP BY 1;
  CREATE UNIQUE INDEX ON _pp_loc (doc);
  ANALYZE _pp_loc;

  -- De esas entidades, las que gobernaba este partido cuando le dieron las órdenes (persona_entidad.gobiernos: 'clave:año').
  DROP TABLE IF EXISTS _pp_loc_gob;
  CREATE TEMP TABLE _pp_loc_gob ON COMMIT DROP AS
    SELECT p.org_clave, p.llave, count(*)::int AS entidades, COALESCE(sum(e.monto), 0) AS monto
      FROM _pp_p p JOIN _pp_loc_e e ON e.doc = p.doc
     WHERE e.gobiernos && ARRAY[p.org_clave || ':2014', p.org_clave || ':2018', p.org_clave || ':2022']
     GROUP BY 1, 2;
  CREATE INDEX ON _pp_loc_gob (org_clave, llave);
  ANALYZE _pp_loc_gob;

  -- Los funcionarios que lo declararon como familiar (DJI).
  DROP TABLE IF EXISTS _pp_fam;
  CREATE TEMP TABLE _pp_fam ON COMMIT DROP AS
    SELECT x.doc, count(*)::int AS n
      FROM (SELECT DISTINCT d.doc, v.entidad_ruc, v.declarante_norm FROM dji_vinculos v JOIN _pp_dd d ON d.doc = v.pariente_doc
             WHERE v.declarante_norm IS NOT NULL) x GROUP BY 1;
  CREATE UNIQUE INDEX ON _pp_fam (doc);
  ANALYZE _pp_fam;

  -- Sus sanciones del Tribunal de Contrataciones: de la persona (RUC 10) o de la empresa que aporta (RUC 20).
  DROP TABLE IF EXISTS _pp_san;
  CREATE TEMP TABLE _pp_san ON COMMIT DROP AS
    SELECT CASE WHEN s.ruc LIKE '10%' THEN substr(s.ruc, 3, 8) ELSE s.ruc END AS doc, count(*)::int AS n,
           (count(*) FILTER (WHERE s.tipo IN ('temporal', 'definitivo')))::int AS inhab
      FROM osce_sancionados s WHERE s.ruc ~ '^(10|20)\d{9}$' GROUP BY 1;
  CREATE UNIQUE INDEX ON _pp_san (doc);
  ANALYZE _pp_san;

  -- Quien ganó una elección con cualquier partido: su nombre es público (lib/electos.ts de la API).
  DROP TABLE IF EXISTS _pp_electo;
  CREATE TEMP TABLE _pp_electo ON COMMIT DROP AS
    SELECT dni AS doc FROM jne_autoridades WHERE dni ~ '^\d{8}$'
    UNION
    SELECT numero_documento FROM jne_candidaturas WHERE resultado = 'electo' AND numero_documento ~ '^\d{8}$';
  CREATE UNIQUE INDEX ON _pp_electo (doc);
  ANALYZE _pp_electo;

  -- 6 · Un código por persona (sólo crece: el de una persona no cambia entre refrescos).
  INSERT INTO politico_codigo (llave) SELECT DISTINCT llave FROM _pp_p ON CONFLICT (llave) DO NOTHING;

  -- 6b · Su DJI (migración 301). Cada autoridad elegida desde 2022 con la entidad que gobierna: su municipalidad (una por
  -- distrito o provincia), la sede central de su gobierno regional (no las UGEL ni los hospitales: ahí un homónimo es más
  -- probable), el Congreso (diputados y senadores) o el Despacho Presidencial. La misma llave que en el paso 2.
  DROP TABLE IF EXISTS _pp_aut0;
  CREATE TEMP TABLE _pp_aut0 ON COMMIT DROP AS
    SELECT n.org_clave, COALESCE(CASE WHEN a.dni ~ '^\d{8}$' THEN a.dni END, d.doc, 'N:' || mef_norm(a.nombre) || '|' || n.org_clave) AS llave,
           mef_norm(a.nombre) AS nom_n, a.cargo, a.proceso, a.ubigeo,
           CASE a.ambito WHEN 'DISTRITAL' THEN 'distrital' WHEN 'PROVINCIAL' THEN 'provincial' WHEN 'REGIONAL' THEN 'regional' ELSE 'nacional' END AS nivel,
           COALESCE(a.periodo_inicio, make_date(COALESCE(substring(a.proceso FROM '\d{4}')::int, 2022) + 1, 1, 1)) AS desde, a.periodo_fin AS hasta
      FROM jne_autoridades a
      JOIN _pp_org n ON n.p = a.organizacion_politica
      LEFT JOIN _pp_prestado d ON NOT COALESCE(a.dni ~ '^\d{8}$', false) AND d.org_clave = n.org_clave AND d.nom_n = mef_norm(a.nombre)
     WHERE a.nombre IS NOT NULL AND COALESCE(a.periodo_fin, DATE '2100-01-01') >= DATE '2022-01-01';
  ANALYZE _pp_aut0;

  -- La sede central de cada gobierno regional (una por región).
  DROP TABLE IF EXISTS _pp_sede;
  CREATE TEMP TABLE _pp_sede ON COMMIT DROP AS
    SELECT g.ubigeo, g.ruc FROM entidad_gobierno_amplia g JOIN entidades en ON en.ruc::text = g.ruc
     WHERE g.nivel = 'regional' AND g.como = 'entidades' AND en.nombre ~* 'SEDE CENTRAL';
  ANALYZE _pp_sede;

  DROP TABLE IF EXISTS _pp_aut;
  CREATE TEMP TABLE _pp_aut ON COMMIT DROP AS
    SELECT DISTINCT ON (x.org_clave, x.llave, x.ruc) x.org_clave, x.llave, x.nom_n, x.cargo, x.proceso, x.desde, x.hasta, x.ruc
      FROM (
        SELECT a.*, g.ruc FROM _pp_aut0 a
          JOIN entidad_gobierno_amplia g ON g.como = 'entidades' AND g.nivel = a.nivel AND g.ubigeo = a.ubigeo
         WHERE a.nivel IN ('distrital', 'provincial')
        UNION ALL
        SELECT a.*, s.ruc FROM _pp_aut0 a JOIN _pp_sede s ON s.ubigeo = a.ubigeo WHERE a.nivel = 'regional'
        UNION ALL
        SELECT a.*, '20161749126' FROM _pp_aut0 a WHERE a.cargo IN ('DIPUTADO', 'SENADOR')   -- Congreso de la República
        UNION ALL
        SELECT a.*, '20161704378' FROM _pp_aut0 a                                          -- Despacho Presidencial
         WHERE a.cargo ~ '^(PRESIDENTE DE LA REP|PRIMER VICEPRESIDENTE|SEGUNDO VICEPRESIDENTE)') x
     ORDER BY x.org_clave, x.llave, x.ruc, x.desde DESC;
  CREATE INDEX ON _pp_aut (ruc, nom_n);
  ANALYZE _pp_aut;

  -- Sin ambigüedad: un nombre de tres palabras o más, y que en esa entidad ninguna otra autoridad se llame igual.
  DROP TABLE IF EXISTS _pp_aut_ok;
  CREATE TEMP TABLE _pp_aut_ok ON COMMIT DROP AS
    SELECT a.* FROM _pp_aut a
     WHERE cardinality(string_to_array(a.nom_n, ' ')) >= 3
       AND NOT EXISTS (SELECT 1 FROM _pp_aut b WHERE b.ruc = a.ruc AND b.nom_n = a.nom_n AND b.llave <> a.llave);
  CREATE INDEX ON _pp_aut_ok (ruc, nom_n);
  ANALYZE _pp_aut_ok;

  -- El nombre de esas entidades en el registro de la Contraloría: el de dji_entidad_ruc y, para las que no tienen RUC
  -- asignado, el nombre igual al de la entidad o con algo más al final («… DE PUEBLO LIBRE(MAGDALENA VIEJA)»).
  DROP TABLE IF EXISTS _pp_ae;
  CREATE TEMP TABLE _pp_ae ON COMMIT DROP AS
    SELECT DISTINCT r.entidad, r.ruc FROM dji_entidad_ruc r WHERE r.ruc IN (SELECT ruc FROM _pp_aut_ok)
    UNION
    SELECT f.entidad, x.ruc
      FROM (SELECT DISTINCT f0.entidad, mef_norm(f0.entidad) AS n FROM dji_funcionarios f0
             WHERE f0.entidad IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dji_entidad_ruc r WHERE r.entidad = f0.entidad)) f
      JOIN (SELECT DISTINCT o.ruc, mef_norm(en.nombre) AS n FROM _pp_aut_ok o JOIN entidades en ON en.ruc::text = o.ruc) x
        ON f.n = x.n OR f.n LIKE x.n || ' %';
  CREATE INDEX ON _pp_ae (entidad);
  ANALYZE _pp_ae;

  -- El registro (quién está obligado a declarar), lo ya leído (dji_secciones) y sus familiares (dji_vinculos, con DNI:
  -- nada de esta tabla sale de la función salvo conteos y lo que obtuvo cada familiar, sin su documento).
  DROP TABLE IF EXISTS _pp_djr;
  CREATE TEMP TABLE _pp_djr ON COMMIT DROP AS
    SELECT x.ruc, mef_norm(f.nombre_norm) AS nom_n, f.codigo_ddjj, f.cargo, fecha_dji(f.fecha_presentacion) AS presentada, f.entidad
      FROM dji_funcionarios f JOIN _pp_ae x ON x.entidad = f.entidad;
  CREATE INDEX ON _pp_djr (ruc, nom_n);
  ANALYZE _pp_djr;

  DROP TABLE IF EXISTS _pp_djl;
  CREATE TEMP TABLE _pp_djl ON COMMIT DROP AS
    SELECT DISTINCT s.entidad_ruc AS ruc, mef_norm(s.declarante_norm) AS nom_n
      FROM dji_secciones s WHERE s.entidad_ruc IN (SELECT ruc FROM _pp_aut_ok) AND s.declarante_norm IS NOT NULL;
  CREATE INDEX ON _pp_djl (ruc, nom_n);
  ANALYZE _pp_djl;

  DROP TABLE IF EXISTS _pp_djv;
  CREATE TEMP TABLE _pp_djv ON COMMIT DROP AS
    SELECT v.entidad_ruc AS ruc, mef_norm(v.declarante_norm) AS nom_n, v.pariente_doc, v.parentesco, v.grado
      FROM dji_vinculos v WHERE v.entidad_ruc IN (SELECT ruc FROM _pp_aut_ok) AND v.declarante_norm IS NOT NULL;
  CREATE INDEX ON _pp_djv (ruc, nom_n);
  ANALYZE _pp_djv;

  -- Cada autoridad con su DJI empatada (en el registro, leída o con familiares).
  DROP TABLE IF EXISTS _pp_dji;
  CREATE TEMP TABLE _pp_dji ON COMMIT DROP AS
    SELECT a.org_clave, a.llave, a.ruc, a.nom_n, a.cargo AS cargo_electo, a.proceso, a.desde, a.hasta,
           r.declaraciones, r.cargo AS cargo_dji, r.presentada,
           (l.ruc IS NOT NULL OR v.ruc IS NOT NULL) AS leida, COALESCE(v.familiares, 0) AS familiares
      FROM _pp_aut_ok a
      LEFT JOIN (SELECT ruc, nom_n, count(DISTINCT codigo_ddjj)::int AS declaraciones,
                        (array_agg(cargo ORDER BY presentada DESC NULLS LAST) FILTER (WHERE cargo IS NOT NULL))[1] AS cargo,
                        max(presentada) AS presentada
                   FROM _pp_djr GROUP BY 1, 2) r ON r.ruc = a.ruc AND r.nom_n = a.nom_n
      LEFT JOIN (SELECT DISTINCT ruc, nom_n FROM _pp_djl) l ON l.ruc = a.ruc AND l.nom_n = a.nom_n
      LEFT JOIN (SELECT ruc, nom_n, count(DISTINCT pariente_doc)::int AS familiares FROM _pp_djv GROUP BY 1, 2) v
        ON v.ruc = a.ruc AND v.nom_n = a.nom_n
     WHERE r.ruc IS NOT NULL OR l.ruc IS NOT NULL OR v.ruc IS NOT NULL;
  CREATE INDEX ON _pp_dji (llave);
  CREATE INDEX ON _pp_dji (ruc, nom_n);
  ANALYZE _pp_dji;

  -- El estado de su DJI, por persona (la llave): leída, sólo en el registro, no encontrada o ambigua (homónimo o nombre corto).
  DROP TABLE IF EXISTS _pp_dje;
  CREATE TEMP TABLE _pp_dje ON COMMIT DROP AS
    SELECT a.llave,
           CASE WHEN bool_or(j.leida) THEN 'leida' WHEN bool_or(j.llave IS NOT NULL) THEN 'registro'
                WHEN bool_or(o.llave IS NULL) THEN 'ambigua' ELSE 'no_encontrada' END AS estado,
           COALESCE(max(f.n), 0) AS fam_n
      FROM _pp_aut a
      LEFT JOIN _pp_aut_ok o ON o.llave = a.llave AND o.ruc = a.ruc AND o.org_clave = a.org_clave
      LEFT JOIN _pp_dji j ON j.llave = a.llave AND j.ruc = a.ruc
      LEFT JOIN (SELECT j2.llave, count(DISTINCT v.pariente_doc)::int AS n FROM _pp_dji j2 JOIN _pp_djv v ON v.ruc = j2.ruc AND v.nom_n = j2.nom_n
                  GROUP BY 1) f ON f.llave = a.llave
     GROUP BY 1;
  CREATE UNIQUE INDEX ON _pp_dje (llave);
  ANALYZE _pp_dje;

  -- 6c · Sus familiares con DNI y lo que obtuvieron. Uno por persona y familiar (si declara al mismo en dos entidades, una vez
  -- por cada entidad que gobierna).
  DROP TABLE IF EXISTS _pp_fd;
  CREATE TEMP TABLE _pp_fd ON COMMIT DROP AS
    SELECT DISTINCT ON (j.llave, j.ruc, v.pariente_doc) j.llave, j.ruc AS su_ruc, j.nom_n, j.desde, j.hasta, v.pariente_doc AS doc, v.parentesco, v.grado
      FROM _pp_dji j JOIN _pp_djv v ON v.ruc = j.ruc AND v.nom_n = j.nom_n
     WHERE v.pariente_doc ~ '^\d{8}$'
     ORDER BY j.llave, j.ruc, v.pariente_doc, v.parentesco;
  CREATE INDEX ON _pp_fd (doc);
  CREATE INDEX ON _pp_fd (llave);
  ANALYZE _pp_fd;

  DROP TABLE IF EXISTS _pp_fdd;
  CREATE TEMP TABLE _pp_fdd ON COMMIT DROP AS SELECT DISTINCT doc FROM _pp_fd;
  CREATE UNIQUE INDEX ON _pp_fdd (doc);
  ANALYZE _pp_fdd;

  -- Sus órdenes de servicio en todas las entidades (persona_entidad, por el RUC 10 del familiar).
  DROP TABLE IF EXISTS _pp_fo;
  CREATE TEMP TABLE _pp_fo ON COMMIT DROP AS
    SELECT d.doc, pe.entidad_ruc, pe.entidad, pe.ordenes, pe.monto, extract(year FROM pe.primera)::int AS desde, extract(year FROM pe.ultima)::int AS hasta,
           ARRAY(SELECT DISTINCT split_part(g, ':', 1) FROM unnest(COALESCE(pe.gobiernos, '{}')) g) AS partidos
      FROM persona_codigo c JOIN _pp_fdd d ON d.doc = substr(c.ruc, 3, 8)
      JOIN persona_entidad pe ON pe.ruc = c.ruc
     WHERE c.ruc LIKE '10%';
  CREATE INDEX ON _pp_fo (doc, entidad_ruc);
  ANALYZE _pp_fo;

  -- En la entidad que él gobierna: el indicio de nepotismo que ya calcula la vista dji_nepotismo (el familiar declarado es
  -- locador de la misma entidad del declarante), con sus años. Cuenta para su gestión si tuvo órdenes desde que asumió.
  -- Las entidades van como arreglo (no como subconsulta): así el filtro baja dentro de la vista y sólo se buscan los
  -- familiares de esas entidades, no los 900 mil de la DJI.
  v_rucs := ARRAY(SELECT DISTINCT ruc FROM _pp_dji);
  DROP TABLE IF EXISTS _pp_nep;
  CREATE TEMP TABLE _pp_nep ON COMMIT DROP AS
    SELECT n.entidad_ruc AS ruc, mef_norm(n.declarante_norm) AS nom_n, substr(n.proveedor_ruc, 3, 8) AS doc,
           -- max y no sum: el mismo familiar puede venir en dos filas de la vista (dos nombres del declarante que se normalizan igual).
           max(n.ordenes)::int AS ordenes, max(n.monto) AS monto, min(n.desde)::int AS desde, max(n.hasta)::int AS hasta
      FROM dji_nepotismo n WHERE n.entidad_ruc = ANY (v_rucs)
     GROUP BY 1, 2, 3;
  CREATE INDEX ON _pp_nep (ruc, nom_n, doc);
  ANALYZE _pp_nep;

  -- Sus empresas (RNP por su DNI, sólo RUC 20) que ganaron buenas pro, con lo que ganaron en todo el Estado.
  DROP TABLE IF EXISTS _pp_fe;
  CREATE TEMP TABLE _pp_fe ON COMMIT DROP AS
    SELECT r.numero_documento AS doc, r.ruc_empresa::text AS ruc, string_agg(DISTINCT r.tipo_rol, ', ' ORDER BY r.tipo_rol) AS rol,
           max(er.nombre) AS nombre, max(er.adj_procesos)::int AS procesos, max(er.adj_monto) AS monto
      FROM rnp_conformacion_juridica r JOIN _pp_fdd d ON d.doc = r.numero_documento
      JOIN empresa_resumen er ON er.ruc = r.ruc_empresa::text AND er.adj_procesos > 0
     WHERE (r.tipo_documento LIKE 'DOC. NACIONAL%' OR r.tipo_documento = 'REG. UNICO DE CONTRIBUYENTES') AND r.ruc_empresa::text ~ '^20[0-9]{9}$'
     GROUP BY 1, 2;
  CREATE INDEX ON _pp_fe (doc);
  CREATE INDEX ON _pp_fe (ruc);
  ANALYZE _pp_fe;

  -- Los partidos en cuyos gobiernos ganó cada una de esas empresas.
  DROP TABLE IF EXISTS _pp_fe_part;
  CREATE TEMP TABLE _pp_fe_part ON COMMIT DROP AS
    SELECT e.ruc, array_agg(DISTINCT pp.org_clave ORDER BY pp.org_clave) AS partidos
      FROM (SELECT DISTINCT ruc FROM _pp_fe) e JOIN partido_proceso pp ON pp.ruc_proveedor = e.ruc GROUP BY 1;
  CREATE UNIQUE INDEX ON _pp_fe_part (ruc);
  ANALYZE _pp_fe_part;

  -- Lo que esas empresas le ganaron a la entidad que él gobierna desde que asumió.
  DROP TABLE IF EXISTS _pp_feg;
  CREATE TEMP TABLE _pp_feg ON COMMIT DROP AS
    SELECT f.llave, f.su_ruc, f.doc, e.ruc, count(DISTINCT a.codigo_convocatoria)::int AS procesos,
           COALESCE(sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')), 0) AS monto
      FROM _pp_fd f JOIN _pp_fe e ON e.doc = f.doc
      JOIN conosce_adjudicaciones a ON a.ruc_proveedor = e.ruc AND a.entidad_ruc = f.su_ruc AND a.fecha_buenapro >= f.desde
     GROUP BY 1, 2, 3, 4;
  CREATE INDEX ON _pp_feg (llave, doc, ruc);
  ANALYZE _pp_feg;

  -- Cada familiar de cada persona con lo que obtuvo, y su número (1, 2, 3…): primero quien obtuvo algo de su entidad, luego
  -- quien más obtuvo. El número no dice nada del familiar (no sigue el orden de su DNI).
  DROP TABLE IF EXISTS _pp_fr;
  CREATE TEMP TABLE _pp_fr ON COMMIT DROP AS
    SELECT x.*, row_number() OVER (PARTITION BY x.llave ORDER BY x.su_monto DESC, x.su_n DESC, x.total DESC, md5(x.llave || x.doc)) AS pariente
      FROM (
        SELECT f.llave, f.doc, min(f.parentesco) AS parentesco, min(f.grado) AS grado,
               COALESCE((SELECT sum(n.monto) FROM _pp_nep n, _pp_fd f2
                          WHERE f2.llave = f.llave AND f2.doc = f.doc AND n.ruc = f2.su_ruc AND n.nom_n = f2.nom_n AND n.doc = f.doc
                            AND n.hasta >= extract(year FROM f2.desde)), 0)
                 + COALESCE((SELECT sum(g.monto) FROM _pp_feg g WHERE g.llave = f.llave AND g.doc = f.doc), 0) AS su_monto,
               (SELECT count(*) FROM _pp_nep n, _pp_fd f2
                 WHERE f2.llave = f.llave AND f2.doc = f.doc AND n.ruc = f2.su_ruc AND n.nom_n = f2.nom_n AND n.doc = f.doc
                   AND n.hasta >= extract(year FROM f2.desde))
                 + (SELECT count(*) FROM _pp_feg g WHERE g.llave = f.llave AND g.doc = f.doc) AS su_n,
               COALESCE((SELECT sum(o.monto) FROM _pp_fo o WHERE o.doc = f.doc), 0) + COALESCE((SELECT sum(e.monto) FROM _pp_fe e WHERE e.doc = f.doc), 0) AS total,
               (SELECT count(*) FROM _pp_fo o WHERE o.doc = f.doc) AS n_ordenes,
               (SELECT count(*) FROM _pp_fe e WHERE e.doc = f.doc) AS n_empresas,
               COALESCE((SELECT sum(o.monto) FROM _pp_fo o WHERE o.doc = f.doc), 0) AS ordenes_monto
          FROM _pp_fd f GROUP BY f.llave, f.doc) x;
  CREATE INDEX ON _pp_fr (llave, doc);
  ANALYZE _pp_fr;

  -- Por persona: cuántos familiares obtuvieron qué.
  DROP TABLE IF EXISTS _pp_fagg;
  CREATE TEMP TABLE _pp_fagg ON COMMIT DROP AS
    SELECT llave, (count(*) FILTER (WHERE n_ordenes > 0))::int AS ordenes_n, COALESCE(sum(ordenes_monto), 0) AS ordenes_monto,
           (count(*) FILTER (WHERE n_empresas > 0))::int AS empresas_n,
           (count(*) FILTER (WHERE su_n > 0))::int AS su_n, COALESCE(sum(su_monto) FILTER (WHERE su_n > 0), 0) AS su_monto
      FROM _pp_fr GROUP BY 1;
  CREATE UNIQUE INDEX ON _pp_fagg (llave);
  ANALYZE _pp_fagg;

  -- Por persona y partido: familiares con órdenes de entidades que gobernaba ESE partido, o con empresas que ganaron en sus
  -- gobiernos después del primer aporte o candidatura del político con él.
  DROP TABLE IF EXISTS _pp_fpart;
  CREATE TEMP TABLE _pp_fpart ON COMMIT DROP AS
    SELECT x.org_clave, x.llave, count(DISTINCT x.doc)::int AS n, COALESCE(sum(x.monto), 0) AS monto
      FROM (
        SELECT p.org_clave, p.llave, o.doc, o.monto
          FROM _pp_p p JOIN (SELECT DISTINCT llave, doc FROM _pp_fd) f ON f.llave = p.llave JOIN _pp_fo o ON o.doc = f.doc
         WHERE p.org_clave = ANY (o.partidos)
        UNION ALL
        SELECT p.org_clave, p.llave, f.doc, pp.monto_adjudicado_pen
          FROM _pp_p p JOIN (SELECT DISTINCT llave, doc FROM _pp_fd) f ON f.llave = p.llave JOIN _pp_fe e ON e.doc = f.doc
          JOIN partido_proceso pp ON pp.ruc_proveedor = e.ruc AND pp.org_clave = p.org_clave AND pp.fecha_convocatoria >= COALESCE(p.desde, DATE '1990-01-01')
      ) x GROUP BY 1, 2;
  CREATE INDEX ON _pp_fpart (org_clave, llave);
  ANALYZE _pp_fpart;

  -- 6d · Informes de control con responsabilidad PRESUNTA (migración 302), por su DNI. Sin esa tabla, nada.
  DROP TABLE IF EXISTS _pp_ctl;
  CREATE TEMP TABLE _pp_ctl (doc text, informe text, responsabilidades text[]) ON COMMIT DROP;
  IF to_regclass('public.informe_control_persona') IS NOT NULL THEN
    EXECUTE $q$
      INSERT INTO _pp_ctl (doc, informe, responsabilidades)
      SELECT i.doc, i.codigo, COALESCE(array_agg(DISTINCT r ORDER BY r) FILTER (WHERE r IS NOT NULL AND r <> ''), '{}')
        FROM informe_control_persona i
        JOIN _pp_dd d ON d.doc = i.doc
        LEFT JOIN LATERAL unnest(i.responsabilidades) r ON true
       WHERE i.doc ~ '^\d{8}$'
       GROUP BY 1, 2 $q$;
  END IF;
  CREATE INDEX ON _pp_ctl (doc);
  ANALYZE _pp_ctl;

  DROP TABLE IF EXISTS _pp_ctl_agg;
  CREATE TEMP TABLE _pp_ctl_agg ON COMMIT DROP AS
    SELECT doc, count(*)::int AS n, (count(*) FILTER (WHERE 'penal' = ANY (responsabilidades)))::int AS penal FROM _pp_ctl GROUP BY 1;
  CREATE UNIQUE INDEX ON _pp_ctl_agg (doc);
  ANALYZE _pp_ctl_agg;

  -- 6e · Las tablas que lee la API, sin documentos: su DJI, lo que obtuvo cada familiar y sus informes.
  DELETE FROM politico_dji;
  INSERT INTO politico_dji (codigo, entidad_ruc, entidad, org_clave, cargo_electo, proceso, desde, hasta, cargo_dji, presentada, declaraciones, leida, familiares)
  SELECT DISTINCT ON (k.codigo, j.ruc) k.codigo, j.ruc, en.nombre, j.org_clave, j.cargo_electo,
         j.proceso, j.desde, j.hasta, j.cargo_dji, j.presentada, COALESCE(j.declaraciones, 0), j.leida, j.familiares
    FROM _pp_dji j JOIN politico_codigo k ON k.llave = j.llave
    LEFT JOIN entidades en ON en.ruc::text = j.ruc
   ORDER BY k.codigo, j.ruc, j.desde DESC;

  DELETE FROM politico_familiar;
  -- Órdenes en la entidad que él gobierna: las del indicio de nepotismo.
  INSERT INTO politico_familiar (codigo, pariente, parentesco, grado, tipo, entidad_ruc, entidad, ordenes, monto, desde, hasta, su_entidad, nepotismo, partidos)
  SELECT k.codigo, r.pariente, r.parentesco, r.grado, 'orden', f.su_ruc, en.nombre, n.ordenes, n.monto, n.desde, n.hasta,
         n.hasta >= extract(year FROM f.desde), true,
         COALESCE((SELECT o.partidos FROM _pp_fo o WHERE o.doc = f.doc AND o.entidad_ruc = f.su_ruc LIMIT 1), '{}')
    FROM _pp_fd f
    JOIN _pp_fr r ON r.llave = f.llave AND r.doc = f.doc
    JOIN _pp_nep n ON n.ruc = f.su_ruc AND n.nom_n = f.nom_n AND n.doc = f.doc
    JOIN politico_codigo k ON k.llave = f.llave
    LEFT JOIN entidades en ON en.ruc::text = f.su_ruc;
  -- Órdenes en las demás entidades.
  INSERT INTO politico_familiar (codigo, pariente, parentesco, grado, tipo, entidad_ruc, entidad, ordenes, monto, desde, hasta, su_entidad, partidos)
  SELECT k.codigo, r.pariente, r.parentesco, r.grado, 'orden', o.entidad_ruc, o.entidad, o.ordenes, o.monto, o.desde, o.hasta, false, o.partidos
    FROM _pp_fr r
    JOIN _pp_fo o ON o.doc = r.doc
    JOIN politico_codigo k ON k.llave = r.llave
   WHERE NOT EXISTS (SELECT 1 FROM _pp_fd f WHERE f.llave = r.llave AND f.doc = r.doc AND f.su_ruc = o.entidad_ruc);
  -- Sus empresas que ganaron buenas pro, con lo que le ganaron a la entidad que él gobierna durante su gestión.
  INSERT INTO politico_familiar (codigo, pariente, parentesco, grado, tipo, empresa_ruc, empresa, rol, procesos, monto, su_entidad,
                                 su_entidad_procesos, su_entidad_monto, partidos)
  SELECT k.codigo, r.pariente, r.parentesco, r.grado, 'empresa', e.ruc, e.nombre, e.rol, e.procesos, e.monto,
         COALESCE(g.procesos, 0) > 0, g.procesos, g.monto, COALESCE(pt.partidos, '{}')
    FROM _pp_fr r
    JOIN _pp_fe e ON e.doc = r.doc
    JOIN politico_codigo k ON k.llave = r.llave
    LEFT JOIN (SELECT llave, doc, ruc, sum(procesos)::int AS procesos, sum(monto) AS monto FROM _pp_feg GROUP BY 1, 2, 3) g
      ON g.llave = r.llave AND g.doc = r.doc AND g.ruc = e.ruc
    LEFT JOIN _pp_fe_part pt ON pt.ruc = e.ruc;

  DELETE FROM politico_informe;
  INSERT INTO politico_informe (codigo, informe, numero, titulo, entidad, entidad_ruc, fecha, responsabilidades)
  SELECT DISTINCT ON (k.codigo, c.informe) k.codigo, c.informe, ic.numero, ic.titulo, ic.entidad_nombre, ic.entidad_ruc::text, ic.fecha_emision, c.responsabilidades
    FROM _pp_ctl c
    JOIN (SELECT DISTINCT llave, doc FROM _pp_p WHERE doc ~ '^\d{8}$') p ON p.doc = c.doc
    JOIN politico_codigo k ON k.llave = p.llave
    LEFT JOIN informes_control ic ON ic.codigo = c.informe
   ORDER BY k.codigo, c.informe;

  -- 7 · La tabla, de nuevo.
  DELETE FROM partido_politico;
  INSERT INTO partido_politico (org_clave, codigo, doc, tipo, nombre, publico, gano, candidato, aportante, n_candidaturas, anios, cargo, lugar,
                                candidaturas, aportes_n, aportes_monto, aporte_desde, aporte_hasta, desde, persona_codigo,
                                emp_n, emp_monto, emp_inhab, emp_gob_n, emp_gob_monto, ord_entidades, ord_monto, ord_gob_entidades, ord_gob_monto,
                                familia_n, sanciones_n, dji_estado, fam_n, fam_ordenes_n, fam_ordenes_monto, fam_empresas_n, fam_su_entidad_n,
                                fam_su_entidad_monto, fam_partido_n, fam_partido_monto, control_n, control_penal,
                                senales, n_senales, sev, busca, nombre_orden)
  SELECT y.org_clave, y.codigo, y.doc, y.tipo, y.nombre, y.publico, y.gano, y.candidato, y.aportante, y.n_candidaturas, y.anios, y.cargo, y.lugar,
         y.candidaturas, y.aportes_n, y.aportes_monto, y.aporte_desde, y.aporte_hasta, y.desde, y.persona_codigo,
         y.emp_n, y.emp_monto, y.emp_inhab, y.emp_gob_n, y.emp_gob_monto, y.ord_entidades, y.ord_monto, y.ord_gob_entidades, y.ord_gob_monto,
         y.familia_n, y.sanciones_n, y.dji_estado, y.fam_n, y.fam_ordenes_n, y.fam_ordenes_monto, y.fam_empresas_n, y.fam_su_entidad_n,
         y.fam_su_entidad_monto, y.fam_partido_n, y.fam_partido_monto, y.control_n, y.control_penal,
         y.senales, cardinality(y.senales),
         CASE WHEN y.senales && ARRAY['empresas_gobierno', 'ordenes_gobierno', 'inhabilitado', 'familia_su_entidad', 'control_penal'] THEN 3
              WHEN y.senales && ARRAY['sancion', 'empresa_inhabilitada', 'empresas_estado', 'familia_partido', 'control'] THEN 2
              WHEN cardinality(y.senales) > 0 THEN 1 ELSE 0 END,
         -- Lo que se ve y nada más: de quien va tapado, su primer apellido (con tres palabras o más: con dos, la primera es la tapada).
         btrim(mef_norm(CASE WHEN y.publico THEN y.nom_n WHEN y.palabras >= 3 THEN COALESCE(y.paterno, '') ELSE '' END
                        || ' ' || COALESCE(y.cargo, '') || ' ' || COALESCE(y.lugar, ''))),
         CASE WHEN y.publico THEN y.nom_n WHEN y.palabras >= 3 THEN COALESCE(y.paterno, '') ELSE '' END
    FROM (
      SELECT p.org_clave, k.codigo, p.doc, CASE WHEN p.doc ~ '^20\d{9}$' THEN 'empresa' ELSE 'persona' END AS tipo, p.nombre, p.nom_n,
             cardinality(string_to_array(p.nom_n, ' ')) AS palabras,
             -- El primer apellido con sus partículas («DE LA CRUZ», «DEL AGUILA»): lo que la API deja a la vista de quien va
             -- tapado (apellidosSunat de lib/privacidad.ts). Nunca incluye el segundo apellido.
             substring(p.nom_n FROM '^((?:(?:DE|DEL|LA|LAS|LOS|SAN|SANTA|SANTO|DA|DAS|DO|DOS|DI|VAN|VON|MC|MAC|VDA|VIUDA|D) )*[^ ]+) ') AS paterno,
             -- Sin documento, `p.doc ~ …` es NULL y dejaba NULL toda la expresión: sin dato, el nombre va tapado.
             (COALESCE(p.doc ~ '^20\d{9}$', false) OR COALESCE(ca.gano, false) OR el.doc IS NOT NULL) AS publico,
             COALESCE(ca.gano, false) AS gano, p.candidato, p.aportante, COALESCE(ca.n, 0) AS n_candidaturas, COALESCE(ca.anios, '{}') AS anios,
             ca.cargo, ca.lugar, COALESCE(ca.candidaturas, '[]'::jsonb) AS candidaturas, p.aportes_n, p.aportes_monto, p.aporte_desde, p.aporte_hasta,
             p.desde, l.codigo AS persona_codigo,
             COALESCE(et.n, 0) AS emp_n, COALESCE(et.monto, 0) AS emp_monto, COALESCE(et.inhab, 0) AS emp_inhab,
             COALESCE(eg.n, 0) AS emp_gob_n, COALESCE(eg.monto, 0) AS emp_gob_monto,
             COALESCE(l.entidades, 0) AS ord_entidades, COALESCE(l.monto, 0) AS ord_monto,
             COALESCE(lg.entidades, 0) AS ord_gob_entidades, COALESCE(lg.monto, 0) AS ord_gob_monto,
             COALESCE(f.n, 0) AS familia_n, COALESCE(s.n, 0) AS sanciones_n,
             dj.estado AS dji_estado, COALESCE(dj.fam_n, 0) AS fam_n,
             COALESCE(fa.ordenes_n, 0) AS fam_ordenes_n, COALESCE(fa.ordenes_monto, 0) AS fam_ordenes_monto, COALESCE(fa.empresas_n, 0) AS fam_empresas_n,
             COALESCE(fa.su_n, 0) AS fam_su_entidad_n, COALESCE(fa.su_monto, 0) AS fam_su_entidad_monto,
             COALESCE(fp.n, 0) AS fam_partido_n, COALESCE(fp.monto, 0) AS fam_partido_monto,
             COALESCE(ct.n, 0) AS control_n, COALESCE(ct.penal, 0) AS control_penal,
             array_remove(ARRAY[
               CASE WHEN eg.n > 0 THEN 'empresas_gobierno' END,
               CASE WHEN lg.entidades > 0 THEN 'ordenes_gobierno' END,
               CASE WHEN fa.su_n > 0 THEN 'familia_su_entidad' END,
               CASE WHEN ct.penal > 0 THEN 'control_penal' END,
               CASE WHEN s.inhab > 0 THEN 'inhabilitado' WHEN s.n > 0 THEN 'sancion' END,
               CASE WHEN et.inhab > 0 THEN 'empresa_inhabilitada' END,
               CASE WHEN et.monto > 0 THEN 'empresas_estado' END,
               CASE WHEN fp.n > 0 THEN 'familia_partido' END,
               CASE WHEN ct.n > 0 AND COALESCE(ct.penal, 0) = 0 THEN 'control' END,
               CASE WHEN l.monto > 0 THEN 'ordenes' END,
               CASE WHEN fa.ordenes_n > 0 OR fa.empresas_n > 0 THEN 'familia_estado' END,
               CASE WHEN f.n > 0 THEN 'familia' END], NULL) AS senales
        FROM _pp_p p
        JOIN politico_codigo k ON k.llave = p.llave
        LEFT JOIN _pp_ca ca ON ca.org_clave = p.org_clave AND ca.llave = p.llave
        LEFT JOIN _pp_electo el ON el.doc = p.doc
        LEFT JOIN _pp_emp_tot et ON et.doc = p.doc
        LEFT JOIN _pp_emp_gob eg ON eg.org_clave = p.org_clave AND eg.llave = p.llave
        LEFT JOIN _pp_loc l ON l.doc = p.doc
        LEFT JOIN _pp_loc_gob lg ON lg.org_clave = p.org_clave AND lg.llave = p.llave
        LEFT JOIN _pp_fam f ON f.doc = p.doc
        LEFT JOIN _pp_san s ON s.doc = p.doc
        LEFT JOIN _pp_dje dj ON dj.llave = p.llave
        LEFT JOIN _pp_fagg fa ON fa.llave = p.llave
        LEFT JOIN _pp_fpart fp ON fp.org_clave = p.org_clave AND fp.llave = p.llave
        LEFT JOIN _pp_ctl_agg ct ON ct.doc = p.doc) y;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  ANALYZE partido_politico;
  ANALYZE politico_dji;
  ANALYZE politico_familiar;
  ANALYZE politico_informe;
  RETURN v_filas;
END $$;

ALTER FUNCTION refrescar_partido_politicos() OWNER TO vigia_jobs;
ALTER TABLE politico_dji OWNER TO vigia_jobs;
ALTER TABLE politico_familiar OWNER TO vigia_jobs;
ALTER TABLE politico_informe OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_partido_politicos() FROM PUBLIC;

-- Permisos. Los privilegios por omisión dan lectura a vigia_api y vigia_ab y escritura a vigia_agentes en toda tabla
-- nueva: así partido_politico y politico_codigo (con DNI) quedaron legibles para los agentes. Se le quita todo a todos los
-- que no son su dueño (como en la 302) y se da sólo lo que hace falta: la API (pública y del panel) y la auditoría.
REVOKE ALL ON partido_politico, politico_codigo, politico_dji, politico_familiar, politico_informe FROM PUBLIC;
DO $$
DECLARE v text;
BEGIN
  FOR v IN SELECT DISTINCT pg_get_userbyid(a.grantee)
             FROM pg_class c, aclexplode(c.relacl) a
            WHERE c.oid IN ('public.partido_politico'::regclass, 'public.politico_codigo'::regclass, 'public.politico_dji'::regclass,
                            'public.politico_familiar'::regclass, 'public.politico_informe'::regclass)
              AND a.grantee <> 0 AND a.grantee <> c.relowner AND pg_get_userbyid(a.grantee) <> 'postgres' LOOP
    EXECUTE format('REVOKE ALL ON public.partido_politico, public.politico_codigo, public.politico_dji, public.politico_familiar, public.politico_informe FROM %I', v);
  END LOOP;
  FOREACH v IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'dev_api', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v) THEN
      EXECUTE format('GRANT SELECT ON public.partido_politico, public.politico_dji, public.politico_familiar, public.politico_informe TO %I', v);
    END IF;
  END LOOP;
  -- Las lecturas de las tablas con documentos se auditan como las demás (migración 213).
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rds_pgaudit') THEN
    GRANT SELECT ON public.partido_politico, public.politico_codigo TO rds_pgaudit;
  END IF;
END $$;

-- La primera carga: la de la 299 tardó 142 s en PROD; esto suma unos 2 minutos. Si pasa de 15, se corta.
SET statement_timeout = '900s';
SELECT refrescar_partido_politicos() AS politicos;
RESET statement_timeout;
