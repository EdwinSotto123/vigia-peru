-- 335 · Qué empresas visitaron a cada funcionario: la arista «empresa → funcionario visitado» de la red de personas.
--
-- El registro de visitas anota el nombre de quien recibió la visita, pero hasta ahora ese nombre era sólo texto: la ficha
-- de rastro de una persona con cargo público (migración 318) mostraba las visitas que HIZO y no las que RECIBIÓ. Medido el
-- 2026-11-17: de 64 715 funcionarios visitados en dos años, 75 % calza por su nombre completo (las mismas palabras, en
-- cualquier orden: el registro a veces pone primero los nombres) con su planilla o su declaración jurada dentro de la misma
-- entidad, y eso cubre 82 % de las 5,4 M de visitas.
--
--   nombre_llave(text)                     las palabras del nombre (mef_norm, de dos letras o más) en orden alfabético:
--                                          «JUAN CARLOS PEREZ GOMEZ» y «PEREZ GOMEZ JUAN CARLOS» dan lo mismo.
--   funcionario_visita_empresa             una fila por funcionario visitado (su llave), entidad y empresa (RUC 20) cuya
--                                          gente lo visitó (empresa_visita, migraciones 241-244): cuántas visitas, la
--                                          primera y la última.
--   refrescar_funcionario_visita_empresa() la rehace entera, después de atribuir las visitas a empresas.
--
-- La API la lee para la ficha de rastro (GET /personas/cargo/:codigo, «Visitas que recibió»), SÓLO en las entidades en
-- que esa persona declaró un cargo o figuró en planilla: así un homónimo de otra entidad no se mezcla. Un homónimo exacto
-- en la misma entidad sí: la ficha lo avisa, como en todo lo demás de ese rastro.
--
-- Privacidad: guarda la llave del nombre (dato personal) y nada de quien visitó; sólo la lee la API, que no publica la
-- llave. Igual que funcionario_resumen (318): ni el MCP ni los agentes la leen directo.

CREATE OR REPLACE FUNCTION nombre_llave(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(string_agg(w, ' ' ORDER BY w), '')
    FROM unnest(regexp_split_to_array(mef_norm(COALESCE(t, '')), '\s+')) w
   WHERE length(w) > 1
$$;

CREATE TABLE IF NOT EXISTS funcionario_visita_empresa (
  llave       TEXT NOT NULL,
  entidad_ruc TEXT NOT NULL,
  ruc         TEXT NOT NULL,
  visitas     INTEGER NOT NULL,
  primera     DATE,
  ultima      DATE,
  PRIMARY KEY (llave, entidad_ruc, ruc)
);
CREATE INDEX IF NOT EXISTS funcionario_visita_empresa_ruc ON funcionario_visita_empresa (ruc, entidad_ruc);

CREATE OR REPLACE FUNCTION refrescar_funcionario_visita_empresa() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  SET LOCAL work_mem = '256MB';
  -- Cada visita atribuida a una empresa (RUC 20), con el nombre de quien la recibió.
  CREATE TEMP TABLE _fve ON COMMIT DROP AS
    SELECT DISTINCT ev.ruc, r.ruc AS entidad_ruc, ev.visita_id, v.fecha_visita AS f,
           COALESCE(NULLIF(btrim(v.funcionario_nombre), ''), NULLIF(btrim(v.funcionario_visitado), '')) AS nom
      FROM empresa_visita ev
      JOIN visitas_entidades v ON v.id = ev.visita_id
      JOIN visita_entidad_ruc r ON r.entidad_visitada = v.entidad_visitada
     WHERE ev.ruc ~ '^20\d{9}$' AND r.ruc ~ '^20\d{9}$';
  DELETE FROM _fve WHERE nom IS NULL;
  -- La llave de cada nombre distinto una sola vez (mef_norm sobre millones de filas es lo caro).
  CREATE TEMP TABLE _fvn ON COMMIT DROP AS
    SELECT nom, nombre_llave(nom) AS llave FROM (SELECT DISTINCT nom FROM _fve) z;
  -- Con una sola palabra no hay a quién reconocer.
  DELETE FROM _fvn WHERE llave IS NULL OR llave NOT LIKE '% %';
  CREATE INDEX ON _fvn (nom);
  ANALYZE _fve;
  ANALYZE _fvn;

  DELETE FROM funcionario_visita_empresa;
  INSERT INTO funcionario_visita_empresa (llave, entidad_ruc, ruc, visitas, primera, ultima)
  SELECT n.llave, e.entidad_ruc, e.ruc, count(DISTINCT e.visita_id)::int, min(e.f), max(e.f)
    FROM _fve e JOIN _fvn n USING (nom)
   GROUP BY 1, 2, 3;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE funcionario_visita_empresa;
  RETURN n;
END $$;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.funcionario_visita_empresa OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_funcionario_visita_empresa() OWNER TO vigia_jobs;
    ALTER FUNCTION public.nombre_llave(text) OWNER TO vigia_jobs;
  END IF;
  REVOKE ALL ON public.funcionario_visita_empresa FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON public.funcionario_visita_empresa FROM %I', r);
    END IF;
  END LOOP;
  -- Sólo la API (y la de DEV), que no publica la llave.
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'dev_api', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.funcionario_visita_empresa TO %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_funcionario_visita_empresa() FROM PUBLIC;
