-- 299 · Los políticos de cada partido y lo que otros registros dicen de ellos (2026-11-16).
--
-- Pedido del dueño: en la ficha de un partido, una sección «Políticos» con sus postulantes que ganaron, los que no
-- ganaron y sus aportantes, y de cada uno: qué empresas tiene que le vendieron al Estado, si recibió órdenes de servicio,
-- si un familiar suyo tiene un puesto, si lo que aportó se relaciona con contratos de sus empresas y si tiene sanciones.
--
-- Quién es del partido (por el nombre de la organización, llevado a la clave de gobierno_periodo):
--   · jne_candidaturas      cada candidatura, con su resultado (electo o no electo);
--   · jne_autoridades       quien ejerce o ejerció el cargo (también un reemplazo);
--   · onpe_candidatos       quien rindió cuentas de campaña a la ONPE y no está en el JNE ese año (sin resultado);
--   · onpe_aporte_unico     quien aportó (la vista de la migración 211: cada aporte una vez). Una empresa también aporta.
--
-- A quién se le cruza: SOLO a quien la fuente trae con su documento (en PROD, 56 938 de 286 613 personas × partido: el
-- JNE no publica el documento de la mayoría de candidatos y de ninguno de 2014). Un candidato sin documento toma el de
-- otra fila del MISMO partido con el mismo nombre completo, si ese nombre tiene un solo documento ahí. Nunca se cruza
-- por nombre con otros registros: un homónimo quedaría con las empresas de otro.
--
-- Los cruces (hechos para revisar, ninguno prueba una falta):
--   empresas_gobierno     alta   una empresa en que es socio, representante o directivo (RNP) ganó procesos de gobiernos de
--                                este partido DESPUÉS de su primer aporte o candidatura con él (partido_proceso);
--   ordenes_gobierno      alta   recibió órdenes de servicio de una entidad mientras la gobernaba este partido;
--   inhabilitado          alta   el Tribunal de Contrataciones lo inhabilitó (a la persona, o a la empresa que aporta);
--   sancion               media  tiene multas del Tribunal, sin inhabilitación;
--   empresa_inhabilitada  media  una empresa suya está inhabilitada;
--   empresas_estado       media  sus empresas le vendieron al Estado (empresa_resumen);
--   ordenes               baja   recibió órdenes de servicio del Estado como persona natural;
--   familia               baja   un funcionario lo declaró como familiar en su declaración jurada de intereses.
-- La Contraloría y la Procuraduría no publican nombres de personas (informes_control trae cuántos funcionarios, no
-- quiénes; la Procuraduría, casos por sede): no hay cruce por persona.
--
-- Privacidad (docs/PRIVACIDAD.md): `doc` no sale nunca de la API; la ficha se pide por `codigo` (al azar, como
-- persona_codigo). `publico`: el nombre va completo (ganó una elección o es una empresa); si no, la API tapa un apellido.
-- `busca` y `nombre_orden` sólo llevan lo que se ve: de quien va tapado, su primera palabra (nunca el apellido tapado),
-- para que ni el buscador ni el orden sirvan para confirmar un nombre (con partículas, el primer apellido entero: «DE LA CRUZ»).
--
-- Medido en PROD en sólo lectura (CTE sin estadísticas, lo peor): 155 s todas las tablas de abajo. La lista de un
-- partido grande (26 622 personas) se lee por su índice.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/299_partido_politicos.sql (o dev.py migrar).

CREATE TABLE IF NOT EXISTS politico_codigo (
  llave  TEXT PRIMARY KEY,   -- el documento, o 'N:' + nombre normalizado + '|' + partido si la fuente no lo trae
  codigo TEXT NOT NULL UNIQUE DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
);
COMMENT ON TABLE politico_codigo IS 'Un código al azar por político, para pedir su detalle sin su documento. Sólo crece (migración 299).';

