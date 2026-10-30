-- 212: visitas atribuidas a una sola entidad y «recién fundada» sin las que ya vendían antes (auditoría de datos del 2026-10-29).
--
-- 1. refrescar_visita_entidad_ruc(): 5 nombres del registro de visitas caían en 2 o 3 RUC (unas 248 mil visitas contadas
--    en entidades que no fueron visitadas: la UGEL de Tacna, Agricultura de Moquegua, PROGRESA, el INSN de Breña, el INPE
--    de Arequipa). Con más de un RUC, el nombre exacto o la sede central; si no, ninguno.
-- 2. refrescar_cruce_recien_fundada(): sin la bandera cuando la empresa ya tenía buenas pro u órdenes antes de su alta.
--
-- Sólo funciones. Después, por el túnel: refrescar_visita_entidad_ruc() y la cadena de visitas (visita_pariente,
-- visitas_entidad, visita_mes, persona_visita_previa, planilla_extra, visita_empresa) y refrescar_cruce_recien_fundada().

CREATE OR REPLACE FUNCTION public.refrescar_visita_entidad_ruc()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
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
  -- Migración 212: un nombre del registro que cae en dos o más RUC se queda con el que se llama exactamente así (con o
  -- sin la sigla entre paréntesis) o, si no hay, con la única sede central; si tampoco, con ninguno. «GOBIERNO REGIONAL
  -- DE TACNA» caía en la sede, la UGEL y un proyecto especial: 221 mil visitas contadas en las tres.
  CREATE TEMP TABLE _vamb ON COMMIT DROP AS
    SELECT a.entidad_visitada,
           (SELECT CASE WHEN count(DISTINCT m.ruc) = 1 THEN min(m.ruc) END
              FROM visita_entidad_ruc m JOIN _veo o ON o.ruc = m.ruc
             WHERE m.entidad_visitada = a.entidad_visitada
               AND mef_norm(o.nombre) IN (mef_norm(a.entidad_visitada),
                                          mef_norm(regexp_replace(a.entidad_visitada, '\s*\([^)]*\)\s*$', '')))) AS exacto,
           (SELECT CASE WHEN count(DISTINCT m.ruc) = 1 THEN min(m.ruc) END
              FROM visita_entidad_ruc m JOIN _veo o ON o.ruc = m.ruc
             WHERE m.entidad_visitada = a.entidad_visitada AND o.nombre ~* 'SEDE CENTRAL') AS sede
      FROM (SELECT entidad_visitada FROM visita_entidad_ruc GROUP BY 1 HAVING count(*) > 1) a;
  DELETE FROM visita_entidad_ruc v USING _vamb a
   WHERE v.entidad_visitada = a.entidad_visitada AND v.ruc IS DISTINCT FROM COALESCE(a.exacto, a.sede);
  SELECT count(*) INTO n FROM visita_entidad_ruc;
  RETURN n;
END $function$;

CREATE OR REPLACE FUNCTION public.refrescar_cruce_recien_fundada()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE n int;
BEGIN
  DELETE FROM cruces_proveedor WHERE tipo IN ('recien_fundada', 'recien_fundada_medio_ano', 'recien_fundada_un_ano', 'recien_fundada_dos_anos');
  -- Migración 212: primero las candidatas (unas 17 mil filas) y después, por índice, cuáles ya le vendían al Estado antes de
  -- su alta en la SUNAT: esa fecha no es la de fundación (un RUC reactivado o reinscrito) y 611 banderas caían en empresas
  -- con buenas pro u órdenes anteriores. En una sola consulta el planificador recorría las 28 M de órdenes.
  CREATE TEMP TABLE _rf ON COMMIT DROP AS
  WITH ganados AS (
    SELECT a.ruc_proveedor AS ruc, a.codigo_convocatoria AS codigo, a.entidad_ruc,
           max(a.fecha_buenapro) AS f,
           sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS monto
      FROM conosce_adjudicaciones a
     WHERE a.ruc_proveedor ~ '^20[0-9]{9}$'
     GROUP BY 1, 2, 3
  ), cv AS (
    SELECT DISTINCT ON (c.codigo, c.entidad_ruc) c.codigo, c.entidad_ruc, c.ocid
      FROM convocatorias c
     WHERE c.codigo IN (SELECT codigo FROM ganados)
     ORDER BY c.codigo, c.entidad_ruc, c.ocid
  )
  SELECT e.fecha_alta_ruc AS alta, CASE WHEN d.dias < 180 THEN 'recien_fundada_medio_ano'
              WHEN d.dias < 365 THEN 'recien_fundada_un_ano'
              ELSE 'recien_fundada_dos_anos' END AS tipo,
         g.ruc, cv.ocid,
         CASE WHEN d.dias < 180 THEN 'alta'
              WHEN g.monto >= 1000000 AND d.dias < 365 THEN 'alta'
              WHEN d.dias < 365 THEN 'media'
              ELSE 'baja' END AS severidad,
         g.f AS fecha, g.monto,
         jsonb_build_object('fundada', e.fecha_alta_ruc, 'buena_pro', g.f, 'dias', d.dias,
                            'meses', round(d.dias / 30.44), 'monto', g.monto, 'millonario', g.monto >= 1000000) AS detalle,
         'sunat'::text AS fuente, 'https://e-consultaruc.sunat.gob.pe/'::text AS fuente_url
    FROM ganados g
    JOIN empresas e ON e.ruc = g.ruc AND e.fecha_alta_ruc IS NOT NULL
    JOIN cv ON cv.codigo = g.codigo AND cv.entidad_ruc = g.entidad_ruc
    CROSS JOIN LATERAL (SELECT (g.f - e.fecha_alta_ruc) AS dias) d
   WHERE g.f IS NOT NULL AND d.dias >= 0 AND d.dias < 730 AND g.monto >= 44000;
  ANALYZE _rf;
  CREATE TEMP TABLE _rf_antes ON COMMIT DROP AS
  SELECT r.ruc FROM (SELECT DISTINCT ruc, alta FROM _rf) r
   WHERE EXISTS (SELECT 1 FROM conosce_adjudicaciones a2 WHERE a2.ruc_proveedor = r.ruc AND a2.fecha_buenapro < r.alta)
      OR EXISTS (SELECT 1 FROM conosce_ordenes o WHERE o.ruc_contratista = r.ruc AND o.fecha_emision < r.alta
                   AND o.estado IS DISTINCT FROM 'Anulada');
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT tipo, ruc, ocid, severidad, fecha, monto, detalle, fuente, fuente_url
    FROM _rf WHERE ruc NOT IN (SELECT ruc FROM _rf_antes);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;
