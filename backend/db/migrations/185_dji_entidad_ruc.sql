-- 185 · DJI tier 3, fase 5 del plan del 2026-10-27: el RUC de cada entidad del registro de declarantes.
--   El registro de la Contraloría (dji_funcionarios: 1,1 M cargos vigentes, 443 mil personas, 2,853 entidades) trae el
--   nombre de la entidad, no su RUC, y el portal busca por RUC. dji_entidad_ruc los une: por el nombre normalizado igual
--   (entidades, una sola), después el del directorio del Portal de Transparencia (pte_directorio, uno solo), y al final el
--   más parecido por trigramas (0.8 o más y sin otro a menos de 0.05: si dos se parecen igual, no se adivina). Medido: el
--   nombre exacto alcanza para 1,678 entidades y 353 mil pares persona × entidad.
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
  -- 1. El mismo nombre en entidades (de una sola).
  INSERT INTO dji_entidad_ruc (entidad, ruc, como, similitud)
  SELECT d.entidad, e.ruc, 'entidades', 1 FROM _de d JOIN _ee e ON e.n = d.n AND e.k = 1;
  -- 2. El mismo nombre en el directorio del Portal de Transparencia.
  INSERT INTO dji_entidad_ruc (entidad, ruc, como, similitud)
  SELECT d.entidad, p.ruc, 'pte_directorio', 1 FROM _de d JOIN _ed p ON p.n = d.n AND p.k = 1
   WHERE NOT EXISTS (SELECT 1 FROM dji_entidad_ruc x WHERE x.entidad = d.entidad);
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
