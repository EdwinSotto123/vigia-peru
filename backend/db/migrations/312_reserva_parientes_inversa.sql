-- 312 · El caso inverso de la 311: el familiar declarado es la autoridad electa (va con su nombre completo) y el parentesco
-- destaparía el apellido tapado del FUNCIONARIO que lo declaró (2026-11-16).
--
-- Con el nombre completo del electo a la vista, «hermano» (comparten los dos apellidos), «madre», «tío», «primo» o un
-- parentesco desconocido dejan deducir el materno que Vigía le tapa al funcionario. La regla es la misma de la 311, al
-- revés (parentescoInversoPublicable en lib/privacidad.ts; aquí parentesco_inverso_publicable, lista CERRADA):
--   · en lo que es del electo (su ficha, su perfil, su fila de la planilla) el caso queda como «lo declaró un funcionario
--     de la entidad», sin el cargo, el apellido, la ficha ni el parentesco del funcionario;
--   · en lo que es del funcionario (su fila de la planilla y el filtro «declaró a un pariente que es locador»), que va con
--     un apellido tapado, el caso no aparece: ni etiqueta, ni filtro, ni conteo por señal;
--   · el bloque de nepotismo de la entidad lo sigue sumando, sin identificarlo (la API, lib/nepotismo.ts).
-- La ficha y el perfil de la persona ya lo reservan al leer (API); la base cambia en la planilla y en los pares del filtro.
--
--   1. refrescar_dji_nepotismo_pares() marca `reservado` el par entidad × funcionario cuyos familiares locadores son todos
--      de este caso: el par sigue contando para la entidad (dji_nepotismo_pares(), la lista de entidades) y deja de marcar
--      al funcionario en la planilla (dji_nepotismo_pares_planilla(), nueva; y dji_declarante_con_nepotismo(), fila por
--      fila, que ya no cuenta esos familiares).
--   2. refrescar_reserva_parientes() (la de la 311, con dos pasos más en la planilla):
--      · «pariente_planilla» en la fila del electo: cada funcionario que lo declaró con un parentesco así va sólo como
--        {"reservado": true};
--      · «pariente_locador» y «familiar_en_planilla» en la fila del funcionario: el familiar electo con un parentesco así
--        sale (y la señal, si no le queda otro; las sumas de «pariente_locador» pasan a ser las de los que quedan). Si el
--        funcionario también es electo, ese familiar queda como {"reservado": true}, como en la 311.
--   Electo, como esElectoSql (lib/electos.ts): su DNI está entre las autoridades o los electos del JNE; en la planilla,
--   que no trae DNI, también por su cargo de elección o por su nombre entre las autoridades de su gobierno.
--
-- Medido en PROD antes de aplicarla (la misma lógica en CTE de sólo lectura, 2026-11-16, ya con la 311): en el bloque de
-- las entidades, 5 casos en 5 entidades (API); 2 de los 6 056 pares del filtro de la planilla dejan de marcar al
-- funcionario; en las filas de funcionarios no electos salen 4 familiares de «pariente_locador» y 1 de
-- «familiar_en_planilla»; en la fila del electo declarado, ninguno hoy. En la ficha y el perfil de la persona (ya
-- reservados por la API): 241 familiares en 304 señales de locadores electos (5 de nepotismo, 3 del mismo gobierno y 233
-- de familia en el Estado) y 371 declaraciones en los perfiles.

