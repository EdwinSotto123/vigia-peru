-- 203 · Las empresas de quienes visitan una entidad, también por su socio, representante o directivo, y lo que la
-- entidad les dio después.
--
-- El usuario preguntó en la pestaña Visitas: «¿haces el cálculo de "ganó una empresa de un socio después"? No sólo a
-- nombre de la empresa sino socio, etc.». «Quiénes la visitan» agrupa por la organización que declaró quien visita: la
-- empresa se ve sólo si alguien dijo venir de ella. Pero su gente suele ir a título personal o por otra organización: en
-- PROD (28-oct) eran 527,955 pares entidad × empresa y la mayoría sólo se ve por el documento de su gente en el RNP. La
-- bandera «visita previa» del contrato ya miraba a esa gente (180 días antes de la buena pro); no las órdenes, ni la
-- entidad entera, ni si antes de esas visitas la empresa nunca le había vendido.
--
-- entidad_visita_empresa: por entidad y empresa (RUC 20), sus visitas (por quién se la reconoce: socio, representante
-- legal, directivo o alguien que dijo venir de ella), cuántas personas, cuántas a quien decide las compras, cuántas
-- declararon a la empresa (si ninguna, el vínculo sólo se ve por su gente), qué otra organización declararon, cuántas
-- visitas son de alguien que figura en varias empresas (no se sabe por cuál fue), desde cuándo; y lo que la entidad le
-- dio desde la primera visita: lo primero (contrato, contrato en consorcio u orden) y a cuántos días de una visita, cuántos
-- contratos, consorcios y órdenes, cuánto suman (sin los montos que parecen mal cargados ni lo del consorcio entero) y
-- cuántos tuvo ANTES de la primera visita (cero: la primera vez que le vende).
--
-- Personas: aquí no va ningún nombre ni documento; la ficha de la empresa muestra sus visitas con sus reglas.
--
-- Cómo aplicarla: después de la 188, la 197 y la 201. Luego SELECT refrescar_visita_empresa() (~4 min en PROD). La corren
-- el Worker de scrapers tras refrescar_empresas (las órdenes y los contratos cambian cada día) y las cargas de visitas.

CREATE TABLE IF NOT EXISTS entidad_visita_empresa (
  entidad_ruc   TEXT NOT NULL,
  ruc           TEXT NOT NULL,     -- la empresa (RUC 20)
  visitas       INT NOT NULL,
  visitantes    INT NOT NULL,      -- personas distintas (por documento)
  decisores     INT NOT NULL,      -- visitas a quien decide las compras (visita_decisor, migración 188)
  socio         INT NOT NULL,      -- visitas, según cómo se reconoce a quien visita (empresa_visita.via)
  representante INT NOT NULL,
  directivo     INT NOT NULL,
  nombre        INT NOT NULL,      -- dijo venir de la empresa sin figurar en ella en el RNP
  declaradas    INT NOT NULL,      -- visitas que declararon a la empresa como su organización
  personal      INT NOT NULL,      -- visitas a título personal
  compartidas   INT NOT NULL,      -- visitas de alguien que figura en más de una empresa
  otra_org      TEXT,              -- la otra organización que más declararon (si no declararon a la empresa)
  primera       DATE NOT NULL,
  ultima        DATE NOT NULL,
  antes         INT NOT NULL,      -- contratos y órdenes de la entidad a la empresa antes de la primera visita
  despues       DATE,              -- lo primero que le dio desde la primera visita
  despues_tipo  TEXT,              -- contrato | consorcio | orden
  dias          INT,               -- días entre la última visita hasta ese día y ese día
  contratos     INT NOT NULL,      -- procesos que ganó sola desde la primera visita
  consorcios    INT NOT NULL,      -- procesos que ganó en consorcio desde la primera visita
  ordenes       INT NOT NULL,      -- órdenes desde la primera visita
  monto         NUMERIC NOT NULL,  -- lo que suman (contratos sola y órdenes), sin montos dudosos
  PRIMARY KEY (entidad_ruc, ruc)
);
CREATE INDEX IF NOT EXISTS entidad_visita_empresa_monto ON entidad_visita_empresa (entidad_ruc, monto DESC) WHERE despues IS NOT NULL;
CREATE INDEX IF NOT EXISTS entidad_visita_empresa_ruc ON entidad_visita_empresa (ruc);
ALTER TABLE entidad_visita_empresa OWNER TO vigia_jobs;
GRANT SELECT ON entidad_visita_empresa TO vigia_api, vigia_api_admin;

