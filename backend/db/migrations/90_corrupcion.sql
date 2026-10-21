-- 90 · Corrupción: informes de control de la Contraloría y casos de la Procuraduría Anticorrupción.
--
-- Hasta acá Vigía mostraba señales de riesgo en las contrataciones, pero nada de lo que el Estado ya investigó o juzgó.
-- Dos fuentes oficiales lo cubren, con pesos distintos (docs/CORRUPCION.md):
--
--   · informes_control: los informes de servicio de control de la Contraloría General de la República que señalan
--     responsabilidad PENAL, CIVIL o ADMINISTRATIVA de funcionarios (Buscador de Informes, BusquedaInformesCGR.ashx).
--     Es responsabilidad PRESUNTA: la Contraloría la identifica y la deriva; no es una condena. Los carga
--     backend/scripts/cargar_contraloria_informes.py, mensual y desde el Perú (el buscador no responde a IPs extranjeras;
--     la fuente `contraloria_informes` de vigia-scrapers hace lo mismo si algún día llega), y
--     refrescar_informes_control_entidad() les pone ubigeo y RUC.
--     El buscador trae los nombres y el DNI de cada funcionario: NO se guardan (sólo cuántos son).
--   · procuraduria_casos_sede: el boletín estadístico mensual de la Procuraduría Pública Especializada en Delitos de
--     Corrupción (PPEDC), por sede: casos en trámite, en ejecución de sentencia (sentencia firme), sentencias del año y
--     reparación civil cobrada. Lo carga backend/scripts/cargar_ppedc_boletin.py. Son cifras agregadas, sin personas.
--
-- Y lo que lee la API (rol vigia_api): informes_control_de_entidad(ruc) y corrupcion_resumen_region(ubigeo2).
-- Son datos públicos: las tablas no se le quitan a ningún rol que lee; los agentes no pueden escribirlas.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/90_corrupcion.sql
-- Después, desde una PC en el Perú: python backend/scripts/cargar_contraloria_informes.py --entorno prod (carga y cruza,
-- ~1 min) y python backend/scripts/cargar_ppedc_boletin.py --url <pdf del boletín> --entorno prod. Ver docs/CORRUPCION.md.

