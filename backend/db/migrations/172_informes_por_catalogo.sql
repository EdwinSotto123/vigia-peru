-- 172 · Los informes de la Contraloría sin entidad: dos niveles más en refrescar_informes_control_entidad().
--
-- 3,009 informes (517 nombres) no tenían ningún candidato por nombre, sigla, subunidad ni ubigeo: entidades nacionales con
-- varias unidades y empresas del Estado (Provías Descentralizado, PNP, SEDAPAR, Hidrandina…). La Contraloría usa el mismo
-- catálogo de entidades en INFOBRAS, y la migración 160 le dio a cada una su RUC por consenso del CUI de sus obras; el
-- registro del OECE (migración 150) trae el nombre oficial de cada RUC. Medido antes de aplicar: 75 nombres (569
-- informes) empatan exacto con INFOBRAS, sin ambigüedad, y 23 (180) con el OECE. Van como niveles 8 y 9, después de
-- todos los anteriores, con la misma regla de lugar para municipios y gobiernos regionales.
-- Revisado a mano antes de aplicarlo: el RUC de INFOBRAS sale del consenso del CUI y a veces es el de quien financia la
-- obra, no el de la entidad (Electro Puno → la DGER del MINEM, Sedacusco → la Municipalidad del Cusco, una UGEL → su
-- municipalidad provincial). Por eso el candidato de estos dos niveles tiene que compartir con el nombre del informe al
-- menos una palabra propia (palabras_propias_entidad: de 4 letras o más, sin las genéricas ni las de un departamento o
-- provincia). Medido en DEV: de 138 nombres, 87 pasan; los 51 que no, casi todos errores (y unos pocos válidos que se
-- pierden: mejor sin entidad que con una ajena, son informes con responsabilidad presunta).
-- Después de aplicar: SELECT * FROM refrescar_informes_control_entidad();

CREATE OR REPLACE FUNCTION palabras_propias_entidad(p text) RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(DISTINCT w), '{}')
    FROM unnest(regexp_split_to_array(upper(immutable_unaccent(coalesce(p, ''))), '[^A-Z0-9]+')) w
   WHERE length(w) >= 4
     AND w <> ALL (ARRAY['GOBIERNO', 'REGIONAL', 'MUNICIPALIDAD', 'DISTRITAL', 'PROVINCIAL', 'DIRECCION', 'GERENCIA',
                         'SUBREGIONAL', 'NACIONAL', 'UNIDAD', 'EJECUTORA', 'PROGRAMA', 'SEDE', 'CENTRAL', 'PERU', 'PARA',
                         'ZONAL', 'ZONA', 'OFICINA', 'GENERAL', 'ADMINISTRACION', 'PROYECTO', 'ESPECIAL', 'EMPRESA',
                         'SERVICIO', 'SERVICIOS', 'PUBLICO', 'PUBLICA', 'SOCIEDAD', 'ANONIMA', 'PERUANO', 'PERUANA',
                         'INSTITUTO', 'HOSPITAL', 'UNIVERSIDAD', 'AUTONOMA', 'ORGANISMO', 'MINISTERIO', 'REDES',
                         'DEPARTAMENTO', 'REGION', 'SUPERIOR', 'TECNOLOGICO', 'PEDAGOGICO', 'COLEGIO', 'ESCUELA', 'FONDO',
                         'SISTEMA'])
     AND NOT EXISTS (SELECT 1 FROM zonas z
                      WHERE z.nivel IN ('departamento', 'provincia')
                        AND w = ANY (regexp_split_to_array(upper(immutable_unaccent(z.nombre)), '[^A-Z0-9]+')))
     AND w NOT IN ('CALLAO', 'LIMA')
$$;

