-- 179 · Cinco señales nuevas de personas y planilla (auditoría del 2026-10-27: «qué señales colocar»). Medidas en producción
-- antes de escribirlas:
--   · doble_planilla (planilla, alta o media): el mismo nombre (cuatro palabras o más, en a lo más dos entidades, las dos
--     del mismo departamento) cobra sueldo en las dos el mismo mes, dos meses o más. Cobrar dos remuneraciones del Estado
--     está prohibido salvo por docencia y dietas de directorio (Ley 28175, art. 3). Medido en DEV: de 3,907 filas, casi
--     todas eran otra cosa y ahora quedan fuera: médicos residentes e internos (la sede y la entidad que paga la plaza),
--     docentes universitarios con categorías que no dicen «docente» (AUXILIAR TIEMPO PARCIAL, TC3, FACULTAD), miembros de
--     los Jurados Electorales Especiales, gerentes públicos de SERVIR y el mismo puesto declarado por un pliego y por su
--     unidad ejecutora (el MINSA y su DIRIS). Es por nombre (la planilla no trae DNI): fuera los apellidos muy comunes (más
--     de 30 personas con los mismos dos apellidos); alta sólo con apellidos poco comunes (10 o menos) y tres meses o más.
--   · socio_proveedor (planilla, alta): trabaja en la entidad y es socio, representante o directivo (RNP) de una empresa
--     que le vende a esa misma entidad. Por nombre (la planilla no trae DNI), sólo si el nombre es de una sola persona en
--     el RNP. 1,362 personas.
--   · pariente_locador (planilla, alta): declaró en su DJI a un pariente que es locador de su misma entidad. Ya se veía en
--     la fila (dji_nepotismo), pero fuera del sistema de señales: «Con señal alta» no lo contaba.
--   · nepotismo_gobierno (personas, media): un funcionario de OTRA entidad del mismo gobierno (el regional y sus UGEL y
--     hospitales, la municipalidad y sus empresas) lo declaró como pariente en su DJI. 703 en producción (2026-10-27).
--   · al_borde_del_tope (personas, media): de las órdenes de servicio que le dio la entidad, la mitad o más (y tres o más)
--     quedaron entre el 95 % y el 100 % del tope de 8 UIT de su año: justo debajo del monto que obliga a un proceso. En
--     2025 hubo 58 mil órdenes en esa franja contra 33 mil entre el 90 % y el 95 %: se acumulan bajo el tope. El tope es
--     el que dice la orden («hasta 8 UIT»; «hasta 9 UIT» con el D.U. 016-2022, 7,296 órdenes de 2022 en la franja); sin el
--     dato, 8 UIT, salvo en 2022, cuando pudo ser cualquiera de los dos (esas no se cuentan).
--
-- refrescar_senales_extra(): paso aparte, después de refrescar_senales_politicas() (migración 177) en los Workers
-- conosce_ordenes y pte_personal. Rehace estos tipos y parcha persona_entidad, planilla_persona y planilla_resumen.
-- Privacidad: el pariente nunca aparece (ni su nombre ni su documento); del funcionario, como en el nepotismo, su cargo y
-- su nombre (que la web reduce al primer apellido). Indicios para revisar, no acusaciones.
--
-- Cómo aplicarla: python infrastructure/dev/dev.py migrar backend/db/migrations/179_mas_senales.sql (DEV) y luego
-- SELECT refrescar_senales_extra(); refrescar_personas_resumen(); en producción, lo mismo con tunel_rds.

-- La franja de montos de «al borde del tope» (95-100 % de 8 UIT de algún año, órdenes de servicio a personas): un índice
-- parcial chico (en producción se crea con CONCURRENTLY antes de aplicar el resto, para no frenar las cargas).
CREATE INDEX IF NOT EXISTS conosce_ordenes_borde_tope ON conosce_ordenes (entidad_ruc, ruc_contratista)
  WHERE tipo_orden = 'Orden de Servicio' AND monto >= 31540 AND monto < 44000 AND ruc_contratista LIKE '10%';