-- ── 1 · Informes de control de la Contraloría ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS informes_control (
  codigo              TEXT PRIMARY KEY,               -- CodigoInforme del SPIC (2026CPO215300011): no cambia
  numero              TEXT,                           -- NumeroInforme (011-2026-2-2153), el que se cita
  titulo              TEXT,                           -- Descripcion: el asunto (la Contraloría lo corta en 400 caracteres)
  modalidad           TEXT,                           -- ModalidadServicio (control específico, auditoría de cumplimiento…)
  sector              TEXT,
  nivel_gobierno      TEXT,                           -- GOBIERNO LOCAL / REGIONAL / CENTRAL
  entidad_nombre      TEXT NOT NULL,                  -- como lo escribe la Contraloría (no trae RUC)
  entidad_ruc         CHAR(11),                       -- cruce con entidades; NULL si no hay uno solo seguro
  entidad_cruce       TEXT,                           -- por qué regla se cruzó ('nombre', 'subunidad'…) o 'ambiguo'
  departamento        TEXT,                           -- nombres como vienen del buscador (de la entidad o de su oficina)
  provincia           TEXT,
  distrito            TEXT,
  ubigeo              TEXT,                           -- INEI, el más fino que se resuelva con `zonas` (6, 4 o 2 dígitos)
  responsabilidades   TEXT[] NOT NULL DEFAULT '{}',   -- penal, civil, administrativa_entidad, administrativa_pas
  funcionarios        INT,                            -- TotalFuncionarios: cuántos, nunca quiénes
  fecha_emision       DATE,
  fecha_publicacion   DATE,
  fecha_fin_ejecucion DATE,
  url_pdf             TEXT,                           -- el informe (TIPOARCHIVO=ADJUNTO)
  url_resumen         TEXT,                           -- el resumen ejecutivo (TIPOARCHIVO=RE)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE informes_control IS
  'Informes de control de la Contraloría con responsabilidad señalada (PRESUNTA: no es condena). Sin nombres ni DNI de '
  'funcionarios. Carga: backend/scripts/cargar_contraloria_informes.py (o la fuente contraloria_informes de vigia-scrapers); '
  'RUC y ubigeo: refrescar_informes_control_entidad().';
COMMENT ON COLUMN informes_control.responsabilidades IS
  'Tipos de responsabilidad que el informe señala: penal, civil, administrativa_entidad (la procesa la entidad), '
  'administrativa_pas (procedimiento sancionador de la Contraloría), administrativa (sin detalle). Presunta.';
CREATE INDEX IF NOT EXISTS informes_control_ruc ON informes_control (entidad_ruc, fecha_emision DESC) WHERE entidad_ruc IS NOT NULL;
CREATE INDEX IF NOT EXISTS informes_control_departamento ON informes_control ((left(ubigeo, 2)), fecha_emision DESC);
ALTER TABLE informes_control OWNER TO vigia_jobs;

-- ── 2 · Casos de la Procuraduría Anticorrupción por sede ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS procuraduria_casos_sede (
  corte             DATE NOT NULL,                  -- último día del mes del boletín (julio 2026 → 2026-07-31)
  sede              TEXT NOT NULL,                  -- como en el boletín: 'Lima (Sede Central)', 'Del Santa', 'Sullana'…
  departamento      CHAR(2) NOT NULL,               -- ubigeo del departamento de la sede (mapa en cargar_ppedc_boletin.py)
  en_tramite        INT NOT NULL,                   -- casos en trámite al corte; INCLUYE los en ejecución (así cuenta la PPEDC)
  en_ejecucion      INT NOT NULL,                   -- casos en ejecución de sentencia: sentencia firme, se cobra la reparación
  importancia_a_mas INT,                            -- A+ (emblemáticos)
  importancia_a     INT,
  importancia_b     INT,
  casos_nuevos      INT,                            -- ingresados del 1 de enero al corte
  sentencias        INT,                            -- "sentencias favorables" del 1 de enero al corte (sentencias y autos
                                                    -- consentidos o ejecutoriados que fijan reparación civil al Estado)
  reparacion_civil  NUMERIC(16, 2),                 -- reparación civil COBRADA del 1 de enero al corte (S/)
  url_fuente        TEXT NOT NULL,
  cargado_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (corte, sede)
);
COMMENT ON TABLE procuraduria_casos_sede IS
  'Boletín estadístico de la Procuraduría Pública Especializada en Delitos de Corrupción, por sede y corte. en_ejecucion = '
  'casos con sentencia firme. Carga: backend/scripts/cargar_ppedc_boletin.py.';
CREATE INDEX IF NOT EXISTS procuraduria_casos_sede_departamento ON procuraduria_casos_sede (departamento, corte DESC);
ALTER TABLE procuraduria_casos_sede OWNER TO vigia_jobs;

-- ── 3 · Cruce de los informes con `zonas` y `entidades` ────────────────────────────────────────
-- La Contraloría no da RUC ni ubigeo: da el nombre de la entidad y el departamento/provincia/distrito en texto.

-- Nombre de lugar para comparar con `zonas`: sin paréntesis ('PUEBLO LIBRE(MAGDALENA VIEJA)'), sin tildes, mayúsculas.
CREATE OR REPLACE FUNCTION lugar_cgr(p TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(btrim(regexp_replace(
           upper(public.immutable_unaccent(regexp_replace(coalesce(p, ''), '\(.*?\)', ' ', 'g'))),
           '[^A-Z0-9]+', ' ', 'g')), '')
$$;

-- Clave de nombre de entidad: sin tildes ni signos, con la forma societaria junta ('S.A.' y 'SA' → 'SA'), sin artículos
-- ni preposiciones (DE, DEL, LA…) y sin un 'SEDE CENTRAL' final.
-- 'GOBIERNO REGIONAL DE PUNO SEDE CENTRAL' y 'GOBIERNO REGIONAL PUNO' → 'GOBIERNO REGIONAL PUNO'.
CREATE OR REPLACE FUNCTION clave_entidad_cgr(p TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(regexp_replace(btrim(regexp_replace(regexp_replace(
           replace(replace(replace(replace(replace(
             ' ' || regexp_replace(upper(public.immutable_unaccent(coalesce(p, ''))), '[^A-Z0-9]+', ' ', 'g') || ' ',
             ' S A A ', ' SAA '), ' S A C ', ' SAC '), ' S A ', ' SA '), ' S R L ', ' SRL '), ' E I R L ', ' EIRL '),
           '\m(DE|DEL|LA|LAS|LOS|EL|Y|E)\M', ' ', 'g'), '\s+', ' ', 'g')), '( SEDE CENTRAL)+$', ''), '')
$$;

-- Los tramos de un nombre separados por guion o paréntesis: 'GOBIERNO REGIONAL DE ICA-HOSPITAL REGIONAL DE ICA' →
-- {'GOBIERNO REGIONAL DE ICA', 'HOSPITAL REGIONAL DE ICA'}.
CREATE OR REPLACE FUNCTION tramos_entidad_cgr(p TEXT) RETURNS TEXT[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_agg(btrim(t) ORDER BY n), '{}')
    FROM regexp_split_to_table(replace(coalesce(p, ''), ')', ' '), '\s*[-–(]\s*') WITH ORDINALITY AS x(t, n)
   WHERE btrim(t) <> ''
$$;

/*
 * Pone `ubigeo` y `entidad_ruc` a todos los informes (se rehace entero: ~15 mil filas, 8 s en DEV). Lo corre cada carga
 * de informes al final (script o fuente del Worker); también sirve tras cargar entidades nuevas.
 *
 * Ubigeo: departamento → provincia → distrito por nombre en `zonas` ('P. C. DEL CALLAO' = Callao); queda el nivel más
 * fino que se resuelva.
 *
 * RUC, por niveles; manda el primer nivel con algún candidato admisible:
 *   1 nombre               misma clave (clave_entidad_cgr)
 *   2 nombre_sin_tramo_e   el nombre del informe = el de la entidad sin su último tramo, si ese tramo es menor: una sola
 *                          palabra, un lugar o la sede ('MINISTERIO DE VIVIENDA… - Administración General', '… - JULIACA')
 *   3 nombre_sin_tramo_i   al revés: el informe sin su último tramo menor ('SEGURO SOCIAL DE SALUD - ESSALUD')
 *   4 subunidad            el nombre del informe = la entidad sin su padre ('GOBIERNO REGIONAL DE ICA-HOSPITAL REGIONAL DE
 *                          ICA', 'MTC-…', 'UNIDAD EJECUTORA 304 - …')
 *   5 sigla                misma sigla final de una palabra que no es un lugar ('… - SEDAPAL', '… - PRONIED')
 *   6 municipalidad_distrital_ubigeo   'MUNICIPALIDAD DISTRITAL …' y la única municipalidad distrital de ese distrito
 *   7 municipalidad_provincial_ubigeo  ídem con la provincia
 * Ubicación: los informes de gobiernos locales y regionales (y los niveles 4, 6 y 7) exigen que la entidad esté en el
 * mismo departamento. Si un nivel tiene varios candidatos, gana el del mismo ubigeo o, si no, del mismo departamento;
 * si aun así quedan varios, el informe queda SIN RUC ('ambiguo'): nunca se fuerza un cruce. Las entidades nacionales con
 * un solo candidato se aceptan aunque el informe esté en otro departamento (EsSalud, SUNAT: el informe va con la
 * oficina donde pasó).
 */
CREATE OR REPLACE FUNCTION refrescar_informes_control_entidad()
RETURNS TABLE (informes INT, con_ubigeo INT, con_ruc INT, ambiguos INT)
LANGUAGE plpgsql AS $$
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
  i AS (SELECT * FROM claves WHERE lado = 'i'),
  cand AS (
    SELECT i.id AS codigo, 1 AS nivel, e.id AS ruc, e.ubigeo FROM i JOIN e ON e.k1 = i.k1
    UNION SELECT i.id, 2, e.id, e.ubigeo FROM i JOIN e ON e.k2 = i.k1 AND e.k2 ~ ' '
    UNION SELECT i.id, 3, e.id, e.ubigeo FROM i JOIN e ON e.k1 = i.k2 AND i.k2 ~ ' '
    UNION SELECT i.id, 4, e.id, e.ubigeo FROM i JOIN e ON e.k3 = i.k1 AND e.k3 ~ ' '
    UNION SELECT i.id, 5, e.id, e.ubigeo FROM i JOIN e ON e.sigla = i.sigla
    UNION SELECT i.id, 6, e.id, e.ubigeo FROM i JOIN e ON i.muni = 'D' AND e.muni = 'D' AND length(i.ubigeo) = 6 AND e.ubigeo = i.ubigeo
    UNION SELECT i.id, 7, e.id, e.ubigeo FROM i JOIN e
            ON i.muni = 'P' AND e.muni = 'P' AND length(i.ubigeo) >= 4 AND left(e.ubigeo, 4) = left(i.ubigeo, 4)),
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
                'municipalidad_distrital_ubigeo', 'municipalidad_provincial_ubigeo'])[el.nivel] END AS cruce
      FROM informes_control ic LEFT JOIN elegido el ON el.codigo = ic.codigo)
  UPDATE informes_control ic SET entidad_ruc = r.ruc, entidad_cruce = r.cruce
    FROM r WHERE r.codigo = ic.codigo
     AND (ic.entidad_ruc IS DISTINCT FROM r.ruc OR ic.entidad_cruce IS DISTINCT FROM r.cruce);

  RETURN QUERY
  SELECT count(*)::int, count(*) FILTER (WHERE length(ubigeo) = 6)::int, count(entidad_ruc)::int,
         count(*) FILTER (WHERE entidad_cruce = 'ambiguo')::int
    FROM informes_control;
