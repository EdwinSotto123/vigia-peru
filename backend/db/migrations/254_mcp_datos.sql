-- 254 · Los datos del MCP v2 (consultar_datos y proveedores_de_entidad): las adjudicaciones de CONOSCE agrupadas por
--       proceso y proveedor, y las órdenes que no van a empresas, listas para contar en menos de un segundo.
--
-- El MCP de Gobserva (backend/mcp-worker, v2) no tiene SQL propio: lee por la API (service binding), que arma cada consulta
-- con fragmentos fijos (routes/datos.ts, GET /datos/consulta) y la ficha de proveedores de una entidad
-- (GET /entidades/:ruc/proveedores). Contar sobre conosce_adjudicaciones en cada pedido (549 mil ítems, 1,7 M postores para
-- saber si hubo único postor) pasaba de los 5 s que tiene cada consulta; leerlo de aquí, décimas.
--
--   mcp_adjudicacion   una fila por proceso (codigo_convocatoria) y proveedor, de conosce_adjudicaciones (por ítem):
--     · proveedor_clave: el RUC si es una empresa (RUC 20), 'C:<código>' si es un consorcio y 'otros' para todo lo demás
--       (personas naturales con RUC 10, 15 o 17, no domiciliados, sin RUC). Las personas naturales NO se guardan con su RUC
--       (lleva su DNI) ni con su nombre: todas las de un proceso quedan en una sola fila 'otros'. `ruc_proveedor` y
--       `proveedor` sólo existen para empresas; `consorcio` es el código del consorcio en el SEACE (no es un RUC), para
--       repartir lo que ganó entre sus integrantes RUC 20 (conosce_consorcios), como la ficha de la empresa.
--     · monto: lo adjudicado EN SOLES ('Soles' y, en los años viejos, 'Nuevos Soles'). Los ítems en otra moneda (dólares,
--       euros… 3,4 % de los ítems) no se convierten: no suman y la fila lo dice con `otra_moneda`; el proceso sí cuenta.
--       `dudoso`: el proceso tiene un monto que parece mal cargado (la regla de la 102 y de empresa_resumen: la adjudicación
--       más grande de 20 veces o más el referencial de todo el proceso y más de S/ 1 M, o un referencial de S/ 1 o menos y
--       más de S/ 100 mil): la API no lo suma.
--     · anio: el año de la convocatoria (el de CONOSCE); mes: el primer día del mes de la buena pro (o de la convocatoria,
--       si no tiene). Un proceso convocado en diciembre puede tener la buena pro en enero.
--     · departamento: el de la entidad, en mayúsculas sin tildes (CALLAO sin «Provincia Constitucional del»).
--     · nivel: nacional | regional | local | empresas (FONAFE y Petroperú), del tipo de entidad de CONOSCE.
--     · tipo_proceso: el procedimiento agrupado (las variantes por decreto o ley de la Adjudicación Simplificada son una);
--       tipo_proceso_oece, el texto de CONOSCE. es_directa: Contratación Directa (también la de Petroperú).
--     · unico_postor: todos los ítems adjudicados del proceso tuvieron un solo postor (RUC distintos en conosce_postores);
--       NULL si ningún ítem tiene postores cargados (el 0,2 %). Se mide por proceso, no por proveedor.
--   mcp_orden_otros   por entidad y año, las órdenes que NO fueron a una empresa (personas naturales, RUC 15 y 17): el
--     total de la entidad (entidad_orden_anual, 148) menos lo de las empresas (empresa_orden_anual, 109), nunca negativo.
--     Así la fuente «ordenes» de la API suma todo lo que compró una entidad con las personas en un solo grupo.
--   mcp_cruce_lugar   el departamento y la entidad de cada contrato con señales (cruces_proveedor.ocid): la fuente «senales»
--     se cuenta por región sin recorrer convocatorias (~900 MB con su JSON del OCDS: 17 s en frío en DEV).
--   mcp_estado        una fila: cuándo se refrescaron las tres y cuánto tardó.
--
--   mcp_refrescar(p_horas)  REFRESH CONCURRENTLY de las tres (se siguen leyendo mientras tanto). Con p_horas > 0, sólo si
--     el último refresco tiene más de esas horas. Lo llama el cron de cada 10 min de la API (POST /admin/asignar) con 20:
--     en la práctica, una vez al día. Si ya hay uno corriendo, no espera: {"ocupado": true}.
--
-- Permisos: sólo la API (vigia_api, vigia_api_admin) lee estas vistas. El rol del MCP (vigia_mcp) no: lee por la API,
-- como pide la regla de la 227 (no lee conosce_adjudicaciones). Aunque aquí no hay RUC 10 ni nombres de personas.
--
-- DEV:  bash infrastructure/deploy/dev.sh migrar backend/db/migrations/254_mcp_datos.sql
-- PROD: python -X utf8 backend/scripts/aplicar_migracion.py prod backend/db/migrations/254_mcp_datos.sql
-- En DEV (db.t4g.large) la creación tarda ~1 min; cada refresco, menos (ver mcp_estado.segundos).