CREATE OR REPLACE FUNCTION refrescar_senales_extra() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int := 0; n_per int := 0; n_pla int := 0; t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_senales_extra'));
  SET LOCAL work_mem = '256MB';

  -- ══ Personas (locadores) ══════════════════════════════════════════════════════════════════════════════════════════
  CREATE TEMP TABLE _xpar ON COMMIT DROP AS
    SELECT DISTINCT entidad_ruc, ruc FROM persona_senal WHERE tipo IN ('nepotismo_gobierno', 'al_borde_del_tope');
  DELETE FROM persona_senal WHERE tipo IN ('nepotismo_gobierno', 'al_borde_del_tope');

  -- 1. nepotismo_gobierno: el pariente declarado (por su DNI) es locador de otra entidad del mismo gobierno. Si en esa
  --    entidad ya tiene la señal «nepotismo» (lo declaró alguien de ahí mismo), no se repite.
  CREATE TEMP TABLE _xdni ON COMMIT DROP AS
    SELECT DISTINCT pariente_doc FROM dji_vinculos WHERE length(pariente_doc) = 8;
  CREATE TEMP TABLE _xloc ON COMMIT DROP AS
    SELECT entidad_ruc, ruc, substr(ruc, 3, 8) AS dni, sum(ordenes)::int AS ordenes, sum(monto) AS monto, min(anio) AS desde, max(anio) AS hasta
      FROM persona_orden_anual
     WHERE ruc LIKE '10%' AND substr(ruc, 3, 8) IN (SELECT pariente_doc FROM _xdni)
     GROUP BY entidad_ruc, ruc;
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT l.entidad_ruc, l.ruc, 'nepotismo_gobierno', 'media',
         jsonb_build_object(
           'parientes', jsonb_agg(DISTINCT jsonb_build_object('declarante', v.declarante_norm, 'cargo', f.cargo, 'grado', v.grado,
                                                              'parentesco', v.parentesco, 'entidad_ruc', v.entidad_ruc, 'entidad', v.entidad)),
           'nivel', max(g2.nivel), 'ordenes', max(l.ordenes), 'monto', max(l.monto), 'desde', min(l.desde), 'hasta', max(l.hasta)),
         'dji_contraloria', 'https://appdji.contraloria.gob.pe/DJIC/'
    FROM _xloc l
    JOIN dji_vinculos v ON v.pariente_doc = l.dni AND v.entidad_ruc <> l.entidad_ruc
    JOIN entidad_gobierno_amplia g1 ON g1.ruc = v.entidad_ruc
    JOIN entidad_gobierno_amplia g2 ON g2.ruc = l.entidad_ruc AND g2.nivel = g1.nivel AND g2.ubigeo = g1.ubigeo
    LEFT JOIN LATERAL (SELECT fc.cargo FROM dji_funcionarios fc WHERE fc.codigo_ddjj = v.codigo_ddjj AND fc.cargo IS NOT NULL
                        ORDER BY fc.fecha_inicio_cargo DESC NULLS LAST LIMIT 1) f ON true
   WHERE NOT EXISTS (SELECT 1 FROM persona_senal n WHERE n.entidad_ruc = l.entidad_ruc AND n.ruc = l.ruc AND n.tipo = 'nepotismo')
   GROUP BY l.entidad_ruc, l.ruc;
  GET DIAGNOSTICS n = ROW_COUNT;
  n_per := n;
  RAISE NOTICE 'senales extra: nepotismo en el mismo gobierno % (% s)', n, round(extract(epoch FROM clock_timestamp() - t0));

  -- 2. al_borde_del_tope: las órdenes de servicio a personas en la franja de montos donde puede caer el 95-100 % del tope
  --    de algún año (de 0,95 × 8 × S/ 4,150 a 8 × S/ 5,500), por su índice parcial (conosce_ordenes_borde_tope, abajo),
  --    una vez cada una; después, la franja exacta de su año. Recorrer las órdenes de cada persona una por una tardaba más
  --    de 20 minutos en frío.
  CREATE TEMP TABLE _xord ON COMMIT DROP AS
    SELECT o.entidad_ruc, o.ruc, o.fecha_emision, o.nro_orden, o.monto, o.tope
      FROM (SELECT DISTINCT ON (x.entidad_ruc, x.ruc_contratista, x.orden, x.fecha_emision)
                   x.entidad_ruc, x.ruc_contratista AS ruc, x.fecha_emision, x.nro_orden, x.monto,
                   -- El tope que dice la orden («hasta 8 UIT»; «hasta 9 UIT» con el D.U. 016-2022); sin el dato, 8 UIT,
                   -- salvo en 2022, cuando pudo ser cualquiera de los dos (sin tope, no se cuenta).
                   CASE WHEN x.tipo_contratacion ~ 'hasta [0-9]+ UIT'
                          THEN substring(x.tipo_contratacion FROM 'hasta ([0-9]+) UIT')::int * uit_soles(extract(year FROM x.fecha_emision)::int)
                        WHEN extract(year FROM x.fecha_emision) <> 2022 THEN 8 * uit_soles(extract(year FROM x.fecha_emision)::int)
                   END AS tope
              FROM conosce_ordenes x
             WHERE x.tipo_orden = 'Orden de Servicio' AND x.monto >= 31540 AND x.monto < 44000
               AND x.ruc_contratista LIKE '10%' AND x.estado IS DISTINCT FROM 'Anulada' AND x.monto_dudoso IS NULL
               AND x.fecha_emision >= DATE '2018-01-01'
             ORDER BY x.entidad_ruc, x.ruc_contratista, x.orden, x.fecha_emision, x.anio DESC, x.mes DESC) o
     WHERE o.monto >= 0.95 * o.tope AND o.monto < o.tope;
  -- El denominador: todas las órdenes que la entidad le dio (persona_orden_anual), sólo de los pares con alguna en la franja.
  CREATE TEMP TABLE _xcand ON COMMIT DROP AS
    SELECT a.entidad_ruc, a.ruc, sum(a.ordenes)::int AS ordenes
      FROM persona_orden_anual a JOIN (SELECT DISTINCT entidad_ruc, ruc FROM _xord) b ON b.entidad_ruc = a.entidad_ruc AND b.ruc = a.ruc
     GROUP BY a.entidad_ruc, a.ruc;
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT b.entidad_ruc, b.ruc, 'al_borde_del_tope', 'media',
         jsonb_build_object('en_el_borde', count(*), 'ordenes', max(c.ordenes), 'monto', sum(b.monto),
                            -- Cada orden de la franja, con su tope de ese año: la evidencia las cita una por una.
                            'citadas', jsonb_agg(jsonb_build_object('fecha', b.fecha_emision, 'numero', b.nro_orden, 'monto', b.monto, 'tope', b.tope)
                                                 ORDER BY b.fecha_emision DESC)),
         'conosce_ordenes', 'https://www.gob.pe/oece'
    FROM _xord b JOIN _xcand c ON c.entidad_ruc = b.entidad_ruc AND c.ruc = b.ruc
   GROUP BY b.entidad_ruc, b.ruc
  HAVING count(*) >= 3 AND count(*) >= 0.5 * max(c.ordenes);
  GET DIAGNOSTICS n = ROW_COUNT;
  n_per := n_per + n;
  RAISE NOTICE 'senales extra: al borde del tope % (% s)', n, round(extract(epoch FROM clock_timestamp() - t0));

  -- 3. El resumen de cada par tocado (antes y después), desde persona_senal.
  INSERT INTO _xpar SELECT DISTINCT entidad_ruc, ruc FROM persona_senal WHERE tipo IN ('nepotismo_gobierno', 'al_borde_del_tope');
  CREATE TEMP TABLE _xpar2 ON COMMIT DROP AS SELECT DISTINCT entidad_ruc, ruc FROM _xpar;
  UPDATE persona_entidad pe SET tipos = '{}', senales = '[]', n_senales = 0, sev = 0
    FROM _xpar2 p WHERE pe.entidad_ruc = p.entidad_ruc AND pe.ruc = p.ruc;
  UPDATE persona_entidad pe
     SET tipos = s.tipos, senales = s.senales, n_senales = s.n, sev = s.sev
    FROM (SELECT ps.entidad_ruc, ps.ruc, array_agg(ps.tipo ORDER BY ps.tipo) AS tipos, count(*)::int AS n,
                 max(CASE ps.severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END)::smallint AS sev,
                 jsonb_agg(jsonb_build_object('tipo', ps.tipo, 'severidad', ps.severidad)
                           ORDER BY CASE ps.severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, ps.tipo) AS senales
            FROM persona_senal ps JOIN _xpar2 p ON p.entidad_ruc = ps.entidad_ruc AND p.ruc = ps.ruc
           GROUP BY ps.entidad_ruc, ps.ruc) s
   WHERE pe.entidad_ruc = s.entidad_ruc AND pe.ruc = s.ruc;

  -- ══ Planilla ══════════════════════════════════════════════════════════════════════════════════════════════════════
  CREATE TEMP TABLE _xps (entidad_ruc text, nombre_norm text, tipo text, severidad text, detalle jsonb) ON COMMIT DROP;

  -- 4. doble_planilla: el mismo nombre con sueldo en dos entidades del mismo departamento el mismo mes, dos meses o más.
  --    Nombres de cuatro palabras o más que están en a lo más dos entidades. Fuera lo que no es un doble sueldo: la
  --    docencia y las dietas (la excepción de la ley), el residentado y el internado, los jurados electorales, los
  --    gerentes públicos de SERVIR y el mismo puesto declarado por un pliego y por su unidad ejecutora.
  -- Cuántas personas comparten los dos apellidos (las dos primeras palabras: la planilla escribe «APELLIDOS NOMBRES»):
  -- con apellidos muy comunes, el mismo nombre completo en dos entidades suele ser de dos personas.
  CREATE TEMP TABLE _xap ON COMMIT DROP AS
    SELECT split_part(nombre_norm, ' ', 1) || ' ' || split_part(nombre_norm, ' ', 2) AS par, count(DISTINCT nombre_norm)::int AS f
      FROM planilla_persona GROUP BY 1;
  -- Los nombres que hoy figuran en dos planillas del mismo departamento (el último mes de cada entidad, planilla_persona)
  -- y, de ellos, sus meses en toda la historia cargada (planilla_pte por su índice de nombre). Recorrer los 10 millones
  -- de filas de la historia buscando pares era lo lento.
  CREATE TEMP TABLE _xpn0 ON COMMIT DROP AS
    SELECT p.nombre_norm, max(ap.f) AS f
      FROM planilla_persona p
      JOIN _xap ap ON ap.par = split_part(p.nombre_norm, ' ', 1) || ' ' || split_part(p.nombre_norm, ' ', 2) AND ap.f <= 30
     WHERE p.nombre_norm ~ '^\S+ \S+ \S+ \S+'
     GROUP BY p.nombre_norm
    HAVING count(DISTINCT p.entidad_ruc) = 2 AND count(DISTINCT p.dep) = 1 AND bool_and(p.dep IS NOT NULL)
       AND NOT bool_or(COALESCE(p.entidad, '') ~* '(UNIVERSIDAD|INSTITUTO (DE EDUCACI.N )?SUPERIOR|INSTITUTO PEDAG|ESCUELA|JURADO|SERVICIO CIVIL)');
  CREATE TEMP TABLE _xpm ON COMMIT DROP AS
    SELECT DISTINCT p.entidad_ruc, p.nombre_norm, p.anio, p.mes, upper(COALESCE(p.cargo, '')) AS cargo,
           COALESCE(p.remuneraciones, 0) + COALESCE(p.honorarios, 0) AS base
      FROM planilla_pte p JOIN _xpn0 n ON n.nombre_norm = p.nombre_norm
     WHERE COALESCE(p.remuneraciones, 0) + COALESCE(p.honorarios, 0) > 0;
  -- Los cargos que no son un doble sueldo, en cualquiera de los meses de las dos entidades. Las universidades escriben la
  -- categoría del docente sin decir «docente» (AUXILIAR TIEMPO PARCIAL, TC3, ASOCIADO, CONTRATO «B»); los hospitales, la
  -- plaza del residente («0365-MEDICO RES. 1ER AÑO»).
  CREATE TEMP TABLE _xpn ON COMMIT DROP AS
    SELECT m.nombre_norm, max(n0.f) AS f
      FROM _xpm m JOIN _xpn0 n0 ON n0.nombre_norm = m.nombre_norm
     GROUP BY m.nombre_norm
    HAVING count(DISTINCT m.entidad_ruc) = 2
       AND NOT bool_or(m.cargo ~ '(DOCENTE|PROFESOR|CATEDR|MAESTR|EDUCACI|DOCENCIA|AUXILIAR (DE )?(EDUCACI|TIEMPO|[0-9]|T\.? ?C)|TIEMPO PARCIAL|TIEMPO COMPLETO|DEDICACI.N EXCLUSIVA|FACULTAD|^T[CP] ?[0-9]|(^|-)(ASOCIADO|PRINCIPAL)\M|JEFE DE PR.CTICA|CONTRATO .?[AB]\M|M.DICO RES|RESIDENTADO|(^|-)RESIDENTE$|RES\. ?[0-9]|SERUMS|(^|-)INTERNO|INTERNADO|\mJEE\M|JURADO|DIRECTORIO|DIETA|GERENTE P.BLICO)');
  -- El pliego de cada entidad (la OECE da su unidad ejecutora, migración 150; el MEF, el pliego de esa unidad): el MINSA y
  -- su DIRIS, o un gobierno regional y su hospital, declaran a veces el mismo puesto.
  CREATE TEMP TABLE _xpl ON COMMIT DROP AS
    SELECT DISTINCT ON (s.ruc) s.ruc::text AS ruc, m.sector || '-' || m.pliego AS pliego
      FROM entidad_siaf s JOIN mef_ejecutora_anual m ON m.sec_ejec ~ '^[0-9]+$' AND m.sec_ejec::int = s.sec_ejec
     WHERE COALESCE(m.pliego, '') <> ''
     ORDER BY s.ruc, m.anio DESC;
  INSERT INTO _xps
  SELECT a.entidad_ruc, a.nombre_norm, 'doble_planilla',
         -- Alta con apellidos poco comunes (10 personas o menos con los mismos dos) y tres meses o más; si no, media.
         CASE WHEN max(n.f) <= 10 AND count(DISTINCT (a.anio, a.mes)) >= 3 THEN 'alta' ELSE 'media' END,
         jsonb_build_object('meses', jsonb_agg(DISTINCT to_char(make_date(a.anio, a.mes, 1), 'YYYY-MM')),
                            'otra_entidad_ruc', max(b.entidad_ruc), 'otra_entidad', max(COALESCE(e.nombre, d.nombre)),
                            'otro_cargo', max(b.cargo), 'otra_base', max(b.base), 'cargo', max(a.cargo), 'base', max(a.base))
    FROM _xpm a
    JOIN _xpn n ON n.nombre_norm = a.nombre_norm
    JOIN _xpm b ON b.nombre_norm = a.nombre_norm AND b.anio = a.anio AND b.mes = a.mes AND b.entidad_ruc <> a.entidad_ruc
    LEFT JOIN _xpl pa ON pa.ruc = a.entidad_ruc
    LEFT JOIN _xpl pb ON pb.ruc = b.entidad_ruc
    LEFT JOIN entidades e ON e.ruc::text = b.entidad_ruc
    LEFT JOIN LATERAL (SELECT dd.nombre FROM pte_directorio dd WHERE dd.ruc = b.entidad_ruc ORDER BY dd.id_pte LIMIT 1) d ON true
   WHERE pa.pliego IS NULL OR pb.pliego IS NULL OR pa.pliego <> pb.pliego
   GROUP BY a.entidad_ruc, a.nombre_norm
  HAVING count(DISTINCT (a.anio, a.mes)) >= 2;
  RAISE NOTICE 'senales extra: doble planilla (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- 5. socio_proveedor: socio, representante o directivo (RNP) de una empresa que le vende a su misma entidad. Por
  --    nombre único en el RNP (un solo DNI con ese nombre), tres palabras o más.
  CREATE TEMP TABLE _xrnp ON COMMIT DROP AS
    SELECT DISTINCT mef_norm(r.nombre) AS nom_n, r.numero_documento AS dni, r.ruc_empresa::text AS ruc, r.tipo_rol
      FROM rnp_conformacion_juridica r
     WHERE r.tipo_documento LIKE 'DOC. NACIONAL%' AND r.numero_documento ~ '^\d{8}$' AND r.ruc_empresa::text ~ '^20\d{9}$';
  CREATE TEMP TABLE _xrnu ON COMMIT DROP AS
    SELECT nom_n FROM _xrnp GROUP BY nom_n HAVING count(DISTINCT dni) = 1;
  CREATE TEMP TABLE _xven ON COMMIT DROP AS
    SELECT ruc, entidad_ruc, sum(monto) AS monto, min(anio) AS desde, max(anio) AS hasta FROM (
      SELECT ruc, entidad_ruc, monto, anio FROM empresa_orden_anual
      UNION ALL
      SELECT a.ruc_proveedor, a.entidad_ruc::text, CASE WHEN a.moneda IN ('Soles', 'Nuevos Soles') THEN a.monto_adjudicado ELSE 0 END,
             extract(year FROM a.fecha_buenapro)::int
        FROM conosce_adjudicaciones a WHERE a.ruc_proveedor ~ '^20\d{9}$') v
     GROUP BY ruc, entidad_ruc;
  CREATE INDEX ON _xven (ruc, entidad_ruc);
  -- Una fila por persona, entidad y empresa (sus roles juntos), y después una señal por persona y entidad.
  INSERT INTO _xps
  WITH pe AS (
    SELECT p.entidad_ruc, p.nombre_norm, p.primer_mes, r.ruc, string_agg(DISTINCT r.tipo_rol, ', ' ORDER BY r.tipo_rol) AS rol,
           max(v.monto) AS monto, max(v.desde) AS desde, max(v.hasta) AS hasta
      FROM planilla_persona p
      JOIN _xrnu u ON u.nom_n = p.nombre_norm
      JOIN _xrnp r ON r.nom_n = p.nombre_norm
      JOIN _xven v ON v.ruc = r.ruc AND v.entidad_ruc = p.entidad_ruc
     WHERE p.nombre_norm ~ '^\S+ \S+ \S+'
     GROUP BY p.entidad_ruc, p.nombre_norm, p.primer_mes, r.ruc)
  SELECT pe.entidad_ruc, pe.nombre_norm, 'socio_proveedor',
         -- Alta si le vendió mientras la persona estaba en la planilla (su primer año en ella o después); media si fue antes.
         CASE WHEN max(pe.hasta) >= extract(year FROM min(pe.primer_mes)) THEN 'alta' ELSE 'media' END,
         jsonb_build_object('empresas', jsonb_agg(jsonb_build_object('ruc', pe.ruc, 'nombre', er.nombre, 'rol', pe.rol,
                                                                     'monto', pe.monto, 'desde', pe.desde, 'hasta', pe.hasta) ORDER BY pe.monto DESC NULLS LAST),
                            'monto', sum(pe.monto), 'primer_mes', min(pe.primer_mes))
    FROM pe LEFT JOIN empresa_resumen er ON er.ruc = pe.ruc
   GROUP BY pe.entidad_ruc, pe.nombre_norm;
  RAISE NOTICE 'senales extra: socio de un proveedor (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- 6. pariente_locador: el funcionario que declaró en su DJI a un pariente que es locador de su misma entidad (la vista
  --    dji_nepotismo, migración 137). Del pariente, sólo el parentesco y lo que cobró: nunca quién es.
  INSERT INTO _xps
  SELECT n.entidad_ruc, n.declarante_norm, 'pariente_locador', 'alta',
         jsonb_build_object('parientes', jsonb_agg(jsonb_build_object('grado', n.grado, 'parentesco', n.parentesco, 'ordenes', n.ordenes,
                                                                     'monto', n.monto, 'desde', n.desde, 'hasta', n.hasta)),
                            'monto', sum(n.monto), 'ordenes', sum(n.ordenes))
    FROM dji_nepotismo n
    JOIN planilla_persona p ON p.entidad_ruc = n.entidad_ruc AND p.nombre_norm = n.declarante_norm
   GROUP BY n.entidad_ruc, n.declarante_norm;

  -- 7. Las filas de la planilla tocadas: se quitan estos tipos (de una corrida anterior) y se agregan los nuevos.
  CREATE TEMP TABLE _xptoc ON COMMIT DROP AS
    SELECT entidad_ruc, nombre_norm FROM planilla_persona
     WHERE tipos && ARRAY['doble_planilla', 'socio_proveedor', 'pariente_locador']
    UNION SELECT entidad_ruc, nombre_norm FROM _xps;
  UPDATE planilla_persona p
     SET senales = x.senales, tipos = x.tipos, n_senales = x.n, sev = x.sev
    FROM (
      SELECT t.entidad_ruc, t.nombre_norm,
             COALESCE(jsonb_agg(e.s ORDER BY CASE e.s->>'severidad' WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, e.s->>'tipo')
                        FILTER (WHERE e.s IS NOT NULL), '[]'::jsonb) AS senales,
             COALESCE(array_agg(DISTINCT e.s->>'tipo') FILTER (WHERE e.s IS NOT NULL), '{}') AS tipos,
             count(e.s)::int AS n,
             COALESCE(max(CASE e.s->>'severidad' WHEN 'alta' THEN 3 WHEN 'media' THEN 2 WHEN 'baja' THEN 1 END), 0)::smallint AS sev
        FROM _xptoc t
        JOIN planilla_persona pp ON pp.entidad_ruc = t.entidad_ruc AND pp.nombre_norm = t.nombre_norm
        LEFT JOIN LATERAL (
          SELECT s FROM jsonb_array_elements(pp.senales) s WHERE s->>'tipo' NOT IN ('doble_planilla', 'socio_proveedor', 'pariente_locador')
          UNION ALL
          SELECT jsonb_build_object('tipo', n.tipo, 'severidad', n.severidad, 'detalle', n.detalle)
            FROM _xps n WHERE n.entidad_ruc = t.entidad_ruc AND n.nombre_norm = t.nombre_norm
        ) e ON true
       GROUP BY t.entidad_ruc, t.nombre_norm) x
   WHERE p.entidad_ruc = x.entidad_ruc AND p.nombre_norm = x.nombre_norm;
  GET DIAGNOSTICS n_pla = ROW_COUNT;

  -- 8. El resumen de cada alcance de la planilla (como al final de refrescar_planilla(), migración 108).
  CREATE TEMP TABLE _xprb ON COMMIT DROP AS
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
            FROM _xprb GROUP BY alcance) t
    LEFT JOIN (SELECT alcance, jsonb_agg(jsonb_build_object('tipo', tipo, 'n', c) ORDER BY c DESC) AS l
                 FROM (SELECT alcance, tipo, count(*)::int AS c FROM _xprb, unnest(_xprb.tipos) tipo GROUP BY 1, 2) z GROUP BY alcance) ps
           ON ps.alcance = t.alcance
    LEFT JOIN (SELECT alcance, jsonb_agg(jsonb_build_object('regimen', regimen, 'n', c) ORDER BY c DESC) AS l
                 FROM (SELECT alcance, regimen, count(*)::int AS c FROM _xprb GROUP BY 1, 2) z GROUP BY alcance) pr
           ON pr.alcance = t.alcance;
  RAISE NOTICE 'senales extra: % filas de planilla tocadas (% s)', n_pla, round(extract(epoch FROM clock_timestamp() - t0));
  RETURN n_per + n_pla;
END $$;
ALTER FUNCTION refrescar_senales_extra() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_senales_extra() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refrescar_senales_extra() TO vigia_jobs;
