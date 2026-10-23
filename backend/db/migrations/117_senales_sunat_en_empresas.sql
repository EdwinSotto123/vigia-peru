-- 117 · Las señales SUNAT (migración 116) se regeneran DENTRO de refrescar_empresas.
--
-- refrescar_empresas() hace DELETE + INSERT de empresa_resumen; si refrescar_senales_sunat() no corría justo
-- después, cualquier reconstrucción (un cron de los scrapers, una corrida manual) dejaba las empresas SIN sus
-- señales SUNAT (recien_fundada, dada_de_baja, suspendida, no_habida). Pasó en prod: el cron las borró. Ahora la
-- propia refrescar_empresas las vuelve a calcular al final, así que no dependen de que el pipeline se acuerde.
-- La definición es la de prod tal cual, con una sola línea añadida (PERFORM refrescar_senales_sunat()).

CREATE OR REPLACE FUNCTION public.refrescar_empresas()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
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

  -- Antecedentes. La misma venta o aporte no cuenta dos veces (como en la ficha del contrato, migración 87):
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

  -- Cada tipo de antecedente una vez, con su gravedad más alta y cuántos registros: lo que la ficha y la lista muestran.
  CREATE TEMP TABLE _ect ON COMMIT DROP AS
    -- `cuantos`, no `n`: la función ya tiene una variable `n` (sería ambigua).
    SELECT ruc, tipo, min(CASE severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END) AS r, count(*)::int AS cuantos
      FROM _ecp GROUP BY ruc, tipo;
  CREATE TEMP TABLE _ecs ON COMMIT DROP AS
    SELECT t.ruc, t.tipos, t.n_alta, t.n_media, t.n_baja, c.cruces
      FROM (SELECT ruc, array_agg(DISTINCT tipo ORDER BY tipo) AS tipos,
                   count(*) FILTER (WHERE severidad = 'alta')::int AS n_alta,
                   count(*) FILTER (WHERE severidad = 'media')::int AS n_media,
                   count(*) FILTER (WHERE severidad = 'baja')::int AS n_baja
              FROM _ecp GROUP BY ruc) t
      JOIN (SELECT ruc, jsonb_agg(jsonb_build_object('tipo', tipo, 'severidad', (ARRAY['alta', 'media', 'baja'])[r + 1], 'n', cuantos)
                                  ORDER BY r, cuantos DESC, tipo) AS cruces
              FROM _ect GROUP BY ruc) c ON c.ruc = t.ruc;
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
                               tipos, n_alta, n_media, n_baja, cruces, texto)
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
         COALESCE(c.tipos, '{}'), COALESCE(c.n_alta, 0), COALESCE(c.n_media, 0), COALESCE(c.n_baja, 0), COALESCE(c.cruces, '[]'),
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
  -- Señales SUNAT (migración 116): SIEMPRE tras reconstruir empresa_resumen, para que no se pierdan.
  PERFORM refrescar_senales_sunat();
  RETURN n;
END $function$
;
