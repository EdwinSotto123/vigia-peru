-- 311 · El caso reservado de una autoridad electa no marca a su familiar en ninguna lista (2026-11-16).
--
-- Una autoridad electa (alcalde, regidor, gobernador, consejero, congresista…) va con su nombre completo en todo Vigía. Si
-- declaró en su DJI a un familiar con un parentesco que destapa el apellido que a él se le tapa (hermano, hijo, sobrino,
-- primo, nieto o uno desconocido), el bloque de nepotismo de la entidad ya lo muestra sólo como «un familiar de una
-- autoridad electa», sin el locador ni el monto (lib/nepotismo.ts en la API). Pero el locador seguía con la etiqueta
-- «Posible nepotismo» en la lista de personas de la entidad, en su filtro y en el conteo por señal: restado de los casos
-- que se ven, quedaba él. Aquí se le quita: su caso sigue sumando en los totales del bloque de la entidad (que lee la
-- vista dji_nepotismo y no lo identifica) y en ninguna otra parte.
--
-- refrescar_reserva_parientes(): un paso más de las cadenas, DESPUÉS de las señales que nombran a un familiar declarado y
-- ANTES de los resúmenes (conosce_ordenes y pte_personal del Worker de scrapers; orquestar_dji.py, cadena_planilla.py y
-- las cargas de visitas). Es idempotente: lo ya reservado no cambia.
--
--   1. Locadores (persona_senal): «nepotismo» (137), «nepotismo_gobierno» (179) y «familia_estado» (180). Cada familiar
--      declarado cuyo declarante es electo y cuyo parentesco destapa sale de la señal; sin ninguno que mostrar, la señal se
--      va (y con ella la etiqueta, el filtro y el conteo: persona_entidad se rehace para esos pares, y el resumen de las
--      listas lo rehace refrescar_personas_resumen(), que va después).
--   2. Planilla, el familiar («pariente_planilla», 182/196): lo mismo con cada funcionario que lo declaró. El nombre del
--      declarante no va en la señal: sale de los mismos vínculos de la DJI que lee refrescar_planilla_extra.
--   3. Planilla, el electo que declaró («pariente_locador» 179, «familiar_en_planilla» 182): la señal queda (que tiene un
--      familiar ahí es lo que su ficha de político ya dice, sin decir quién), pero ese familiar va sólo como
--      {"reservado": true}: sin parentesco, grado, cargo, órdenes, monto ni años; y con uno solo así, la señal no da sus
--      sumas (restadas de las de los demás darían las suyas). Si cambia el número de señales de alguna fila, se rehace el
--      resumen de la planilla (como al final de refrescar_planilla(), migración 209).
--
-- Electo, como declaranteElectoSql (lib/electos.ts): cargo de elección en la DJI o en la planilla (cargo_de_eleccion), o
-- el nombre de una autoridad del JNE del gobierno de la entidad, o el de un político cuya DJI se empató en ella
-- (politico_dji, 301). Destapa, como parentescoPublicable (lib/privacidad.ts): todo lo que no está en la lista cerrada de
-- parentesco_publicable. Las dos listas viven también en TypeScript; test/privacidad.test.ts comprueba que coincidan.
--
-- Medido en PROD antes de escribirla (la misma lógica en CTE de sólo lectura, 2026-11-16):
--   nepotismo           7 297 señales, 7 415 familiares: 357 reservados; se van 353 señales, 4 pierden alguno
--   nepotismo_gobierno  2 511 señales: 55 reservados; se van 54, 1 pierde alguno
--   familia_estado      179 747 señales: 3 067 reservados; se van 2 693, 372 pierden alguno
--   pariente_planilla   24 vínculos de electos (por su nombre; por el cargo, ninguno)
--   pariente_locador    33 familiares reservados en 29 señales; familiar_en_planilla, 6 en 6
-- El lado contrario (el locador es el electo y el parentesco destapa al funcionario) no entra aquí.