CREATE OR REPLACE FUNCTION refrescar_visita_empresa() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n INT;
  t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_visita_empresa'));
  SET LOCAL work_mem = '256MB';

  -- Las visitas que se atribuyen a más de una empresa: quien visita es socio o representante de varias.
  CREATE TEMP TABLE _vem ON COMMIT DROP AS
    SELECT visita_id FROM empresa_visita WHERE ruc ~ '^20\d{9}$' GROUP BY 1 HAVING count(*) > 1;
  CREATE INDEX ON _vem (visita_id);
  ANALYZE _vem;
  -- El nombre de cada empresa como se escribe a mano (razon_norm, migración 109, sin lo que va entre paréntesis: «(SIL SA)»
  -- dejaba la forma societaria en medio), para ver si la visita la declaró.
  CREATE TEMP TABLE _ven ON COMMIT DROP AS
    SELECT ruc, razon_norm(regexp_replace(nombre, '\([^)]*\)', ' ', 'g')) AS k
      FROM empresa_resumen WHERE ruc ~ '^20\d{9}$' AND nombre IS NOT NULL;
  CREATE INDEX ON _ven (ruc);
  ANALYZE _ven;

  -- 1. Cada visita de la gente de una empresa (empresa_visita: socio, representante o directivo por su DNI en el RNP, o
  -- quien dijo venir de ella) a una entidad que se reconoce por todos sus nombres (visita_entidad_ruc, 186 y 197).
  -- Declaró a la empresa si escribió su RUC, su nombre (sin la forma societaria ni lo que va entre paréntesis), un nombre
  -- que lo contiene («CONSTRUCTORA ABC Y ASOCIADOS») o el comienzo de su nombre («SERVICIOS INTEGRADOS DE LIMPIE…»), como
  -- organización privada o pública (hay empresas anotadas como entidad pública). Una sigla («PROTSSA») no se reconoce.
  CREATE TEMP TABLE _vx ON COMMIT DROP AS
    SELECT y.entidad_ruc, y.ruc, y.via, y.fecha, y.doc, y.decisor, y.tipo, y.org, y.compartida,
           COALESCE(y.via = 'nombre' OR (y.orgk IS NOT NULL AND (
               position(y.ruc IN y.org) > 0
               OR (length(y.k) >= 6 AND (y.orgk = y.k OR position(y.k IN y.orgk) > 0
                                         OR (length(y.orgk) >= 8 AND position(y.orgk IN y.k) = 1))))), false) AS declarada
      FROM (SELECT m.ruc AS entidad_ruc, ev.ruc, ev.via, v.fecha_visita AS fecha, v.numero_documento AS doc,
                   COALESCE(v.decisor, visita_decisor(v.funcionario_cargo, v.funcionario_area)) AS decisor,
                   v.tipo_entidad_visitante AS tipo,
                   NULLIF(upper(btrim(v.entidad_visitante)), '') AS org,
                   CASE WHEN v.tipo_entidad_visitante IN ('privada', 'publica') AND btrim(COALESCE(v.entidad_visitante, '')) <> ''
                        THEN razon_norm(regexp_replace(v.entidad_visitante, '\([^)]*\)', ' ', 'g')) END AS orgk,
                   n.k, (s.visita_id IS NOT NULL) AS compartida
              FROM empresa_visita ev
              JOIN visitas_entidades v ON v.id = ev.visita_id
              JOIN visita_entidad_ruc m ON m.entidad_visitada = v.entidad_visitada
              LEFT JOIN _ven n ON n.ruc = ev.ruc
              LEFT JOIN _vem s ON s.visita_id = ev.visita_id
             WHERE ev.ruc ~ '^20\d{9}$' AND v.fecha_visita IS NOT NULL) y;
  ANALYZE _vx;
  RAISE NOTICE 'visita_empresa: visitas (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  CREATE TEMP TABLE _vp ON COMMIT DROP AS
    SELECT entidad_ruc, ruc, count(*) AS visitas, count(DISTINCT doc) AS visitantes,
           count(*) FILTER (WHERE decisor) AS decisores,
           count(*) FILTER (WHERE via = 'socio') AS socio, count(*) FILTER (WHERE via = 'representante') AS representante,
           count(*) FILTER (WHERE via = 'directivo') AS directivo, count(*) FILTER (WHERE via = 'nombre') AS nombre,
           count(*) FILTER (WHERE declarada) AS declaradas, count(*) FILTER (WHERE tipo = 'persona_natural') AS personal,
           count(*) FILTER (WHERE compartida) AS compartidas,
           mode() WITHIN GROUP (ORDER BY org) FILTER (WHERE NOT declarada AND tipo IN ('privada', 'publica') AND org IS NOT NULL) AS otra_org,
           min(fecha) AS primera, max(fecha) AS ultima
      FROM _vx GROUP BY 1, 2;
  CREATE INDEX ON _vp (entidad_ruc, ruc);
  ANALYZE _vp;
  RAISE NOTICE 'visita_empresa: % pares (% s)', (SELECT count(*) FROM _vp), round(extract(epoch FROM clock_timestamp() - t0));

  -- 2. Sus órdenes en esa entidad, antes y desde la primera visita (el índice de la 201: entidad, contratista y fecha).
  CREATE TEMP TABLE _vo ON COMMIT DROP AS
    SELECT p.entidad_ruc, p.ruc,
           count(*) FILTER (WHERE x.fecha_emision < p.primera) AS antes,
           count(*) FILTER (WHERE x.fecha_emision >= p.primera) AS despues,
           min(x.fecha_emision) FILTER (WHERE x.fecha_emision >= p.primera) AS f,
           sum(x.monto) FILTER (WHERE x.fecha_emision >= p.primera AND x.monto_dudoso IS NULL) AS monto
      FROM _vp p
      JOIN conosce_ordenes x ON x.entidad_ruc = p.entidad_ruc AND x.ruc_contratista = p.ruc
     WHERE x.fecha_emision IS NOT NULL AND x.estado IS DISTINCT FROM 'Anulada'
     GROUP BY 1, 2;
  CREATE INDEX ON _vo (entidad_ruc, ruc);
  RAISE NOTICE 'visita_empresa: órdenes (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- 3. Sus contratos: cada ítem adjudicado a la empresa sola o a un consorcio del que es parte (como en la 112).
  CREATE TEMP TABLE _vcm ON COMMIT DROP AS
    SELECT DISTINCT ruc_consorcio, ruc_miembro FROM conosce_consorcios WHERE ruc_miembro ~ '^20\d{9}$';
  CREATE INDEX ON _vcm (ruc_consorcio);
  ANALYZE _vcm;
  CREATE TEMP TABLE _vai ON COMMIT DROP AS
    SELECT p.entidad_ruc, p.ruc, p.primera, a.codigo_convocatoria, a.fecha_buenapro AS f, a.monto_adjudicado AS monto,
           a.moneda IN ('Soles', 'Nuevos Soles') AS soles, (m.ruc_miembro IS NOT NULL) AS en_consorcio
      FROM conosce_adjudicaciones a
      LEFT JOIN _vcm m ON m.ruc_consorcio = a.ruc_proveedor AND a.ruc_proveedor !~ '^(10|20)\d{9}$'
      JOIN _vp p ON p.ruc = COALESCE(m.ruc_miembro, a.ruc_proveedor) AND p.entidad_ruc = a.entidad_ruc::text
     WHERE a.fecha_buenapro IS NOT NULL;
  -- Los procesos con un monto que parece mal cargado (la regla de la 102 y la 112): no suman.
  CREATE TEMP TABLE _vad ON COMMIT DROP AS
    SELECT codigo_convocatoria, entidad_ruc
      FROM (SELECT codigo_convocatoria, entidad_ruc, sum(ref) AS ref, max(adj) AS adj
              FROM (SELECT a.codigo_convocatoria, a.entidad_ruc::text AS entidad_ruc, a.n_item,
                           max(a.monto_referencial) AS ref, max(a.monto_adjudicado) AS adj
                      FROM conosce_adjudicaciones a
                     WHERE a.moneda IN ('Soles', 'Nuevos Soles')
                       AND a.codigo_convocatoria IN (SELECT DISTINCT codigo_convocatoria FROM _vai)
                     GROUP BY 1, 2, 3) i
             GROUP BY 1, 2) x
     WHERE ref > 0 AND ((ref <= 1 AND adj > 100000) OR (ref > 1 AND adj >= 20 * ref AND adj > 1000000));
  CREATE TEMP TABLE _va ON COMMIT DROP AS
    SELECT i.entidad_ruc, i.ruc,
           count(DISTINCT i.codigo_convocatoria) FILTER (WHERE i.f < i.primera) AS antes,
           count(DISTINCT i.codigo_convocatoria) FILTER (WHERE i.f >= i.primera AND NOT i.en_consorcio) AS contratos,
           count(DISTINCT i.codigo_convocatoria) FILTER (WHERE i.f >= i.primera AND i.en_consorcio) AS consorcios,
           min(i.f) FILTER (WHERE i.f >= i.primera) AS f,
           sum(i.monto) FILTER (WHERE i.f >= i.primera AND NOT i.en_consorcio AND i.soles AND d.codigo_convocatoria IS NULL) AS monto
      FROM _vai i
      LEFT JOIN _vad d ON d.codigo_convocatoria = i.codigo_convocatoria AND d.entidad_ruc = i.entidad_ruc
     GROUP BY 1, 2;
  CREATE INDEX ON _va (entidad_ruc, ruc);
  -- Si lo primero fue en consorcio (si el mismo día ganó también sola, cuenta como suyo).
  CREATE TEMP TABLE _vac ON COMMIT DROP AS
    SELECT i.entidad_ruc, i.ruc, bool_and(i.en_consorcio) AS primero_consorcio
      FROM _vai i JOIN _va a ON a.entidad_ruc = i.entidad_ruc AND a.ruc = i.ruc AND i.f = a.f
     GROUP BY 1, 2;
  CREATE INDEX ON _vac (entidad_ruc, ruc);
  RAISE NOTICE 'visita_empresa: contratos (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- 4. Lo primero que le dio desde la primera visita, y a cuántos días de la última visita hasta ese día.
  CREATE TEMP TABLE _vr ON COMMIT DROP AS
    SELECT p.*, COALESCE(o.antes, 0) + COALESCE(a.antes, 0) AS antes,
           LEAST(o.f, a.f) AS despues,
           CASE WHEN a.f IS NOT NULL AND (o.f IS NULL OR a.f <= o.f) THEN CASE WHEN ac.primero_consorcio THEN 'consorcio' ELSE 'contrato' END
                WHEN o.f IS NOT NULL THEN 'orden' END AS despues_tipo,
           COALESCE(a.contratos, 0) AS contratos, COALESCE(a.consorcios, 0) AS consorcios, COALESCE(o.despues, 0) AS ordenes,
           COALESCE(a.monto, 0) + COALESCE(o.monto, 0) AS monto
      FROM _vp p
      LEFT JOIN _vo o ON o.entidad_ruc = p.entidad_ruc AND o.ruc = p.ruc
      LEFT JOIN _va a ON a.entidad_ruc = p.entidad_ruc AND a.ruc = p.ruc
      LEFT JOIN _vac ac ON ac.entidad_ruc = p.entidad_ruc AND ac.ruc = p.ruc;
  CREATE INDEX ON _vr (entidad_ruc, ruc);
  CREATE TEMP TABLE _vd ON COMMIT DROP AS
    SELECT x.entidad_ruc, x.ruc, r.despues - max(x.fecha) AS dias
      FROM _vx x JOIN _vr r ON r.entidad_ruc = x.entidad_ruc AND r.ruc = x.ruc
     WHERE r.despues IS NOT NULL AND x.fecha <= r.despues
     GROUP BY x.entidad_ruc, x.ruc, r.despues;
  CREATE INDEX ON _vd (entidad_ruc, ruc);

  DELETE FROM entidad_visita_empresa;
  INSERT INTO entidad_visita_empresa (entidad_ruc, ruc, visitas, visitantes, decisores, socio, representante, directivo, nombre,
                                      declaradas, personal, compartidas, otra_org, primera, ultima, antes, despues, despues_tipo,
                                      dias, contratos, consorcios, ordenes, monto)
  SELECT r.entidad_ruc, r.ruc, r.visitas, r.visitantes, r.decisores, r.socio, r.representante, r.directivo, r.nombre,
         r.declaradas, r.personal, r.compartidas, r.otra_org, r.primera, r.ultima, r.antes, r.despues, r.despues_tipo,
         d.dias, r.contratos, r.consorcios, r.ordenes, r.monto
    FROM _vr r LEFT JOIN _vd d ON d.entidad_ruc = r.entidad_ruc AND d.ruc = r.ruc;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE entidad_visita_empresa;
  RAISE NOTICE 'visita_empresa: % pares, % con algo después (% s)', n,
    (SELECT count(*) FROM entidad_visita_empresa WHERE despues IS NOT NULL), round(extract(epoch FROM clock_timestamp() - t0));
  RETURN n;
END $$;
ALTER FUNCTION refrescar_visita_empresa() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_visita_empresa() FROM PUBLIC;
GRANT SELECT ON empresa_visita, visitas_entidades, visita_entidad_ruc, empresa_resumen, conosce_ordenes, conosce_adjudicaciones,
  conosce_consorcios TO vigia_jobs;