SET lock_timeout = '10s';

-- ─── Las adjudicaciones por proceso y proveedor ──────────────────────────────────────────────────────────────────────

-- mcp_orden_otros lee de mcp_adjudicacion: se borra primero (al volver a aplicar la migración).
DROP MATERIALIZED VIEW IF EXISTS mcp_orden_otros;
DROP MATERIALIZED VIEW IF EXISTS mcp_cruce_lugar;
DROP MATERIALIZED VIEW IF EXISTS mcp_adjudicacion;
CREATE MATERIALIZED VIEW mcp_adjudicacion AS
WITH a AS (
  SELECT a.codigo_convocatoria, a.anio, a.n_item, a.entidad_ruc, a.entidad, a.tipo_entidad, a.entidad_departamento,
         a.objeto, a.tipo_proceso, a.fecha_convocatoria, a.fecha_buenapro, a.monto_adjudicado,
         a.moneda IN ('Soles', 'Nuevos Soles') AS soles,
         CASE WHEN a.ruc_proveedor ~ '^20[0-9]{9}$' THEN a.ruc_proveedor
              -- El código de un consorcio son 5 a 7 cifras: nunca un RUC (ni el de una persona).
              WHEN a.tipo_proveedor = 'Consorcio' AND a.ruc_proveedor ~ '^[0-9]{1,9}$' THEN 'C:' || a.ruc_proveedor
              ELSE 'otros' END AS clave,
         CASE WHEN a.ruc_proveedor ~ '^20[0-9]{9}$' THEN a.proveedor END AS proveedor
    FROM conosce_adjudicaciones a
   WHERE a.codigo_convocatoria IS NOT NULL
),
-- Cuántos postores distintos tuvo cada ítem adjudicado; por proceso, si todos tuvieron uno solo (NULL sin datos).
p AS (
  SELECT i.codigo_convocatoria, bool_and(x.n = 1) AS unico
    FROM (SELECT DISTINCT anio, codigo_convocatoria, n_item FROM conosce_adjudicaciones) i
    JOIN (SELECT anio, codigo_convocatoria, n_item, count(DISTINCT ruc_postor) AS n
            FROM conosce_postores GROUP BY 1, 2, 3) x USING (anio, codigo_convocatoria, n_item)
   GROUP BY 1
),
-- Procesos con un monto que parece mal cargado (la misma regla que refrescar_empresas, migraciones 109 y 112).
d AS (
  SELECT codigo_convocatoria
    FROM (SELECT codigo_convocatoria, n_item, max(monto_referencial) AS ref, max(monto_adjudicado) AS adj
            FROM conosce_adjudicaciones WHERE moneda IN ('Soles', 'Nuevos Soles') GROUP BY 1, 2) i
   GROUP BY 1
  HAVING sum(ref) > 0 AND ((sum(ref) <= 1 AND max(adj) > 100000) OR (sum(ref) > 1 AND max(adj) >= 20 * sum(ref) AND max(adj) > 1000000))
),
g AS (
  SELECT a.codigo_convocatoria, a.clave,
         max(a.proveedor) AS proveedor,
         min(a.anio)::smallint AS anio,
         date_trunc('month', min(COALESCE(a.fecha_buenapro, a.fecha_convocatoria)))::date AS mes,
         max(a.entidad_ruc) AS entidad_ruc, max(a.entidad) AS entidad,
         max(regexp_replace(mef_norm(a.entidad_departamento), '^(PROV CONSTITUC DEL|PROVINCIA CONSTITUCIONAL DEL) ', '')) AS departamento,
         max(mef_norm(a.tipo_entidad)) AS tipo_entidad,
         max(a.objeto) AS objeto,
         max(a.tipo_proceso) AS tipo_proceso_oece,
         max(mef_norm(a.tipo_proceso)) AS tp,
         sum(a.monto_adjudicado) FILTER (WHERE a.soles) AS monto,
         bool_or(NOT a.soles) AS otra_moneda,
         count(DISTINCT a.n_item)::int AS items
    FROM a
   GROUP BY a.codigo_convocatoria, a.clave
)
SELECT g.codigo_convocatoria,
       g.clave AS proveedor_clave,
       CASE WHEN g.clave ~ '^20[0-9]{9}$' THEN g.clave END AS ruc_proveedor,
       CASE WHEN g.clave LIKE 'C:%' THEN substr(g.clave, 3) END AS consorcio,
       g.clave ~ '^20[0-9]{9}$' AS es_empresa,
       g.proveedor,
       g.anio, g.mes, g.entidad_ruc, g.entidad,
       NULLIF(g.departamento, '') AS departamento,
       CASE WHEN g.tipo_entidad = 'GOBIERNO NACIONAL' THEN 'nacional'
            WHEN g.tipo_entidad = 'GOBIERNO REGIONAL' THEN 'regional'
            WHEN g.tipo_entidad = 'GOBIERNO LOCAL' THEN 'local'
            WHEN g.tipo_entidad IN ('FONAFE', 'PETROPERU') THEN 'empresas'
       END AS nivel,
       g.objeto,
       CASE WHEN g.tp LIKE 'CONTRATACION DIRECTA%' THEN 'Contratación Directa'
            WHEN g.tp LIKE 'ADJUDICACION SIMPLIFICADA%' THEN 'Adjudicación Simplificada'
            WHEN g.tp LIKE 'SUBASTA INVERSA%' THEN 'Subasta Inversa Electrónica'
            WHEN g.tp LIKE 'LICITACION PUBLICA ABREVIADA%' THEN 'Licitación Pública Abreviada'
            WHEN g.tp LIKE 'LICITACION PUBLICA%' THEN 'Licitación Pública'
            WHEN g.tp LIKE 'CONCURSO PUBLICO ABREVIADO%' THEN 'Concurso Público Abreviado'
            WHEN g.tp LIKE 'CONCURSO PUBLICO%' THEN 'Concurso Público'
            WHEN g.tp LIKE 'COMPARACION DE PRECIOS%' THEN 'Comparación de Precios'
            WHEN g.tp LIKE 'REGIMEN ESPECIAL%' THEN 'Régimen Especial'
            WHEN g.tp LIKE 'CONVENIO%' THEN 'Convenio'
            WHEN g.tp LIKE 'CONTRATACION INTERNACIONAL%' THEN 'Contratación Internacional'
            WHEN g.tp LIKE 'PROCEDIMIENTO ESPECIAL DE CONTRATACION%' THEN 'Procedimiento Especial de Contratación'
            ELSE 'Otros'
       END AS tipo_proceso,
       g.tipo_proceso_oece,
       g.tp LIKE 'CONTRATACION DIRECTA%' AS es_directa,
       g.monto, g.otra_moneda, g.items,
       p.unico AS unico_postor,
       (d.codigo_convocatoria IS NOT NULL) AS dudoso
  FROM g
  LEFT JOIN p ON p.codigo_convocatoria = g.codigo_convocatoria
  LEFT JOIN d ON d.codigo_convocatoria = g.codigo_convocatoria;

