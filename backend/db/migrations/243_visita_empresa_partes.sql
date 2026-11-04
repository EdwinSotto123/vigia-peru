-- 243 · refrescar_visita_empresa por partes
--
-- Lo que la entidad le dio a cada empresa después de que su gente la visitó (migración 203) cruza las 2,96 M visitas
-- atribuidas con las órdenes y contratos de cada empresa: con las visitas nacionales tardó 553 s en producción
-- (2026-11-03) y va en el refresco diario de oece_ocds, donde la conexión del Worker corta a los 5-10 min.
-- refrescar_visita_empresa_parte(p, n) hace lo mismo sólo para las empresas de la parte p de n (por un hash de su RUC:
-- una empresa cae siempre en la misma parte, y con ella todos sus pares entidad-empresa). Las visitas que se atribuyen
-- a más de una empresa (_vem) se cuentan sobre todas. refrescar_visita_empresa() corre las partes en una transacción,
-- para las cargas desde la PC; el Worker corre una parte por paso (fuentes/comun.ts).

CREATE OR REPLACE FUNCTION public.refrescar_visita_empresa_parte(p_parte integer, p_partes integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  n INT;
  t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_visita_empresa'));
  SET LOCAL work_mem = '256MB';
  -- Varias partes en una misma transacción (refrescar_visita_empresa): las temporales de la anterior siguen ahí.
  DROP TABLE IF EXISTS pg_temp._vem, pg_temp._ven, pg_temp._vx, pg_temp._vp, pg_temp._vo, pg_temp._vcm,
    pg_temp._vai, pg_temp._vad, pg_temp._va, pg_temp._vac, pg_temp._vr, pg_temp._vd, pg_temp._vf;

  -- Las visitas que se atribuyen a más de una empresa: quien visita es socio o representante de varias.
  CREATE TEMP TABLE _vem ON COMMIT DROP AS
    SELECT visita_id FROM empresa_visita WHERE ruc ~ '^20\d{9}$' GROUP BY 1 HAVING count(*) > 1;
  CREATE INDEX ON _vem (visita_id);
  ANALYZE _vem;
  -- El nombre de cada empresa como se escribe a mano (razon_norm, migración 109, sin lo que va entre paréntesis: «(SIL SA)»
  -- dejaba la forma societaria en medio), para ver si la visita la declaró.
  CREATE TEMP TABLE _ven ON COMMIT DROP AS
    SELECT ruc, razon_norm(regexp_replace(nombre, '\([^)]*\)', ' ', 'g')) AS k
      FROM empresa_resumen WHERE ruc ~ '^20\d{9}$' AND nombre IS NOT NULL AND (hashtext(ruc) & 2147483647) % p_partes = p_parte;
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
             WHERE ev.ruc ~ '^20\d{9}$' AND v.fecha_visita IS NOT NULL AND (hashtext(ev.ruc) & 2147483647) % p_partes = p_parte) y;
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
           a.moneda IN ('Soles', 'Nuevos Soles') AS soles, (m.ruc_miembro IS NOT NULL) AS en_consorcio,
           a.nomenclatura, COALESCE(NULLIF(btrim(a.descripcion_proceso), ''), NULLIF(btrim(a.descripcion_item), ''), a.objeto) AS detalle
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

  -- 5. Cuál fue (para citarlo, migración 204): la orden de ese día (la de mayor monto si hubo varias) o el proceso, con su
  -- número, qué se compró y cuánto; el contrato se enlaza a su ficha por su OCID si está en la base.
  CREATE TEMP TABLE _vf ON COMMIT DROP AS
    SELECT r.entidad_ruc, r.ruc, o.numero, o.detalle, o.monto, NULL::text AS codigo, o.tipo_orden
      FROM _vr r
      CROSS JOIN LATERAL (
        SELECT x.nro_orden AS numero, left(btrim(x.descripcion), 300) AS detalle, x.monto, x.tipo_orden
          FROM conosce_ordenes x
         WHERE x.entidad_ruc = r.entidad_ruc AND x.ruc_contratista = r.ruc AND x.fecha_emision = r.despues
           AND x.estado IS DISTINCT FROM 'Anulada'
         ORDER BY x.monto DESC NULLS LAST, x.orden
         LIMIT 1) o
     WHERE r.despues_tipo = 'orden';
  INSERT INTO _vf (entidad_ruc, ruc, numero, detalle, monto, codigo, tipo_orden)
  SELECT DISTINCT ON (g.entidad_ruc, g.ruc) g.entidad_ruc, g.ruc, g.numero, g.detalle, g.monto, g.codigo_convocatoria, NULL
    FROM (SELECT i.entidad_ruc, i.ruc, i.codigo_convocatoria, min(COALESCE(i.nomenclatura, i.codigo_convocatoria)) AS numero,
                 left(min(btrim(i.detalle)), 300) AS detalle, sum(i.monto) FILTER (WHERE i.soles) AS monto,
                 bool_or(i.en_consorcio) AS en_consorcio
            FROM _vai i JOIN _vr r ON r.entidad_ruc = i.entidad_ruc AND r.ruc = i.ruc AND i.f = r.despues
           WHERE r.despues_tipo IN ('contrato', 'consorcio')
           GROUP BY 1, 2, 3) g
    JOIN _vr r ON r.entidad_ruc = g.entidad_ruc AND r.ruc = g.ruc
   ORDER BY g.entidad_ruc, g.ruc, (g.en_consorcio = (r.despues_tipo = 'consorcio')) DESC, g.monto DESC NULLS LAST, g.codigo_convocatoria;
  CREATE INDEX ON _vf (entidad_ruc, ruc);

  DELETE FROM entidad_visita_empresa WHERE (hashtext(ruc) & 2147483647) % p_partes = p_parte;
  INSERT INTO entidad_visita_empresa (entidad_ruc, ruc, visitas, visitantes, decisores, socio, representante, directivo, nombre,
                                      declaradas, personal, compartidas, otra_org, primera, ultima, antes, despues, despues_tipo,
                                      dias, contratos, consorcios, ordenes, monto,
                                      despues_numero, despues_detalle, despues_monto, despues_codigo, despues_orden, despues_ocid)
  SELECT r.entidad_ruc, r.ruc, r.visitas, r.visitantes, r.decisores, r.socio, r.representante, r.directivo, r.nombre,
         r.declaradas, r.personal, r.compartidas, r.otra_org, r.primera, r.ultima, r.antes, r.despues, r.despues_tipo,
         d.dias, r.contratos, r.consorcios, r.ordenes, r.monto,
         f.numero, f.detalle, f.monto, f.codigo, f.tipo_orden,
         CASE WHEN f.codigo IS NOT NULL THEN
           (SELECT cv.ocid FROM convocatorias cv
             WHERE cv.codigo = f.codigo AND cv.entidad_ruc::text = r.entidad_ruc AND cv.ocid NOT LIKE 'ocds-vigia-%'
             ORDER BY cv.ocid LIMIT 1) END
    FROM _vr r
    LEFT JOIN _vd d ON d.entidad_ruc = r.entidad_ruc AND d.ruc = r.ruc
    LEFT JOIN _vf f ON f.entidad_ruc = r.entidad_ruc AND f.ruc = r.ruc;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF p_parte = p_partes - 1 THEN
    ANALYZE entidad_visita_empresa;
  END IF;
  RAISE NOTICE 'visita_empresa (parte % de %): % pares, % con algo después (% s)', p_parte + 1, p_partes, n,
    (SELECT count(*) FROM entidad_visita_empresa WHERE despues IS NOT NULL), round(extract(epoch FROM clock_timestamp() - t0));
  RETURN n;
