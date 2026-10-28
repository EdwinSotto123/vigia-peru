-- 186 · Organización 2.0 (fase 1 del plan del 2026-10-27): lo que la API necesita para armar el organigrama de cada
-- entidad con evidencia (backend/api/src/lib/organigrama.ts).
--
--   1. organo_nombre_global: los nombres completos de oficinas que usan las entidades, para expandir las siglas de una
--      planilla que sólo trae siglas. La del Gobierno Regional de Ayacucho dice «GRPPAT», «ORADM», «DRTPE»: los cargos de
--      sus propios funcionarios en la DJI resuelven las que tienen («GERENTE REGIONAL DE PLANEAMIENTO, PRESUPUESTO Y
--      ACONDICIONAMIENTO TERRITORIAL» → GRPPAT); las demás, los nombres que usan otras entidades («OFICINA REGIONAL DE
--      ADMINISTRACION» en 5, «DIRECCION REGIONAL DE TRABAJO Y PROMOCION DEL EMPLEO» en 10). Dos fuentes:
--        · 'planilla': el primer tramo de la dependencia (antes de « - »), con al menos dos palabras;
--        · 'dji': el cargo declarado tal cual (la API lo vuelve nombre de oficina: GERENTE → GERENCIA, DIRECTOR → DIRECCIÓN).
--      Sólo los que aparecen en dos entidades o más (un nombre de una sola entidad ya está en la suya).
--   2. visita_entidad_ruc: a qué entidad corresponde cada nombre del registro de visitas, con la regla de la migración 174
--      (todos los nombres de la entidad, sin los que comparten entidades de distritos distintos). Antes vivía en una tabla
--      temporal de refrescar_cruce_visita_previa(); el organigrama cuenta las visitas de cada oficina con ella.
--   3. dji_jefatura: los cargos de jefatura VIGENTES de cada entidad en el registro de declarantes (gerentes, directores,
--      jefes, gobernador, alcalde, ministro…), hasta tres por cargo, los más recientes. Leerlos de dji_funcionarios en cada
--      pedido tardaba 4 s en el Ministerio de Salud (decenas de miles de declarantes, casi todos sin jefatura).
--
-- refrescar_organo_nombre_global() (~1 min) corre con la planilla mensual (pte_personal) y la DJI; refrescar_visita_entidad_ruc()
-- (segundos) con la carga de visitas; refrescar_dji_jefatura() con la DJI. Cómo aplicarla: python infrastructure/dev/dev.py
-- migrar backend/db/migrations/186_organigrama.sql (DEV); en producción, backend/scripts/aplicar_186.py.

CREATE TABLE IF NOT EXISTS organo_nombre_global (
  texto      TEXT NOT NULL,      -- mef_norm del nombre (planilla) o del cargo (dji)
  fuente     TEXT NOT NULL,      -- 'planilla' | 'dji'
  entidades  INT  NOT NULL,      -- en cuántas entidades aparece
  PRIMARY KEY (texto, fuente)
);
ALTER TABLE organo_nombre_global OWNER TO vigia_jobs;
GRANT SELECT ON organo_nombre_global TO vigia_api;

CREATE TABLE IF NOT EXISTS visita_entidad_ruc (
  entidad_visitada TEXT NOT NULL,   -- tal como lo escribe el registro de visitas
  ruc              TEXT NOT NULL,
  PRIMARY KEY (entidad_visitada, ruc)
);
CREATE INDEX IF NOT EXISTS visita_entidad_ruc_ruc ON visita_entidad_ruc (ruc);
ALTER TABLE visita_entidad_ruc OWNER TO vigia_jobs;
GRANT SELECT ON visita_entidad_ruc TO vigia_api;

-- Las visitas de una entidad, por el nombre con que las registró.
CREATE INDEX IF NOT EXISTS visitas_entidad_visitada_idx ON visitas_entidades (entidad_visitada);

CREATE OR REPLACE FUNCTION refrescar_organo_nombre_global() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_organo_nombre_global'));
  SET LOCAL work_mem = '256MB';
  CREATE TEMP TABLE _ong ON COMMIT DROP AS
    SELECT x.texto, 'planilla'::text AS fuente, count(DISTINCT x.entidad_ruc)::int AS entidades
      FROM (SELECT DISTINCT entidad_ruc, mef_norm(split_part(dependencia, ' - ', 1)) AS texto
              FROM planilla_persona WHERE dependencia IS NOT NULL) x
     WHERE x.texto ~ ' ' GROUP BY 1 HAVING count(DISTINCT x.entidad_ruc) >= 2
    UNION ALL
    SELECT mef_norm(cargo), 'dji', count(DISTINCT entidad)::int
      FROM dji_funcionarios WHERE cargo IS NOT NULL
     GROUP BY 1 HAVING count(DISTINCT entidad) >= 2;
  DELETE FROM organo_nombre_global;
  INSERT INTO organo_nombre_global (texto, fuente, entidades)
  SELECT texto, fuente, max(entidades) FROM _ong WHERE texto <> '' GROUP BY 1, 2;
  SELECT count(*) INTO n FROM organo_nombre_global;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_organo_nombre_global() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_organo_nombre_global() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refrescar_organo_nombre_global() TO vigia_jobs;