-- El parentesco que, con el nombre completo del FAMILIAR (el electo), no deja deducir el apellido tapado del declarante.
-- La misma lista de parentescoInversoPublicable: lo que no está en ella se trata como si destapara.
CREATE OR REPLACE FUNCTION parentesco_inverso_publicable(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT x.n IN ('CONYUGE', 'CONVIVIENTE', 'PADRE DEL DECLARANTE', 'HIJO(A)', '(HIJO)', 'SOBRINO(A)', 'NIETO(A)',
                 'ABUELO PATERNO DEL DECLARANTE', 'ABUELA PATERNA DEL DECLARANTE', 'ABUELA MATERNA DEL DECLARANTE', 'CUNADO(A)',
                 'SUEGRO(A)', 'YERNO', 'NUERA', 'HIJASTRO(A)', 'HIJASTRO(A) POR PARTE DEL CONYUGE', 'NIETASTRO(A) POR PARTE DEL CONYUGE')
      OR x.n ~ '^(PADRE|MADRE|HERMANO\(A\)|HIJO|HIJO\(A\)|NIETO\(A\)|ABUEL[OA] (PATERN|MATERN)[OA]) DEL (CONYUGE|CONVIVIENTE|EXCONYUGE)$'
    FROM (SELECT btrim(regexp_replace(upper(immutable_unaccent(COALESCE(p, ''))), '\s+', ' ', 'g')) AS n) x
$$;

-- ─── 1. Los pares del filtro de la planilla ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE dji_nepotismo_pares_hecho ADD COLUMN IF NOT EXISTS reservado boolean NOT NULL DEFAULT false;

/** Recalcula los pares (como la 235) y marca los que sólo tienen familiares electos con un parentesco que destapa. */
CREATE OR REPLACE FUNCTION public.refrescar_dji_nepotismo_pares()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  DELETE FROM dji_nepotismo_pares_hecho;
  INSERT INTO dji_nepotismo_pares_hecho (entidad, declarante, reservado)
  SELECT v.entidad_ruc, v.declarante_norm,
         bool_and(NOT parentesco_inverso_publicable(v.parentesco)
                  AND (v.pariente_doc IN (SELECT dni FROM jne_autoridades WHERE dni IS NOT NULL)
                       OR v.pariente_doc IN (SELECT numero_documento FROM jne_candidaturas
                                              WHERE resultado = 'electo' AND numero_documento IS NOT NULL)))
    FROM dji_vinculos v
   WHERE v.declarante_norm IS NOT NULL AND length(v.pariente_doc) = 8
     AND EXISTS (SELECT 1 FROM persona_orden_anual po
                  WHERE po.entidad_ruc = v.entidad_ruc AND po.ruc BETWEEN '10' || v.pariente_doc || '0' AND '10' || v.pariente_doc || '9')
   GROUP BY v.entidad_ruc, v.declarante_norm;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO dji_nepotismo_pares_estado (id, calculado_at, pares) VALUES (true, now(), n)
  ON CONFLICT (id) DO UPDATE SET calculado_at = EXCLUDED.calculado_at, pares = EXCLUDED.pares;
  RETURN n;
END $$;

/** Los pares que marcan al funcionario en la planilla: sin los del caso inverso. Lo ya calculado o, si es viejo, en vivo. */
CREATE OR REPLACE FUNCTION public.dji_nepotismo_pares_planilla()
RETURNS TABLE (entidad text, declarante text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM dji_nepotismo_pares_estado e WHERE e.calculado_at > now() - interval '2 days') THEN
    RETURN QUERY SELECT h.entidad, h.declarante FROM dji_nepotismo_pares_hecho h WHERE NOT h.reservado;
  ELSE
    RETURN QUERY
      SELECT v.entidad_ruc, v.declarante_norm
        FROM dji_vinculos v
       WHERE v.declarante_norm IS NOT NULL AND length(v.pariente_doc) = 8
         AND EXISTS (SELECT 1 FROM persona_orden_anual po
                      WHERE po.entidad_ruc = v.entidad_ruc AND po.ruc BETWEEN '10' || v.pariente_doc || '0' AND '10' || v.pariente_doc || '9')
       GROUP BY v.entidad_ruc, v.declarante_norm
      HAVING NOT bool_and(NOT parentesco_inverso_publicable(v.parentesco)
                          AND (v.pariente_doc IN (SELECT a.dni FROM jne_autoridades a WHERE a.dni IS NOT NULL)
                               OR v.pariente_doc IN (SELECT c.numero_documento FROM jne_candidaturas c
                                                      WHERE c.resultado = 'electo' AND c.numero_documento IS NOT NULL)));
  END IF;
END $$;

/** ¿Este funcionario de la planilla declaró a un pariente que es locador de su entidad? Sin contar los del caso inverso. */
CREATE OR REPLACE FUNCTION public.dji_declarante_con_nepotismo(p_entidad text, p_declarante text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM dji_vinculos v
     WHERE v.entidad_ruc = p_entidad AND v.declarante_norm = p_declarante AND length(v.pariente_doc) = 8
       AND EXISTS (SELECT 1 FROM persona_orden_anual po
                    WHERE po.entidad_ruc = v.entidad_ruc AND po.ruc BETWEEN '10' || v.pariente_doc || '0' AND '10' || v.pariente_doc || '9')
       AND NOT (NOT parentesco_inverso_publicable(v.parentesco)
                AND (v.pariente_doc IN (SELECT a.dni FROM jne_autoridades a WHERE a.dni IS NOT NULL)
                     OR v.pariente_doc IN (SELECT c.numero_documento FROM jne_candidaturas c
                                            WHERE c.resultado = 'electo' AND c.numero_documento IS NOT NULL))))
$$;

REVOKE EXECUTE ON FUNCTION public.dji_nepotismo_pares_planilla() FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  -- Como las de la 213: la API de cada base y la del panel.
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'dev_api', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.dji_nepotismo_pares_planilla() TO %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_agentes') THEN
    REVOKE ALL ON FUNCTION public.dji_nepotismo_pares_planilla() FROM vigia_agentes;
  END IF;
END $$;

-- ─── 2. La reserva en las señales (la de la 311, con el caso inverso en la planilla) ──────────────────────────────────────

CREATE OR REPLACE FUNCTION refrescar_reserva_parientes() RETURNS integer
LANGUAGE plpgsql SET work_mem = '256MB' SET statement_timeout = '1800s' AS $$
DECLARE
  n_fuera int := 0;      -- señales de locadores que se van: todos sus familiares, reservados
  n_podadas int := 0;    -- señales de locadores que pierden algún familiar
  n_pla_fuera int := 0;  -- señales de la planilla que se van
  n_planilla int := 0;   -- filas de la planilla tocadas
  t0 timestamptz := clock_timestamp();
BEGIN
  -- El cerrojo de las que escriben persona_senal y el resumen de persona_entidad (308), y el de la planilla (209).
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_personas'));
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_planilla'));

  -- 0. Las autoridades electas de cada entidad, por su nombre: las del JNE del gobierno de la entidad (su municipalidad o
  --    su gobierno regional) y los políticos cuya DJI se empató en ella (Congreso, Despacho Presidencial…). Y por su DNI,
  --    como esElectoSql: las autoridades y los electos del JNE.
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
  DROP TABLE IF EXISTS _rp_ed;
  CREATE TEMP TABLE _rp_ed ON COMMIT DROP AS
    SELECT dni FROM jne_autoridades WHERE dni ~ '^[0-9]{8}$'
    UNION
    SELECT numero_documento FROM jne_candidaturas WHERE resultado = 'electo' AND numero_documento ~ '^[0-9]{8}$';
  CREATE INDEX ON _rp_ed (dni);
  ANALYZE _rp_ed;

  -- 1. Locadores: cada familiar declarado de sus tres señales, y si su caso se reserva (311). El declarante del nepotismo
  --    es de la misma entidad de la señal; el de las otras dos, de la que trae el familiar. (El caso inverso aquí no cambia
  --    nada en la base: la señal es del electo y la API la muestra reservada.)
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

  DELETE FROM persona_senal ps USING _rp_s s
   WHERE s.todos AND ps.entidad_ruc = s.entidad_ruc AND ps.ruc = s.ruc AND ps.tipo = s.tipo;
  GET DIAGNOSTICS n_fuera = ROW_COUNT;
  UPDATE persona_senal ps
     SET detalle = ps.detalle || jsonb_build_object('parientes', s.quedan)
                   || CASE WHEN s.tipo = 'familia_estado' THEN jsonb_build_object('entidades', s.entidades) ELSE '{}'::jsonb END
    FROM _rp_s s
   WHERE NOT s.todos AND ps.entidad_ruc = s.entidad_ruc AND ps.ruc = s.ruc AND ps.tipo = s.tipo;
  GET DIAGNOSTICS n_podadas = ROW_COUNT;

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

  -- 2. Planilla, el familiar declarado («pariente_planilla» en su fila). Los vínculos de la DJI de cada fila con la señal,
  --    por el nombre del familiar como lo escribe la planilla («PATERNO MATERNO NOMBRES», como refrescar_planilla_extra,
  --    migración 196): si el declarante es electo y si el familiar es electo (por su DNI).
  DROP TABLE IF EXISTS _rp_pp;
  CREATE TEMP TABLE _rp_pp ON COMMIT DROP AS
    SELECT entidad_ruc, nombre_norm FROM planilla_persona WHERE tipos && ARRAY['pariente_planilla'];
  CREATE INDEX ON _rp_pp (entidad_ruc, nombre_norm);
  ANALYZE _rp_pp;
  DROP TABLE IF EXISTS _rp_pv;
  CREATE TEMP TABLE _rp_pv ON COMMIT DROP AS
    SELECT DISTINCT x.entidad_ruc, x.pariente_pl, x.parentesco, x.grado,
           EXISTS (SELECT 1 FROM _rp_el e WHERE e.entidad_ruc = x.entidad_ruc AND e.nom = mef_norm(x.declarante_norm)) AS declarante_electo,
           x.pariente_doc IN (SELECT dni FROM _rp_ed) AS pariente_electo
      FROM (SELECT d.entidad_ruc, d.declarante_norm, d.parentesco, d.grado, d.pariente_doc,
                   array_to_string(d.w[array_length(d.w, 1) - 1:array_length(d.w, 1)] || d.w[1:array_length(d.w, 1) - 2], ' ') AS pariente_pl
              FROM (SELECT v.entidad_ruc, v.declarante_norm, v.parentesco, v.grado, v.pariente_doc,
                           regexp_split_to_array(v.pariente_norm, ' ') AS w
                      FROM dji_vinculos v
                     WHERE v.pariente_norm ~ '^\S+ \S+ \S+' AND v.pariente_norm ~ '^[A-ZÑ ]+$' AND v.declarante_norm IS NOT NULL
                       AND v.entidad_ruc IN (SELECT entidad_ruc FROM _rp_pp)) d) x
      JOIN _rp_pp p ON p.entidad_ruc = x.entidad_ruc AND p.nombre_norm = x.pariente_pl;
  CREATE INDEX ON _rp_pv (entidad_ruc, pariente_pl);
  ANALYZE _rp_pv;

  -- Cada funcionario de la señal: fuera si es el caso de la 311 (su cargo es de elección o el vínculo es de un declarante
  -- electo, y el parentesco destapa al familiar); reservado si el familiar de la fila es el electo (por su cargo, su nombre
  -- o su DNI) y el parentesco destapa al funcionario. La señal nueva, o NULL si no queda ninguno.
  DROP TABLE IF EXISTS _rp_pc;
  CREATE TEMP TABLE _rp_pc ON COMMIT DROP AS
    SELECT z.entidad_ruc, z.nombre_norm, z.ks,
           CASE WHEN z.quedan IS NULL THEN NULL ELSE jsonb_set(z.s, '{detalle,funcionarios}', z.quedan) END AS nueva
      FROM (SELECT y.entidad_ruc, y.nombre_norm, y.ks, (array_agg(y.s))[1] AS s,
                   jsonb_agg(CASE WHEN y.accion = 'reservar' THEN '{"reservado": true}'::jsonb ELSE y.f END ORDER BY y.kf)
                     FILTER (WHERE y.accion <> 'fuera') AS quedan
              FROM (SELECT p.entidad_ruc, p.nombre_norm, s.k AS ks, s.s, f.f, f.kf,
                           CASE WHEN f.f ? 'reservado' THEN 'queda'
                                WHEN NOT parentesco_publicable(f.f->>'parentesco')
                                     AND (cargo_de_eleccion(f.f->>'cargo')
                                          OR EXISTS (SELECT 1 FROM _rp_pv v
                                                      WHERE v.entidad_ruc = p.entidad_ruc AND v.pariente_pl = p.nombre_norm AND v.declarante_electo
                                                        AND v.parentesco IS NOT DISTINCT FROM f.f->>'parentesco'
                                                        AND v.grado IS NOT DISTINCT FROM f.f->>'grado')) THEN 'fuera'
                                WHEN NOT parentesco_inverso_publicable(f.f->>'parentesco')
                                     AND (cargo_de_eleccion(p.cargo)
                                          OR EXISTS (SELECT 1 FROM _rp_el e WHERE e.entidad_ruc = p.entidad_ruc AND e.nom = mef_norm(p.nombre_norm))
                                          OR EXISTS (SELECT 1 FROM _rp_pv v
                                                      WHERE v.entidad_ruc = p.entidad_ruc AND v.pariente_pl = p.nombre_norm AND v.pariente_electo))
                                     THEN 'reservar'
                                ELSE 'queda' END AS accion
                      FROM planilla_persona p
                      JOIN _rp_pp pp ON pp.entidad_ruc = p.entidad_ruc AND pp.nombre_norm = p.nombre_norm
                      CROSS JOIN LATERAL jsonb_array_elements(p.senales) WITH ORDINALITY s(s, k)
                      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.s->'detalle'->'funcionarios') = 'array'
                                                                   THEN s.s->'detalle'->'funcionarios' ELSE '[]'::jsonb END) WITH ORDINALITY f(f, kf)
                     WHERE s.s->>'tipo' = 'pariente_planilla') y
             GROUP BY y.entidad_ruc, y.nombre_norm, y.ks
            HAVING bool_or(y.accion <> 'queda')) z;

  -- 3. Planilla, el funcionario que declaró («pariente_locador» y «familiar_en_planilla» en su fila). Los vínculos de su
  --    DJI cuyo familiar es electo (por su DNI) con un parentesco que destapa al funcionario, y si ese familiar es locador de
  --    la entidad (el de «pariente_locador» lo es; el de «familiar_en_planilla» está en su planilla).
  DROP TABLE IF EXISTS _rp_vd;
  CREATE TEMP TABLE _rp_vd ON COMMIT DROP AS
    SELECT v.entidad_ruc, v.declarante_norm, v.parentesco, v.grado,
           EXISTS (SELECT 1 FROM persona_orden_anual po
                    WHERE po.entidad_ruc = v.entidad_ruc AND po.ruc BETWEEN '10' || v.pariente_doc || '0' AND '10' || v.pariente_doc || '9') AS locador
      FROM dji_vinculos v
     WHERE v.declarante_norm IS NOT NULL AND v.pariente_doc IN (SELECT dni FROM _rp_ed)
       AND NOT parentesco_inverso_publicable(v.parentesco);
  CREATE INDEX ON _rp_vd (entidad_ruc, declarante_norm);
  ANALYZE _rp_vd;

  -- Cada familiar de la señal:
  --   · el funcionario es electo (311): con un parentesco que destapa al familiar, o con el caso inverso, va reservado;
  --   · no lo es: el familiar electo con un parentesco que lo destapa a él sale.
  -- Con uno solo reservado, la señal no da sus sumas; si salió alguno, sus sumas son las de los que quedan.
  INSERT INTO _rp_pc (entidad_ruc, nombre_norm, ks, nueva)
  SELECT w.entidad_ruc, w.nombre_norm, w.ks, w.nueva
    FROM (SELECT z.entidad_ruc, z.nombre_norm, z.ks, z.s,
                 CASE WHEN z.parientes IS NULL THEN NULL
                      WHEN z.s->>'tipo' = 'pariente_locador' AND z.n_res = 1
                        THEN jsonb_set(jsonb_set(jsonb_set(z.s, '{detalle,parientes}', z.parientes), '{detalle,monto}', 'null'::jsonb),
                                       '{detalle,ordenes}', 'null'::jsonb)
                      WHEN z.s->>'tipo' = 'pariente_locador' AND z.n_fuera > 0
                        THEN jsonb_set(jsonb_set(jsonb_set(z.s, '{detalle,parientes}', z.parientes), '{detalle,monto}', to_jsonb(z.monto)),
                                       '{detalle,ordenes}', to_jsonb(z.ordenes))
                      ELSE jsonb_set(z.s, '{detalle,parientes}', z.parientes) END AS nueva
            FROM (SELECT y.entidad_ruc, y.nombre_norm, y.ks, (array_agg(y.s))[1] AS s,
                         count(*) FILTER (WHERE y.accion IN ('reservar', 'reservada'))::int AS n_res,
                         count(*) FILTER (WHERE y.accion = 'fuera')::int AS n_fuera,
                         jsonb_agg(CASE WHEN y.accion IN ('reservar', 'reservada') THEN '{"reservado": true}'::jsonb ELSE y.e END ORDER BY y.ke)
                           FILTER (WHERE y.accion <> 'fuera') AS parientes,
                         COALESCE(sum((y.e->>'monto')::numeric) FILTER (WHERE y.accion = 'queda'), 0) AS monto,
                         COALESCE(sum((y.e->>'ordenes')::numeric) FILTER (WHERE y.accion = 'queda'), 0)::int AS ordenes
                    FROM (SELECT x.*,
                                 CASE WHEN x.e ? 'reservado' THEN 'reservada'
                                      WHEN x.electo AND (NOT parentesco_publicable(x.e->>'parentesco') OR x.inverso) THEN 'reservar'
                                      WHEN NOT x.electo AND x.inverso THEN 'fuera'
                                      ELSE 'queda' END AS accion
                            FROM (SELECT p.entidad_ruc, p.nombre_norm, s.k AS ks, s.s, e.e, e.ke,
                                         cargo_de_eleccion(p.cargo)
                                           OR EXISTS (SELECT 1 FROM _rp_el el WHERE el.entidad_ruc = p.entidad_ruc AND el.nom = mef_norm(p.nombre_norm)) AS electo,
                                         NOT parentesco_inverso_publicable(e.e->>'parentesco')
                                           AND ((s.s->>'tipo' = 'familiar_en_planilla' AND cargo_de_eleccion(e.e->>'cargo'))
                                                OR EXISTS (SELECT 1 FROM _rp_vd v
                                                            WHERE v.entidad_ruc = p.entidad_ruc AND v.declarante_norm = p.nombre_norm
                                                              AND v.parentesco IS NOT DISTINCT FROM e.e->>'parentesco'
                                                              AND v.grado IS NOT DISTINCT FROM e.e->>'grado'
                                                              AND (v.locador OR s.s->>'tipo' = 'familiar_en_planilla'))) AS inverso
                                    FROM planilla_persona p
                                    CROSS JOIN LATERAL jsonb_array_elements(p.senales) WITH ORDINALITY s(s, k)
                                    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.s->'detalle'->'parientes') = 'array'
                                                                                 THEN s.s->'detalle'->'parientes' ELSE '[]'::jsonb END) WITH ORDINALITY e(e, ke)
                                   WHERE p.tipos && ARRAY['pariente_locador', 'familiar_en_planilla']
                                     AND s.s->>'tipo' IN ('pariente_locador', 'familiar_en_planilla')) x) y
                   GROUP BY y.entidad_ruc, y.nombre_norm, y.ks
                  HAVING bool_or(y.accion <> 'queda')) z) w
   -- Lo ya reservado en una corrida anterior vuelve igual: sólo se reescribe la señal que cambia.
   WHERE w.nueva IS DISTINCT FROM w.s;
  SELECT count(*) INTO n_pla_fuera FROM _rp_pc WHERE nueva IS NULL;

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
  RAISE NOTICE 'reserva: planilla, % filas tocadas (% señales fuera) (% s)', n_planilla, n_pla_fuera,
    round(extract(epoch FROM clock_timestamp() - t0));
  RETURN n_fuera + n_podadas + n_planilla;
END $$;
ALTER FUNCTION refrescar_reserva_parientes() OWNER TO vigia_jobs;
REVOKE ALL ON FUNCTION refrescar_reserva_parientes() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_agentes') THEN
    REVOKE ALL ON FUNCTION refrescar_reserva_parientes() FROM vigia_agentes;
  END IF;
END $$;

-- La primera vez: los pares con su marca y la planilla. persona_senal no cambia (el caso inverso de los locadores lo
-- reserva la API), así que el resumen de personas tampoco.
SET statement_timeout = '1800s';
SELECT refrescar_dji_nepotismo_pares() AS pares;
SELECT refrescar_reserva_parientes() AS reserva_parientes;
RESET statement_timeout;