END $$;
ALTER FUNCTION refrescar_informes_control_entidad() OWNER TO vigia_jobs;

-- ── 4 · Lo que lee la API ──────────────────────────────────────────────────────────────────────
-- Sin nombres ni DNI: en las tablas no hay. La etiqueta en la web: "Presunta responsabilidad penal/civil (Contraloría) —
-- no es una condena" y "Sentencia firme (Procuraduría Anticorrupción)".

-- Los informes de control de una entidad, del más nuevo al más viejo.
CREATE OR REPLACE FUNCTION informes_control_de_entidad(p_ruc TEXT)
RETURNS TABLE (numero TEXT, titulo TEXT, fecha DATE, responsabilidades TEXT[], funcionarios INT, modalidad TEXT,
               url_pdf TEXT, url_resumen TEXT)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT numero, titulo, coalesce(fecha_emision, fecha_publicacion), responsabilidades, funcionarios, modalidad, url_pdf, url_resumen
    FROM informes_control
   WHERE entidad_ruc = p_ruc
   ORDER BY coalesce(fecha_emision, fecha_publicacion) DESC NULLS LAST, codigo DESC
$$;

/*
 * Corrupción en un departamento (ubigeo de 2 dígitos), en un jsonb:
 *   procuraduria: el último corte del boletín, sumado por las sedes del departamento, y cada sede
 *   informes:     informes de control ubicados en el departamento, por tipo de responsabilidad
 *   ultimos:      los 10 informes más nuevos
 * Un departamento sin datos devuelve procuraduria null, informes en cero y ultimos [].
 */
