-- Dos señales más para quien investiga (2026-11-14). Las dos salen de registros que ya están en la base.
--
-- 1. SOCIOS DE CONSORCIO QUE COMPITEN (cruce `consorcio_rival`, atado a cada proceso). Dos empresas que alguna vez
--    postularon JUNTAS en un consorcio se presentan después por separado, como rivales, en procesos de 2 a 4 postores,
--    y gana una de las dos. Quien fue tu socio conoce tus precios: que «compita» contigo una y otra vez es un indicio
--    de reparto. Medido en PROD (procesos de 2018 en adelante): 2 598 pares coinciden alguna vez; 288 lo hacen en 3 o
--    más procesos en que gana sólo una de las dos (3 133 procesos), y en 211 de esos pares ganan las dos por turnos.
--    Es alta cuando las dos fueron las ÚNICAS postoras del proceso.
--
-- 2. PUERTA GIRATORIA (cruce `puerta_giratoria`, atado a cada proceso). Una persona que salió de la planilla de una
--    entidad es socia o representante (RNP) de una empresa que le gana a esa MISMA entidad después de su salida. El
--    empate es por nombre completo, con dos guardas contra homónimos: el nombre corresponde a un solo documento en
--    todo el RNP y sale de la planilla de una sola entidad. `socio_en_entidad` (migración 122) mira a quien SIGUE
--    contratado; ésta, a quien ya se fue. Medido en PROD (salidas de planilla desde 2025): 13 personas, 15 empresas,
--    23 procesos, S/ 5,2 millones; 22 de los 23, en el primer año tras la salida. Alta en el primer año.

-- ── 1. Socios de consorcio que compiten ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consorcio_rival (
  ruc_a          TEXT NOT NULL,
  ruc_b          TEXT NOT NULL,          -- ruc_a < ruc_b
  nombre_a       TEXT,
  nombre_b       TEXT,
  consorcios     INT NOT NULL,           -- consorcios que integraron juntas
  rivales        INT NOT NULL,           -- procesos de 2 a 4 postores en que postularon por separado y ganó sólo una
  solas          INT NOT NULL,           -- de esos, en cuántos fueron las únicas dos postoras
  gano_a         INT NOT NULL,
  gano_b         INT NOT NULL,
  entidades      INT NOT NULL,
  desde          DATE,
  hasta          DATE,
  refrescado_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ruc_a, ruc_b)
);
CREATE INDEX IF NOT EXISTS consorcio_rival_b ON consorcio_rival (ruc_b);

