-- 197 · El RUC de la entidad visitada, también cuando la plataforma nacional la nombra distinto que las compras.
--
-- Con las visitas de la plataforma nacional (10,8 M), sólo 382 de sus 682 nombres de entidad tenían RUC
-- (visita_entidad_ruc, migración 186): 3,3 M de visitas quedaban fuera de la pestaña Visitas y de los cruces. La
-- plataforma escribe el nombre oficial con su sigla («MINISTERIO DE LA MUJER Y POBLACIONES VULNERABLES (MIMP)»,
-- «PETRÓLEOS DEL PERÚ (PETROPERU)»); las compras, con la sigla del sector delante («MTC-PROYECTO ESPECIAL …»), una cola
-- administrativa («…- ADMINISTRACIÓN GENERAL»), la forma societaria («… S.A.») o el gobierno regional delante
-- («GOBIERNO REGIONAL DE CAJAMARCA - UNIDAD DE GESTION EDUCATIVA LOCAL JAEN»).
--
-- Variantes nuevas del nombre de la entidad (nivel 2: sólo si el exacto y el «sin la cola tras el guion» no casan):
--   1. sin la sigla del sector delante («MTC-», «MINAG - », «MEF - »);
--   2. sin una cola administrativa (ADMINISTRACIÓN GENERAL, SEDE CENTRAL, OFICINA GENERAL DE ADMINISTRACIÓN…);
--   3. lo de después del guion de «GOBIERNO REGIONAL DE X - …» (o municipalidad), con el lugar del gobierno detrás
--      («GERENCIA REGIONAL DE SALUD LA LIBERTAD») y, sólo si se identifica sola, también sin él: una oficina genérica
--      («GERENCIA REGIONAL DE SALUD», «UNIDAD DE GESTIÓN EDUCATIVA LOCAL») sin su lugar no pasa (en la medición, la
--      gerencia de salud de La Libertad se iba a la de Arequipa);
--   4. sin la forma societaria (S.A., S.A.C., S.A.A.).
-- Del lado de la visita, además de las claves de la 174, la que queda sin la sigla entre paréntesis y sin la forma
-- societaria. Sigue la regla de siempre: una clave que lleva a dos lugares distintos no se usa.
-- En producción (28-oct): de 390 a 455 nombres con RUC y de 8,82 M a 9,87 M visitas; ningún nombre cambia de RUC.
--
-- Cómo aplicarla: después de la 186 (redefine su función); luego SELECT refrescar_visita_entidad_ruc() y lo que lee las
-- visitas (cargar_visitas_nacional.py --solo-refrescos).

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
  -- El lugar de cada RUC, para la guarda de las oficinas genéricas.
  CREATE TEMP TABLE _vel ON COMMIT DROP AS
    SELECT ruc::text AS ruc, mef_norm(region) AS dep, mef_norm(provincia) AS prov, mef_norm(distrito) AS dist FROM entidades;
  CREATE INDEX ON _vel (ruc);
  -- Las variantes de nivel 2 (arriba). `lugar`: el del gobierno que va delante («GOBIERNO REGIONAL DE CAJAMARCA - …»).
  CREATE TEMP TABLE _vev ON COMMIT DROP AS
    SELECT o.ruc, btrim(v.t) AS t
      FROM _veo o
     CROSS JOIN LATERAL (
       SELECT regexp_replace(o.nombre, '^\s*[A-ZÁÉÍÓÚÑ]{2,8}\s*-\s*', '') AS t
       UNION ALL
       SELECT regexp_replace(o.nombre, '\s*-\s*(ADMINISTRACI[OÓ]N GENERAL|SEDE CENTRAL|OFICINA GENERAL DE ADMINISTRACI[OÓ]N|ADMINISTRACI[OÓ]N CENTRAL|OFICINA DE ADMINISTRACI[OÓ]N)\s*$', '', 'i')
       UNION ALL
       SELECT regexp_replace(o.nombre, '\s+S\.?\s?A\.?(\s?C\.?|\s?A\.?)?\s*$', '', 'i')
       UNION ALL
       -- Lo de después del guion, con el lugar del gobierno detrás.
       SELECT regexp_replace(o.nombre, '^[^-]*\s-\s', '') || ' ' || g.lugar
         FROM (SELECT substring(o.nombre FROM '(?i)^\s*(?:GOBIERNO REGIONAL|GOB\. REG\.|REGION|MUNICIPALIDAD (?:PROVINCIAL|DISTRITAL|METROPOLITANA))(?:\s+(?:DE|DEL))?\s+([^-]+?)\s+-\s') AS lugar) g
        WHERE g.lugar IS NOT NULL
       UNION ALL
       -- Y sin el lugar, si la oficina se identifica sola (no empieza por gerencia, dirección, oficina o unidad) o ya lo nombra.
       SELECT r.resto
         FROM (SELECT regexp_replace(o.nombre, '^[^-]*\s-\s', '') AS resto) r
         LEFT JOIN _vel l ON l.ruc = o.ruc
        WHERE o.nombre ~* '^\s*(GOBIERNO REGIONAL|GOB\. REG\.|REGION|MUNICIPALIDAD (PROVINCIAL|DISTRITAL|METROPOLITANA))[^-]*\s-\s'
          AND (mef_norm(r.resto) !~ '^(GERENCIA|DIRECCION|OFICINA|SUB ?GERENCIA|SUBDIRECCION|UNIDAD|RED|AREA|DEPARTAMENTO)\M'
               OR (l.dep <> '' AND mef_norm(r.resto) ~ ('\m' || l.dep || '\M'))
               OR (l.prov <> '' AND mef_norm(r.resto) ~ ('\m' || l.prov || '\M'))
               OR (l.dist <> '' AND mef_norm(r.resto) ~ ('\m' || l.dist || '\M')))
     ) v
     WHERE v.t IS NOT NULL AND btrim(v.t) <> btrim(o.nombre) AND array_length(regexp_split_to_array(btrim(v.t), '\s+'), 1) >= 3;
  CREATE TEMP TABLE _ven ON COMMIT DROP AS
    SELECT DISTINCT ruc, mef_norm(nombre) AS k, 0 AS nivel FROM _veo
    UNION
    SELECT DISTINCT ruc, mef_norm(regexp_replace(nombre, '\s+-\s+.*$', '')), 1 FROM _veo WHERE nombre ~ '\s-\s'
    UNION
    SELECT DISTINCT ruc, mef_norm(t), 2 FROM _vev
    UNION
    SELECT DISTINCT ruc, mef_norm(regexp_replace(t, '\s*\([^)]*\)\s*$', '')), 2 FROM _vev;
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
   CROSS JOIN LATERAL unnest(claves_entidad_visitada(v.t)
                             || claves_entidad_visitada(regexp_replace(regexp_replace(v.t, '\s*\([^)]*\)\s*$', ''),
                                                                       '\s+S\.?\s?A\.?(\s?C\.?|\s?A\.?)?\s*$', '', 'i'))) c(k)
    JOIN _vek k ON k.k = c.k;
  SELECT count(*) INTO n FROM visita_entidad_ruc;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_visita_entidad_ruc() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_visita_entidad_ruc() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refrescar_visita_entidad_ruc() TO vigia_jobs;
