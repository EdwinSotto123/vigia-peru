-- 349 · Grupos de proveedores (343): el borde del tope de 8 UIT también para las órdenes «Otras contrataciones sin proceso de
-- selección previo».
--
-- En la UNI las órdenes del grupo Valencia estaban registradas así (también directas, sin competencia): de sus 296 órdenes
-- sólo 97 entraban al cálculo del borde y del objeto repartido. En 2024 son 89 901 órdenes de compra con ese tipo. Es la
-- función de la 343 con esa única ampliación.

CREATE OR REPLACE FUNCTION refrescar_grupos_proveedor() RETURNS jsonb
LANGUAGE plpgsql SET work_mem = '256MB' AS $$
DECLARE
  n_grupos int; n_resumen int; vueltas int := 0; cambios int;
BEGIN
  -- Proveedores con órdenes desde 2018 y a qué entidades les vendieron.
  CREATE TEMP TABLE _ne ON COMMIT DROP AS
    SELECT ruc, entidad_ruc, sum(monto) AS monto, sum(ordenes)::int AS ordenes, max(nombre) AS nombre FROM empresa_orden_anual
     WHERE anio >= 2018 AND ruc ~ '^20\d{9}$' GROUP BY 1, 2
    UNION ALL
    SELECT ruc, entidad_ruc, sum(monto), sum(ordenes)::int, max(nombre) FROM persona_orden_anual
     WHERE anio >= 2018 AND ruc ~ '^10\d{9}$' GROUP BY 1, 2;
  CREATE INDEX ON _ne (ruc, entidad_ruc); ANALYZE _ne;
  CREATE TEMP TABLE _n ON COMMIT DROP AS SELECT DISTINCT ruc FROM _ne;
  CREATE UNIQUE INDEX ON _n (ruc); ANALYZE _n;

  -- Personas del RNP de las empresas proveedoras (con DNI), y si son socias.
  CREATE TEMP TABLE _rp ON COMMIT DROP AS
    SELECT r.ruc_empresa::text AS ruc, r.numero_documento AS dni, max(mef_norm(r.nombre)) AS nombre,
           bool_or(r.tipo_rol = 'SOCIO_ACCIONISTA_TITULAR') AS socio,
           split_part(max(mef_norm(r.nombre)), ' ', 1) AS ap1, split_part(max(mef_norm(r.nombre)), ' ', 2) AS ap2
      FROM rnp_conformacion_juridica r JOIN _n ON _n.ruc = r.ruc_empresa::text
     WHERE r.tipo_documento LIKE 'DOC. NACIONAL%' AND r.numero_documento ~ '^\d{8}$'
     GROUP BY 1, 2;
  CREATE INDEX ON _rp (dni); CREATE INDEX ON _rp (ap1, ap2); ANALYZE _rp;
  -- Las personas que venden con su RUC 10.
  CREATE TEMP TABLE _p10 ON COMMIT DROP AS
    SELECT DISTINCT ON (ruc) ruc, substr(ruc, 3, 8) AS dni, nom_n AS nombre, ap1, ap2 FROM persona_orden_anual
     WHERE anio >= 2018 AND ruc ~ '^10\d{9}$' ORDER BY ruc, anio DESC;
  CREATE INDEX ON _p10 (dni); CREATE INDEX ON _p10 (ap1, ap2); ANALYZE _p10;

  -- Aristas (sin entidad todavía).
  CREATE TEMP TABLE _e (a text, b text, via text, persona text, persona_b text) ON COMMIT DROP;
  INSERT INTO _e
    SELECT DISTINCT ON (a.ruc, b.ruc) a.ruc, b.ruc, 'socio_comun', a.nombre, NULL
      FROM _rp a JOIN _rp b ON b.dni = a.dni AND b.ruc > a.ruc
     WHERE (a.socio OR b.socio)
       AND a.dni IN (SELECT dni FROM _rp GROUP BY dni HAVING count(DISTINCT ruc) <= 6)
     ORDER BY a.ruc, b.ruc, (a.socio AND b.socio) DESC;
  INSERT INTO _e
    SELECT DISTINCT ON (p.ruc, r.ruc) p.ruc, r.ruc, 'es_socio', r.nombre, NULL FROM _p10 p JOIN _rp r ON r.dni = p.dni ORDER BY p.ruc, r.ruc;
  CREATE TEMP TABLE _fr ON COMMIT DROP AS
    SELECT ap1, ap2, count(DISTINCT dni) AS n FROM (SELECT ap1, ap2, dni FROM _rp UNION ALL SELECT ap1, ap2, dni FROM _p10) x
     WHERE length(ap1) >= 3 AND length(ap2) >= 3 GROUP BY 1, 2;
  CREATE INDEX ON _fr (ap1, ap2);
  CREATE TEMP TABLE _ind ON COMMIT DROP AS
    SELECT x.nodo, x.dni, x.ap1, x.ap2, x.socio, x.nombre FROM (
      SELECT ruc AS nodo, dni, ap1, ap2, true AS socio, nombre FROM _rp
      UNION SELECT ruc, dni, ap1, ap2, false, nombre FROM _p10) x
    JOIN _fr f ON f.ap1 = x.ap1 AND f.ap2 = x.ap2 WHERE f.n BETWEEN 2 AND 8;
  CREATE INDEX ON _ind (ap1, ap2);
  INSERT INTO _e
    SELECT DISTINCT ON (a.nodo, b.nodo) a.nodo, b.nodo, 'hermanos_probables', a.nombre, b.nombre
      FROM _ind a JOIN _ind b ON b.ap1 = a.ap1 AND b.ap2 = a.ap2 AND b.dni <> a.dni AND b.nodo > a.nodo
     WHERE (a.socio OR b.socio)
     ORDER BY a.nodo, b.nodo;

  -- Por entidad: sólo los vínculos entre proveedores de esa entidad.
  CREATE TEMP TABLE _ex ON COMMIT DROP AS
    SELECT x.entidad_ruc, e.a, e.b, e.via, e.persona, e.persona_b
      FROM _e e JOIN _ne x ON x.ruc = e.a JOIN _ne y ON y.ruc = e.b AND y.entidad_ruc = x.entidad_ruc;
  CREATE TEMP TABLE _eex ON COMMIT DROP AS SELECT entidad_ruc, a, b FROM _ex UNION SELECT entidad_ruc, b, a FROM _ex;
  CREATE INDEX ON _eex (entidad_ruc, a); ANALYZE _eex;
  CREATE TEMP TABLE _gx ON COMMIT DROP AS SELECT DISTINCT entidad_ruc, a AS ruc, a AS grupo FROM _eex;
  CREATE UNIQUE INDEX ON _gx (entidad_ruc, ruc); ANALYZE _gx;
  LOOP
    UPDATE _gx SET grupo = m.g
      FROM (SELECT e.entidad_ruc, e.a AS ruc, min(g2.grupo) AS g FROM _eex e
              JOIN _gx g2 ON g2.entidad_ruc = e.entidad_ruc AND g2.ruc = e.b GROUP BY 1, 2) m
     WHERE _gx.entidad_ruc = m.entidad_ruc AND _gx.ruc = m.ruc AND m.g < _gx.grupo;
    GET DIAGNOSTICS cambios = ROW_COUNT;
    vueltas := vueltas + 1;
    EXIT WHEN cambios = 0 OR vueltas >= 60;
  END LOOP;

  DELETE FROM grupo_proveedor;
  INSERT INTO grupo_proveedor (entidad_ruc, grupo, ruc) SELECT entidad_ruc, grupo, ruc FROM _gx;
  GET DIAGNOSTICS n_grupos = ROW_COUNT;
  DELETE FROM grupo_proveedor_vinculo;
  INSERT INTO grupo_proveedor_vinculo (entidad_ruc, a, b, via, persona, persona_b) SELECT entidad_ruc, a, b, via, persona, persona_b FROM _ex;

  -- Los grupos que se resumen: de 2 a 25 miembros y S/ 50 mil o más en órdenes desde 2018.
  CREATE TEMP TABLE _gs ON COMMIT DROP AS
    SELECT g.entidad_ruc, g.grupo, count(*)::int AS miembros, sum(n.monto) AS monto, sum(n.ordenes)::int AS ordenes
      FROM _gx g JOIN _ne n ON n.ruc = g.ruc AND n.entidad_ruc = g.entidad_ruc
     GROUP BY 1, 2 HAVING count(*) BETWEEN 2 AND 25 AND sum(n.monto) >= 50000;
  CREATE INDEX ON _gs (entidad_ruc, grupo);
  CREATE TEMP TABLE _gm ON COMMIT DROP AS
    SELECT g.entidad_ruc, g.grupo, g.ruc FROM _gx g JOIN _gs s ON s.entidad_ruc = g.entidad_ruc AND s.grupo = g.grupo;
  CREATE INDEX ON _gm (entidad_ruc, ruc); ANALYZE _gm;

  -- Sus órdenes, una vez cada una, con el tope del año y el número de orden.
  CREATE TEMP TABLE _o ON COMMIT DROP AS
    SELECT m.grupo, o.* FROM _gm m CROSS JOIN LATERAL (
      SELECT DISTINCT ON (c.orden, c.fecha_emision) c.entidad_ruc, c.ruc_contratista AS ruc, c.fecha_emision AS fecha, c.monto, c.tipo_orden,
             c.orden, NULLIF(substring(c.nro_orden FROM '\d+'), '')::bigint AS nro, left(mef_norm(c.descripcion), 28) AS objeto,
             left(c.descripcion, 140) AS descripcion,
             CASE WHEN c.tipo_contratacion ILIKE 'Contrataciones hasta%' OR c.tipo_contratacion ILIKE 'Otras contrataciones sin proceso%'
                  THEN COALESCE(substring(c.tipo_contratacion FROM 'hasta (\d+) UIT')::int, 8) * uit_soles(extract(year FROM c.fecha_emision)::int) END AS tope
        FROM conosce_ordenes c
       WHERE c.entidad_ruc = m.entidad_ruc AND c.ruc_contratista = m.ruc AND c.fecha_emision >= DATE '2018-01-01'
         AND c.estado IS DISTINCT FROM 'Anulada' AND c.monto > 0 AND c.moneda = 'Nuevos Soles'
       ORDER BY c.orden, c.fecha_emision, c.anio DESC, c.mes DESC) o;
  CREATE INDEX ON _o (entidad_ruc, grupo, fecha); ANALYZE _o;

  -- Días en que 2 o más miembros recibieron órdenes, y los pares de números correlativos de miembros distintos.
  CREATE TEMP TABLE _dj ON COMMIT DROP AS
    SELECT entidad_ruc, grupo, fecha, count(*)::int AS ordenes, count(DISTINCT ruc)::int AS miembros, sum(monto) AS monto,
           (SELECT count(*) FROM _o a JOIN _o b ON b.entidad_ruc = a.entidad_ruc AND b.grupo = a.grupo AND b.fecha = a.fecha
              AND b.tipo_orden = a.tipo_orden AND b.ruc <> a.ruc AND b.nro > a.nro AND b.nro - a.nro <= 3
             WHERE a.entidad_ruc = o.entidad_ruc AND a.grupo = o.grupo AND a.fecha = o.fecha)::int AS correlativas,
           jsonb_agg(jsonb_build_object('ruc', ruc, 'orden', orden, 'monto', monto) ORDER BY nro) AS detalle
      FROM _o o GROUP BY 1, 2, 3 HAVING count(DISTINCT ruc) >= 2;
  -- El mismo objeto a 2 o más miembros en el mismo año, que juntos pasan el tope.
  CREATE TEMP TABLE _rep ON COMMIT DROP AS
    SELECT entidad_ruc, grupo, extract(year FROM fecha)::int AS anio, objeto, count(*)::int AS ordenes, count(DISTINCT ruc)::int AS miembros,
           sum(monto) AS monto, max(tope) AS tope, min(descripcion) AS descripcion,
           jsonb_agg(jsonb_build_object('ruc', ruc, 'orden', orden, 'fecha', fecha, 'monto', monto) ORDER BY fecha) AS detalle
      FROM _o WHERE tope IS NOT NULL AND length(objeto) >= 12 GROUP BY 1, 2, 3, 4
    HAVING count(DISTINCT ruc) >= 2 AND sum(monto) > max(tope);

  -- Puesto en la entidad: el grupo como si fuera un solo proveedor, y su miembro más grande.
  CREATE TEMP TABLE _rank ON COMMIT DROP AS
    SELECT n.entidad_ruc, n.ruc, n.monto, rank() OVER (PARTITION BY n.entidad_ruc ORDER BY n.monto DESC) AS puesto
      FROM _ne n WHERE n.entidad_ruc IN (SELECT DISTINCT entidad_ruc FROM _gs);
  CREATE INDEX ON _rank (entidad_ruc, monto);

  DELETE FROM grupo_proveedor_resumen;
  INSERT INTO grupo_proveedor_resumen (entidad_ruc, grupo, miembros, empresas, personas, ordenes, monto, desde, hasta, hasta_8uit, borde,
                                       monto_borde, sobre_tope, dias_juntos, monto_juntos, correlativas, repartidos, monto_repartido,
                                       puesto_grupo, puesto_mayor, severidad, detalle)
  SELECT s.entidad_ruc, s.grupo, s.miembros,
         (SELECT count(*) FROM _gm m WHERE m.entidad_ruc = s.entidad_ruc AND m.grupo = s.grupo AND m.ruc LIKE '20%')::int,
         (SELECT count(*) FROM _gm m WHERE m.entidad_ruc = s.entidad_ruc AND m.grupo = s.grupo AND m.ruc LIKE '10%')::int,
         s.ordenes, s.monto, o.desde, o.hasta, COALESCE(o.hasta_8uit, 0), COALESCE(o.borde, 0), COALESCE(o.monto_borde, 0), COALESCE(o.sobre, 0),
         COALESCE(d.dias, 0), COALESCE(d.monto, 0), COALESCE(d.correlativas, 0), COALESCE(r.n, 0), COALESCE(r.monto, 0),
         (SELECT count(*) + 1 FROM _rank k WHERE k.entidad_ruc = s.entidad_ruc AND k.monto > s.monto)::int,
         (SELECT min(k.puesto) FROM _rank k JOIN _gm m ON m.entidad_ruc = k.entidad_ruc AND m.ruc = k.ruc WHERE m.entidad_ruc = s.entidad_ruc AND m.grupo = s.grupo)::int,
         CASE
           WHEN (COALESCE(d.correlativas, 0) >= 2 OR COALESCE(r.n, 0) >= 2) AND COALESCE(o.borde, 0) * 4 >= GREATEST(COALESCE(o.hasta_8uit, 0), 1) THEN 'alta'
           WHEN COALESCE(d.correlativas, 0) >= 1 OR COALESCE(r.n, 0) >= 1 OR COALESCE(o.sobre, 0) >= 1 OR COALESCE(d.dias, 0) >= 3 THEN 'media'
           ELSE 'baja' END,
         jsonb_build_object(
           'miembros', (SELECT jsonb_agg(jsonb_build_object('ruc', m.ruc, 'nombre', n.nombre, 'ordenes', n.ordenes, 'monto', round(n.monto, 2)) ORDER BY n.monto DESC)
                          FROM _gm m JOIN _ne n ON n.ruc = m.ruc AND n.entidad_ruc = m.entidad_ruc WHERE m.entidad_ruc = s.entidad_ruc AND m.grupo = s.grupo),
           'dias', (SELECT jsonb_agg(jsonb_build_object('fecha', x.fecha, 'ordenes', x.ordenes, 'miembros', x.miembros, 'monto', x.monto,
                                                        'correlativas', x.correlativas, 'detalle', x.detalle) ORDER BY x.correlativas DESC, x.monto DESC)
                      FROM (SELECT * FROM _dj j WHERE j.entidad_ruc = s.entidad_ruc AND j.grupo = s.grupo ORDER BY j.correlativas DESC, j.monto DESC LIMIT 15) x),
           'repartidos', (SELECT jsonb_agg(jsonb_build_object('anio', x.anio, 'objeto', x.descripcion, 'ordenes', x.ordenes, 'miembros', x.miembros,
                                                              'monto', x.monto, 'tope', x.tope, 'detalle', x.detalle) ORDER BY x.monto DESC)
                            FROM (SELECT * FROM _rep p WHERE p.entidad_ruc = s.entidad_ruc AND p.grupo = s.grupo ORDER BY p.monto DESC LIMIT 15) x),
           'sobre_tope', (SELECT jsonb_agg(jsonb_build_object('ruc', x.ruc, 'orden', x.orden, 'fecha', x.fecha, 'monto', x.monto, 'tope', x.tope,
                                                              'descripcion', x.descripcion) ORDER BY x.monto DESC)
                            FROM (SELECT * FROM _o q WHERE q.entidad_ruc = s.entidad_ruc AND q.grupo = s.grupo AND q.tope IS NOT NULL AND q.monto > q.tope
                                   ORDER BY q.monto DESC LIMIT 15) x))
    FROM _gs s
    LEFT JOIN (SELECT entidad_ruc, grupo, min(fecha) AS desde, max(fecha) AS hasta, count(*) FILTER (WHERE tope IS NOT NULL)::int AS hasta_8uit,
                      count(*) FILTER (WHERE tope IS NOT NULL AND monto >= 0.85 * tope AND monto <= tope)::int AS borde,
                      sum(monto) FILTER (WHERE tope IS NOT NULL AND monto >= 0.85 * tope AND monto <= tope) AS monto_borde,
                      count(*) FILTER (WHERE tope IS NOT NULL AND monto > tope)::int AS sobre
                 FROM _o GROUP BY 1, 2) o ON o.entidad_ruc = s.entidad_ruc AND o.grupo = s.grupo
    LEFT JOIN (SELECT entidad_ruc, grupo, count(*)::int AS dias, sum(monto) AS monto, sum(correlativas)::int AS correlativas FROM _dj GROUP BY 1, 2) d
           ON d.entidad_ruc = s.entidad_ruc AND d.grupo = s.grupo
    LEFT JOIN (SELECT entidad_ruc, grupo, count(*)::int AS n, sum(monto) AS monto FROM _rep GROUP BY 1, 2) r
           ON r.entidad_ruc = s.entidad_ruc AND r.grupo = s.grupo;
  GET DIAGNOSTICS n_resumen = ROW_COUNT;
  ANALYZE grupo_proveedor; ANALYZE grupo_proveedor_vinculo; ANALYZE grupo_proveedor_resumen;
  RETURN jsonb_build_object('miembros', n_grupos, 'grupos_resumidos', n_resumen, 'vueltas', vueltas);
END $$;