-- La llave (sin NULL: proveedor_clave siempre tiene valor): la pide REFRESH ... CONCURRENTLY.
CREATE UNIQUE INDEX mcp_adjudicacion_llave ON mcp_adjudicacion (codigo_convocatoria, proveedor_clave);
CREATE INDEX mcp_adjudicacion_anio ON mcp_adjudicacion (anio);
CREATE INDEX mcp_adjudicacion_entidad ON mcp_adjudicacion (entidad_ruc, anio);
CREATE INDEX mcp_adjudicacion_proveedor ON mcp_adjudicacion (ruc_proveedor) WHERE ruc_proveedor IS NOT NULL;
CREATE INDEX mcp_adjudicacion_consorcio ON mcp_adjudicacion (consorcio) WHERE consorcio IS NOT NULL;
CREATE INDEX mcp_adjudicacion_departamento ON mcp_adjudicacion (departamento, anio);

-- ─── Las órdenes que no fueron a una empresa, por entidad y año ──────────────────────────────────────────────────────

CREATE MATERIALIZED VIEW mcp_orden_otros AS
WITH e AS (
  SELECT entidad_ruc, anio, sum(ordenes) AS ordenes, sum(monto) AS monto
    FROM empresa_orden_anual GROUP BY 1, 2
),
-- El departamento y el nombre de la entidad (son los mismos todos los años): de sus órdenes a empresas o, si no tiene,
-- de sus procesos.
ent AS (
  SELECT entidad_ruc, max(entidad) AS entidad, max(replace(departamento, 'PROV.CONSTITUC.DEL ', '')) AS departamento
    FROM empresa_orden_anual GROUP BY 1
),
adj AS (
  SELECT entidad_ruc, max(entidad) AS entidad, max(departamento) AS departamento FROM mcp_adjudicacion GROUP BY 1
)
SELECT t.entidad_ruc, t.anio,
       COALESCE(ent.entidad, adj.entidad) AS entidad,
       COALESCE(ent.departamento, adj.departamento) AS departamento,
       greatest(t.ordenes - COALESCE(e.ordenes, 0), 0)::int AS ordenes,
       greatest(t.monto - COALESCE(e.monto, 0), 0)::numeric(18, 2) AS monto
  FROM entidad_orden_anual t
  LEFT JOIN e ON e.entidad_ruc = t.entidad_ruc AND e.anio = t.anio
  LEFT JOIN ent ON ent.entidad_ruc = t.entidad_ruc
  LEFT JOIN adj ON adj.entidad_ruc = t.entidad_ruc
 WHERE t.ordenes > COALESCE(e.ordenes, 0) OR t.monto > COALESCE(e.monto, 0);