-- El parentesco que, con el nombre completo del declarante, no deja deducir el apellido tapado del familiar. Una lista
-- CERRADA, la misma de parentescoPublicable: lo que no está en ella se trata como si destapara.
CREATE OR REPLACE FUNCTION parentesco_publicable(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT x.n IN ('CONYUGE', 'CONVIVIENTE', 'PADRE DEL DECLARANTE', 'MADRE DEL DECLARANTE', 'TIO (A)', 'TIO(A)', 'TIO(A) ABUELO(A)',
                 'ABUELO PATERNO DEL DECLARANTE', 'ABUELA PATERNA DEL DECLARANTE', 'ABUELO MATERNO DEL DECLARANTE',
                 'ABUELA MATERNA DEL DECLARANTE', 'BISABUELO(A)', 'TATARABUELO(A)', 'CUNADO(A)', 'SUEGRO(A)', 'YERNO', 'NUERA',
                 'HIJASTRO(A)', 'HIJASTRO(A) POR PARTE DEL CONYUGE', 'NIETASTRO(A) POR PARTE DEL CONYUGE')
      OR x.n ~ '^(PADRE|MADRE|HERMANO\(A\)|HIJO|HIJO\(A\)|NIETO\(A\)|ABUEL[OA] (PATERN|MATERN)[OA]) DEL (CONYUGE|CONVIVIENTE|EXCONYUGE)$'
    FROM (SELECT btrim(regexp_replace(upper(immutable_unaccent(COALESCE(p, ''))), '\s+', ' ', 'g')) AS n) x
$$;

-- Un cargo de elección popular como lo escribe la DJI o la planilla (CARGO_DE_ELECCION de lib/electos.ts).
CREATE OR REPLACE FUNCTION cargo_de_eleccion(c text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT upper(immutable_unaccent(COALESCE(c, ''))) ~ '^\s*(?:EX\s*-?\s*)?(?:TENIENTE\s+)?(?:ALCALD|REGID|REGIGOR|CONCEJAL|CONCEJO MUNICIPAL|GOBERNADOR|GOBERNACION REGIONAL|VICE\s*GOBERNADOR|CONSEJER|CONGRESISTA|DIPUTAD|SENADOR)'
$$;

CREATE OR REPLACE FUNCTION refrescar_reserva_parientes() RETURNS integer
LANGUAGE plpgsql SET work_mem = '256MB' SET statement_timeout = '1800s' AS $$
DECLARE
  n_fuera int := 0;      -- señales de locadores que se van: todos sus familiares, reservados
  n_podadas int := 0;    -- señales de locadores que pierden algún familiar
  n_pla_fuera int := 0;  -- señales «pariente_planilla» que se van
  n_planilla int := 0;   -- filas de la planilla tocadas
  t0 timestamptz := clock_timestamp();
BEGIN
  -- El cerrojo de las que escriben persona_senal y el resumen de persona_entidad (308), y el de la planilla (209).
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_personas'));
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_planilla'));

  -- 0. Las autoridades electas de cada entidad, por su nombre: las del JNE del gobierno de la entidad (su municipalidad o
  --    su gobierno regional) y los políticos cuya DJI se empató en ella (Congreso, Despacho Presidencial…).
  DROP TABLE IF EXISTS _rp_el;
  CREATE TEMP TABLE _rp_el ON COMMIT DROP AS
    SELECT eg.ruc AS entidad_ruc, mef_norm(ja.nombre) AS nom
      FROM entidad_gobierno_amplia eg
      JOIN jne_autoridades ja ON ja.ubigeo = eg.ubigeo
       AND eg.nivel = CASE ja.ambito WHEN 'DISTRITAL' THEN 'distrital' WHEN 'PROVINCIAL' THEN 'provincial' WHEN 'REGIONAL' THEN 'regional' END
     WHERE eg.como = 'entidades' AND ja.nombre IS NOT NULL
    UNION
    SELECT pd.entidad_ruc, mef_norm(pp.nombre) FROM politico_dji pd JOIN partido_politico pp ON pp.codigo = pd.codigo;
  CREATE INDEX ON _rp_el (entidad_ruc, nom);
  ANALYZE _rp_el;

  -- 1. Locadores: cada familiar declarado de sus tres señales, y si su caso se reserva. El declarante del nepotismo es de la
  --    misma entidad de la señal; el de las otras dos, de la que trae el familiar.
  DROP TABLE IF EXISTS _rp_s;
  CREATE TEMP TABLE _rp_s ON COMMIT DROP AS
    SELECT y.entidad_ruc, y.ruc, y.tipo, bool_and(y.reservado) AS todos,
           jsonb_agg(y.p ORDER BY y.k) FILTER (WHERE NOT y.reservado) AS quedan,
           count(DISTINCT y.p->>'entidad_ruc') FILTER (WHERE NOT y.reservado)::int AS entidades
      FROM (SELECT ps.entidad_ruc, ps.ruc, ps.tipo, x.p, x.k,
                   CASE WHEN parentesco_publicable(x.p->>'parentesco') THEN false
                        ELSE cargo_de_eleccion(x.p->>'cargo')
                             OR EXISTS (SELECT 1 FROM _rp_el e
                                         WHERE e.entidad_ruc = CASE WHEN ps.tipo = 'nepotismo' THEN ps.entidad_ruc ELSE x.p->>'entidad_ruc' END
                                           AND e.nom = mef_norm(x.p->>'declarante')) END AS reservado
              FROM persona_senal ps
              CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(ps.detalle->'parientes') = 'array'
                                                           THEN ps.detalle->'parientes' ELSE '[]'::jsonb END) WITH ORDINALITY x(p, k)
             WHERE ps.tipo IN ('nepotismo', 'nepotismo_gobierno', 'familia_estado')) y
     GROUP BY y.entidad_ruc, y.ruc, y.tipo
    HAVING bool_or(y.reservado);

  -- Sin ningún familiar que mostrar, la señal se va; si le quedan, sólo pierde los reservados («entidades» de la familia en
  -- el Estado cuenta las de los que quedan).
  DELETE FROM persona_senal ps USING _rp_s s
   WHERE s.todos AND ps.entidad_ruc = s.entidad_ruc AND ps.ruc = s.ruc AND ps.tipo = s.tipo;
  GET DIAGNOSTICS n_fuera = ROW_COUNT;
  UPDATE persona_senal ps
     SET detalle = ps.detalle || jsonb_build_object('parientes', s.quedan)
                   || CASE WHEN s.tipo = 'familia_estado' THEN jsonb_build_object('entidades', s.entidades) ELSE '{}'::jsonb END
    FROM _rp_s s
   WHERE NOT s.todos AND ps.entidad_ruc = s.entidad_ruc AND ps.ruc = s.ruc AND ps.tipo = s.tipo;
  GET DIAGNOSTICS n_podadas = ROW_COUNT;

  -- El resumen de cada par que perdió una señal (tipos, señales, cuántas y la más grave), desde persona_senal, como la 308;
  -- sin ninguna, vacío.
  DROP TABLE IF EXISTS _rp_pares;
  CREATE TEMP TABLE _rp_pares ON COMMIT DROP AS SELECT DISTINCT entidad_ruc, ruc FROM _rp_s WHERE todos;
  UPDATE persona_entidad pe SET tipos = '{}', senales = '[]', n_senales = 0, sev = 0
    FROM _rp_pares p WHERE pe.entidad_ruc = p.entidad_ruc AND pe.ruc = p.ruc;
  UPDATE persona_entidad pe
     SET tipos = s.tipos, senales = s.senales, n_senales = s.n, sev = s.sev
    FROM (SELECT ps.entidad_ruc, ps.ruc, array_agg(ps.tipo ORDER BY ps.tipo) AS tipos, count(*)::int AS n,
                 max(CASE ps.severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END)::smallint AS sev,
                 jsonb_agg(jsonb_build_object('tipo', ps.tipo, 'severidad', ps.severidad)
                           ORDER BY CASE ps.severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, ps.tipo) AS senales
            FROM persona_senal ps JOIN _rp_pares p ON p.entidad_ruc = ps.entidad_ruc AND p.ruc = ps.ruc
           GROUP BY ps.entidad_ruc, ps.ruc) s
   WHERE pe.entidad_ruc = s.entidad_ruc AND pe.ruc = s.ruc;
  RAISE NOTICE 'reserva: locadores, % señales fuera y % con menos familiares (% s)', n_fuera, n_podadas,
    round(extract(epoch FROM clock_timestamp() - t0));

  -- 2. Planilla, el familiar: los vínculos de la DJI de autoridades electas con un parentesco que destapa, y el nombre del
  --    familiar como lo escribe la planilla («PATERNO MATERNO NOMBRES», como refrescar_planilla_extra, migración 196). Sólo
  --    en las entidades con la señal.
  DROP TABLE IF EXISTS _rp_pp;
  CREATE TEMP TABLE _rp_pp ON COMMIT DROP AS
    SELECT entidad_ruc, nombre_norm FROM planilla_persona WHERE tipos && ARRAY['pariente_planilla'];
  CREATE INDEX ON _rp_pp (entidad_ruc, nombre_norm);
  ANALYZE _rp_pp;
  DROP TABLE IF EXISTS _rp_pv;
  CREATE TEMP TABLE _rp_pv ON COMMIT DROP AS
    SELECT DISTINCT x.entidad_ruc, x.pariente_pl, x.parentesco, x.grado
      FROM (SELECT d.entidad_ruc, d.declarante_norm, d.parentesco, d.grado,
                   array_to_string(d.w[array_length(d.w, 1) - 1:array_length(d.w, 1)] || d.w[1:array_length(d.w, 1) - 2], ' ') AS pariente_pl
              FROM (SELECT v.entidad_ruc, v.declarante_norm, v.parentesco, v.grado, regexp_split_to_array(v.pariente_norm, ' ') AS w
                      FROM dji_vinculos v
                     WHERE v.pariente_norm ~ '^\S+ \S+ \S+' AND v.pariente_norm ~ '^[A-ZÑ ]+$' AND v.declarante_norm IS NOT NULL
                       AND v.entidad_ruc IN (SELECT entidad_ruc FROM _rp_pp)) d) x
      JOIN _rp_pp p ON p.entidad_ruc = x.entidad_ruc AND p.nombre_norm = x.pariente_pl
     WHERE NOT parentesco_publicable(x.parentesco)
       AND EXISTS (SELECT 1 FROM _rp_el e WHERE e.entidad_ruc = x.entidad_ruc AND e.nom = mef_norm(x.declarante_norm));
  CREATE INDEX ON _rp_pv (entidad_ruc, pariente_pl);
  ANALYZE _rp_pv;

  -- Cada funcionario de la señal: reservado si el parentesco destapa y su cargo es de elección o el vínculo es de un electo
  -- (por el parentesco y el grado, que la señal copia del vínculo). La señal nueva, o NULL si no queda ninguno.
  DROP TABLE IF EXISTS _rp_pc;
  CREATE TEMP TABLE _rp_pc ON COMMIT DROP AS
    SELECT z.entidad_ruc, z.nombre_norm, z.ks, CASE WHEN z.todos THEN NULL ELSE jsonb_set(z.s, '{detalle,funcionarios}', z.quedan) END AS nueva
      FROM (SELECT p.entidad_ruc, p.nombre_norm, s.k AS ks, (array_agg(s.s))[1] AS s, bool_and(r.reservado) AS todos,
                   jsonb_agg(f.f ORDER BY f.kf) FILTER (WHERE NOT r.reservado) AS quedan
              FROM planilla_persona p
              JOIN _rp_pp pp ON pp.entidad_ruc = p.entidad_ruc AND pp.nombre_norm = p.nombre_norm
              CROSS JOIN LATERAL jsonb_array_elements(p.senales) WITH ORDINALITY s(s, k)
              CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.s->'detalle'->'funcionarios') = 'array'
                                                           THEN s.s->'detalle'->'funcionarios' ELSE '[]'::jsonb END) WITH ORDINALITY f(f, kf)
              CROSS JOIN LATERAL (
                SELECT NOT parentesco_publicable(f.f->>'parentesco')
                       AND (cargo_de_eleccion(f.f->>'cargo')
                            OR EXISTS (SELECT 1 FROM _rp_pv v
                                        WHERE v.entidad_ruc = p.entidad_ruc AND v.pariente_pl = p.nombre_norm
                                          AND v.parentesco IS NOT DISTINCT FROM f.f->>'parentesco'
                                          AND v.grado IS NOT DISTINCT FROM f.f->>'grado')) AS reservado) r
             WHERE s.s->>'tipo' = 'pariente_planilla'
             GROUP BY p.entidad_ruc, p.nombre_norm, s.k
            HAVING bool_or(r.reservado)) z;
  SELECT count(*) INTO n_pla_fuera FROM _rp_pc WHERE nueva IS NULL;

  -- 3. Planilla, el electo que declaró: cada familiar con un parentesco que destapa, reservado; con uno solo, sin las sumas.
  INSERT INTO _rp_pc (entidad_ruc, nombre_norm, ks, nueva)
  SELECT w.entidad_ruc, w.nombre_norm, w.ks, w.nueva
    FROM (SELECT z.entidad_ruc, z.nombre_norm, z.ks, z.s,
                 CASE WHEN z.s->>'tipo' = 'pariente_locador' AND z.n_res = 1
                      THEN jsonb_set(jsonb_set(jsonb_set(z.s, '{detalle,parientes}', z.parientes), '{detalle,monto}', 'null'::jsonb),
                                     '{detalle,ordenes}', 'null'::jsonb)
                      ELSE jsonb_set(z.s, '{detalle,parientes}', z.parientes) END AS nueva
            FROM (SELECT p.entidad_ruc, p.nombre_norm, s.k AS ks, (array_agg(s.s))[1] AS s,
                         count(*) FILTER (WHERE NOT parentesco_publicable(e.e->>'parentesco'))::int AS n_res,
                         jsonb_agg(CASE WHEN parentesco_publicable(e.e->>'parentesco') THEN e.e ELSE '{"reservado": true}'::jsonb END
                                   ORDER BY e.ke) AS parientes
                    FROM planilla_persona p
                    CROSS JOIN LATERAL jsonb_array_elements(p.senales) WITH ORDINALITY s(s, k)
                    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.s->'detalle'->'parientes') = 'array'
                                                                 THEN s.s->'detalle'->'parientes' ELSE '[]'::jsonb END) WITH ORDINALITY e(e, ke)
                   WHERE p.tipos && ARRAY['pariente_locador', 'familiar_en_planilla']
                     AND s.s->>'tipo' IN ('pariente_locador', 'familiar_en_planilla')
                     AND (cargo_de_eleccion(p.cargo)
                          OR EXISTS (SELECT 1 FROM _rp_el el WHERE el.entidad_ruc = p.entidad_ruc AND el.nom = mef_norm(p.nombre_norm)))
                   GROUP BY p.entidad_ruc, p.nombre_norm, s.k) z
           WHERE z.n_res > 0) w
   -- Lo ya reservado en una corrida anterior vuelve igual: sólo se reescribe la señal que cambia.
   WHERE w.nueva IS DISTINCT FROM w.s;

  -- Las filas tocadas: cada señal en su lugar (la nueva, o ninguna), y su resumen.
  UPDATE planilla_persona p
     SET senales = x.senales, tipos = x.tipos, n_senales = x.n, sev = x.sev
    FROM (
      SELECT pp.entidad_ruc, pp.nombre_norm,
             COALESCE(jsonb_agg(e.s ORDER BY e.k) FILTER (WHERE e.s IS NOT NULL), '[]'::jsonb) AS senales,
             COALESCE(array_agg(DISTINCT e.s->>'tipo') FILTER (WHERE e.s IS NOT NULL), '{}') AS tipos,
             count(e.s)::int AS n,
             COALESCE(max(CASE e.s->>'severidad' WHEN 'alta' THEN 3 WHEN 'media' THEN 2 WHEN 'baja' THEN 1 END), 0)::smallint AS sev
        FROM (SELECT DISTINCT entidad_ruc, nombre_norm FROM _rp_pc) t
        JOIN planilla_persona pp ON pp.entidad_ruc = t.entidad_ruc AND pp.nombre_norm = t.nombre_norm
        CROSS JOIN LATERAL (
          SELECT CASE WHEN c.ks IS NULL THEN j.s ELSE c.nueva END AS s, j.k
            FROM jsonb_array_elements(pp.senales) WITH ORDINALITY j(s, k)
            LEFT JOIN _rp_pc c ON c.entidad_ruc = pp.entidad_ruc AND c.nombre_norm = pp.nombre_norm AND c.ks = j.k) e
       GROUP BY pp.entidad_ruc, pp.nombre_norm) x
   WHERE p.entidad_ruc = x.entidad_ruc AND p.nombre_norm = x.nombre_norm;
  GET DIAGNOSTICS n_planilla = ROW_COUNT;

  -- El resumen de cada alcance de la planilla, si alguna fila perdió una señal (como al final de refrescar_planilla()).
  IF n_pla_fuera > 0 THEN
    DROP TABLE IF EXISTS _rp_prb;
    CREATE TEMP TABLE _rp_prb ON COMMIT DROP AS
    SELECT x.alcance, CASE WHEN p.dudoso IS NULL THEN p.total END AS total, p.n_senales, p.sev, p.tipos, p.regimen, p.ultimo_mes,
           p.dudoso IS NOT NULL AS es_dudoso
      FROM planilla_persona p
      CROSS JOIN LATERAL (SELECT 'pais' AS alcance UNION ALL SELECT 'dep:' || p.dep WHERE p.dep IS NOT NULL
                          UNION ALL SELECT 'ent:' || p.entidad_ruc) x;
    DELETE FROM planilla_resumen;
    INSERT INTO planilla_resumen (alcance, resumen)
    SELECT t.alcance, jsonb_build_object('personas', t.personas, 'totalMes', t.total, 'conSenales', t.con, 'alta', t.alta, 'media', t.media,
                                         'ultimoMes', t.ultimo, 'porSenal', COALESCE(ps.l, '[]'), 'porRegimen', COALESCE(pr.l, '[]'),
                                         'dudosos', t.dudosos)
      FROM (SELECT alcance, count(*)::int AS personas, COALESCE(sum(total), 0)::float AS total, count(*) FILTER (WHERE n_senales > 0)::int AS con,
                   count(*) FILTER (WHERE sev = 3)::int AS alta, count(*) FILTER (WHERE sev = 2)::int AS media,
                   to_char(max(ultimo_mes), 'YYYY-MM') AS ultimo, count(*) FILTER (WHERE es_dudoso)::int AS dudosos
              FROM _rp_prb GROUP BY alcance) t
      LEFT JOIN (SELECT alcance, jsonb_agg(jsonb_build_object('tipo', tipo, 'n', c) ORDER BY c DESC) AS l
                   FROM (SELECT alcance, tipo, count(*)::int AS c FROM _rp_prb, unnest(_rp_prb.tipos) tipo GROUP BY 1, 2) z GROUP BY alcance) ps
             ON ps.alcance = t.alcance
      LEFT JOIN (SELECT alcance, jsonb_agg(jsonb_build_object('regimen', regimen, 'n', c) ORDER BY c DESC) AS l
                   FROM (SELECT alcance, regimen, count(*)::int AS c FROM _rp_prb GROUP BY 1, 2) z GROUP BY alcance) pr
             ON pr.alcance = t.alcance;
  END IF;
  RAISE NOTICE 'reserva: planilla, % filas tocadas (% señales de familiar fuera) (% s)', n_planilla, n_pla_fuera,
    round(extract(epoch FROM clock_timestamp() - t0));
  RETURN n_fuera + n_podadas + n_planilla;
END $$;
ALTER FUNCTION refrescar_reserva_parientes() OWNER TO vigia_jobs;
-- Escribe persona_senal y la planilla: sólo la corre su dueño (los Workers y los scripts como vigia_jobs o postgres).
REVOKE ALL ON FUNCTION refrescar_reserva_parientes() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_agentes') THEN
    REVOKE ALL ON FUNCTION refrescar_reserva_parientes() FROM vigia_agentes;
  END IF;
END $$;

-- La primera vez y el resumen de las listas (porSenal de cada alcance): en PROD, la lógica en CTE de sólo lectura tardó
-- 35 s y refrescar_personas_resumen() suele tardar 3 min. Si pasa de 30 minutos algo anda mal.
SET statement_timeout = '1800s';
SELECT refrescar_reserva_parientes() AS reserva_parientes;
SELECT refrescar_personas_resumen() AS personas_resumen;
RESET statement_timeout;