CREATE OR REPLACE FUNCTION corrupcion_resumen_region(p_ubigeo2 TEXT)
RETURNS JSONB LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH ic AS (SELECT * FROM informes_control WHERE left(ubigeo, 2) = p_ubigeo2),
  ult AS (SELECT max(corte) AS corte FROM procuraduria_casos_sede WHERE departamento = p_ubigeo2),
  sedes AS (SELECT s.* FROM procuraduria_casos_sede s JOIN ult ON s.corte = ult.corte WHERE s.departamento = p_ubigeo2)
  SELECT jsonb_build_object(
    'departamento', p_ubigeo2,
    'procuraduria', (
      SELECT CASE WHEN count(*) > 0 THEN jsonb_build_object(
               'corte', max(corte), 'en_tramite', sum(en_tramite), 'en_ejecucion', sum(en_ejecucion),
               'sentencias', sum(sentencias), 'reparacion_civil', sum(reparacion_civil), 'casos_nuevos', sum(casos_nuevos),
               'url_fuente', max(url_fuente),
               'sedes', jsonb_agg(jsonb_build_object('sede', sede, 'en_tramite', en_tramite, 'en_ejecucion', en_ejecucion,
                                  'sentencias', sentencias, 'reparacion_civil', reparacion_civil) ORDER BY en_tramite DESC)) END
        FROM sedes),
    'informes', (
      SELECT jsonb_build_object(
               'total', count(*),
               'penal', count(*) FILTER (WHERE 'penal' = ANY (responsabilidades)),
               'civil', count(*) FILTER (WHERE 'civil' = ANY (responsabilidades)),
               'administrativa_entidad', count(*) FILTER (WHERE 'administrativa_entidad' = ANY (responsabilidades)),
               'administrativa_pas', count(*) FILTER (WHERE 'administrativa_pas' = ANY (responsabilidades)),
               'funcionarios', coalesce(sum(funcionarios), 0),
               'entidades', count(DISTINCT entidad_ruc),
               'desde', min(fecha_emision), 'hasta', max(fecha_emision))
        FROM ic),
    'ultimos', coalesce((
      SELECT jsonb_agg(jsonb_build_object('numero', numero, 'titulo', titulo, 'fecha', fecha, 'entidad', entidad_nombre,
                       'entidad_ruc', entidad_ruc, 'responsabilidades', responsabilidades, 'url_pdf', url_pdf) ORDER BY fecha DESC NULLS LAST, codigo DESC)
        FROM (SELECT *, coalesce(fecha_emision, fecha_publicacion) AS fecha FROM ic
               ORDER BY coalesce(fecha_emision, fecha_publicacion) DESC NULLS LAST, codigo DESC LIMIT 10) u), '[]'::jsonb))