CREATE OR REPLACE FUNCTION refrescar_cruce_consorcio_rival() RETURNS integer
LANGUAGE plpgsql SET work_mem = '128MB' AS $$
DECLARE v_filas int;
BEGIN
  CREATE TEMP TABLE _cp ON COMMIT DROP AS
    SELECT codigo_convocatoria::text AS codigo, ruc_postor AS ruc, max(postor) AS nombre, max(fecha_convocatoria) AS fecha
      FROM conosce_postores WHERE ruc_postor ~ '^20[0-9]{9}$' AND anio >= 2018 GROUP BY 1, 2;
  CREATE INDEX ON _cp (ruc);
  CREATE INDEX ON _cp (codigo);
  CREATE TEMP TABLE _cn ON COMMIT DROP AS SELECT codigo, count(*) AS postores FROM _cp GROUP BY 1;
  CREATE INDEX ON _cn (codigo);
  CREATE TEMP TABLE _cs ON COMMIT DROP AS
    WITH m AS (SELECT DISTINCT ruc_consorcio, ruc_miembro FROM conosce_consorcios WHERE ruc_miembro ~ '^20[0-9]{9}$')
    SELECT a.ruc_miembro AS a, b.ruc_miembro AS b, count(DISTINCT a.ruc_consorcio) AS consorcios
      FROM m a JOIN m b ON b.ruc_consorcio = a.ruc_consorcio AND a.ruc_miembro < b.ruc_miembro GROUP BY 1, 2;
  -- Cada proceso de pocos postores en que las dos postularon por separado y ganó exactamente una.
  CREATE TEMP TABLE _cx ON COMMIT DROP AS
    SELECT s.a, s.b, s.consorcios, pa.codigo, n.postores, r.entidad_ruc, r.monto, pa.fecha, pa.nombre AS nombre_a, pb.nombre AS nombre_b,
           (s.a = ANY (r.rucs)) AS gano_a
      FROM _cs s JOIN _cp pa ON pa.ruc = s.a JOIN _cp pb ON pb.ruc = s.b AND pb.codigo = pa.codigo
      JOIN _cn n ON n.codigo = pa.codigo JOIN conosce_proceso_resumen r ON r.codigo = pa.codigo
     WHERE n.postores BETWEEN 2 AND 4 AND r.rucs IS NOT NULL AND (s.a = ANY (r.rucs)) <> (s.b = ANY (r.rucs));

  DELETE FROM consorcio_rival;
  INSERT INTO consorcio_rival (ruc_a, ruc_b, nombre_a, nombre_b, consorcios, rivales, solas, gano_a, gano_b, entidades, desde, hasta)
  SELECT x.a, x.b, COALESCE(ea.nombre, max(x.nombre_a)), COALESCE(eb.nombre, max(x.nombre_b)), max(x.consorcios), count(*),
         count(*) FILTER (WHERE x.postores = 2), count(*) FILTER (WHERE x.gano_a), count(*) FILTER (WHERE NOT x.gano_a),
         count(DISTINCT x.entidad_ruc), min(x.fecha), max(x.fecha)
    FROM _cx x LEFT JOIN empresa_resumen ea ON ea.ruc = x.a LEFT JOIN empresa_resumen eb ON eb.ruc = x.b
   GROUP BY x.a, x.b, ea.nombre, eb.nombre HAVING count(*) >= 3;

  DELETE FROM cruces_proveedor WHERE tipo = 'consorcio_rival';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (g.ganador, cv.ocid) 'consorcio_rival', g.ganador, cv.ocid,
         CASE WHEN g.postores = 2 THEN 'alta' ELSE 'media' END, g.fecha, g.monto,
         jsonb_build_object('rival', g.rival, 'ruc_rival', g.ruc_rival, 'consorcios_juntas', g.consorcios, 'veces_rivales', g.rivales,
                            'gano_esta', g.gano_esta, 'gano_la_rival', g.gano_rival, 'entidades', g.entidades,
                            'postores_del_proceso', g.postores, 'solas_las_dos', g.postores = 2),
         'conosce_consorcios', 'https://conosce.osce.gob.pe/buscador/'
    FROM (SELECT CASE WHEN x.gano_a THEN x.a ELSE x.b END AS ganador, CASE WHEN x.gano_a THEN x.b ELSE x.a END AS ruc_rival,
                 CASE WHEN x.gano_a THEN c.nombre_b ELSE c.nombre_a END AS rival, x.codigo, x.entidad_ruc, x.postores, x.fecha, x.monto,
                 c.consorcios, c.rivales, c.entidades, CASE WHEN x.gano_a THEN c.gano_a ELSE c.gano_b END AS gano_esta,
                 CASE WHEN x.gano_a THEN c.gano_b ELSE c.gano_a END AS gano_rival
            FROM _cx x JOIN consorcio_rival c ON c.ruc_a = x.a AND c.ruc_b = x.b) g
    JOIN (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
           WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid) cv ON cv.codigo = g.codigo AND cv.entidad_ruc = g.entidad_ruc
   ORDER BY g.ganador, cv.ocid, g.rivales DESC;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas;
END $$;
ALTER FUNCTION refrescar_cruce_consorcio_rival() OWNER TO vigia_jobs;
ALTER TABLE consorcio_rival OWNER TO vigia_jobs;

