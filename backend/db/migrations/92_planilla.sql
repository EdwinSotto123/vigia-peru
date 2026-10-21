-- 92 · Planilla del Estado: el personal que cada entidad publica en su Portal de Transparencia Estándar (PTE,
--      transparencia.gob.pe, rubro "Personal"), mes a mes y por régimen: CAS, 276, 728, altos funcionarios, Ley Servir…
--      Con su nombre, cargo, oficina y lo que cobra (sin DNI). Lo carga la fuente `pte_personal` de vigia-scrapers.
--
-- Para qué (pedido del 2026-10-21: nepotismo, brechas salariales, direccionamiento de plazas):
--   · planilla_persona: cada persona en cada entidad (por su nombre completo), con su último cargo y sueldo, y sus
--     señales:
--       tambien_ordenes      alta   está en la planilla y además recibe órdenes de servicio de la misma entidad el mismo
--                                   mes (cobrar dos veces del Estado está prohibido salvo docencia)
--       candidato_gobierna   alta   fue candidato del partido que gobierna la entidad (por nombre y departamento)
--       brecha_cargo         media  cobra el doble o más que la mediana de su mismo cargo en la entidad (con 5 o más)
--       apellidos_autoridad  media  tiene los dos apellidos de una autoridad del gobierno de la entidad (baja si comunes)
--       apellidos_directivo  media  tiene los dos apellidos, poco comunes, de un directivo de la misma planilla
--       antes_locador        baja   fue locador (órdenes de servicio) de la entidad antes de entrar a la planilla
--   · cargo_referencia: lo que se paga por cargo en cada entidad y mes (mediana, cuartiles), para la brecha.
--   · senales_planilla_de_personas(): lo mismo visto desde las órdenes (persona_senal, migración 91):
--       tambien_planilla  alta  recibe órdenes de una entidad en cuya planilla está ese mes
--       paso_a_planilla   baja  después de sus órdenes entró a la planilla de la entidad
--     La llama refrescar_personas_senales() antes de armar su resumen.
--
-- El PTE no trae DNI: todo cruce de la planilla es por nombre completo (apellidos y nombres normalizados), dentro de la
-- misma entidad o del mismo departamento. No se cargan los pensionistas (régimen 8).
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/92_planilla.sql
-- (después de la 91). La carga: POST /correr {"fuente":"pte_personal"} en vigia-scrapers (los dos últimos meses; con
-- desde/hasta AAAA-MM, ese rango). Corre sola el día 20 de cada mes.