CREATE OR REPLACE FUNCTION public.refrescar_informes_control_entidad()
 RETURNS TABLE(informes integer, con_ubigeo integer, con_ruc integer, ambiguos integer)
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Ubigeo.
  WITH z AS (SELECT ubigeo, nivel, padre_ubigeo, lugar_cgr(nombre) AS n FROM zonas),
  i AS (
    SELECT codigo,
           CASE WHEN lugar_cgr(departamento) LIKE '%CALLAO%' THEN 'CALLAO' ELSE lugar_cgr(departamento) END AS d,
           CASE WHEN lugar_cgr(departamento) LIKE '%CALLAO%' THEN 'CALLAO' ELSE lugar_cgr(provincia) END AS p,
           lugar_cgr(distrito) AS t
      FROM informes_control),
  r AS (
    SELECT DISTINCT ON (i.codigo) i.codigo, coalesce(zt.ubigeo, zp.ubigeo, zd.ubigeo) AS ubigeo
      FROM i
      LEFT JOIN z zd ON zd.nivel = 'departamento' AND zd.n = i.d
      LEFT JOIN z zp ON zp.nivel = 'provincia' AND zp.padre_ubigeo = zd.ubigeo AND zp.n = i.p
      LEFT JOIN z zt ON zt.nivel = 'distrito' AND zt.padre_ubigeo = zp.ubigeo AND zt.n = i.t
     ORDER BY i.codigo, zt.ubigeo, zp.ubigeo)
  UPDATE informes_control ic SET ubigeo = r.ubigeo
    FROM r WHERE r.codigo = ic.codigo AND ic.ubigeo IS DISTINCT FROM r.ubigeo;

  -- RUC.
  -- MATERIALIZED: sin él Postgres repite deps (y relee zonas) por cada nombre: 10 s en vez de milisegundos.
  WITH lugares AS MATERIALIZED (
    SELECT DISTINCT lugar_cgr(nombre) AS n FROM zonas
    UNION SELECT unnest(ARRAY['PERU', 'NORTE', 'SUR', 'ESTE', 'OESTE', 'CENTRO', 'CENTRAL', 'SEDE', 'REGION', 'NACIONAL', 'REGIONAL'])),
  deps AS MATERIALIZED (   -- 'GOBIERNO REGIONAL <departamento> ', el prefijo de sus subunidades
    SELECT 'GOBIERNO REGIONAL ' || d || ' ' AS p
      FROM (SELECT clave_entidad_cgr(nombre) AS d FROM zonas WHERE nivel = 'departamento'
            UNION VALUES ('LIMA METROPOLITANA'), ('PROVINCIA CONSTITUCIONAL CALLAO')) x),
  -- los nombres de los dos lados; territorial: el informe es de un gobierno local o regional
  nombres AS (
    SELECT 'e' AS lado, ruc AS id, ubigeo::text AS ubigeo, nombre, NULL::boolean AS territorial FROM entidades
    UNION ALL
    SELECT 'i', codigo, ubigeo, entidad_nombre,
           coalesce(nivel_gobierno IN ('GOBIERNO LOCAL', 'GOBIERNO REGIONAL'), false)
             OR coalesce(clave_entidad_cgr(entidad_nombre) ~ '^(MUNICIPALIDAD|GOBIERNO REGIONAL)', false)
      FROM informes_control),
  -- cada nombre con su clave, sus tramos y la clave del último tramo
  t AS (
    SELECT n.*, clave_entidad_cgr(n.nombre) AS k1, tr, cardinality(tr) AS nt, clave_entidad_cgr(tr[cardinality(tr)]) AS ult
      FROM nombres n, LATERAL (SELECT tramos_entidad_cgr(n.nombre) AS tr) x),
  claves AS (
    SELECT t.lado, t.id, t.ubigeo, t.territorial, t.k1,
           -- sin el último tramo, si es menor (una palabra, un lugar o la sede)
           CASE WHEN t.nt >= 2 AND (t.ult !~ ' ' OR t.ult IN (SELECT n FROM lugares)
                                    OR t.ult ~ '^(ADMINISTRACION GENERAL|OFICINA GENERAL ADMINISTRACION|PNP UE 001 OGA|UE 001|UNIDAD EJECUTORA 001)')
                THEN NULLIF(clave_entidad_cgr(array_to_string(t.tr[1:t.nt - 1], ' ')), '') END AS k2,
           -- la sigla final: una palabra de 4+ letras que no es un lugar
           CASE WHEN t.nt >= 2 AND t.ult !~ ' ' AND length(t.ult) >= 4 AND t.ult NOT IN (SELECT n FROM lugares WHERE n IS NOT NULL)
                THEN t.ult END AS sigla,
           -- la subunidad: el nombre sin 'GOBIERNO REGIONAL <departamento>' o sin un primer tramo padre (MTC, MINAG…)
           CASE WHEN t.k1 LIKE 'GOBIERNO REGIONAL %'
                THEN (SELECT substr(t.k1, length(d.p) + 1) FROM deps d
                       WHERE left(t.k1, length(d.p)) = d.p ORDER BY length(d.p) DESC LIMIT 1)
                WHEN t.nt >= 2 AND clave_entidad_cgr(t.tr[1]) ~ '^(MTC|MINAG|MINSA|MINEDU|MIDIS|MINAM|MINCETUR|PRODUCE|UNIDAD EJECUTORA)( |$)'
                THEN clave_entidad_cgr(array_to_string(t.tr[2:t.nt], ' ')) END AS k3,
           CASE WHEN t.k1 LIKE 'MUNICIPALIDAD DISTRITAL %' THEN 'D' WHEN t.k1 LIKE 'MUNICIPALIDAD PROVINCIAL %' THEN 'P' END AS muni
      FROM t),
  e AS (SELECT * FROM claves WHERE lado = 'e'),
  -- Migración 172: el catálogo de entidades de la Contraloría que usa INFOBRAS (con el RUC que le dio refrescar_obras()
  -- por consenso del CUI) y el registro de entidades del OECE (entidad_siaf). Sólo deciden si ningún nivel anterior
  -- encontró nada: los 3,009 informes sin entidad del 2026-10-27 no tenían ningún candidato.
  catalogo AS MATERIALIZED (
    SELECT DISTINCT 8 AS nivel, clave_entidad_cgr(o.entidad_nombre) AS k, o.entidad_ruc::text AS ruc, en.ubigeo::text AS ubigeo,
           palabras_propias_entidad(en.nombre) AS palabras
      FROM (SELECT DISTINCT entidad_nombre, entidad_ruc FROM obra_infobras WHERE entidad_ruc IS NOT NULL AND entidad_nombre IS NOT NULL) o
      JOIN entidades en ON en.ruc = o.entidad_ruc
    UNION
    SELECT DISTINCT 9, clave_entidad_cgr(s.nombre), s.ruc::text, en.ubigeo::text, palabras_propias_entidad(en.nombre)
      FROM entidad_siaf s JOIN entidades en ON en.ruc = s.ruc
     WHERE s.nombre IS NOT NULL),
  i AS (SELECT * FROM claves WHERE lado = 'i'),
  cand AS (
    SELECT i.id AS codigo, 1 AS nivel, e.id AS ruc, e.ubigeo FROM i JOIN e ON e.k1 = i.k1
    UNION SELECT i.id, 2, e.id, e.ubigeo FROM i JOIN e ON e.k2 = i.k1 AND e.k2 ~ ' '
    UNION SELECT i.id, 3, e.id, e.ubigeo FROM i JOIN e ON e.k1 = i.k2 AND i.k2 ~ ' '
    UNION SELECT i.id, 4, e.id, e.ubigeo FROM i JOIN e ON e.k3 = i.k1 AND e.k3 ~ ' '
    UNION SELECT i.id, 5, e.id, e.ubigeo FROM i JOIN e ON e.sigla = i.sigla
    UNION SELECT i.id, 6, e.id, e.ubigeo FROM i JOIN e ON i.muni = 'D' AND e.muni = 'D' AND length(i.ubigeo) = 6 AND e.ubigeo = i.ubigeo
    UNION SELECT i.id, 7, e.id, e.ubigeo FROM i JOIN e
            ON i.muni = 'P' AND e.muni = 'P' AND length(i.ubigeo) >= 4 AND left(e.ubigeo, 4) = left(i.ubigeo, 4)
    UNION SELECT i.id, k.nivel, k.ruc, k.ubigeo FROM i JOIN catalogo k
            ON k.k = i.k1 AND k.k <> '' AND palabras_propias_entidad(i.k1) && k.palabras),
  -- loc: 2 = mismo ubigeo, 1 = mismo departamento, 0 = otro o sin dato
  p AS (
    SELECT c.codigo, c.nivel, c.ruc, i.territorial OR c.nivel IN (4, 6, 7) AS exige_lugar,
           CASE WHEN i.ubigeo IS NULL OR c.ubigeo IS NULL THEN 0 WHEN c.ubigeo = i.ubigeo THEN 2
                WHEN left(c.ubigeo, 2) = left(i.ubigeo, 2) THEN 1 ELSE 0 END AS loc,
           count(*) OVER (PARTITION BY c.codigo, c.nivel) AS n
      FROM cand c JOIN i ON i.id = c.codigo),
  q AS (SELECT p.*, max(loc) OVER (PARTITION BY codigo, nivel) AS mejor FROM p),
  admisibles AS (
    SELECT * FROM q
     WHERE (n = 1 AND (loc > 0 OR NOT exige_lugar)) OR (n > 1 AND mejor > 0 AND loc = mejor)),
  -- decide el primer nivel con algún admisible; con más de uno en ese nivel, ambiguo
  elegido AS (
    SELECT codigo, nivel, min(ruc) AS ruc, count(*) AS k
      FROM (SELECT a.*, min(nivel) OVER (PARTITION BY codigo) AS primero FROM admisibles a) x
     WHERE nivel = primero GROUP BY codigo, nivel),
  r AS (
    SELECT ic.codigo,
           CASE WHEN el.k = 1 THEN el.ruc END AS ruc,
           CASE WHEN el.k > 1 THEN 'ambiguo' ELSE (ARRAY['nombre', 'nombre_sin_tramo_e', 'nombre_sin_tramo_i', 'subunidad', 'sigla',
                'municipalidad_distrital_ubigeo', 'municipalidad_provincial_ubigeo',
                'catalogo_infobras', 'registro_oece'])[el.nivel] END AS cruce
      FROM informes_control ic LEFT JOIN elegido el ON el.codigo = ic.codigo)
  UPDATE informes_control ic SET entidad_ruc = r.ruc, entidad_cruce = r.cruce
    FROM r WHERE r.codigo = ic.codigo
     AND (ic.entidad_ruc IS DISTINCT FROM r.ruc OR ic.entidad_cruce IS DISTINCT FROM r.cruce);

  RETURN QUERY
  SELECT count(*)::int, count(*) FILTER (WHERE length(ubigeo) = 6)::int, count(entidad_ruc)::int,
         count(*) FILTER (WHERE entidad_cruce = 'ambiguo')::int
    FROM informes_control;
END $function$;