CREATE TABLE IF NOT EXISTS partido_politico (
  org_clave        TEXT    NOT NULL,
  codigo           TEXT    NOT NULL,
  doc              TEXT,                       -- DNI (8) o RUC 20 de una empresa aportante. NUNCA sale de la API.
  tipo             TEXT    NOT NULL,           -- persona | empresa
  nombre           TEXT    NOT NULL,           -- como en la fuente (apellidos primero)
  publico          BOOLEAN NOT NULL,           -- el nombre va completo: ganó una elección o es una empresa
  gano             BOOLEAN NOT NULL,           -- ganó una elección con ESTE partido
  candidato        BOOLEAN NOT NULL,
  aportante        BOOLEAN NOT NULL,
  n_candidaturas   INT     NOT NULL DEFAULT 0,
  anios            INT[]   NOT NULL DEFAULT '{}',
  cargo            TEXT,                       -- el de su candidatura más reciente
  lugar            TEXT,
  candidaturas     JSONB   NOT NULL DEFAULT '[]',
  aportes_n        INT     NOT NULL DEFAULT 0,
  aportes_monto    NUMERIC NOT NULL DEFAULT 0,
  aporte_desde     DATE,
  aporte_hasta     DATE,
  desde            DATE,                       -- su primer aporte o candidatura con el partido
  persona_codigo   TEXT,                       -- su ficha de persona contratada (/app/personas/<código>)
  emp_n            INT     NOT NULL DEFAULT 0,
  emp_monto        NUMERIC NOT NULL DEFAULT 0,
  emp_inhab        INT     NOT NULL DEFAULT 0,
  emp_gob_n        INT     NOT NULL DEFAULT 0,
  emp_gob_monto    NUMERIC NOT NULL DEFAULT 0,
  ord_entidades    INT     NOT NULL DEFAULT 0,
  ord_monto        NUMERIC NOT NULL DEFAULT 0,
  ord_gob_entidades INT    NOT NULL DEFAULT 0,
  ord_gob_monto    NUMERIC NOT NULL DEFAULT 0,
  familia_n        INT     NOT NULL DEFAULT 0,
  sanciones_n      INT     NOT NULL DEFAULT 0,
  senales          TEXT[]  NOT NULL DEFAULT '{}',
  n_senales        INT     NOT NULL DEFAULT 0,
  sev              SMALLINT NOT NULL DEFAULT 0, -- 3 alta, 2 media, 1 baja, 0 sin cruces
  busca            TEXT    NOT NULL DEFAULT '', -- mef_norm de lo que se ve: nombre (o su primera palabra), cargo y lugar
  nombre_orden     TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (org_clave, codigo)
);
CREATE INDEX IF NOT EXISTS partido_politico_orden ON partido_politico (org_clave, sev DESC, n_senales DESC, emp_gob_monto DESC, codigo);
CREATE INDEX IF NOT EXISTS partido_politico_codigo ON partido_politico (codigo);
COMMENT ON TABLE partido_politico IS 'Candidatos, autoridades y aportantes de cada partido con sus cruces ya contados (migración 299, refrescar_partido_politicos).';

-- El detalle de una persona busca los procesos que ganaron SUS empresas en los gobiernos del partido.
CREATE INDEX IF NOT EXISTS partido_proceso_proveedor ON partido_proceso (ruc_proveedor, org_clave);

CREATE OR REPLACE FUNCTION refrescar_partido_politicos() RETURNS integer
LANGUAGE plpgsql SET work_mem = '128MB' SET statement_timeout = '900s' AS $$
DECLARE v_filas int;
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

  -- 7 · La tabla, de nuevo.
  DELETE FROM partido_politico;
  INSERT INTO partido_politico (org_clave, codigo, doc, tipo, nombre, publico, gano, candidato, aportante, n_candidaturas, anios, cargo, lugar,
                                candidaturas, aportes_n, aportes_monto, aporte_desde, aporte_hasta, desde, persona_codigo,
                                emp_n, emp_monto, emp_inhab, emp_gob_n, emp_gob_monto, ord_entidades, ord_monto, ord_gob_entidades, ord_gob_monto,
                                familia_n, sanciones_n, senales, n_senales, sev, busca, nombre_orden)
  SELECT y.org_clave, y.codigo, y.doc, y.tipo, y.nombre, y.publico, y.gano, y.candidato, y.aportante, y.n_candidaturas, y.anios, y.cargo, y.lugar,
         y.candidaturas, y.aportes_n, y.aportes_monto, y.aporte_desde, y.aporte_hasta, y.desde, y.persona_codigo,
         y.emp_n, y.emp_monto, y.emp_inhab, y.emp_gob_n, y.emp_gob_monto, y.ord_entidades, y.ord_monto, y.ord_gob_entidades, y.ord_gob_monto,
         y.familia_n, y.sanciones_n, y.senales, cardinality(y.senales),
         CASE WHEN y.senales && ARRAY['empresas_gobierno', 'ordenes_gobierno', 'inhabilitado'] THEN 3
              WHEN y.senales && ARRAY['sancion', 'empresa_inhabilitada', 'empresas_estado'] THEN 2
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
             array_remove(ARRAY[
               CASE WHEN eg.n > 0 THEN 'empresas_gobierno' END,
               CASE WHEN lg.entidades > 0 THEN 'ordenes_gobierno' END,
               CASE WHEN s.inhab > 0 THEN 'inhabilitado' WHEN s.n > 0 THEN 'sancion' END,
               CASE WHEN et.inhab > 0 THEN 'empresa_inhabilitada' END,
               CASE WHEN et.monto > 0 THEN 'empresas_estado' END,
               CASE WHEN l.monto > 0 THEN 'ordenes' END,
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
        LEFT JOIN _pp_san s ON s.doc = p.doc) y;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  ANALYZE partido_politico;
  RETURN v_filas;
END $$;

ALTER FUNCTION refrescar_partido_politicos() OWNER TO vigia_jobs;
ALTER TABLE partido_politico OWNER TO vigia_jobs;
ALTER TABLE politico_codigo OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_partido_politicos() FROM PUBLIC;

-- Sólo la API (pública y del panel) lee la tabla: lleva el documento de cada persona, que la API no publica.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'dev_api', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.partido_politico TO %I', r);
    END IF;
  END LOOP;
  -- Sus lecturas se auditan como las de las demás tablas con documentos de personas (migración 213).
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rds_pgaudit') THEN
    GRANT SELECT ON public.partido_politico, public.politico_codigo TO rds_pgaudit;
  END IF;
END $$;

-- La primera carga. En PROD, unos minutos: si pasa de 15, algo anda mal y se corta antes de llenar el disco temporal.
SET statement_timeout = '900s';
SELECT refrescar_partido_politicos() AS politicos;
RESET statement_timeout;