$$;

-- ── 5 · Permisos ───────────────────────────────────────────────────────────────────────────────
-- Datos públicos: los leen la API, el panel, el MCP y los agentes. Escribe sólo vigia_jobs (dueño).
GRANT SELECT ON informes_control, procuraduria_casos_sede TO vigia_api, vigia_api_admin, vigia_mcp;
GRANT EXECUTE ON FUNCTION informes_control_de_entidad(TEXT), corrupcion_resumen_region(TEXT) TO vigia_api, vigia_api_admin, vigia_mcp;
GRANT EXECUTE ON FUNCTION lugar_cgr(TEXT), clave_entidad_cgr(TEXT), tramos_entidad_cgr(TEXT) TO vigia_jobs, vigia_api, vigia_api_admin;
REVOKE EXECUTE ON FUNCTION refrescar_informes_control_entidad() FROM PUBLIC;
DO $$
BEGIN
  -- Los privilegios por defecto de la 43 dan a vigia_agentes escritura en toda tabla nueva: aquí sólo lee.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_agentes') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON informes_control, procuraduria_casos_sede FROM vigia_agentes;
    GRANT SELECT ON informes_control, procuraduria_casos_sede TO vigia_agentes;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_ab') THEN
    GRANT SELECT ON informes_control, procuraduria_casos_sede TO vigia_ab;
  END IF;
END $$;