CREATE OR REPLACE FUNCTION refrescar_visita_entidad_ruc() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_visita_entidad_ruc'));
  -- Los nombres de cada entidad (los mismos pasos 1 y 2 de refrescar_cruce_visita_previa, migración 174).
  CREATE TEMP TABLE _veo ON COMMIT DROP AS
    SELECT DISTINCT ruc, nombre FROM (
      SELECT ruc::text AS ruc, nombre FROM entidades WHERE nombre IS NOT NULL
      UNION ALL SELECT DISTINCT entidad_ruc::text, entidad FROM empresa_orden_anual WHERE entidad IS NOT NULL
      UNION ALL SELECT DISTINCT entidad_ruc::text, entidad FROM conosce_adjudicaciones WHERE entidad IS NOT NULL) x
     WHERE ruc ~ '^\d{11}$';
  CREATE TEMP TABLE _ven ON COMMIT DROP AS
    SELECT DISTINCT ruc, mef_norm(nombre) AS k, 0 AS nivel FROM _veo
    UNION
    SELECT DISTINCT ruc, mef_norm(regexp_replace(nombre, '\s+-\s+.*$', '')), 1 FROM _veo WHERE nombre ~ '\s-\s';
  DELETE FROM _ven WHERE k = '';
  CREATE TEMP TABLE _vek ON COMMIT DROP AS
    SELECT x.k, x.ruc
      FROM _ven x
      JOIN (SELECT k, min(nivel) AS nivel FROM _ven GROUP BY k) m ON m.k = x.k AND m.nivel = x.nivel
      JOIN (SELECT y.k FROM _ven y JOIN (SELECT k, min(nivel) AS nivel FROM _ven GROUP BY k) mm ON mm.k = y.k AND mm.nivel = y.nivel
              LEFT JOIN entidades e ON e.ruc::text = y.ruc
             GROUP BY y.k HAVING count(DISTINCT COALESCE(e.ubigeo, y.ruc)) = 1) ok ON ok.k = x.k;
  CREATE INDEX ON _vek (k);
  DELETE FROM visita_entidad_ruc;
  INSERT INTO visita_entidad_ruc (entidad_visitada, ruc)
  SELECT DISTINCT v.t, k.ruc
    FROM (SELECT DISTINCT entidad_visitada AS t FROM visitas_entidades WHERE entidad_visitada IS NOT NULL) v
   CROSS JOIN LATERAL unnest(claves_entidad_visitada(v.t)) c(k)
    JOIN _vek k ON k.k = c.k;
  SELECT count(*) INTO n FROM visita_entidad_ruc;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_visita_entidad_ruc() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_visita_entidad_ruc() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refrescar_visita_entidad_ruc() TO vigia_jobs;

CREATE TABLE IF NOT EXISTS dji_jefatura (
  ruc          TEXT NOT NULL,   -- la entidad (dji_entidad_ruc)
  cargo        TEXT NOT NULL,   -- mef_norm del cargo declarado
  nombre_norm  TEXT NOT NULL,   -- «PATERNO MATERNO NOMBRES», como planilla_persona.nombre_norm
  paterno      TEXT,
  nombres      TEXT,
  desde        DATE
);
CREATE INDEX IF NOT EXISTS dji_jefatura_ruc ON dji_jefatura (ruc);
ALTER TABLE dji_jefatura OWNER TO vigia_jobs;
GRANT SELECT ON dji_jefatura TO vigia_api;

CREATE OR REPLACE FUNCTION refrescar_dji_jefatura() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_dji_jefatura'));
  SET LOCAL work_mem = '256MB';
  CREATE TEMP TABLE _dj ON COMMIT DROP AS
    SELECT m.ruc, mef_norm(f.cargo) AS cargo, f.nombre_norm, btrim(f.apellido_paterno) AS paterno, btrim(f.nombres) AS nombres,
           CASE WHEN btrim(f.fecha_inicio_cargo) ~ '^\d{2}/\d{2}/\d{4}$' THEN to_date(btrim(f.fecha_inicio_cargo), 'DD/MM/YYYY')
                WHEN btrim(f.fecha_inicio_cargo) ~ '^\d{2}/\d{2}/\d{2}$' THEN to_date(btrim(f.fecha_inicio_cargo), 'DD/MM/YY')
                WHEN btrim(f.fecha_inicio_cargo) ~ '^\d{4}-\d{2}-\d{2}' THEN left(btrim(f.fecha_inicio_cargo), 10)::date END AS desde
      FROM dji_funcionarios f JOIN dji_entidad_ruc m ON m.entidad = f.entidad
     WHERE (f.fecha_cese_cargo IS NULL OR btrim(f.fecha_cese_cargo) = '')
       AND f.nombre_norm IS NOT NULL AND f.cargo IS NOT NULL
       AND mef_norm(f.cargo) ~ '^(SUB ?GERENTE|GERENTE|SUB ?DIRECTORA?|DIRECTORA?|JEF[EA]|GOBERNADORA?|VICE ?GOBERNADORA?|ALCALDE(SA)?|TENIENTE ALCALDE|SECRETARI[OA] GENERAL|PROCURADORA?|MINISTR[OA]|VICE ?MINISTR[OA]|PRESIDENT[EA]|RECTORA?|VICE ?RECTORA?|DECAN[OA]|ADMINISTRADORA?|SUPERINTENDENTE|CONTRALORA?)\M';
  DELETE FROM dji_jefatura;
  INSERT INTO dji_jefatura (ruc, cargo, nombre_norm, paterno, nombres, desde)
  SELECT ruc, cargo, nombre_norm, paterno, nombres, desde
    FROM (SELECT d.*, row_number() OVER (PARTITION BY ruc, cargo ORDER BY desde DESC NULLS LAST, nombre_norm) AS k
            FROM (SELECT DISTINCT ON (ruc, cargo, nombre_norm) * FROM _dj ORDER BY ruc, cargo, nombre_norm, desde DESC NULLS LAST) d) z
   WHERE k <= 3;
  SELECT count(*) INTO n FROM dji_jefatura;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_dji_jefatura() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_dji_jefatura() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refrescar_dji_jefatura() TO vigia_jobs;