-- ── 1 · Tablas ─────────────────────────────────────────────────────────────────────────────────
-- Qué id tiene cada entidad en el PTE (su buscador por nombre). id_pte NULL: no se encontró; se vuelve a buscar a los
-- 60 días.
CREATE TABLE IF NOT EXISTS pte_entidad (
  ruc        TEXT PRIMARY KEY,
  id_pte     INT,
  nombre_pte TEXT,
  buscado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS planilla_pte (
  id_pte_personal BIGINT PRIMARY KEY,      -- PK_ID_PERSONAL del portal
  entidad_ruc     TEXT NOT NULL,           -- VC_PERSONAL_RUC_ENTIDAD
  anio            SMALLINT NOT NULL,
  mes             SMALLINT NOT NULL,
  regimen         SMALLINT,                -- 1 CAS, 2 276, 3 728/otros, 4 PAC, 5 FAG, 6 PNUD, 7 altos funcionarios, 9 Ley Servir
  paterno         TEXT,
  materno         TEXT,
  nombres         TEXT,
  cargo           TEXT,
  dependencia     TEXT,
  remuneraciones  NUMERIC(14, 2),
  honorarios      NUMERIC(14, 2),
  incentivo       NUMERIC(14, 2),
  gratificacion   NUMERIC(14, 2),
  otros           NUMERIC(14, 2),
  total           NUMERIC(14, 2),
  observaciones   TEXT,
  nombre_norm     TEXT GENERATED ALWAYS AS (mef_norm(COALESCE(paterno, '') || ' ' || COALESCE(materno, '') || ' ' || COALESCE(nombres, ''))) STORED,
  cargado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS planilla_pte_mes ON planilla_pte (entidad_ruc, anio, mes);
CREATE INDEX IF NOT EXISTS planilla_pte_nombre ON planilla_pte (nombre_norm);

CREATE TABLE IF NOT EXISTS cargo_referencia (
  entidad_ruc TEXT NOT NULL,
  anio        SMALLINT NOT NULL,
  mes         SMALLINT NOT NULL,
  cargo       TEXT NOT NULL,               -- mef_norm(cargo)
  personas    INT NOT NULL,
  mediana     NUMERIC(14, 2),
  p25         NUMERIC(14, 2),
  p75         NUMERIC(14, 2),
  maximo      NUMERIC(14, 2),
  PRIMARY KEY (entidad_ruc, anio, mes, cargo)
);

CREATE TABLE IF NOT EXISTS planilla_persona (
  entidad_ruc  TEXT NOT NULL,
  nombre_norm  TEXT NOT NULL,
  paterno      TEXT,
  materno      TEXT,
  nombres      TEXT,
  entidad      TEXT,
  dep          TEXT,
  regimen      SMALLINT,                   -- el del último mes
  cargo        TEXT,
  dependencia  TEXT,
  total        NUMERIC(14, 2),             -- lo del último mes
  meses        INT NOT NULL,
  primer_mes   DATE,
  ultimo_mes   DATE,
  tipos        TEXT[] NOT NULL DEFAULT '{}',
  senales      JSONB NOT NULL DEFAULT '[]', -- [{tipo, severidad, detalle}], de la más grave a la menos
  n_senales    INT NOT NULL DEFAULT 0,
  sev          SMALLINT NOT NULL DEFAULT 0,
  codigo       TEXT,                       -- persona_codigo de sus órdenes, si también es locador (para enlazar su ficha)
  PRIMARY KEY (entidad_ruc, nombre_norm)
);
CREATE INDEX IF NOT EXISTS planilla_persona_orden ON planilla_persona (entidad_ruc, sev DESC, n_senales DESC, total DESC);
CREATE INDEX IF NOT EXISTS planilla_persona_pais ON planilla_persona (sev DESC, n_senales DESC, total DESC);
CREATE INDEX IF NOT EXISTS planilla_persona_dep ON planilla_persona (dep, sev DESC, n_senales DESC, total DESC);
CREATE INDEX IF NOT EXISTS planilla_persona_tipos ON planilla_persona USING gin (tipos);

-- El resumen de cada alcance ('pais', 'dep:15', 'ent:<ruc>'), ya contado (el del país pasaría los 10 s de la API).
CREATE TABLE IF NOT EXISTS planilla_resumen (
  alcance TEXT PRIMARY KEY,
  resumen JSONB NOT NULL
);

ALTER TABLE planilla_resumen OWNER TO vigia_jobs;
ALTER TABLE pte_entidad OWNER TO vigia_jobs;
ALTER TABLE planilla_pte OWNER TO vigia_jobs;
ALTER TABLE cargo_referencia OWNER TO vigia_jobs;
ALTER TABLE planilla_persona OWNER TO vigia_jobs;

-- Cargos de dirección (para apellidos_directivo): por el nombre del cargo o por ser "alto funcionario".
CREATE OR REPLACE FUNCTION es_directivo(cargo text, regimen smallint) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regimen = 7 OR mef_norm(cargo) ~ '^(GERENTE|SUB ?GERENTE|DIRECTOR|DIRECTORA|SUB ?DIRECTOR|JEFE|JEFA|ALCALDE|ALCALDESA|SECRETARIO GENERAL|SECRETARIA GENERAL|PRESIDENTE|VICEMINISTRO|MINISTRO|PROCURADOR|ADMINISTRADOR|ADMINISTRADORA|COORDINADOR GENERAL)'
$$;
ALTER FUNCTION es_directivo(text, smallint) OWNER TO vigia_jobs;

-- ── 2 · Señales de la planilla ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refrescar_planilla() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  SET LOCAL work_mem = '256MB';

  -- Lo que se paga por cargo en cada entidad y mes.
  DELETE FROM cargo_referencia;
  INSERT INTO cargo_referencia (entidad_ruc, anio, mes, cargo, personas, mediana, p25, p75, maximo)
  SELECT entidad_ruc, anio, mes, mef_norm(cargo), count(*),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY total), percentile_cont(0.25) WITHIN GROUP (ORDER BY total),
         percentile_cont(0.75) WITHIN GROUP (ORDER BY total), max(total)
    FROM planilla_pte WHERE total > 0 AND cargo IS NOT NULL
   GROUP BY entidad_ruc, anio, mes, mef_norm(cargo);

  -- Cada persona en cada entidad: su último mes manda (cargo, régimen, sueldo).
  CREATE TEMP TABLE _pl ON COMMIT DROP AS
  SELECT DISTINCT ON (p.entidad_ruc, p.nombre_norm) p.entidad_ruc, p.nombre_norm, p.paterno, p.materno, p.nombres, p.regimen, p.cargo,
         p.dependencia, p.total, p.anio, p.mes, make_date(p.anio, p.mes, 1) AS ultimo_mes,
         mef_norm(p.paterno) AS ap1, mef_norm(p.materno) AS ap2
    FROM planilla_pte p
   WHERE p.nombre_norm <> ''
   ORDER BY p.entidad_ruc, p.nombre_norm, p.anio DESC, p.mes DESC, p.total DESC NULLS LAST;
  CREATE TEMP TABLE _plm ON COMMIT DROP AS
  SELECT entidad_ruc, nombre_norm, count(DISTINCT (anio, mes))::int AS meses, min(make_date(anio, mes, 1)) AS primer_mes,
         array_agg(DISTINCT make_date(anio, mes, 1)) AS lista_meses
    FROM planilla_pte WHERE nombre_norm <> '' GROUP BY 1, 2;
  CREATE TEMP TABLE _pls (entidad_ruc text, nombre_norm text, tipo text, severidad text, detalle jsonb) ON COMMIT DROP;

  -- Gobierno de la entidad el último mes, y su departamento.
  CREATE TEMP TABLE _plg ON COMMIT DROP AS
  SELECT l.entidad_ruc, l.nombre_norm, eg.nivel, eg.ubigeo::text AS gub, gp.org_nombre, mef_norm(gp.org_nombre) AS gob_n, gp.anio_eleccion,
         left(e.ubigeo, 2) AS dep, mef_norm(z.nombre) AS dep_n, e.nombre AS entidad
    FROM _pl l
    LEFT JOIN entidades e ON e.ruc = l.entidad_ruc
    LEFT JOIN zonas z ON z.ubigeo = left(e.ubigeo, 2)
    LEFT JOIN entidad_gobierno eg ON eg.ruc = l.entidad_ruc
    LEFT JOIN LATERAL (
      SELECT g.org_nombre, g.anio_eleccion FROM gobierno_periodo g
       WHERE g.nivel = eg.nivel AND g.ubigeo = eg.ubigeo AND l.ultimo_mes BETWEEN g.desde AND g.hasta
       ORDER BY g.anio_eleccion DESC LIMIT 1
    ) gp ON TRUE;
  ANALYZE _pl; ANALYZE _plg;

  -- brecha_cargo: el doble o más que la mediana de su cargo en la entidad ese mes (5 o más con ese cargo), y S/ 5,000+.
  INSERT INTO _pls
  SELECT l.entidad_ruc, l.nombre_norm, 'brecha_cargo', 'media',
         jsonb_build_object('anio', l.anio, 'mes', l.mes, 'cargo', l.cargo, 'total', l.total, 'mediana', r.mediana, 'p75', r.p75,
                            'personas', r.personas, 'veces', round(l.total / r.mediana, 1))
    FROM _pl l JOIN cargo_referencia r ON r.entidad_ruc = l.entidad_ruc AND r.anio = l.anio AND r.mes = l.mes AND r.cargo = mef_norm(l.cargo)
   WHERE r.personas >= 5 AND r.mediana > 0 AND l.total >= 2 * r.mediana AND l.total >= 5000;

  -- tambien_ordenes / antes_locador: la misma persona (por nombre) recibe órdenes de servicio de la entidad.
  CREATE TEMP TABLE _plo ON COMMIT DROP AS
  SELECT l.entidad_ruc, l.nombre_norm, a.ruc, m.lista_meses, m.primer_mes
    FROM _pl l
    JOIN _plm m ON m.entidad_ruc = l.entidad_ruc AND m.nombre_norm = l.nombre_norm
    JOIN (SELECT DISTINCT entidad_ruc, ruc, mef_norm(nombre) AS nom_n FROM persona_orden_anual) a
      ON a.entidad_ruc = l.entidad_ruc AND a.nom_n = l.nombre_norm;
  INSERT INTO _pls
  SELECT x.entidad_ruc, x.nombre_norm, 'tambien_ordenes', 'alta',
         jsonb_build_object('meses', jsonb_agg(DISTINCT to_char(o.mes, 'YYYY-MM')), 'ordenes', count(*), 'monto', sum(o.monto))
    FROM _plo x
    JOIN LATERAL (
      SELECT DISTINCT ON (c.orden, c.fecha_emision) date_trunc('month', c.fecha_emision)::date AS mes, c.monto
        FROM conosce_ordenes c
       WHERE c.ruc_contratista = x.ruc AND c.entidad_ruc = x.entidad_ruc AND c.tipo_orden = 'Orden de Servicio'
         AND c.estado IS DISTINCT FROM 'Anulada' AND c.monto > 0
       ORDER BY c.orden, c.fecha_emision, c.anio DESC, c.mes DESC
    ) o ON o.mes = ANY (x.lista_meses)
   GROUP BY x.entidad_ruc, x.nombre_norm;
  INSERT INTO _pls
  SELECT x.entidad_ruc, x.nombre_norm, 'antes_locador', 'baja',
         jsonb_build_object('primera_orden', min(a.primera), 'ultima_orden_antes', max(a.ultima) FILTER (WHERE a.ultima < x.primer_mes),
                            'primer_mes_planilla', x.primer_mes, 'monto', sum(a.monto))
    FROM _plo x JOIN persona_orden_anual a ON a.entidad_ruc = x.entidad_ruc AND a.ruc = x.ruc
   GROUP BY x.entidad_ruc, x.nombre_norm, x.primer_mes
  HAVING min(a.primera) < x.primer_mes;

  -- candidato_gobierna: candidato (JNE, por nombre y departamento) del partido que gobierna la entidad.
  INSERT INTO _pls
  SELECT g.entidad_ruc, g.nombre_norm, 'candidato_gobierna', 'alta',
         jsonb_build_object('partido', max(g.org_nombre), 'por', 'nombre',
                            'candidaturas', jsonb_agg(DISTINCT jsonb_build_object('nombre', c.nombre, 'partido', c.partido, 'cargo', c.cargo,
                                                                                 'anio', c."año", 'resultado', c.resultado)))
    FROM _plg g
    JOIN jne_candidaturas c ON mef_norm(c.nombre) = g.nombre_norm AND mef_norm(c.region) = g.dep_n
   WHERE g.gob_n IS NOT NULL AND mismo_partido(mef_norm(c.partido), g.gob_n) AND c."año" BETWEEN g.anio_eleccion - 4 AND g.anio_eleccion
   GROUP BY g.entidad_ruc, g.nombre_norm;

  -- apellidos_autoridad: los dos apellidos de una autoridad electa del gobierno de la entidad (JNE autoridades). Todo
  -- por igualdad (nivel, gobierno, apellidos): un OR en el JOIN sería un bucle de millones × miles.
  CREATE TEMP TABLE _frec_pl ON COMMIT DROP AS
  SELECT ap1, ap2, count(*)::int AS frec FROM (SELECT DISTINCT nombre_norm, ap1, ap2 FROM _pl) x GROUP BY 1, 2;
  CREATE TEMP TABLE _autpl ON COMMIT DROP AS
  SELECT a.nombre, a.cargo, a.organizacion_politica AS partido, mef_norm(a.nombre) AS nom_n,
         split_part(mef_norm(a.nombre), ' ', 1) AS ap1, split_part(mef_norm(a.nombre), ' ', 2) AS ap2,
         a.periodo_inicio AS desde, COALESCE(a.periodo_fin, DATE '2026-12-31') AS hasta,
         CASE WHEN a.cargo ILIKE '%DISTRITAL' THEN 'distrital' WHEN a.cargo ILIKE '%PROVINCIAL' THEN 'provincial' ELSE 'regional' END AS nivel,
         CASE WHEN a.cargo ILIKE '%DISTRITAL' THEN a.ubigeo WHEN a.cargo ILIKE '%PROVINCIAL' THEN left(a.ubigeo, 4) ELSE left(a.ubigeo, 2) END AS gub
    FROM jne_autoridades a
   WHERE a.ubigeo IS NOT NULL AND a.periodo_inicio IS NOT NULL AND a.cargo ~* '(DISTRITAL|PROVINCIAL|REGIONAL)$';
  ANALYZE _autpl;
  INSERT INTO _pls
  SELECT g.entidad_ruc, g.nombre_norm, 'apellidos_autoridad', CASE WHEN min(f.frec) <= 20 THEN 'media' ELSE 'baja' END,
         jsonb_build_object('frecuencia', min(f.frec),
                            'autoridades', jsonb_agg(DISTINCT jsonb_build_object('nombre', a.nombre, 'cargo', a.cargo, 'partido', a.partido)))
    FROM _plg g
    JOIN _pl l ON l.entidad_ruc = g.entidad_ruc AND l.nombre_norm = g.nombre_norm
    JOIN _autpl a ON a.nivel = g.nivel AND a.gub = g.gub AND a.ap1 = l.ap1 AND a.ap2 = l.ap2
    JOIN _frec_pl f ON f.ap1 = l.ap1 AND f.ap2 = l.ap2
   WHERE length(l.ap1) > 1 AND length(l.ap2) > 1 AND a.nom_n <> l.nombre_norm AND l.ultimo_mes BETWEEN a.desde AND a.hasta
   GROUP BY g.entidad_ruc, g.nombre_norm;

  -- apellidos_directivo: los dos apellidos, poco comunes, de un directivo de la misma planilla (no él mismo).
  INSERT INTO _pls
  SELECT l.entidad_ruc, l.nombre_norm, 'apellidos_directivo', 'media',
         jsonb_build_object('frecuencia', min(f.frec),
                            'funcionarios_designados', jsonb_agg(DISTINCT jsonb_build_object(
                              'nombre', trim(COALESCE(d.nombres, '') || ' ' || COALESCE(d.paterno, '') || ' ' || COALESCE(d.materno, '')),
                              'cargo', d.cargo)))
    FROM _pl l
    JOIN _pl d ON d.entidad_ruc = l.entidad_ruc AND d.ap1 = l.ap1 AND d.ap2 = l.ap2 AND d.nombre_norm <> l.nombre_norm
    JOIN _frec_pl f ON f.ap1 = l.ap1 AND f.ap2 = l.ap2
   WHERE f.frec <= 20 AND length(l.ap1) > 1 AND length(l.ap2) > 1 AND es_directivo(d.cargo, d.regimen) AND NOT es_directivo(l.cargo, l.regimen)
   GROUP BY l.entidad_ruc, l.nombre_norm;

  -- Resumen.
  DELETE FROM planilla_persona;
  INSERT INTO planilla_persona (entidad_ruc, nombre_norm, paterno, materno, nombres, entidad, dep, regimen, cargo, dependencia, total, meses,
                                primer_mes, ultimo_mes, tipos, senales, n_senales, sev, codigo)
  SELECT l.entidad_ruc, l.nombre_norm, l.paterno, l.materno, l.nombres, g.entidad, g.dep, l.regimen, l.cargo, l.dependencia, l.total, m.meses,
         m.primer_mes, l.ultimo_mes,
         COALESCE(s.tipos, '{}'), COALESCE(s.senales, '[]'), COALESCE(s.n, 0), COALESCE(s.sev, 0),
         (SELECT pc.codigo FROM _plo o JOIN persona_codigo pc ON pc.ruc = o.ruc WHERE o.entidad_ruc = l.entidad_ruc AND o.nombre_norm = l.nombre_norm LIMIT 1)
    FROM _pl l
    JOIN _plm m ON m.entidad_ruc = l.entidad_ruc AND m.nombre_norm = l.nombre_norm
    LEFT JOIN _plg g ON g.entidad_ruc = l.entidad_ruc AND g.nombre_norm = l.nombre_norm
    LEFT JOIN (
      SELECT entidad_ruc, nombre_norm, array_agg(tipo ORDER BY tipo) AS tipos, count(*)::int AS n,
             max(CASE severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END)::smallint AS sev,
             jsonb_agg(jsonb_build_object('tipo', tipo, 'severidad', severidad, 'detalle', detalle)
                       ORDER BY CASE severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, tipo) AS senales
        FROM _pls GROUP BY 1, 2
    ) s ON s.entidad_ruc = l.entidad_ruc AND s.nombre_norm = l.nombre_norm;
  GET DIAGNOSTICS n = ROW_COUNT;

  -- El resumen de cada alcance (lo que GET /planilla devuelve como `resumen`).
  CREATE TEMP TABLE _prb ON COMMIT DROP AS
  SELECT x.alcance, p.total, p.n_senales, p.sev, p.tipos, p.regimen, p.ultimo_mes
    FROM planilla_persona p
    CROSS JOIN LATERAL (SELECT 'pais' AS alcance UNION ALL SELECT 'dep:' || p.dep WHERE p.dep IS NOT NULL
                        UNION ALL SELECT 'ent:' || p.entidad_ruc) x;
  DELETE FROM planilla_resumen;
  INSERT INTO planilla_resumen (alcance, resumen)
  SELECT t.alcance, jsonb_build_object('personas', t.personas, 'totalMes', t.total, 'conSenales', t.con, 'alta', t.alta, 'media', t.media,
                                       'ultimoMes', t.ultimo, 'porSenal', COALESCE(ps.l, '[]'), 'porRegimen', COALESCE(pr.l, '[]'))
    FROM (SELECT alcance, count(*)::int AS personas, COALESCE(sum(total), 0)::float AS total, count(*) FILTER (WHERE n_senales > 0)::int AS con,
                 count(*) FILTER (WHERE sev = 3)::int AS alta, count(*) FILTER (WHERE sev = 2)::int AS media,
                 to_char(max(ultimo_mes), 'YYYY-MM') AS ultimo
            FROM _prb GROUP BY alcance) t
    LEFT JOIN (SELECT alcance, jsonb_agg(jsonb_build_object('tipo', tipo, 'n', c) ORDER BY c DESC) AS l
                 FROM (SELECT alcance, tipo, count(*)::int AS c FROM _prb, unnest(_prb.tipos) tipo GROUP BY 1, 2) z GROUP BY alcance) ps
           ON ps.alcance = t.alcance
    LEFT JOIN (SELECT alcance, jsonb_agg(jsonb_build_object('regimen', regimen, 'n', c) ORDER BY c DESC) AS l
                 FROM (SELECT alcance, regimen, count(*)::int AS c FROM _prb GROUP BY 1, 2) z GROUP BY alcance) pr
           ON pr.alcance = t.alcance;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_planilla() OWNER TO vigia_jobs;

-- ── 3 · Lo mismo visto desde las órdenes (persona_senal) ───────────────────────────────────────
-- La llama refrescar_personas_senales() (migración 91) antes de su resumen: usa su tabla temporal _pa.
CREATE OR REPLACE FUNCTION senales_planilla_de_personas() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  -- tambien_planilla: órdenes de la entidad en un mes en que está en su planilla.
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT p.entidad_ruc, p.ruc, 'tambien_planilla', 'alta',
         jsonb_build_object('meses', jsonb_agg(DISTINCT to_char(make_date(pl.anio, pl.mes, 1), 'YYYY-MM')),
                            'cargo', max(pl.cargo), 'regimen', max(pl.regimen), 'sueldo', max(pl.total)),
         'pte_personal', 'https://www.transparencia.gob.pe/'
    FROM (SELECT DISTINCT entidad_ruc, ruc, nom_n FROM _pa) p
    JOIN planilla_pte pl ON pl.entidad_ruc = p.entidad_ruc AND pl.nombre_norm = p.nom_n
   WHERE EXISTS (
     SELECT 1 FROM conosce_ordenes c
      WHERE c.ruc_contratista = p.ruc AND c.entidad_ruc = p.entidad_ruc AND c.tipo_orden = 'Orden de Servicio'
        AND c.estado IS DISTINCT FROM 'Anulada' AND date_trunc('month', c.fecha_emision) = make_date(pl.anio, pl.mes, 1))
   GROUP BY p.entidad_ruc, p.ruc
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;

  -- paso_a_planilla: después de sus órdenes aparece en la planilla de la entidad.
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT p.entidad_ruc, p.ruc, 'paso_a_planilla', 'baja',
         jsonb_build_object('primer_mes_planilla', min(make_date(pl.anio, pl.mes, 1)), 'cargo', (array_agg(pl.cargo ORDER BY pl.anio, pl.mes))[1],
                            'regimen', (array_agg(pl.regimen ORDER BY pl.anio, pl.mes))[1], 'primera_orden', min(p.primera)),
         'pte_personal', 'https://www.transparencia.gob.pe/'
    FROM (SELECT entidad_ruc, ruc, nom_n, min(primera) AS primera FROM _pa GROUP BY 1, 2, 3) p
    JOIN planilla_pte pl ON pl.entidad_ruc = p.entidad_ruc AND pl.nombre_norm = p.nom_n
   GROUP BY p.entidad_ruc, p.ruc
  HAVING min(p.primera) < min(make_date(pl.anio, pl.mes, 1))
  ON CONFLICT DO NOTHING;
  RETURN n;
END $$;
ALTER FUNCTION senales_planilla_de_personas() OWNER TO vigia_jobs;

-- ── 4 · Permisos ───────────────────────────────────────────────────────────────────────────────
GRANT SELECT ON pte_entidad, planilla_pte, cargo_referencia, planilla_persona, planilla_resumen TO vigia_api, vigia_api_admin;
GRANT EXECUTE ON FUNCTION es_directivo(text, smallint) TO vigia_jobs, vigia_api, vigia_api_admin;
REVOKE EXECUTE ON FUNCTION refrescar_planilla(), senales_planilla_de_personas() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_agentes') THEN
    REVOKE ALL ON pte_entidad, planilla_pte, cargo_referencia, planilla_persona, planilla_resumen FROM vigia_agentes;
  END IF;
END $$;
