-- 350 · La empresa de un pariente: un socio, representante o directivo (RNP) de una empresa que recibe ÓRDENES de una
-- entidad es pariente que un funcionario de esa MISMA entidad declaró en su declaración jurada de intereses.
--
-- Pregunta del usuario del 2026-11-17 (caso UNI, grupo Valencia): «¿las órdenes se hacen a nombre de persona o de
-- empresa? capaz ahí perdemos información». Sí se perdía. Los parientes declarados se cruzaban de dos maneras:
--   · dji_nepotismo (136): el pariente vende con su propio RUC 10;
--   · pariente_funcionario (189): el pariente es socio de una empresa que GANÓ UN PROCESO en la entidad.
-- Faltaba el pariente socio de una empresa que vende por órdenes directas, que es por donde pasa lo menudo. Medido en
-- PROD el 2026-11-17: 700 pares entidad-empresa con órdenes desde 2023 (S/ 252 M), de los que sólo 88 ya salían por un
-- proceso. 284 son cuñados, suegros, primos u otros; 247 hermanos; 103 cónyuges; 79 padres; 54 hijos.
--
--   severidad  alta  si el parentesco es cercano (cónyuge o conviviente, padres, hijos, hermanos);
--              media si no (cuñados, suegros, primos, tíos, sobrinos…), como en pariente_funcionario.
-- Fuera las personas que figuran en más de 10 empresas del RNP (apoderados de muchas), como en 189. Una fila por entidad
-- y empresa, con el pariente más cercano; `parientes` cuenta cuántos hay. La orden lleva la bandera sólo si es de 2023 en
-- adelante (las DJI son de quienes están hoy en el cargo) y si el pariente ya estaba en la empresa (RNP) ese día.
--
-- Privacidad: ni el pariente ni el funcionario se guardan con nombre ni documento; el parentesco, el cargo y el papel del
-- pariente en la empresa. Si el funcionario es autoridad electa, la API no muestra su cargo (con un parentesco de sangre
-- destaparía un apellido).
--
-- marcar_grupos_parientes() (344) pasa a sumar estos casos: un grupo de proveedores sube a grave también si el socio de
-- uno de sus integrantes es pariente declarado de un funcionario de la entidad (`via`: «socio»; los de 344, «ruc10»).

CREATE TABLE IF NOT EXISTS empresa_pariente_funcionario (
  entidad_ruc       TEXT NOT NULL,
  ruc_empresa       TEXT NOT NULL,
  grado             TEXT,             -- conyuge, padre, hijo, hermano, otro (dji_vinculos)
  parentesco        TEXT,             -- como lo escribe la DJI: «HERMANO(A)», «CUÑADO(A)», «SUEGRO(A)»…
  cargo             TEXT,             -- del funcionario que lo declaró (DJI de datos abiertos, por nombre y entidad)
  rol               TEXT,             -- su papel en la empresa (RNP): socio, representante, órgano de administración
  en_empresa_desde  DATE,             -- desde cuándo figura en la empresa (RNP)
  parientes         INT NOT NULL,     -- cuántos parientes declarados figuran en la empresa
  ordenes           INT NOT NULL,     -- órdenes de la entidad a la empresa desde 2023
  monto             NUMERIC(18, 2) NOT NULL,
  desde_anio        INT,
  hasta_anio        INT,
  severidad         TEXT NOT NULL,
  PRIMARY KEY (entidad_ruc, ruc_empresa)
);
CREATE INDEX IF NOT EXISTS empresa_pariente_funcionario_empresa ON empresa_pariente_funcionario (ruc_empresa);

