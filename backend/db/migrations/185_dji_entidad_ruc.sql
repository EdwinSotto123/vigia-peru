-- 185 · DJI tier 3, fase 5 del plan del 2026-10-27: el RUC de cada entidad del registro de declarantes.
--   El registro de la Contraloría (dji_funcionarios, Reporte1: 1,1 M cargos vigentes, 443 mil personas, 2,853 entidades)
--   trae el nombre de la entidad, no su RUC, y el portal busca por RUC. Pero cada declaración trae sus empleos (dji_empleos,
--   Reporte3) CON el RUC de la entidad (RUC_ENTIDAD_LABORO), y entre ellos el de ahora. dji_entidad_ruc los une, de lo más
--   seguro a lo menos:
--     1. 'empleo': el empleo declarado con el mismo nombre que la entidad del registro, el RUC de la mayoría (80 % o más)
--        de sus declaraciones: 1,362 entidades, iguales al nombre exacto en 1,085 de 1,090 (las 5 distintas eran
--        trigramas equivocados).
--     2. 'entidades' / 'pte_directorio': el nombre normalizado igual en entidades o en el directorio del Portal de
--        Transparencia, de un solo RUC.
--     3. 'empleo_actual': el empleo sin fecha de cese (el de ahora), cualquiera sea su nombre, si el 80 % o más de las
--        declaraciones (3 o más) dicen el mismo RUC.
--     4. 'trigramas': el nombre más parecido entre las entidades (0.8 o más y sin otro a menos de 0.05).
--
-- refrescar_dji_entidad_ruc(): la usa backend/scripts/preparar_dji_tier3.py antes de armar los objetivos del tier 3.
--
-- Cómo aplicarla: python infrastructure/dev/dev.py migrar backend/db/migrations/185_dji_entidad_ruc.sql (DEV); en
-- producción, preparar_dji_tier3.py la aplica y la corre.

CREATE TABLE IF NOT EXISTS dji_entidad_ruc (
  entidad  TEXT PRIMARY KEY,   -- como lo escribe el registro de la Contraloría
  ruc      TEXT NOT NULL,
  como     TEXT NOT NULL,      -- 'entidades', 'pte_directorio' o 'trigramas'
  similitud REAL
);
ALTER TABLE dji_entidad_ruc OWNER TO vigia_jobs;

CREATE OR REPLACE FUNCTION refrescar_dji_entidad_ruc() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_dji_entidad_ruc'));
  CREATE TEMP TABLE _de ON COMMIT DROP AS
    SELECT DISTINCT entidad, mef_norm(entidad) AS n FROM dji_funcionarios WHERE entidad IS NOT NULL;
  CREATE TEMP TABLE _ee ON COMMIT DROP AS
    SELECT mef_norm(nombre) AS n, min(ruc::text) AS ruc, count(DISTINCT ruc) AS k FROM entidades WHERE nombre IS NOT NULL GROUP BY 1;
  CREATE TEMP TABLE _ed ON COMMIT DROP AS
    SELECT mef_norm(nombre) AS n, min(ruc) AS ruc, count(DISTINCT ruc) AS k FROM pte_directorio
     WHERE nombre IS NOT NULL AND ruc ~ '^20[0-9]{9}$' GROUP BY 1;
  DELETE FROM dji_entidad_ruc;
  -- 0. Lo que declaran sus propios funcionarios: el empleo con el mismo nombre que la entidad, con su RUC.
  CREATE TEMP TABLE _emp ON COMMIT DROP AS
    WITH par AS (
      SELECT f.entidad, e.ruc_entidad AS ruc, count(DISTINCT f.codigo_ddjj) AS nd,
             bool_or(mef_norm(e.nombre_entidad) = mef_norm(f.entidad)) AS mismo_nombre
        FROM dji_funcionarios f JOIN dji_empleos e ON e.codigo_ddjj = f.codigo_ddjj
       WHERE e.ruc_entidad ~ '^20[0-9]{9}$'
         AND (mef_norm(e.nombre_entidad) = mef_norm(f.entidad) OR COALESCE(btrim(e.fecha_cese::text), '') = '')
       GROUP BY 1, 2, (mef_norm(e.nombre_entidad) = mef_norm(f.entidad)))
    SELECT entidad, ruc, nd, mismo_nombre,
           nd::float / sum(nd) OVER (PARTITION BY entidad, mismo_nombre) AS cuota,
           sum(nd) OVER (PARTITION BY entidad, mismo_nombre) AS total,
           row_number() OVER (PARTITION BY entidad, mismo_nombre ORDER BY nd DESC) AS k
      FROM par;
  INSERT INTO dji_entidad_ruc (entidad, ruc, como, similitud)
  SELECT entidad, ruc, 'empleo', cuota FROM _emp WHERE mismo_nombre AND k = 1 AND cuota >= 0.8;
  -- 1. El mismo nombre en entidades (de una sola).
  INSERT INTO dji_entidad_ruc (entidad, ruc, como, similitud)
  SELECT d.entidad, e.ruc, 'entidades', 1 FROM _de d JOIN _ee e ON e.n = d.n AND e.k = 1
   WHERE NOT EXISTS (SELECT 1 FROM dji_entidad_ruc x WHERE x.entidad = d.entidad);
  -- 2. El mismo nombre en el directorio del Portal de Transparencia.
  INSERT INTO dji_entidad_ruc (entidad, ruc, como, similitud)
  SELECT d.entidad, p.ruc, 'pte_directorio', 1 FROM _de d JOIN _ed p ON p.n = d.n AND p.k = 1
   WHERE NOT EXISTS (SELECT 1 FROM dji_entidad_ruc x WHERE x.entidad = d.entidad);
  -- 2b. El empleo de ahora de sus declaraciones, si casi todas dicen el mismo RUC.
  INSERT INTO dji_entidad_ruc (entidad, ruc, como, similitud)
  SELECT entidad, ruc, 'empleo_actual', cuota FROM _emp
   WHERE NOT mismo_nombre AND k = 1 AND cuota >= 0.8 AND total >= 3
     AND NOT EXISTS (SELECT 1 FROM dji_entidad_ruc x WHERE x.entidad = _emp.entidad);
  -- 3. El más parecido entre las entidades, si es claramente el mejor.
  INSERT INTO dji_entidad_ruc (entidad, ruc, como, similitud)
  SELECT entidad, ruc, 'trigramas', s
    FROM (SELECT d.entidad, e.ruc, similarity(d.n, e.n) AS s,
                 row_number() OVER (PARTITION BY d.entidad ORDER BY similarity(d.n, e.n) DESC) AS k,
                 lead(similarity(d.n, e.n)) OVER (PARTITION BY d.entidad ORDER BY similarity(d.n, e.n) DESC) AS s2
            FROM _de d JOIN _ee e ON e.k = 1 AND d.n % e.n
           WHERE NOT EXISTS (SELECT 1 FROM dji_entidad_ruc x WHERE x.entidad = d.entidad)) t
   WHERE k = 1 AND s >= 0.8 AND (s2 IS NULL OR s - s2 >= 0.05);
  SELECT count(*) INTO n FROM dji_entidad_ruc;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_dji_entidad_ruc() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_dji_entidad_ruc() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refrescar_dji_entidad_ruc() TO vigia_jobs;
