-- 313 · «La Contraloría observó este proceso»: cada observación de un informe de control, atada al contrato que nombra
-- (2026-11-16).
--
-- Hasta aquí un informe de control se unía a su ENTIDAD (migración 90) y a las PERSONAS comprendidas (302, 303, 308). La
-- lectura con IA de las fichas resumen (migración 304; script cargar_contraloria_fichas.py, paso `leer`) saca además, de
-- cada observación, los procedimientos de selección que nombra («Adjudicación Simplificada N° 26-2022-MPS/CS») y las
-- obras con su código único de inversión. Con eso la observación se ata al CONTRATO: lo que la Contraloría ya encontró
-- en ese proceso queda a la vista en su ficha, en la de quien lo ganó y en las listas.
--
--   informe_control_proceso                         una fila por observación y contrato (ocid), con cómo se empató (`via`)
--   refrescar_informe_control_proceso()             arma esa tabla
--   refrescar_cruce_observado_por_contraloria()     la bandera `observado_por_contraloria` en cruces_proveedor
--
-- CÓMO SE EMPATA (la precisión va primero: ante la duda no se ata)
--   1. Del texto sale el TIPO (AS, LP, CP, SIE, DIRECTA, COMPRE, PEC, RES, SCI), el NÚMERO, el AÑO y lo que sigue (la
--      sigla). No entran los concursos de personal (CAS, méritos, plazas).
--   2. Candidatos: los procesos adjudicados de la MISMA entidad del informe (su RUC) en CONOSCE, con igual tipo, número
--      y año. La nomenclatura es `TIPO-MODALIDAD-NÚMERO-AÑO-SIGLA-CONVOCATORIA`; una «familia» es TIPO-MODALIDAD + SIGLA
--      (una entidad con varias unidades repite el número: ESSALUD tiene 28 «AS-1-2021», una por red).
--   3. Una familia es compatible si el texto trae la nomenclatura entera (`codigo`), o si todas las palabras de la sigla
--      del texto están en la del proceso, o las de la del proceso (dos o más) están en el texto (`sigla`). Si el texto no
--      da ninguna sigla, sólo se ata cuando la entidad tiene UNA familia con ese número y año (`unico`).
--   4. Si quedan varias, gana la de más puntos (nomenclatura entera 100, cada palabra de la sigla 10, mismo régimen
--      —decreto de urgencia, ley, abreviado, homologación— 5, comité u órgano encargado 1) sólo si gana sola.
--   5. El año del proceso no puede ser posterior al del informe. Si el texto dice «segunda convocatoria», esa.
--   6. Por CUI (`cui`): la observación nombra una obra con su código único de inversión y esa inversión tiene, en la entidad
--      del informe y convocado antes del informe, UN solo contrato de obra. Sólo observaciones de ejecución o de pagos
--      cuyo texto habla de la ejecución de la obra (valorizaciones, metrados, ampliaciones de plazo, adicionales,
--      penalidades, recepción, liquidación) y no de la elaboración del expediente técnico ni de contratar o pagar la supervisión:
--      esos son otros contratos de la misma inversión (en una muestra de 24, 4 eran de esos).
--
-- Medido en PROD antes de escribirla, con 9 768 observaciones leídas de 18 207 (CTE de sólo lectura): 1 915 procesos
-- nombrados; 238 de informes sin RUC de entidad; 1 567 con tipo, número y año; 1 154 con algún candidato; 1 098 con una
-- sola familia (1 053 con la sigla coincidente). De los que no coincidían en la sigla, la mayoría eran de otra unidad
-- (EMAPE frente a MML, PRONIS frente a MINSA): por eso la regla 3. Por CUI: 769 obras nombradas, 160 con un solo
-- contrato de obra. Aplicada con 11 mil fichas leídas: 787 contratos por sigla, 96 por la nomenclatura entera y 9 por
-- número único; en una muestra de 26 de las dos primeras, 24 claramente del mismo proceso y ninguna de otro.
--
-- La bandera: una por contrato y ganador (también cada integrante de un consorcio).
--   alta   el informe señala responsabilidad PENAL presunta y la observación es de selección, ejecución o pagos;
--   media  responsabilidad penal o civil, o la observación cuantifica un perjuicio;
--   baja   sólo administrativa.
-- Atada por CUI o por número único (sin sigla) nunca pasa de media.
--
-- La responsabilidad que identifica un informe es PRESUNTA y recae en funcionarios y servidores: el informe no sanciona
-- al proveedor. Es un hecho para revisar, no una acusación.
--
-- Privacidad: ni la tabla ni el detalle de la bandera llevan el texto de la observación (puede nombrar a un funcionario;
-- quien lo muestra lo saca de la ficha y lo pasa por publicar() con los comprendidos del informe), ni nombres ni
-- documentos de personas.