-- ── 2. Puerta giratoria ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refrescar_cruce_puerta_giratoria() RETURNS integer
LANGUAGE plpgsql SET work_mem = '128MB' AS $$
DECLARE v_filas int;
BEGIN
  -- Quien salió de la planilla de UNA sola entidad (un nombre que sale de dos entidades puede ser dos personas).
  CREATE TEMP TABLE _gs ON COMMIT DROP AS
    SELECT upper(nombre_norm) AS nombre, min(entidad_ruc) AS entidad_ruc, max(ultimo_mes) AS ultimo_mes,
           (array_agg(cargo ORDER BY ultimo_mes DESC))[1] AS cargo, (array_agg(dependencia ORDER BY ultimo_mes DESC))[1] AS dependencia
      FROM planilla_salida WHERE length(paterno) > 2 AND length(materno) > 2
     GROUP BY 1 HAVING count(DISTINCT entidad_ruc) = 1;
  CREATE INDEX ON _gs (nombre);
  CREATE TEMP TABLE _gc ON COMMIT DROP AS
    SELECT upper(c.nombre) AS nombre, c.numero_documento AS doc, c.ruc_empresa::text AS ruc, c.tipo_rol, c.fecha_inicio_vigencia AS desde
      FROM rnp_conformacion_juridica c JOIN _gs s ON s.nombre = upper(c.nombre)
     WHERE c.numero_documento ~ '^[0-9]{8}$' AND c.ruc_empresa ~ '^20[0-9]{9}$';
  -- El nombre corresponde a un solo documento en el RNP.
  DELETE FROM _gc WHERE nombre IN (SELECT nombre FROM _gc GROUP BY 1 HAVING count(DISTINCT doc) > 1);

  DELETE FROM cruces_proveedor WHERE tipo = 'puerta_giratoria';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (g.ruc, cv.ocid) 'puerta_giratoria', g.ruc, cv.ocid,
         CASE WHEN g.f <= g.ultimo_mes + 365 THEN 'alta' ELSE 'media' END, g.f, g.monto, g.doc, g.nombre, g.rol,
         jsonb_build_object('cargo', g.cargo, 'dependencia', g.dependencia, 'salio', to_char(g.ultimo_mes, 'YYYY-MM'),
                            'dias_despues', g.f - g.ultimo_mes, 'en_la_empresa_desde', to_char(g.desde, 'YYYY-MM-DD'),
                            'entro_a_la_empresa_tras_salir', g.desde > g.ultimo_mes, 'empate', 'nombre_completo'),
         'planilla_salida', 'https://www.gob.pe/'
    FROM (SELECT p.ruc, p.doc, p.nombre, max(p.tipo_rol) AS rol, min(p.desde) AS desde, s.entidad_ruc, s.ultimo_mes, s.cargo, s.dependencia,
                 a.codigo_convocatoria AS codigo, max(a.fecha_buenapro) AS f,
                 sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS monto
            FROM _gc p JOIN _gs s USING (nombre)
            JOIN conosce_adjudicaciones a ON a.ruc_proveedor = p.ruc AND a.entidad_ruc = s.entidad_ruc AND a.fecha_buenapro > s.ultimo_mes
           GROUP BY p.ruc, p.doc, p.nombre, s.entidad_ruc, s.ultimo_mes, s.cargo, s.dependencia, a.codigo_convocatoria) g
    JOIN (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
           WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid) cv ON cv.codigo = g.codigo AND cv.entidad_ruc = g.entidad_ruc
   ORDER BY g.ruc, cv.ocid, g.ultimo_mes DESC;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas;
END $$;
ALTER FUNCTION refrescar_cruce_puerta_giratoria() OWNER TO vigia_jobs;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.consorcio_rival TO %I', r);
    END IF;
  END LOOP;
END $$;

SELECT refrescar_cruce_consorcio_rival() AS cruces_consorcio_rival;
SELECT refrescar_cruce_puerta_giratoria() AS cruces_puerta_giratoria;