CREATE UNIQUE INDEX mcp_orden_otros_llave ON mcp_orden_otros (entidad_ruc, anio);

-- ─── Dónde está cada contrato con señales ────────────────────────────────────────────────────────────────────────────

CREATE MATERIALIZED VIEW mcp_cruce_lugar AS
SELECT c.ocid,
       CASE left(c.ubigeo, 2)
         WHEN '01' THEN 'AMAZONAS' WHEN '02' THEN 'ANCASH' WHEN '03' THEN 'APURIMAC' WHEN '04' THEN 'AREQUIPA'
         WHEN '05' THEN 'AYACUCHO' WHEN '06' THEN 'CAJAMARCA' WHEN '07' THEN 'CALLAO' WHEN '08' THEN 'CUSCO'
         WHEN '09' THEN 'HUANCAVELICA' WHEN '10' THEN 'HUANUCO' WHEN '11' THEN 'ICA' WHEN '12' THEN 'JUNIN'
         WHEN '13' THEN 'LA LIBERTAD' WHEN '14' THEN 'LAMBAYEQUE' WHEN '15' THEN 'LIMA' WHEN '16' THEN 'LORETO'
         WHEN '17' THEN 'MADRE DE DIOS' WHEN '18' THEN 'MOQUEGUA' WHEN '19' THEN 'PASCO' WHEN '20' THEN 'PIURA'
         WHEN '21' THEN 'PUNO' WHEN '22' THEN 'SAN MARTIN' WHEN '23' THEN 'TACNA' WHEN '24' THEN 'TUMBES'
         WHEN '25' THEN 'UCAYALI'
       END AS departamento,
       NULLIF(btrim(c.entidad_ruc::text), '') AS entidad_ruc
  FROM convocatorias c
 WHERE c.ocid IN (SELECT DISTINCT ocid FROM cruces_proveedor WHERE ocid IS NOT NULL);

CREATE UNIQUE INDEX mcp_cruce_lugar_llave ON mcp_cruce_lugar (ocid);

-- ─── Estado y refresco ───────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mcp_estado (
  id             BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  refrescado_at  TIMESTAMPTZ NOT NULL,
  segundos       NUMERIC(8, 1),
  adjudicaciones INT,          -- filas de mcp_adjudicacion
  ordenes_otros  INT           -- filas de mcp_orden_otros
);