SET lock_timeout = '10s';

-- Las palabras de una sigla para comparar el texto del informe con la nomenclatura: sin tildes ni puntos («C.G.R.» →
-- CGR), de 2 letras o más, sin números sueltos, sin el comité ni el órgano encargado y sin «primera convocatoria».
CREATE OR REPLACE FUNCTION sigla_de_proceso(p text) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_agg(DISTINCT w), '{}')
    FROM unnest(regexp_split_to_array(replace(upper(public.immutable_unaccent(coalesce(p, ''))), '.', ''), '[^A-Z0-9]+')) w
   WHERE length(w) >= 2 AND w !~ '^[0-9]+$'
     AND w NOT IN ('CS', 'OEC', 'CE', 'CEP', 'CES', 'CEA', 'CSE', 'OC', 'PRIMERA', 'SEGUNDA', 'TERCERA', 'CUARTA', 'QUINTA',
                   'CONVOCATORIA', 'ITEM', 'ITEMS', 'PAQUETE', 'DERIVADA', 'DERIVADO', 'NRO', 'DE', 'DEL', 'LA', 'EL', 'LOS',
                   'LAS', 'PARA', 'POR', 'CON', 'EN')
$$;

-- Una nomenclatura sin adornos para ver si un texto la trae entera: sin tildes, sin ceros a la izquierda de cada número
-- y sin separadores («LP-SM-002-2019-MPCH/C-1» → LPSM22019MPCHC1).
CREATE OR REPLACE FUNCTION nomenclatura_compacta(p text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(regexp_replace(upper(public.immutable_unaccent(coalesce(p, ''))), '(^|[^0-9])0+([0-9])', '\1\2', 'g'),
                        '[^A-Z0-9]', '', 'g')
$$;

CREATE TABLE IF NOT EXISTS informe_control_proceso (
  codigo        TEXT    NOT NULL REFERENCES informes_control (codigo) ON DELETE CASCADE,
  n             INT     NOT NULL,                -- la observación de la ficha
  ocid          TEXT    NOT NULL,                -- el contrato en Vigía (convocatorias.ocid)
  nomenclatura  TEXT,                            -- la del proceso en CONOSCE (NULL si se ató por CUI)
  via           TEXT    NOT NULL CHECK (via IN ('codigo', 'sigla', 'unico', 'cui')),
  cui           TEXT,                            -- la inversión, si se ató por CUI
  tema          TEXT,
  perjuicio     NUMERIC,
  moneda        TEXT,
  PRIMARY KEY (codigo, n, ocid)
);
COMMENT ON TABLE informe_control_proceso IS
  'Qué contrato nombra cada observación de un informe de control (lectura de IA de la ficha resumen): por la nomenclatura '
  'del proceso (via codigo, sigla o unico) o por el CUI de la obra. La arma refrescar_informe_control_proceso(). No lleva '
  'el texto de la observación ni personas. Responsabilidad PRESUNTA.';
CREATE INDEX IF NOT EXISTS informe_control_proceso_ocid ON informe_control_proceso (ocid);
ALTER TABLE informe_control_proceso OWNER TO vigia_jobs;
REVOKE ALL ON informe_control_proceso FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  -- Los privilegios por defecto dan la tabla nueva a los que publican (y a vigia_agentes, con escritura): sólo lectura.
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON informe_control_proceso FROM %I', r);
      EXECUTE format('GRANT SELECT ON informe_control_proceso TO %I', r);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION refrescar_informe_control_proceso() RETURNS integer
LANGUAGE plpgsql SET work_mem = '64MB' SET statement_timeout = '600s' AS $$
DECLARE v_filas int;
BEGIN
  -- 1. Cada proceso que nombra cada observación, con su tipo, número, año y lo que sigue (la sigla).
  DROP TABLE IF EXISTS _icp_m;
  CREATE TEMP TABLE _icp_m ON COMMIT DROP AS
    SELECT DISTINCT q.codigo, q.n, q.t, q.ruc, q.tipo, (q.m)[1]::int AS num, (q.m)[2]::int AS anio,
           regexp_replace((q.m)[3], '\(.*?\)', ' ', 'g') AS resto
      FROM (
        SELECT f.codigo, (x ->> 'n')::int AS n, u.t, btrim(i.entidad_ruc) AS ruc, i.fecha_emision AS emision,
               CASE WHEN u.t ~ 'MERITOS|\mCAS\M|PLAZAS|DOCENTE|NOMBRAMIENTO|ASCENSO|ADMISION' THEN NULL
                    WHEN u.t ~ 'ADJUDICACION SIMPLIFICADA|\mAS-' THEN 'AS'
                    WHEN u.t ~ 'LICITACION PUBLICA|\mLP-' THEN 'LP'
                    WHEN u.t ~ 'CONCURSO PUBLICO|\mCP-' THEN 'CP'
                    WHEN u.t ~ 'SUBASTA INVERSA|\mSIE-' THEN 'SIE'
                    WHEN u.t ~ 'COMPARACION DE PRECIOS|\mCOMPRE-' THEN 'COMPRE'
                    WHEN u.t ~ 'CONTRATACION DIRECTA|\mDIRECTA-' THEN 'DIRECTA'
                    WHEN u.t ~ 'PROCEDIMIENTO (DE CONTRATACION PUBLICA )?ESPECIAL|\mPEC-' THEN 'PEC'
                    WHEN u.t ~ 'REGIMEN ESPECIAL|\mRES-' THEN 'RES'
                    WHEN u.t ~ 'CONSULTORES INDIVIDUALES|\mSCI-' THEN 'SCI' END AS tipo,
               regexp_match(u.t, '(?:^|[^0-9])0*([0-9]{1,5})\s*-\s*((?:19|20)[0-9]{2})(?![0-9])(.*)$') AS m
          FROM informe_control_ficha f
          JOIN informes_control i ON i.codigo = f.codigo
          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(f.campos -> 'ia' -> 'observaciones') = 'array'
                                                       THEN f.campos -> 'ia' -> 'observaciones' ELSE '[]'::jsonb END) x
          CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(x -> 'procesos') = 'array'
                                                            THEN x -> 'procesos' ELSE '[]'::jsonb END) p(t)
          CROSS JOIN LATERAL (SELECT upper(public.immutable_unaccent(p.t)) AS t) u
         WHERE (x ->> 'n') ~ '^\d{1,3}$' AND i.entidad_ruc IS NOT NULL
      ) q
     WHERE q.tipo IS NOT NULL AND q.m IS NOT NULL AND (q.m)[2]::int >= 2015
       AND (q.emision IS NULL OR (q.m)[2]::int <= extract(year FROM q.emision)::int);
  CREATE INDEX ON _icp_m (ruc, tipo, num, anio);
  ANALYZE _icp_m;

  -- 2. Los procesos adjudicados de esas entidades (CONOSCE), con su nomenclatura partida.
  DROP TABLE IF EXISTS _icp_c;
  CREATE TEMP TABLE _icp_c ON COMMIT DROP AS
    SELECT c.ruc, c.convocatoria, c.nomenclatura, split_part(split_part(c.nom, '-', 1), ' ', 1) AS tipo,
           (c.m)[1] AS pref, (c.m)[2]::int AS num, (c.m)[3]::int AS anio, (c.m)[4] AS sigla, (c.m)[5]::int AS conv
      FROM (
        SELECT d.*, regexp_match(d.nom, '^(.*)-0*([0-9]{1,6})-((?:19|20)[0-9]{2})-(.+)-([0-9]{1,3})$') AS m
          FROM (
            SELECT DISTINCT btrim(a.entidad_ruc) AS ruc, a.codigo_convocatoria::text AS convocatoria, a.nomenclatura,
                   upper(public.immutable_unaccent(a.nomenclatura)) AS nom
              FROM conosce_adjudicaciones a
             WHERE a.entidad_ruc IN (SELECT DISTINCT ruc FROM _icp_m) AND a.nomenclatura IS NOT NULL
          ) d
      ) c
     WHERE c.m IS NOT NULL;
  CREATE INDEX ON _icp_c (ruc, tipo, num, anio);
  ANALYZE _icp_c;

  -- 3. Cada mención con cada candidato: si la familia es compatible y cuántos puntos tiene.
  DROP TABLE IF EXISTS _icp_j;
  CREATE TEMP TABLE _icp_j ON COMMIT DROP AS
    SELECT m.codigo, m.n, m.t, c.convocatoria, c.nomenclatura, c.pref, c.sigla, c.conv,
           k.exacta, cardinality(s.tt) = 0 AS sin_sigla,
           (k.exacta OR (cardinality(s.tt) > 0 AND s.tt <@ s.tn) OR (cardinality(s.tn) >= 2 AND s.tn <@ s.tt)) AS compatible,
           (100 * k.exacta::int
            + 10 * least((SELECT count(*) FROM unnest(s.tn) w WHERE w = ANY (s.tt))::int, 3)
            + 5 * ((m.t ~ '\mD\.? ?U\.?[ 0-9]|\mDU\M|DECRETO DE URGENCIA|\mLEY[ 0-9N]|HOMOLOG|ABREVIAD|DECRETO LEGISLATIVO|\mD\.? ?L\.?[ 0-9]')
                   = (c.pref !~ '^[A-Z ]+-(SM|SIE|DIRECTA|COMPRE|PROC)$'))::int
            + least((SELECT count(*) FROM unnest(ARRAY['CS', 'OEC', 'CE', 'CEP', 'OC']) g
                      WHERE c.sigla ~ ('\m' || g || '\M') AND m.resto ~ ('\m' || g || '\M'))::int, 2)) AS puntos,
           CASE WHEN m.t ~ 'PRIMERA CONV' THEN 1 WHEN m.t ~ 'SEGUNDA CONV' THEN 2 WHEN m.t ~ 'TERCERA CONV' THEN 3
                WHEN m.t ~ 'CUARTA CONV' THEN 4 END AS conv_pedida
      FROM _icp_m m
      JOIN _icp_c c ON c.ruc = m.ruc AND c.tipo = m.tipo AND c.num = m.num AND c.anio = m.anio
      CROSS JOIN LATERAL (SELECT sigla_de_proceso(c.sigla) AS tn, sigla_de_proceso(m.resto) AS tt) s
      CROSS JOIN LATERAL (
        SELECT position(nomenclatura_compacta(c.pref || '-' || c.num || '-' || c.anio || '-' || c.sigla)
                        IN nomenclatura_compacta(m.t)) > 0 AS exacta) k;
  ANALYZE _icp_j;

  -- 4. La familia que gana sola en cada mención; de ella, la convocatoria que el texto pide o todas las adjudicadas.
  DROP TABLE IF EXISTS _icp_e;
  CREATE TEMP TABLE _icp_e ON COMMIT DROP AS
    WITH fam AS (
      SELECT codigo, n, t, pref, sigla, max(puntos) AS puntos, bool_or(exacta) AS exacta, bool_or(sin_sigla) AS sin_sigla,
             bool_or(compatible) AS compatible
        FROM _icp_j GROUP BY 1, 2, 3, 4, 5
    ), r AS (
      SELECT fam.*, count(*) OVER (PARTITION BY codigo, n, t) AS familias,
             rank() OVER (PARTITION BY codigo, n, t ORDER BY compatible DESC, puntos DESC) AS puesto,
             count(*) OVER (PARTITION BY codigo, n, t, compatible, puntos) AS empatadas
        FROM fam
    )
    SELECT DISTINCT j.codigo, j.n, j.convocatoria, j.nomenclatura,
           CASE WHEN r.exacta THEN 'codigo' WHEN r.compatible THEN 'sigla' ELSE 'unico' END AS via
      FROM r
      JOIN _icp_j j ON j.codigo = r.codigo AND j.n = r.n AND j.t = r.t AND j.pref = r.pref AND j.sigla = r.sigla
     WHERE r.puesto = 1 AND r.empatadas = 1
       AND (r.compatible OR (r.sin_sigla AND r.familias = 1))
       AND (j.conv_pedida IS NULL OR j.conv = j.conv_pedida
            OR NOT EXISTS (SELECT 1 FROM _icp_j z WHERE z.codigo = j.codigo AND z.n = j.n AND z.t = j.t AND z.pref = j.pref
                                                    AND z.sigla = j.sigla AND z.conv = j.conv_pedida));

  -- 5. Lo que la lectura dijo de cada observación (tema y perjuicio), una vez.
  DROP TABLE IF EXISTS _icp_o;
  CREATE TEMP TABLE _icp_o ON COMMIT DROP AS
    SELECT DISTINCT ON (f.codigo, (x ->> 'n')::int) f.codigo, (x ->> 'n')::int AS n, x ->> 'tema' AS tema,
           CASE WHEN (x ->> 'perjuicio') ~ '^[0-9]+(\.[0-9]+)?$' THEN (x ->> 'perjuicio')::numeric END AS perjuicio,
           x ->> 'moneda' AS moneda, x -> 'obras' AS obras,
           -- El texto de la observación (el de la ficha), sólo para la regla del CUI: no se guarda.
           (SELECT upper(public.immutable_unaccent(z ->> 'texto'))
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f.campos -> 'observaciones') = 'array'
                                             THEN f.campos -> 'observaciones' ELSE '[]'::jsonb END) z
             WHERE z ->> 'n' = x ->> 'n' LIMIT 1) AS texto
      FROM informe_control_ficha f
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(f.campos -> 'ia' -> 'observaciones') = 'array'
                                                   THEN f.campos -> 'ia' -> 'observaciones' ELSE '[]'::jsonb END) x
     WHERE (x ->> 'n') ~ '^\d{1,3}$'
     ORDER BY f.codigo, (x ->> 'n')::int;
  CREATE INDEX ON _icp_o (codigo, n);
  ANALYZE _icp_o;

  -- 6. Por CUI: la obra que nombra la observación tiene un solo contrato de obra en la entidad del informe, convocado antes,
  --    y la observación habla de la ejecución de esa obra (no del expediente técnico ni de la supervisión).
  DROP TABLE IF EXISTS _icp_u;
  CREATE TEMP TABLE _icp_u ON COMMIT DROP AS
    WITH men AS (
      SELECT DISTINCT o.codigo, o.n, lpad(ob ->> 'cui', 7, '0') AS cui, btrim(i.entidad_ruc) AS ruc, i.fecha_emision AS emision
        FROM _icp_o o
        JOIN informes_control i ON i.codigo = o.codigo
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.obras) = 'array' THEN o.obras ELSE '[]'::jsonb END) ob
       WHERE (ob ->> 'cui') ~ '^[0-9]{6,7}$' AND i.entidad_ruc IS NOT NULL AND i.fecha_emision IS NOT NULL
         AND o.tema IN ('ejecucion_contractual', 'pagos_adelantos')
         AND o.texto ~ 'VALORIZACI|METRADO|AMPLIACION(ES)? DE PLAZO|ADICIONAL|DEDUCTIVO|PENALIDAD|RECEPCION|LIQUIDACION|PARTIDAS|CONTRATISTA|EJECUCION DE (LA )?OBRA|ADELANTO|PARALIZA'
         AND o.texto !~ 'ELABORACION DE(L)? EXPEDIENTE|PAGARON POR EXPEDIENTE|CONTRATACION DE(L)? SUPERVISOR|CONTRATACION DE LA SUPERVISION|SERVICIOS? DE CONSULTORIA|CONSULTORIA DE OBRA|CONTRATISTA SUPERVISOR|PAGOS? A(L| LA) SUPERVIS'
    ), cand AS (
      SELECT men.codigo, men.n, men.cui, k.ocid, count(*) OVER (PARTITION BY men.codigo, men.n, men.cui) AS contratos
        FROM men
        JOIN contrato_cui k ON k.cui = men.cui::char(7)
        JOIN convocatorias c ON c.ocid = k.ocid
       WHERE btrim(c.entidad_ruc) = men.ruc AND c.fecha_convocatoria <= men.emision
         AND COALESCE(c.tipo_contratacion, CASE c.categoria WHEN 'works' THEN 'obras' END) = 'obras'
    )
    SELECT codigo, n, cui, ocid FROM cand WHERE contratos = 1;

  DELETE FROM informe_control_proceso;
  INSERT INTO informe_control_proceso (codigo, n, ocid, nomenclatura, via, cui, tema, perjuicio, moneda)
  SELECT DISTINCT ON (e.codigo, e.n, c.ocid) e.codigo, e.n, c.ocid, e.nomenclatura, e.via, NULL, o.tema, o.perjuicio, o.moneda
    FROM _icp_e e
    JOIN convocatorias c ON c.codigo::text = e.convocatoria
    LEFT JOIN _icp_o o ON o.codigo = e.codigo AND o.n = e.n
   ORDER BY e.codigo, e.n, c.ocid, (e.via = 'codigo') DESC, (e.via = 'sigla') DESC;
  INSERT INTO informe_control_proceso (codigo, n, ocid, nomenclatura, via, cui, tema, perjuicio, moneda)
  SELECT DISTINCT ON (u.codigo, u.n, u.ocid) u.codigo, u.n, u.ocid, NULL, 'cui', u.cui, o.tema, o.perjuicio, o.moneda
    FROM _icp_u u
    LEFT JOIN _icp_o o ON o.codigo = u.codigo AND o.n = u.n
   ORDER BY u.codigo, u.n, u.ocid, u.cui
  ON CONFLICT DO NOTHING;
  SELECT count(*) INTO v_filas FROM informe_control_proceso;
  ANALYZE informe_control_proceso;
  RETURN v_filas;