CREATE OR REPLACE FUNCTION refrescar_empresa_pariente_funcionario() RETURNS integer
LANGUAGE plpgsql SET work_mem = '256MB' AS $$
DECLARE n int;
BEGIN
  CREATE TEMP TABLE _epv ON COMMIT DROP AS
    SELECT DISTINCT entidad_ruc, pariente_doc AS dni, grado, parentesco, declarante_norm
      FROM dji_vinculos WHERE pariente_doc ~ '^\d{8}$' AND entidad_ruc ~ '^\d{11}$';
  CREATE INDEX ON _epv (dni); ANALYZE _epv;
  CREATE TEMP TABLE _epr ON COMMIT DROP AS
    SELECT r.numero_documento AS dni, r.ruc_empresa::text AS ruc, string_agg(DISTINCT lower(r.tipo_rol), ', ') AS rol,
           min(r.fecha_inicio_vigencia) AS desde
      FROM rnp_conformacion_juridica r
     WHERE r.numero_documento IN (SELECT dni FROM _epv) AND r.ruc_empresa::text ~ '^20\d{9}$'
     GROUP BY 1, 2;
  DELETE FROM _epr WHERE dni IN (SELECT dni FROM _epr GROUP BY dni HAVING count(*) > 10);
  CREATE INDEX ON _epr (ruc); ANALYZE _epr;
  CREATE TEMP TABLE _epo ON COMMIT DROP AS
    SELECT e.entidad_ruc, e.ruc, sum(e.ordenes)::int AS ordenes, sum(e.monto) AS monto, min(e.anio) AS a0, max(e.anio) AS a1
      FROM empresa_orden_anual e
     WHERE e.anio >= 2023 AND e.ruc IN (SELECT ruc FROM _epr)
     GROUP BY 1, 2;
  CREATE INDEX ON _epo (entidad_ruc, ruc); ANALYZE _epo;

  DELETE FROM empresa_pariente_funcionario;
  INSERT INTO empresa_pariente_funcionario (entidad_ruc, ruc_empresa, grado, parentesco, cargo, rol, en_empresa_desde, parientes,
                                            ordenes, monto, desde_anio, hasta_anio, severidad)
  SELECT x.entidad_ruc, x.ruc, x.grado, x.parentesco, f.cargo, x.rol, x.desde, c.parientes, x.ordenes, x.monto, x.a0, x.a1,
         CASE WHEN x.grado IN ('conyuge', 'padre', 'hijo', 'hermano') THEN 'alta' ELSE 'media' END
    FROM (SELECT DISTINCT ON (v.entidad_ruc, r.ruc)
                 v.entidad_ruc, r.ruc, v.grado, v.parentesco, v.declarante_norm, r.rol, r.desde, o.ordenes, o.monto, o.a0, o.a1
            FROM _epv v
            JOIN _epr r ON r.dni = v.dni
            JOIN _epo o ON o.entidad_ruc = v.entidad_ruc AND o.ruc = r.ruc
           ORDER BY v.entidad_ruc, r.ruc, CASE v.grado WHEN 'conyuge' THEN 0 WHEN 'hijo' THEN 1 WHEN 'padre' THEN 2 WHEN 'hermano' THEN 3 ELSE 4 END,
                    r.desde NULLS LAST) x
    JOIN (SELECT v.entidad_ruc, r.ruc, count(DISTINCT v.dni)::int AS parientes
            FROM _epv v JOIN _epr r ON r.dni = v.dni JOIN _epo o ON o.entidad_ruc = v.entidad_ruc AND o.ruc = r.ruc
           GROUP BY 1, 2) c ON c.entidad_ruc = x.entidad_ruc AND c.ruc = x.ruc
    LEFT JOIN LATERAL (
      SELECT f.cargo FROM dji_funcionarios f JOIN dji_entidad_ruc m ON m.entidad = f.entidad
       WHERE m.ruc = x.entidad_ruc AND f.nombre_norm = x.declarante_norm
       ORDER BY f.fecha_presentacion DESC NULLS LAST LIMIT 1) f ON true;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE empresa_pariente_funcionario;
  RETURN n;
END $$;

-- 344, ampliada: también el socio pariente (via «socio»), además del pariente que vende con su RUC 10 (via «ruc10»).
CREATE OR REPLACE FUNCTION marcar_grupos_parientes() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  WITH d AS (
    SELECT n.entidad_ruc, n.proveedor_ruc AS ruc, n.cargo, n.parentesco, n.ordenes, n.monto, 'ruc10'::text AS via
      FROM dji_nepotismo n
    UNION ALL
    SELECT e.entidad_ruc, e.ruc_empresa, e.cargo, e.parentesco, e.ordenes, e.monto, 'socio'
      FROM empresa_pariente_funcionario e
  ), p AS (
    SELECT r.entidad_ruc, r.grupo,
           jsonb_agg(DISTINCT jsonb_build_object('ruc', d.ruc, 'cargo', d.cargo, 'parentesco', d.parentesco,
                                                 'ordenes', d.ordenes, 'monto', d.monto, 'via', d.via)) AS parientes
      FROM grupo_proveedor_resumen r
      JOIN grupo_proveedor g ON g.entidad_ruc = r.entidad_ruc AND g.grupo = r.grupo
      JOIN d ON d.entidad_ruc = r.entidad_ruc AND d.ruc = g.ruc
     GROUP BY 1, 2)
  UPDATE grupo_proveedor_resumen r
     SET severidad = 'alta',
         detalle = r.detalle || jsonb_build_object('parientes_de_funcionarios', p.parientes)
    FROM p WHERE p.entidad_ruc = r.entidad_ruc AND p.grupo = r.grupo;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.empresa_pariente_funcionario OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_empresa_pariente_funcionario() OWNER TO vigia_jobs;
    ALTER FUNCTION public.marcar_grupos_parientes() OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab', 'dev_api', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.empresa_pariente_funcionario TO %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_empresa_pariente_funcionario() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION marcar_grupos_parientes() FROM PUBLIC;
