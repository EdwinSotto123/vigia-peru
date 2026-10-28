-- 190 · El RUC de las entidades del registro de la DJI, también por todos sus nombres (fase 5 del plan del 2026-10-27).
--
-- La 185 dejó 412 entidades del registro de declarantes (8,611 vigentes) sin RUC, y sin RUC no se pueden bajar sus DJI:
-- «GOBIERNO REGIONAL HUANCAVELICA» (el padrón dice «DE HUANCAVELICA»), «BANCO AGROPECUARIO - AGROBANCO», «SUPERINTENDENCIA
-- DEL MERCADO DE VALORES (EX- CONASEV)», «EMPRESA REGIONAL  ELECTRONORTE MEDIO S.A - HIDRANDINA». Un paso más (2c),
-- antes de los trigramas: las variantes de claves_entidad_visitada (174) contra todos los nombres de cada entidad.
--
-- Se probó además un parecido por trigramas sobre las variantes (0,72 y 0,1 de distancia al segundo): sumaba 32 pero
-- confundía «Instituto Regional de Oftalmología» con el Nacional y una empresa de mercados de Chimbote con EMMSA. Un RUC
-- equivocado cuelga familiares de otra entidad (nepotismo falso): no va.
--
-- Cómo aplicarla: después de la 185 (preparar_dji_tier3.py aplica las dos). En producción, luego
-- SELECT refrescar_dji_entidad_ruc(); y preparar_dji_tier3.py para encolar a sus declarantes.

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
  -- 2c. Por todos los nombres de la entidad (el del padrón y los que usa en CONOSCE al adjudicar y al emitir órdenes) y las
  --     variantes del registro (sin la sigla tras « - », sin lo que va entre paréntesis, con el «DE» del padrón y con
  --     «SEDE CENTRAL»): la misma regla que las visitas (claves_entidad_visitada, migración 174). Un nombre que comparten
  --     dos entidades no se usa, y todas las variantes tienen que llevar a una sola.
  CREATE TEMP TABLE _dno ON COMMIT DROP AS
    SELECT DISTINCT ruc, nombre FROM (
      SELECT ruc::text AS ruc, nombre FROM entidades WHERE nombre IS NOT NULL
      UNION ALL SELECT DISTINCT entidad_ruc::text, entidad FROM empresa_orden_anual WHERE entidad IS NOT NULL
      UNION ALL SELECT DISTINCT entidad_ruc::text, entidad FROM conosce_adjudicaciones WHERE entidad IS NOT NULL) x
     WHERE ruc ~ '^\d{11}$';
  CREATE TEMP TABLE _dnk ON COMMIT DROP AS
    SELECT k, min(ruc) AS ruc FROM (
      SELECT ruc, mef_norm(nombre) AS k FROM _dno
      UNION SELECT ruc, mef_norm(regexp_replace(nombre, '\s+-\s+.*$', '')) FROM _dno WHERE nombre ~ '\s-\s') y
     WHERE k <> '' GROUP BY k HAVING count(DISTINCT ruc) = 1;
  CREATE INDEX ON _dnk (k);
  INSERT INTO dji_entidad_ruc (entidad, ruc, como, similitud)
  SELECT d.entidad, min(k.ruc), 'nombres', 1
    FROM _de d CROSS JOIN LATERAL unnest(claves_entidad_visitada(d.entidad)) c(k0)
    JOIN _dnk k ON k.k = c.k0
   WHERE NOT EXISTS (SELECT 1 FROM dji_entidad_ruc x WHERE x.entidad = d.entidad)
   GROUP BY d.entidad HAVING count(DISTINCT k.ruc) = 1;
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
