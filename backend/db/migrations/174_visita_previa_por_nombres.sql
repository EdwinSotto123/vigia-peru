-- 174 · «Visitó la entidad antes de ganar»: la entidad visitada se reconoce por todos sus nombres.
--
-- La migración 115 exigió que la visita fuera a la MISMA entidad que adjudicó (antes se unía sólo por DNI y fecha, y el
-- 99 % era ruido), pero comparando el nombre del registro de visitas con el de `entidades` letra por letra: «GOBIERNO
-- REGIONAL CUSCO» no es «GOBIERNO REGIONAL DE CUSCO», ni «MUNICIPALIDAD DISTRITAL DE MAJES» es «MUNICIPALIDAD DISTRITAL
-- DE MAJES - VILLA EL PEDREGAL». De los 346 nombres que trae el registro (82 mil visitas, ene. 2025 a may. 2026) sólo 95
-- calzaban, el 15 % de las visitas: 46 cruces en todo el país, y el dueño veía que «la visita nunca aparece».
--
-- Ahora:
--   · la entidad se reconoce por cualquiera de sus nombres: el del padrón y los que usa en CONOSCE al adjudicar y al
--     emitir órdenes (empresa_orden_anual);
--   · del lado de la visita, sus variantes: sin la sigla final «(VIVIENDA)», sin lo que va tras « - » («- PCM», «- LA
--     LIBERTAD - PERÚ»), sin el artículo inicial («LA CONTRALORÍA…»), con el «DE» que usa el padrón («GOBIERNO REGIONAL
--     DE CUSCO») y con «SEDE CENTRAL»;
--   · del lado de la entidad, el nombre entero y, si no hay otra que se llame así, el nombre sin lo que va tras « - »;
--   · un nombre que comparten entidades de distritos distintos (dos «Santa Rosa», las unidades del Gobierno Regional de
--     Cusco) no se usa: la visita podría ser a la otra. Mejor perder el cruce que pegarlo a quien no es.
-- Los contratos salen de CONOSCE (adjudicaciones con su OCID, como socio_en_entidad), los consorcios por sus
-- integrantes, y la gente del ganador del RNP (socios, representantes, directivos) o el titular de un RUC 10.
--
-- Corre después de refrescar_cruces() (que sigue insertando los suyos con la regla vieja): borra el tipo y lo rehace.
-- La llama comun.ts del Worker de scrapers (siExiste), antes de dedup_cruces_proveedor y refrescar_casos_cruce_base.
--
-- Cómo aplicarla: python infrastructure/dev/dev.py migrar backend/db/migrations/174_visita_previa_por_nombres.sql (DEV);
-- en producción con tunel_rds y luego SELECT refrescar_cruce_visita_previa(), dedup_cruces_proveedor() y
-- refrescar_casos_cruce_base().