END $$;
ALTER FUNCTION refrescar_informe_control_proceso() OWNER TO vigia_jobs;

/*
 * La bandera `observado_por_contraloria`: una por contrato y ganador (los suppliers del OCDS y, si ganó un consorcio, sus
 * integrantes con RUC, como refrescar_casos_cruce_base). Si varias observaciones nombran el contrato, la más grave va
 * primero y las demás se cuentan.
 */
CREATE OR REPLACE FUNCTION refrescar_cruce_observado_por_contraloria() RETURNS integer
LANGUAGE plpgsql SET work_mem = '64MB' SET statement_timeout = '600s' AS $$
DECLARE v_filas int;
BEGIN
  PERFORM refrescar_informe_control_proceso();

  -- 1. Los ganadores de los contratos atados.
  DROP TABLE IF EXISTS _opc_s;
  CREATE TEMP TABLE _opc_s ON COMMIT DROP AS
    SELECT c.ocid, regexp_replace(s ->> 'id', '^PE-RUC-', '') AS sup, s ->> 'name' AS nombre,
           (aw -> 'value' ->> 'amount')::numeric AS monto, NULLIF(aw ->> 'date', '')::date AS f, btrim(c.entidad_ruc) AS entidad_ruc
      FROM (SELECT DISTINCT ocid FROM informe_control_proceso) x
      JOIN convocatorias c ON c.ocid = x.ocid
      CROSS JOIN LATERAL (SELECT COALESCE(c.ocds_payload -> 'awards', c.adjudicaciones) AS a OFFSET 0) j
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(j.a) = 'array' THEN j.a ELSE '[]'::jsonb END) aw
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(aw -> 'suppliers') = 'array' THEN aw -> 'suppliers' ELSE '[]'::jsonb END) s;
  ANALYZE _opc_s;
  DROP TABLE IF EXISTS _opc_m;
  CREATE TEMP TABLE _opc_m ON COMMIT DROP AS
    SELECT DISTINCT ON (ruc_consorcio, ruc_miembro) ruc_consorcio, ruc_miembro
      FROM conosce_consorcios
     WHERE ruc_miembro ~ '^(10|20)\d{9}$' AND ruc_consorcio IN (SELECT sup FROM _opc_s WHERE sup !~ '^(10|20)\d{9}$')
     ORDER BY ruc_consorcio, ruc_miembro, anio DESC;
  ANALYZE _opc_m;
  DROP TABLE IF EXISTS _opc_g;
  CREATE TEMP TABLE _opc_g ON COMMIT DROP AS
    SELECT x.ocid, COALESCE(m.ruc_miembro, x.sup) AS ruc, max(CASE WHEN m.ruc_miembro IS NOT NULL THEN x.nombre END) AS consorcio,
           max(x.monto) AS monto, max(x.f) AS f, max(x.entidad_ruc) AS entidad_ruc
      FROM _opc_s x LEFT JOIN _opc_m m ON m.ruc_consorcio = x.sup AND x.sup !~ '^(10|20)\d{9}$'
     WHERE COALESCE(m.ruc_miembro, x.sup) ~ '^(10|20)\d{9}$'
     GROUP BY 1, 2;
  CREATE INDEX ON _opc_g (ocid);
  ANALYZE _opc_g;

  -- 2. Cada contrato con sus observaciones, la más grave primero.
  DROP TABLE IF EXISTS _opc_o;
  CREATE TEMP TABLE _opc_o ON COMMIT DROP AS
    SELECT p.ocid, p.codigo, p.n, p.via, p.nomenclatura, p.cui, p.tema, p.perjuicio, p.moneda,
           i.numero, i.titulo, i.entidad_nombre, btrim(i.entidad_ruc) AS entidad_ruc, i.fecha_emision AS emision, i.modalidad,
           coalesce(i.responsabilidades, '{}') AS resp, coalesce(i.url_resumen, i.url_pdf) AS url,
           CASE WHEN 'penal' = ANY (i.responsabilidades) AND p.via IN ('codigo', 'sigla')
                     AND p.tema IN ('seleccion_contratacion', 'ejecucion_contractual', 'pagos_adelantos') THEN 0
                WHEN 'penal' = ANY (i.responsabilidades) OR 'civil' = ANY (i.responsabilidades) OR coalesce(p.perjuicio, 0) > 0 THEN 1
                ELSE 2 END AS rango
      FROM informe_control_proceso p
      JOIN informes_control i ON i.codigo = p.codigo;
  CREATE INDEX ON _opc_o (ocid);
  ANALYZE _opc_o;

  DELETE FROM cruces_proveedor WHERE tipo = 'observado_por_contraloria';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT 'observado_por_contraloria', g.ruc, g.ocid, (ARRAY['alta', 'media', 'baja'])[1 + (k.obs -> 0 ->> 'rango')::int],
         coalesce(g.f, (k.obs -> 0 ->> 'emision')::date), g.monto,
         jsonb_build_object(
           'informe_codigo', k.obs -> 0 ->> 'codigo', 'informe_numero', k.obs -> 0 ->> 'numero', 'informe_titulo', k.obs -> 0 ->> 'titulo',
           'informe_entidad', k.obs -> 0 ->> 'entidad', 'informe_entidad_ruc', k.obs -> 0 ->> 'entidad_ruc',
           'modalidad', k.obs -> 0 ->> 'modalidad', 'emision', k.obs -> 0 ->> 'emision',
           'responsabilidades', k.obs -> 0 -> 'responsabilidades', 'url_resumen', k.obs -> 0 ->> 'url_resumen',
           'observacion_n', (k.obs -> 0 ->> 'n')::int, 'tema', k.obs -> 0 ->> 'tema',
           'perjuicio', (k.obs -> 0 ->> 'perjuicio')::numeric, 'moneda', k.obs -> 0 ->> 'moneda',
           'via', k.obs -> 0 ->> 'via', 'nomenclatura', k.obs -> 0 ->> 'nomenclatura', 'cui', k.obs -> 0 ->> 'cui',
           -- Todo lo que nombra este contrato: cuántas observaciones, de cuántos informes y cuánto perjuicio cuantifican.
           'n_observaciones', k.n_obs, 'n_informes', k.n_inf, 'perjuicio_total', k.perjuicio_total,
           'otras', (SELECT jsonb_agg(e - 'rango' - 'titulo' - 'entidad' - 'entidad_ruc' - 'modalidad' ORDER BY q)
                       FROM jsonb_array_elements(k.obs) WITH ORDINALITY t(e, q) WHERE q BETWEEN 2 AND 6),
           'consorcio', g.consorcio),
         'informes_control', coalesce(k.obs -> 0 ->> 'url_resumen', 'https://appbp.contraloria.gob.pe/BuscadorCGR/Informes/Avanzada.html')
    FROM _opc_g g
    JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
                 'codigo', o.codigo, 'numero', o.numero, 'titulo', o.titulo, 'entidad', o.entidad_nombre, 'entidad_ruc', o.entidad_ruc,
                 'modalidad', o.modalidad, 'emision', to_char(o.emision, 'YYYY-MM-DD'), 'responsabilidades', to_jsonb(o.resp),
                 'url_resumen', o.url, 'n', o.n, 'tema', o.tema, 'perjuicio', o.perjuicio, 'moneda', o.moneda, 'via', o.via,
                 'nomenclatura', o.nomenclatura, 'cui', o.cui, 'rango', o.rango)
               ORDER BY o.rango, o.perjuicio DESC NULLS LAST, o.emision DESC NULLS LAST, o.codigo, o.n) AS obs,
             count(*)::int AS n_obs, count(DISTINCT o.codigo)::int AS n_inf,
             sum(o.perjuicio) FILTER (WHERE o.moneda = 'PEN') AS perjuicio_total
        FROM _opc_o o WHERE o.ocid = g.ocid
    ) k ON k.obs IS NOT NULL;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas;
END $$;
ALTER FUNCTION refrescar_cruce_observado_por_contraloria() OWNER TO vigia_jobs;

-- Sólo se arma la tabla de empates: la bandera se escribe cuando la API y la web ya conocen el tipo (la corre el
-- refresco de cruces, comun.ts, y el guion mensual de la Contraloría).
SET statement_timeout = '600s';
SELECT refrescar_informe_control_proceso() AS contratos_observados;
RESET statement_timeout;