CREATE OR REPLACE FUNCTION mcp_refrescar(p_horas NUMERIC DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET work_mem = '128MB' AS $$
DECLARE
  t0 TIMESTAMPTZ := clock_timestamp();
  v_ultimo TIMESTAMPTZ;
  n_adj INT;
  n_ord INT;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('mcp_refrescar')) THEN
    RETURN jsonb_build_object('ocupado', true);
  END IF;
  SELECT refrescado_at INTO v_ultimo FROM mcp_estado WHERE id;
  IF COALESCE(p_horas, 0) > 0 AND v_ultimo IS NOT NULL AND v_ultimo > now() - make_interval(secs => (p_horas * 3600)::double precision) THEN
    RETURN jsonb_build_object('refrescado', false, 'ultimo', v_ultimo);
  END IF;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mcp_adjudicacion;
  -- Después de mcp_adjudicacion: de ahí saca el departamento de las entidades sin órdenes a empresas.
  REFRESH MATERIALIZED VIEW CONCURRENTLY mcp_orden_otros;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mcp_cruce_lugar;
  SELECT count(*) INTO n_adj FROM mcp_adjudicacion;
  SELECT count(*) INTO n_ord FROM mcp_orden_otros;
  INSERT INTO mcp_estado (id, refrescado_at, segundos, adjudicaciones, ordenes_otros)
  VALUES (true, now(), round(extract(epoch FROM clock_timestamp() - t0)::numeric, 1), n_adj, n_ord)
  ON CONFLICT (id) DO UPDATE SET refrescado_at = EXCLUDED.refrescado_at, segundos = EXCLUDED.segundos,
                                 adjudicaciones = EXCLUDED.adjudicaciones, ordenes_otros = EXCLUDED.ordenes_otros;
  RETURN jsonb_build_object('refrescado', true, 'adjudicaciones', n_adj, 'ordenesOtros', n_ord,
                            'segundos', round(extract(epoch FROM clock_timestamp() - t0)::numeric, 1));
END $$;

-- La primera marca (las vistas recién creadas ya tienen sus datos).
INSERT INTO mcp_estado (id, refrescado_at, adjudicaciones, ordenes_otros)
VALUES (true, now(), (SELECT count(*) FROM mcp_adjudicacion), (SELECT count(*) FROM mcp_orden_otros))
ON CONFLICT (id) DO UPDATE SET refrescado_at = EXCLUDED.refrescado_at, adjudicaciones = EXCLUDED.adjudicaciones,
                               ordenes_otros = EXCLUDED.ordenes_otros;

-- ─── Dueños y permisos (como la 232) ─────────────────────────────────────────────────────────────────────────────────

-- REFRESH exige ser dueño de la vista: las dos y la función son de vigia_jobs (lee todas las tablas de origen).
ALTER MATERIALIZED VIEW mcp_adjudicacion OWNER TO vigia_jobs;
ALTER MATERIALIZED VIEW mcp_orden_otros OWNER TO vigia_jobs;
ALTER MATERIALIZED VIEW mcp_cruce_lugar OWNER TO vigia_jobs;
ALTER TABLE mcp_estado OWNER TO vigia_jobs;
ALTER FUNCTION mcp_refrescar(NUMERIC) OWNER TO vigia_jobs;

-- Sólo la API las lee. Los privilegios por defecto (37, 43, 44) le dan SELECT a otros roles en toda tabla nueva: fuera.
REVOKE ALL ON mcp_adjudicacion, mcp_orden_otros, mcp_cruce_lugar, mcp_estado FROM PUBLIC;
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_mcp', 'vigia_ab', 'vigia_agentes'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON mcp_adjudicacion, mcp_orden_otros, mcp_cruce_lugar, mcp_estado FROM %I', r);
    END IF;
  END LOOP;
END $$;
GRANT SELECT ON mcp_adjudicacion, mcp_orden_otros, mcp_cruce_lugar, mcp_estado TO vigia_api, vigia_api_admin;

REVOKE ALL ON FUNCTION mcp_refrescar(NUMERIC) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_agentes') THEN
    REVOKE ALL ON FUNCTION mcp_refrescar(NUMERIC) FROM vigia_agentes;
  END IF;
END $$;
-- El cron de la API corre con el pool del panel (vigia_api_admin, 120 s por sentencia).
GRANT EXECUTE ON FUNCTION mcp_refrescar(NUMERIC) TO vigia_api_admin;