CREATE OR REPLACE FUNCTION claves_entidad_visitada(t TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  WITH b AS (
    SELECT unnest(ARRAY[
      t,
      regexp_replace(t, '\s*\([^)]*\)\s*$', ''),
      regexp_replace(t, '\s+-\s+.*$', ''),
      regexp_replace(regexp_replace(t, '\s*\([^)]*\)\s*$', ''), '\s+-\s+.*$', ''),
      regexp_replace(t, '^\s*(LA|EL|LOS|LAS)\s+', '', 'i')
    ]) AS x),
  n AS (SELECT DISTINCT mef_norm(x) AS k FROM b WHERE x IS NOT NULL),
  d AS (
    SELECT k FROM n
    UNION
    SELECT regexp_replace(k, '^(GOBIERNO REGIONAL|MUNICIPALIDAD DISTRITAL|MUNICIPALIDAD PROVINCIAL) (?!DE |DEL )', '\1 DE ') FROM n)
  SELECT array_agg(DISTINCT v) FROM (SELECT k AS v FROM d WHERE k <> '' UNION SELECT k || ' SEDE CENTRAL' FROM d WHERE k <> '') z
$$;

CREATE OR REPLACE FUNCTION refrescar_cruce_visita_previa() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  SET LOCAL work_mem = '128MB';

  -- 1. Los nombres de cada entidad (nivel 0, enteros; nivel 1, sin lo que va tras « - »).
  CREATE TEMP TABLE _vpo ON COMMIT DROP AS
    SELECT DISTINCT ruc, nombre FROM (
      SELECT ruc::text AS ruc, nombre FROM entidades WHERE nombre IS NOT NULL
      UNION ALL SELECT DISTINCT entidad_ruc::text, entidad FROM empresa_orden_anual WHERE entidad IS NOT NULL
      UNION ALL SELECT DISTINCT entidad_ruc::text, entidad FROM conosce_adjudicaciones WHERE entidad IS NOT NULL) x
     WHERE ruc ~ '^\d{11}$';
  CREATE TEMP TABLE _vpn ON COMMIT DROP AS
    SELECT DISTINCT ruc, mef_norm(nombre) AS k, 0 AS nivel FROM _vpo
    UNION
    SELECT DISTINCT ruc, mef_norm(regexp_replace(nombre, '\s+-\s+.*$', '')), 1 FROM _vpo WHERE nombre ~ '\s-\s';
  DELETE FROM _vpn WHERE k = '';
  -- Por cada nombre, sólo las entidades de su mejor nivel (un nombre entero gana al recortado), y sólo si caen todas en
  -- un mismo distrito (dos RUC de la misma municipalidad sí; dos «Santa Rosa» no).
  CREATE TEMP TABLE _vpk ON COMMIT DROP AS
    SELECT x.k, x.ruc
      FROM _vpn x
      JOIN (SELECT k, min(nivel) AS nivel FROM _vpn GROUP BY k) m ON m.k = x.k AND m.nivel = x.nivel
      JOIN (SELECT y.k FROM _vpn y JOIN (SELECT k, min(nivel) AS nivel FROM _vpn GROUP BY k) mm ON mm.k = y.k AND mm.nivel = y.nivel
              LEFT JOIN entidades e ON e.ruc::text = y.ruc
             GROUP BY y.k HAVING count(DISTINCT COALESCE(e.ubigeo, y.ruc)) = 1) ok ON ok.k = x.k;
  CREATE INDEX ON _vpk (k);

  -- 2. Cada nombre del registro de visitas, a las entidades que reconoce.
  CREATE TEMP TABLE _vpm ON COMMIT DROP AS
    SELECT DISTINCT v.t, k.ruc
      FROM (SELECT DISTINCT entidad_visitada AS t FROM visitas_entidades WHERE entidad_visitada IS NOT NULL) v
     CROSS JOIN LATERAL unnest(claves_entidad_visitada(v.t)) c(k)
      JOIN _vpk k ON k.k = c.k;
  CREATE INDEX ON _vpm (t);

  -- 3. Los contratos desde que hay visitas (con 180 días de margen): cada ganador con RUC, o los integrantes con RUC de
  --    un consorcio, y la fecha de la buena pro.
  CREATE TEMP TABLE _vpg ON COMMIT DROP AS
    SELECT DISTINCT cv.ocid, COALESCE(m.ruc_miembro, a.ruc_proveedor) AS ruc, a.entidad_ruc::text AS entidad_ruc, a.fecha_buenapro AS f
      FROM conosce_adjudicaciones a
      JOIN (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
             WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid) cv
        ON cv.codigo = a.codigo_convocatoria AND cv.entidad_ruc = a.entidad_ruc
      LEFT JOIN conosce_consorcios m ON m.ruc_consorcio = a.ruc_proveedor AND a.ruc_proveedor !~ '^(10|20)\d{9}$'
     WHERE a.fecha_buenapro >= (SELECT min(fecha_visita) FROM visitas_entidades)
       AND a.fecha_buenapro <= (SELECT max(fecha_visita) FROM visitas_entidades) + 180
       AND COALESCE(m.ruc_miembro, a.ruc_proveedor) ~ '^(10|20)\d{9}$';
  CREATE INDEX ON _vpg (ruc);

  -- 4. La gente de cada ganador con DNI: RNP (socios, representantes, directivos) y el titular de un RUC 10.
  CREATE TEMP TABLE _vpp ON COMMIT DROP AS
    SELECT ruc, dni, max(nombre) AS nombre, string_agg(DISTINCT rol, ', ' ORDER BY rol) AS rol FROM (
      SELECT r.ruc_empresa::text AS ruc, r.numero_documento AS dni, r.nombre, r.tipo_rol AS rol
        FROM rnp_conformacion_juridica r
       WHERE r.tipo_documento LIKE 'DOC. NACIONAL%' AND r.numero_documento ~ '^\d{8}$'
         AND r.ruc_empresa::text IN (SELECT ruc FROM _vpg)
      UNION ALL
      SELECT DISTINCT g.ruc, substr(g.ruc, 3, 8), NULL, 'TITULAR' FROM _vpg g WHERE g.ruc LIKE '10%') x
     GROUP BY ruc, dni;
  CREATE INDEX ON _vpp (dni);

  DELETE FROM cruces_proveedor WHERE tipo = 'visita_previa';
  -- Una fila por contrato, ganador y visita (la evidencia es cada visita, con su fecha y a quién vio).
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (g.ocid, g.ruc, v.id)
         'visita_previa', g.ruc, g.ocid, 'alta', v.fecha_visita, p.dni, COALESCE(p.nombre, v.visitante), p.rol,
         jsonb_build_object('entidad_visitada', v.entidad_visitada, 'misma_entidad', true,
                            'funcionario', v.funcionario_nombre, 'cargo_funcionario', v.funcionario_cargo, 'motivo', v.motivo,
                            'dias_antes', g.f - v.fecha_visita, 'buena_pro', g.f),
         'visitas_entidades', 'https://www.datosabiertos.gob.pe/'
    FROM _vpg g
    JOIN _vpp p ON p.ruc = g.ruc
    JOIN visitas_entidades v ON v.numero_documento = p.dni AND v.fecha_visita BETWEEN g.f - 180 AND g.f
    JOIN _vpm m ON m.t = v.entidad_visitada AND m.ruc = g.entidad_ruc
   ORDER BY g.ocid, g.ruc, v.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_cruce_visita_previa() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_cruce_visita_previa() FROM PUBLIC;