END $function$;


-- El tramo de visitas de empresas (242), con la misma limpieza de sus temporales.
CREATE OR REPLACE FUNCTION refrescar_empresa_visitas_tramo(p_desde bigint, p_hasta bigint) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_empresa_visitas'));
  SET LOCAL work_mem = '256MB';
  -- Varios tramos en una misma transacción (refrescar_empresa_visitas): las temporales del anterior siguen ahí.
  DROP TABLE IF EXISTS pg_temp._vt, pg_temp._ev;
  -- Las visitas del tramo primero (un recorrido por la llave), y después los cruces por hash.
  CREATE TEMP TABLE _vt ON COMMIT DROP AS
    SELECT id, numero_documento, entidad_visitada, entidad_visitante, tipo_entidad_visitante
      FROM visitas_entidades WHERE id >= p_desde AND id < p_hasta;
  ANALYZE _vt;
  CREATE TEMP TABLE _ev ON COMMIT DROP AS
    SELECT DISTINCT ON (ruc, visita_id) ruc, visita_id, via, claves
      FROM (SELECT r.ruc, v.id AS visita_id,
                   CASE r.tipo_rol WHEN 'SOCIO_ACCIONISTA_TITULAR' THEN 'socio' WHEN 'REPRESENTANTE_LEGAL' THEN 'representante' ELSE 'directivo' END AS via,
                   CASE r.tipo_rol WHEN 'REPRESENTANTE_LEGAL' THEN 0 WHEN 'SOCIO_ACCIONISTA_TITULAR' THEN 1 ELSE 2 END AS p,
                   entidad_visita_claves(v.entidad_visitada) AS claves
              FROM _vt v JOIN empresa_rnp_doc r ON r.doc = v.numero_documento
             WHERE length(v.numero_documento) = 8
            UNION ALL
            SELECT u.ruc, v.id, 'nombre', 3, entidad_visita_claves(v.entidad_visitada)
              FROM _vt v
              JOIN empresa_nombre_unico u ON u.k = razon_norm(v.entidad_visitante)
             WHERE v.tipo_entidad_visitante = 'privada') x
     ORDER BY ruc, visita_id, p;
  DELETE FROM empresa_visita WHERE visita_id >= p_desde AND visita_id < p_hasta;
  INSERT INTO empresa_visita (ruc, visita_id, via, entidad_ruc)
  SELECT v.ruc, v.visita_id, v.via,
         (SELECT c.entidad_ruc FROM empresa_cliente_nombre c WHERE c.ruc = v.ruc AND c.ent_n = ANY (v.claves) LIMIT 1)
    FROM _ev v;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;



CREATE OR REPLACE FUNCTION refrescar_visita_empresa() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE total int := 0;
BEGIN
  FOR p IN 0..5 LOOP
    total := total + refrescar_visita_empresa_parte(p, 6);
  END LOOP;
  RETURN total;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER FUNCTION refrescar_visita_empresa_parte(integer, integer) OWNER TO vigia_jobs;
    ALTER FUNCTION refrescar_visita_empresa() OWNER TO vigia_jobs;
    ALTER FUNCTION refrescar_empresa_visitas_tramo(bigint, bigint) OWNER TO vigia_jobs;
  END IF;
END $$;
