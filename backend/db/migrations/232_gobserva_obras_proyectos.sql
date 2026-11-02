-- 232 · Gobserva Obras (obras.gobserva.cloud, 2026-11-01): los proyectos de inversión pública en una tabla plana, lista para
--       buscar, filtrar y contar en menos de un segundo, y la ficha y el mercado de obras para la web y el MCP.
--
-- Por qué una tabla aparte: la lista de Gobserva Obras filtra y cuenta (por región, sector, nivel, fase, modalidad) las
-- ~150 mil inversiones activas de Invierte.pe, cruzadas con sus obras de INFOBRAS (por CUI) y sus procesos del SEACE
-- (contrato_cui). Hacer ese cruce en cada pedido tarda de 3 a 35 s; leerlo de esta tabla, décimas. Se rehace con
-- gobserva_refrescar_proyectos(): al aplicar esta migración, cada vez que la API la encuentra vieja (más de 20 h, en
-- segundo plano) y, lo ideal, al final de cada carga de invierte_pe e infobras (después de refrescar_obras()).
--
--   gobserva_proyecto          una fila por inversión ACTIVA de Invierte.pe (las cerradas sólo tienen ficha), con:
--     · su fase, de la más avanzada a la menos (la regla está en gobserva_refrescar_proyectos):
--         paralizada  una obra suya de INFOBRAS está hoy paralizada
--         ejecucion   una obra suya está en ejecución; o hay un contrato de obra (SEACE, de los últimos 3 años); o el MEF
--                     registra avance físico o gasto de 10 % o más, con gasto en los últimos 24 meses
--         licitacion  se está licitando la obra: un proceso de obra con su CUI en etapa de convocatoria (últimos 60 días, como
--                     las oportunidades de Gobserva Licitaciones)
--         terminada   sus obras de INFOBRAS terminaron (o el MEF registra 100 % de avance): falta cerrar la inversión
--         sin_movimiento  tuvo gasto o avance, pero nada en los últimos 24 meses y sin obra en INFOBRAS
--         expediente  viable o aprobada y con expediente técnico (o su monto): lista para licitar la obra
--         viable      viable o aprobada, sin expediente técnico todavía
--     · `se_viene`: el pipeline ANTES de la licitación (viable, expediente o licitación) que no es un proyecto olvidado:
--       declarado viable en los últimos 3 años, con presupuesto este año (PIM) o licitándose.
--     · montos saneados: el costo actualizado (o el viable si el costo es imposible, `dudoso` de la 160), lo devengado, lo
--       que falta ejecutar; el avance de la obra de INFOBRAS sólo entre 0 y 100 %, su fecha sólo si no es futura, y el
--       monto de su contrato sólo si no pasa de 3 veces el costo de la inversión (INFOBRAS trae contratos de S/ 113 mil
--       millones en obras de S/ 637 millones).
--     · su obra principal de INFOBRAS: la paralizada o en ejecución que se llama como la inversión (pg_trgm) y, si no,
--       la más grande; `obra_representa` dice si esa obra es el proyecto o sólo una parte chica de uno grande.
--     · quién ejecuta la obra, SÓLO si es una empresa (RUC 20): un RUC 10 lleva un DNI y una persona natural no se nombra.
--     · para las alertas: `primera_vez` (cuándo entró; el refresco no la toca) y `fase_cambio_at` (cuándo cambió de fase).
--   gobserva_proyecto_estado   una fila: cuándo se refrescó, con qué datos y cuánto tardó.
--
--   gobserva_obras_ficha(cui)               la ficha entera de una inversión (activa o cerrada) en jsonb: sus montos, sus
--                                           obras de INFOBRAS, sus procesos del SEACE con quién ganó (sólo empresas RUC
--                                           20; de un consorcio, sus integrantes RUC 20), los contratistas, las fuentes
--                                           y proyectos parecidos. Sin nombres de personas naturales.
--   gobserva_obras_mercado(region, sector)  el mercado de obras: cuánto hay por ejecutar y en el pipeline, por zona,
--                                           sector y tamaño, cuántas paralizadas y por qué, y quién gana las obras y las
--                                           supervisiones (CONOSCE, 12 meses; sólo empresas RUC 20; un consorcio se
--                                           reparte entre sus integrantes en partes iguales: su participación no se
--                                           publica en estos datos).
--
-- SECURITY DEFINER como la 227: el rol del MCP (vigia_mcp) no lee conosce_adjudicaciones ni conosce_consorcios (traen
-- personas naturales con su RUC 10); estas funciones le dan sólo lo que se puede publicar.
--
-- DEV:  bash infrastructure/deploy/dev.sh migrar backend/db/migrations/232_gobserva_obras_proyectos.sql
-- PROD: lo mismo por el túnel (tunel_rds). Al final llena la tabla: ~75 s la primera vez en DEV (db.t4g.large); después,
-- cada refresco tarda ~18 s y sólo reescribe las filas que cambiaron.

SET lock_timeout = '10s';

-- ─── La tabla ─────────────────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gobserva_proyecto (
  cui                   CHAR(7) PRIMARY KEY,
  nombre                TEXT NOT NULL,
  fase                  TEXT NOT NULL CHECK (fase IN ('viable', 'expediente', 'licitacion', 'ejecucion', 'paralizada', 'terminada', 'sin_movimiento')),
  se_viene              BOOLEAN NOT NULL,
  tipo                  TEXT NOT NULL CHECK (tipo IN ('obra', 'equipamiento')),   -- equipamiento: «Adquisición de …»
  situacion             TEXT,                       -- VIABLE | APROBADO | EN FORMULACION
  nivel                 TEXT,                       -- GN | GR | GL
  sector                TEXT NOT NULL,              -- la función del MEF agrupada (gobserva_obras_sector)
  funcion               TEXT,
  tipologia             TEXT,
  tipo_inversion        TEXT,
  modalidad             TEXT,                       -- contrata | directa | mixta | oxi | app | nucleo | otra (gobserva_obras_modalidad)
  entidad_ruc           CHAR(11),
  entidad               TEXT,
  unidad                TEXT,                       -- la unidad ejecutora de inversiones (UEI)
  region                CHAR(2),                    -- 01 a 25 (99: multidepartamental → NULL)
  departamento          TEXT,
  provincia             TEXT,
  distrito              TEXT,
  ubigeo                CHAR(6),
  viable                NUMERIC(18, 2),             -- monto con el que se declaró viable
  costo                 NUMERIC(18, 2),             -- costo actualizado (saneado)
  expediente_monto      NUMERIC(18, 2),             -- el del expediente técnico (formato 8)
  con_expediente        BOOLEAN NOT NULL,
  devengado             NUMERIC(18, 2) NOT NULL,    -- devengado acumulado (MEF)
  devengado_anio        NUMERIC(18, 2) NOT NULL,
  pim_anio              NUMERIC(18, 2) NOT NULL,
  por_ejecutar          NUMERIC(18, 2),             -- costo − devengado, nunca negativo
  avance_mef            NUMERIC(6, 2),              -- avance físico que registra el MEF (0 a 100)
  fecha_viable          DATE,
  ultimo_gasto          DATE,                       -- el mes del último devengado (primer día del mes)
  inicio_previsto       DATE,
  fin_previsto          DATE,
  beneficiarios         INT,
  -- INFOBRAS: cuántas obras tiene el CUI y la principal (paralizada, en ejecución, sin ejecutar o terminada; la más nueva)
  obras                 INT NOT NULL DEFAULT 0,
  obra_codigo           INT,
  obra_estado           TEXT,
  obra_modalidad        TEXT,
  obra_fisico           NUMERIC(6, 2),
  obra_programado       NUMERIC(6, 2),
  obra_financiero       NUMERIC(8, 2),
  obra_avance_al        DATE,
  obra_inicio           DATE,
  obra_fin              DATE,
  obra_paralizada_desde DATE,
  obra_causal           TEXT,
  ejecutor_ruc          CHAR(11),                   -- sólo RUC 20
  ejecutor              TEXT,
  contrato_obra         NUMERIC(18, 2),             -- el contrato de la obra según INFOBRAS (saneado)
  obra_representa       BOOLEAN NOT NULL DEFAULT true,   -- la obra principal es el proyecto (no una parte chica de uno grande)
  -- SEACE (contrato_cui): cuántos procesos citan el CUI y el último abierto (obra primero, luego consultoría)
  procesos              INT NOT NULL DEFAULT 0,
  ultimo_proceso        DATE,
  convocatoria_ocid     TEXT,
  convocatoria_tipo     TEXT,
  convocatoria_fecha    DATE,
  convocatoria_valor    NUMERIC(18, 2),
  dudoso                BOOLEAN NOT NULL DEFAULT false,   -- el costo del MEF era imposible: se usa el viable
  texto                 TEXT NOT NULL,              -- para buscar: sin tildes, en minúsculas, sin personas naturales
  dataset_fecha         DATE,
  huella                TEXT NOT NULL,
  actualizado_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Para las alertas («lo nuevo desde el último aviso», backend/api/src/lib/gobservaAlertas.ts):
  primera_vez           TIMESTAMPTZ NOT NULL DEFAULT now(),   -- cuándo entró la inversión a la tabla (el refresco nunca la cambia)
  fase_cambio_at        TIMESTAMPTZ DEFAULT now()             -- cuándo cambió de fase por última vez (o entró)
);
-- (Columnas que llegaron después de la primera versión, para la base que ya tenía la tabla: las filas que ya están quedan
-- con la hora de esta migración.)
ALTER TABLE gobserva_proyecto ADD COLUMN IF NOT EXISTS obra_representa BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE gobserva_proyecto ADD COLUMN IF NOT EXISTS primera_vez TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE gobserva_proyecto ADD COLUMN IF NOT EXISTS fase_cambio_at TIMESTAMPTZ DEFAULT now();
UPDATE gobserva_proyecto SET fase_cambio_at = now() WHERE fase_cambio_at IS NULL;
CREATE INDEX IF NOT EXISTS gobserva_proyecto_primera_vez ON gobserva_proyecto (primera_vez);
CREATE INDEX IF NOT EXISTS gobserva_proyecto_fase_cambio ON gobserva_proyecto (fase_cambio_at);
CREATE INDEX IF NOT EXISTS gobserva_proyecto_costo ON gobserva_proyecto (costo DESC NULLS LAST, cui);
CREATE INDEX IF NOT EXISTS gobserva_proyecto_entidad ON gobserva_proyecto (entidad_ruc);
CREATE INDEX IF NOT EXISTS gobserva_proyecto_region_sector ON gobserva_proyecto (region, sector);
CREATE INDEX IF NOT EXISTS gobserva_proyecto_texto ON gobserva_proyecto USING gin (texto gin_trgm_ops);
COMMENT ON TABLE gobserva_proyecto IS
  'Gobserva Obras: una fila por inversión activa de Invierte.pe con su fase, sus montos, su obra de INFOBRAS y sus procesos del SEACE. La rehace gobserva_refrescar_proyectos(). Migración 232.';

CREATE TABLE IF NOT EXISTS gobserva_proyecto_estado (
  id              BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  refrescado_at   TIMESTAMPTZ,
  inversiones_al  DATE,                             -- el día del archivo de Invierte.pe (dataset_fecha)
  infobras_al     DATE,                             -- el del archivo de INFOBRAS (obra_refresco 'infobras_fecha')
  filas           INT,
  cambiadas       INT,
  borradas        INT,
  ms              INT
);

-- ─── Claves de sector y modalidad ────────────────────────────────────────────────────────────────────────────────────

-- La función del MEF agrupada como la piensa quien construye (las del SNIP viejo caen en la suya).
CREATE OR REPLACE FUNCTION gobserva_obras_sector(f TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN x IN ('TRANSPORTE') THEN 'transporte'
    WHEN x IN ('SANEAMIENTO', 'SALUD Y SANEAMIENTO') THEN 'saneamiento'
    WHEN x IN ('EDUCACION', 'EDUCACION Y CULTURA') THEN 'educacion'
    WHEN x IN ('SALUD') THEN 'salud'
    WHEN x IN ('AGROPECUARIA', 'AGRARIA', 'PESCA') THEN 'agro'
    WHEN x IN ('VIVIENDA Y DESARROLLO URBANO') THEN 'urbano'
    WHEN x IN ('CULTURA Y DEPORTE') THEN 'deporte'
    WHEN x IN ('ENERGIA', 'ENERGIA Y RECURSOS MINERALES') THEN 'energia'
    WHEN x IN ('AMBIENTE') THEN 'ambiente'
    WHEN x IN ('ORDEN PUBLICO Y SEGURIDAD', 'DEFENSA Y SEGURIDAD NACIONAL') THEN 'seguridad'
    WHEN x IN ('PLANEAMIENTO, GESTION Y RESERVA DE CONTINGENCIA', 'ADMINISTRACION Y PLANEAMIENTO') THEN 'gestion'
    WHEN x IN ('PROTECCION SOCIAL', 'ASISTENCIA Y PREVISION SOCIAL', 'PREVISION SOCIAL', 'TRABAJO') THEN 'social'
    WHEN x IN ('COMERCIO', 'TURISMO', 'INDUSTRIA', 'INDUSTRIA, COMERCIO Y SERVICIOS') THEN 'comercio'
    WHEN x IN ('JUSTICIA') THEN 'justicia'
    WHEN x IN ('COMUNICACIONES') THEN 'comunicaciones'
    ELSE 'otros' END
  FROM (SELECT btrim(upper(immutable_unaccent(COALESCE(f, '')))) AS x) t
$$;

-- La modalidad de ejecución del MEF (una lista con comas) en una clave: si se contrata (una empresa la construye) o la
-- ejecuta la entidad.
CREATE OR REPLACE FUNCTION gobserva_obras_modalidad(m TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN x = '' THEN NULL
    WHEN x LIKE '%ADMINISTRACION DIRECTA%' AND x NOT LIKE '%INDIRECTA%' AND x NOT LIKE '%LEY DE CONTRATACIONES%' THEN 'directa'
    WHEN x LIKE '%ADMINISTRACION DIRECTA%' THEN 'mixta'
    WHEN x LIKE '%POR CONTRATA%' OR x LIKE '%LEY DE CONTRATACIONES%' OR x LIKE '%GOBIERNO A GOBIERNO%' THEN 'contrata'
    WHEN x LIKE '%OBRAS POR IMPUESTOS%' THEN 'oxi'
    WHEN x LIKE '%ASOCIACION PUBLICA PRIVADA%' THEN 'app'
    WHEN x LIKE '%NUCLEO EJECUTOR%' THEN 'nucleo'
    ELSE 'otra' END
  FROM (SELECT btrim(upper(immutable_unaccent(COALESCE(m, '')))) AS x) t
$$;

-- ─── El refresco ─────────────────────────────────────────────────────────────────────────────────────────────────────

/*
 * Rehace gobserva_proyecto desde inversion_mef, obra_infobras y contrato_cui: arma todas las filas en una tabla temporal y
 * sólo reescribe las que cambiaron (huella), borra las inversiones que ya no están activas y anota el estado. Si ya hay un
 * refresco corriendo, no espera: devuelve {"ocupado": true}. Las filas viejas se siguen leyendo mientras tanto (sin
 * TRUNCATE: nadie espera un bloqueo).
 */
CREATE OR REPLACE FUNCTION gobserva_refrescar_proyectos() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t0 TIMESTAMPTZ := clock_timestamp();
  hace24 INT := to_char(current_date - interval '24 months', 'YYYYMM')::int;
  n_filas INT;
  n_cambiadas INT;
  n_borradas INT;
  v_inv DATE;
  v_inf DATE;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('gobserva_refrescar_proyectos')) THEN
    RETURN jsonb_build_object('ocupado', true);
  END IF;
  SET LOCAL work_mem = '128MB';

  -- La tabla temporal siempre con su esquema (pg_temp): en una función SECURITY DEFINER, `public` va primero en la ruta.
  DROP TABLE IF EXISTS pg_temp._gp;
  CREATE TEMP TABLE _gp ON COMMIT DROP AS
  SELECT q.*, md5(q::text) AS huella FROM (
  WITH ob0 AS (
    -- Las obras de INFOBRAS de cada CUI, con su tamaño: el contrato si es creíble (hasta 3 veces el expediente o el monto
    -- viable), si no, el expediente técnico.
    SELECT o.cui, o.codigo, o.estado, o.fecha_inicio, o.nombre,
           CASE WHEN o.contrato_monto > 0 AND o.contrato_monto <= 3 * GREATEST(COALESCE(o.costo_et, 0), COALESCE(o.monto_viable, 0))
                THEN o.contrato_monto ELSE NULLIF(o.costo_et, 0) END AS monto,
           count(*) OVER (PARTITION BY o.cui) AS n_cui
      FROM obra_infobras o WHERE NOT o.retirada AND o.cui IS NOT NULL
  ), ob1 AS (
    -- Con varias obras, cuánto se parece cada una al nombre de la inversión (pg_trgm): la que se llama como el proyecto es
    -- el proyecto (la Línea 2 del Metro tiene 40 obras con su CUI; la suya es una, con un contrato chico registrado).
    SELECT ob0.*, CASE WHEN ob0.n_cui > 1 THEN similarity(lower(ob0.nombre), lower(i.nombre)) END AS sim
      FROM ob0 LEFT JOIN inversion_mef i ON ob0.n_cui > 1 AND i.cui = ob0.cui
  ), ob AS (
    -- La principal: paralizada, en ejecución, sin ejecutar o terminada y, en cada estado, la que se llama como el proyecto
    -- y después la más grande y la más nueva.
    SELECT ob1.cui, count(*)::int AS n,
           bool_or(ob1.estado = 'Paralizada') AS par, bool_or(ob1.estado = 'En Ejecución') AS ejec, bool_or(ob1.estado = 'Finalizado') AS fin,
           (array_agg(ob1.codigo ORDER BY CASE ob1.estado WHEN 'Paralizada' THEN 0 WHEN 'En Ejecución' THEN 1 WHEN 'Sin Ejecución' THEN 2 ELSE 3 END,
                      (COALESCE(ob1.sim, 1) >= 0.5) DESC, ob1.monto DESC NULLS LAST, ob1.fecha_inicio DESC NULLS LAST, ob1.codigo DESC))[1] AS principal,
           (array_agg(COALESCE(ob1.sim, 1) ORDER BY CASE ob1.estado WHEN 'Paralizada' THEN 0 WHEN 'En Ejecución' THEN 1 WHEN 'Sin Ejecución' THEN 2 ELSE 3 END,
                      (COALESCE(ob1.sim, 1) >= 0.5) DESC, ob1.monto DESC NULLS LAST, ob1.fecha_inicio DESC NULLS LAST, ob1.codigo DESC))[1] AS principal_sim
      FROM ob1 GROUP BY ob1.cui
  ), pr AS (
    -- Los procesos del SEACE que citan el CUI (contrato_cui): cuántos, si la obra ya se contrató y el último abierto.
    SELECT k.cui, count(DISTINCT k.ocid)::int AS n, max(c.fecha_convocatoria) AS ultimo,
           bool_or(c.tipo_contratacion = 'obras' AND c.etapa IN ('contratada', 'en_ejecucion', 'adjudicada')
                   AND c.fecha_convocatoria >= current_date - 1095) AS obra_contratada,
           bool_or(c.tipo_contratacion = 'obras' AND c.etapa = 'convocada' AND c.fecha_convocatoria >= current_date - 60) AS obra_licitando,
           (array_agg(c.ocid ORDER BY (c.tipo_contratacion = 'obras') DESC, (c.tipo_contratacion = 'consultoria') DESC, c.fecha_convocatoria DESC, c.ocid DESC)
              FILTER (WHERE c.etapa = 'convocada' AND c.fecha_convocatoria >= current_date - 60))[1] AS abierta
      FROM contrato_cui k JOIN convocatorias c ON c.ocid = k.ocid GROUP BY k.cui
  ), fsec AS (
    -- La clave de sector y de modalidad, una vez por valor distinto (~30 y ~50), no por fila: llamar 300 mil veces a una
    -- función de SQL que no se expande en línea costaba 40 s.
    SELECT d.k, gobserva_obras_sector(d.k) AS sector FROM (SELECT DISTINCT COALESCE(funcion, '') AS k FROM inversion_mef) d
  ), fmod AS (
    SELECT d.k, gobserva_obras_modalidad(d.k) AS modalidad FROM (SELECT DISTINCT COALESCE(modalidad, '') AS k FROM inversion_mef) d
  ), b AS (
    SELECT i.*, ob.n AS ob_n, ob.par, ob.ejec, ob.fin, ob.principal, ob.principal_sim, pr.n AS pr_n, pr.ultimo AS pr_ultimo, pr.obra_contratada,
           pr.obra_licitando, pr.abierta,
           CASE WHEN 'costo_imposible' = ANY(i.dudoso) THEN NULLIF(i.monto_viable, 0) ELSE NULLIF(i.costo_actualizado, 0) END AS costo_ok,
           CASE WHEN i.avance_fisico BETWEEN 0 AND 100.5 THEN LEAST(i.avance_fisico, 100) END AS avance_ok
      FROM inversion_mef i LEFT JOIN ob ON ob.cui = i.cui LEFT JOIN pr ON pr.cui = i.cui
     WHERE NOT i.retirada AND i.origen = 'activa' AND i.nombre IS NOT NULL
  ), f AS (
    SELECT b.*,
      CASE
        WHEN b.par THEN 'paralizada'
        WHEN b.ejec THEN 'ejecucion'
        WHEN b.obra_licitando AND NOT COALESCE(b.fin, false) AND NOT COALESCE(b.obra_contratada, false) THEN 'licitacion'
        WHEN b.obra_contratada AND NOT COALESCE(b.fin, false) THEN 'ejecucion'
        WHEN b.fin THEN 'terminada'
        WHEN b.avance_ok >= 99.5 THEN 'terminada'
        WHEN b.avance_ok > 0 OR b.devengado_acumulado >= 0.1 * b.costo_ok
          THEN CASE WHEN b.ultimo_devengado >= hace24 THEN 'ejecucion' ELSE 'sin_movimiento' END
        WHEN COALESCE(b.expediente_tecnico, false) OR COALESCE(b.monto_et, 0) > 0 THEN 'expediente'
        ELSE 'viable' END AS fase
      FROM b
  )
  SELECT f.cui,
         btrim(regexp_replace(f.nombre, '\s+', ' ', 'g')) AS nombre,
         f.fase,
         COALESCE(f.fase IN ('viable', 'expediente', 'licitacion') AND f.costo_ok > 0
           AND (f.fecha_viabilidad >= current_date - 1095 OR f.pim_anio > 0 OR f.fase = 'licitacion'), false) AS se_viene,
         CASE WHEN f.nombre ~* '^\s*ADQUISICI' THEN 'equipamiento' ELSE 'obra' END AS tipo,
         f.situacion, f.nivel,
         CASE WHEN fsec.sector = 'saneamiento' AND f.nombre ~* '(HOSPITAL|SALUD|CL[IÍ]NICA|POSTA|ESSALUD|MATERNO|BOTIQU)' THEN 'salud'
              ELSE COALESCE(fsec.sector, 'otros') END AS sector,
         f.funcion, f.tipologia, f.tipo_inversion,
         fmod.modalidad,
         f.entidad_ruc, f.entidad_nombre AS entidad, COALESCE(f.uei, f.uep) AS unidad,
         CASE WHEN left(f.ubigeo, 2) BETWEEN '01' AND '25' THEN left(f.ubigeo, 2) END::char(2) AS region,
         f.departamento, f.provincia, f.distrito, f.ubigeo,
         NULLIF(f.monto_viable, 0) AS viable,
         f.costo_ok AS costo,
         NULLIF(f.monto_et, 0) AS expediente_monto,
         (COALESCE(f.expediente_tecnico, false) OR COALESCE(f.monto_et, 0) > 0) AS con_expediente,
         COALESCE(f.devengado_acumulado, 0) AS devengado,
         COALESCE(f.devengado_anio, 0) AS devengado_anio,
         COALESCE(f.pim_anio, 0) AS pim_anio,
         CASE WHEN f.costo_ok IS NOT NULL THEN GREATEST(f.costo_ok - COALESCE(f.devengado_acumulado, 0), 0) END AS por_ejecutar,
         f.avance_ok AS avance_mef,
         f.fecha_viabilidad AS fecha_viable,
         CASE WHEN f.ultimo_devengado BETWEEN 200001 AND 210012 AND f.ultimo_devengado % 100 BETWEEN 1 AND 12
              THEN make_date(f.ultimo_devengado / 100, f.ultimo_devengado % 100, 1) END AS ultimo_gasto,
         f.inicio_ejecucion AS inicio_previsto, f.fin_ejecucion AS fin_previsto,
         NULLIF(f.beneficiarios, 0) AS beneficiarios,
         COALESCE(f.ob_n, 0) AS obras,
         o.codigo AS obra_codigo, o.estado AS obra_estado, o.modalidad AS obra_modalidad,
         CASE WHEN o.fisico_real BETWEEN 0 AND 100.5 THEN LEAST(o.fisico_real, 100) END AS obra_fisico,
         CASE WHEN o.fisico_prog BETWEEN 0 AND 100.5 THEN LEAST(o.fisico_prog, 100) END AS obra_programado,
         CASE WHEN o.financiero_pct BETWEEN 0 AND 200 THEN o.financiero_pct END AS obra_financiero,
         CASE WHEN o.avance_fecha <= COALESCE(o.dataset_fecha, current_date) THEN o.avance_fecha END AS obra_avance_al,
         o.fecha_inicio AS obra_inicio, COALESCE(o.fecha_fin_reprog, o.fecha_fin_prog) AS obra_fin,
         CASE WHEN o.estado = 'Paralizada' THEN o.fecha_paralizacion END AS obra_paralizada_desde,
         CASE WHEN o.estado = 'Paralizada' THEN NULLIF(btrim(o.causal_paralizacion), '') END AS obra_causal,
         CASE WHEN o.ejecutor_ruc ~ '^20[0-9]{9}$' THEN o.ejecutor_ruc END::char(11) AS ejecutor_ruc,
         CASE WHEN o.ejecutor_ruc ~ '^20[0-9]{9}$' THEN NULLIF(btrim(regexp_replace(o.ejecutor_nombre, '\s+amp\s+', ' & ', 'gi')), '') END AS ejecutor,
         CASE WHEN o.contrato_monto > 0 AND (f.costo_ok IS NULL OR o.contrato_monto <= 3 * f.costo_ok) THEN o.contrato_monto END AS contrato_obra,
         -- ¿La obra principal es el proyecto? Sí, si es la única del CUI o se llama como la inversión. Si no, sólo si su monto
         -- (contrato creíble o expediente) es la quinta parte del costo o más: si no, es una parte chica de un proyecto grande y
         -- su avance y su contratista no son los del proyecto.
         COALESCE(CASE WHEN o.codigo IS NULL OR f.ob_n = 1 OR f.principal_sim >= 0.5 THEN true
                       WHEN f.costo_ok > 0 THEN COALESCE(CASE WHEN o.contrato_monto > 0 AND o.contrato_monto <= 3 * GREATEST(COALESCE(o.costo_et, 0), COALESCE(o.monto_viable, 0))
                                                              THEN o.contrato_monto ELSE NULLIF(o.costo_et, 0) END, 0) >= 0.2 * f.costo_ok
                       ELSE f.ob_n = 1 END, true) AS obra_representa,
         COALESCE(f.pr_n, 0) AS procesos, f.pr_ultimo AS ultimo_proceso,
         ca.ocid AS convocatoria_ocid, ca.tipo_contratacion AS convocatoria_tipo, ca.fecha_convocatoria AS convocatoria_fecha,
         NULLIF(ca.cuantia_referencial, 0) AS convocatoria_valor,
         ('costo_imposible' = ANY(f.dudoso)) AS dudoso,
         concat_ws(' ', f.texto, lower(immutable_unaccent(concat_ws(' ', f.entidad_nombre, f.tipologia,
                   CASE WHEN o.ejecutor_ruc ~ '^20[0-9]{9}$' THEN concat_ws(' ', o.ejecutor_nombre, o.ejecutor_ruc) END)))) AS texto,
         f.dataset_fecha
    FROM f
    LEFT JOIN fsec ON fsec.k = COALESCE(f.funcion, '')
    LEFT JOIN fmod ON fmod.k = COALESCE(f.modalidad, '')
    LEFT JOIN obra_infobras o ON o.codigo = f.principal
    LEFT JOIN convocatorias ca ON ca.ocid = f.abierta
  ) q;
  GET DIAGNOSTICS n_filas = ROW_COUNT;
  CREATE UNIQUE INDEX ON pg_temp._gp (cui);

  DELETE FROM gobserva_proyecto p WHERE NOT EXISTS (SELECT 1 FROM pg_temp._gp g WHERE g.cui = p.cui);
  GET DIAGNOSTICS n_borradas = ROW_COUNT;

  INSERT INTO gobserva_proyecto AS p (
    cui, nombre, fase, se_viene, tipo, situacion, nivel, sector, funcion, tipologia, tipo_inversion, modalidad, entidad_ruc, entidad,
    unidad, region, departamento, provincia, distrito, ubigeo, viable, costo, expediente_monto, con_expediente, devengado,
    devengado_anio, pim_anio, por_ejecutar, avance_mef, fecha_viable, ultimo_gasto, inicio_previsto, fin_previsto, beneficiarios,
    obras, obra_codigo, obra_estado, obra_modalidad, obra_fisico, obra_programado, obra_financiero, obra_avance_al, obra_inicio,
    obra_fin, obra_paralizada_desde, obra_causal, ejecutor_ruc, ejecutor, contrato_obra, obra_representa, procesos, ultimo_proceso,
    convocatoria_ocid, convocatoria_tipo, convocatoria_fecha, convocatoria_valor, dudoso, texto, dataset_fecha, huella, actualizado_at,
    primera_vez, fase_cambio_at)
  SELECT cui, nombre, fase, se_viene, tipo, situacion, nivel, sector, funcion, tipologia, tipo_inversion, modalidad, entidad_ruc, entidad,
    unidad, region, departamento, provincia, distrito, ubigeo, viable, costo, expediente_monto, con_expediente, devengado,
    devengado_anio, pim_anio, por_ejecutar, avance_mef, fecha_viable, ultimo_gasto, inicio_previsto, fin_previsto, beneficiarios,
    obras, obra_codigo, obra_estado, obra_modalidad, obra_fisico, obra_programado, obra_financiero, obra_avance_al, obra_inicio,
    obra_fin, obra_paralizada_desde, obra_causal, ejecutor_ruc, ejecutor, contrato_obra, obra_representa, procesos, ultimo_proceso,
    convocatoria_ocid, convocatoria_tipo, convocatoria_fecha, convocatoria_valor, dudoso, texto, dataset_fecha, huella, now(),
    now(), now()
    FROM pg_temp._gp
  ON CONFLICT (cui) DO UPDATE SET
    nombre = EXCLUDED.nombre, fase = EXCLUDED.fase, se_viene = EXCLUDED.se_viene, tipo = EXCLUDED.tipo, situacion = EXCLUDED.situacion,
    nivel = EXCLUDED.nivel, sector = EXCLUDED.sector, funcion = EXCLUDED.funcion, tipologia = EXCLUDED.tipologia,
    tipo_inversion = EXCLUDED.tipo_inversion, modalidad = EXCLUDED.modalidad, entidad_ruc = EXCLUDED.entidad_ruc,
    entidad = EXCLUDED.entidad, unidad = EXCLUDED.unidad, region = EXCLUDED.region, departamento = EXCLUDED.departamento,
    provincia = EXCLUDED.provincia, distrito = EXCLUDED.distrito, ubigeo = EXCLUDED.ubigeo, viable = EXCLUDED.viable,
    costo = EXCLUDED.costo, expediente_monto = EXCLUDED.expediente_monto, con_expediente = EXCLUDED.con_expediente,
    devengado = EXCLUDED.devengado, devengado_anio = EXCLUDED.devengado_anio, pim_anio = EXCLUDED.pim_anio,
    por_ejecutar = EXCLUDED.por_ejecutar, avance_mef = EXCLUDED.avance_mef, fecha_viable = EXCLUDED.fecha_viable,
    ultimo_gasto = EXCLUDED.ultimo_gasto, inicio_previsto = EXCLUDED.inicio_previsto, fin_previsto = EXCLUDED.fin_previsto,
    beneficiarios = EXCLUDED.beneficiarios, obras = EXCLUDED.obras, obra_codigo = EXCLUDED.obra_codigo,
    obra_estado = EXCLUDED.obra_estado, obra_modalidad = EXCLUDED.obra_modalidad, obra_fisico = EXCLUDED.obra_fisico,
    obra_programado = EXCLUDED.obra_programado, obra_financiero = EXCLUDED.obra_financiero,
    obra_avance_al = EXCLUDED.obra_avance_al, obra_inicio = EXCLUDED.obra_inicio, obra_fin = EXCLUDED.obra_fin,
    obra_paralizada_desde = EXCLUDED.obra_paralizada_desde, obra_causal = EXCLUDED.obra_causal,
    ejecutor_ruc = EXCLUDED.ejecutor_ruc, ejecutor = EXCLUDED.ejecutor, contrato_obra = EXCLUDED.contrato_obra,
    obra_representa = EXCLUDED.obra_representa,
    procesos = EXCLUDED.procesos, ultimo_proceso = EXCLUDED.ultimo_proceso, convocatoria_ocid = EXCLUDED.convocatoria_ocid,
    convocatoria_tipo = EXCLUDED.convocatoria_tipo, convocatoria_fecha = EXCLUDED.convocatoria_fecha,
    convocatoria_valor = EXCLUDED.convocatoria_valor, dudoso = EXCLUDED.dudoso, texto = EXCLUDED.texto,
    dataset_fecha = EXCLUDED.dataset_fecha, huella = EXCLUDED.huella, actualizado_at = now(),
    -- primera_vez no se toca nunca; fase_cambio_at, sólo si cambió la fase (la fase es parte de la huella).
    fase_cambio_at = CASE WHEN p.fase IS DISTINCT FROM EXCLUDED.fase THEN now() ELSE p.fase_cambio_at END
  WHERE p.huella IS DISTINCT FROM EXCLUDED.huella;
  GET DIAGNOSTICS n_cambiadas = ROW_COUNT;

  SELECT max(dataset_fecha) INTO v_inv FROM pg_temp._gp;
  v_inf := COALESCE((SELECT (valor AT TIME ZONE 'America/Lima')::date FROM obra_refresco WHERE clave = 'infobras_fecha'),
                    (SELECT max(dataset_fecha) FROM obra_infobras));
  INSERT INTO gobserva_proyecto_estado (id, refrescado_at, inversiones_al, infobras_al, filas, cambiadas, borradas, ms)
  VALUES (true, now(), v_inv, v_inf, n_filas, n_cambiadas, n_borradas, (extract(epoch FROM clock_timestamp() - t0) * 1000)::int)
  ON CONFLICT (id) DO UPDATE SET refrescado_at = EXCLUDED.refrescado_at, inversiones_al = EXCLUDED.inversiones_al,
    infobras_al = EXCLUDED.infobras_al, filas = EXCLUDED.filas, cambiadas = EXCLUDED.cambiadas, borradas = EXCLUDED.borradas,
    ms = EXCLUDED.ms;
  IF n_cambiadas + n_borradas > 5000 THEN
    ANALYZE gobserva_proyecto;
  END IF;
  RETURN jsonb_build_object('filas', n_filas, 'cambiadas', n_cambiadas, 'borradas', n_borradas,
                            'ms', (extract(epoch FROM clock_timestamp() - t0) * 1000)::int);
END $$;

-- ─── Quién ganó un proceso: sólo empresas ────────────────────────────────────────────────────────────────────────────

/*
 * Los ganadores de un proceso del SEACE (convocatorias.adjudicaciones, el «awards» del OCDS) que se pueden nombrar: cada
 * proveedor con RUC 20 y, de un consorcio (su código de 7 cifras), los integrantes con RUC 20 (conosce_consorcios). Una
 * persona natural (RUC 10) o un consorcio sin integrantes conocidos se cuentan en `otros`, sin nombre.
 *   {"empresas": [{"ruc", "nombre", "consorcio": "…" | null, "monto"}], "otros": n, "monto": suma}
 */
CREATE OR REPLACE FUNCTION gobserva_obras_ganadores(adj JSONB) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH s AS (
    SELECT regexp_replace(COALESCE(sp->>'id', ''), '^PE-RUC-', '') AS id, sp->>'name' AS nombre,
           CASE WHEN jsonb_typeof(a->'value'->'amount') = 'number' THEN (a->'value'->>'amount')::numeric END AS monto,
           jsonb_array_length(CASE WHEN jsonb_typeof(a->'suppliers') = 'array' THEN a->'suppliers' ELSE '[]'::jsonb END) AS n_sup
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(adj) = 'array' THEN adj ELSE '[]'::jsonb END) a,
           jsonb_array_elements(CASE WHEN jsonb_typeof(a->'suppliers') = 'array' THEN a->'suppliers' ELSE '[]'::jsonb END) sp
     WHERE COALESCE(a->>'status', '') NOT IN ('cancelled', 'unsuccessful')
  ), m AS (
    -- Los integrantes RUC 20 de cada consorcio (su código del SEACE), una vez cada uno; `n`, entre cuántos integrantes
    -- (de cualquier tipo) se reparte en partes iguales.
    SELECT x.id, x.ruc, x.nombre, x.n FROM (
      SELECT s.id, cc.ruc_miembro AS ruc, max(cc.miembro) AS nombre, count(*) OVER (PARTITION BY s.id) AS n
        FROM (SELECT DISTINCT id FROM s WHERE id ~ '^[0-9]{5,8}$') s
        JOIN conosce_consorcios cc ON cc.ruc_consorcio = s.id
       GROUP BY s.id, cc.ruc_miembro) x
     WHERE x.ruc ~ '^20[0-9]{9}$'
  ), e AS (
    SELECT s.id AS ruc, max(s.nombre) AS nombre, NULL::text AS consorcio, sum(s.monto / GREATEST(s.n_sup, 1)) AS monto
      FROM s WHERE s.id ~ '^20[0-9]{9}$' GROUP BY s.id
    UNION ALL
    SELECT m.ruc, m.nombre, 'consorcio', sum(s.monto / GREATEST(s.n_sup, 1) / m.n)
      FROM m JOIN s ON s.id = m.id GROUP BY m.ruc, m.nombre
  )
  SELECT jsonb_build_object(
    'empresas', COALESCE((SELECT jsonb_agg(jsonb_build_object('ruc', e.ruc, 'nombre', e.nombre, 'consorcio', e.consorcio IS NOT NULL,
                                                             'monto', round(e.monto, 2)) ORDER BY e.monto DESC NULLS LAST, e.ruc) FROM e), '[]'::jsonb),
    'otros', (SELECT count(DISTINCT s.id) FROM s WHERE s.id !~ '^20[0-9]{9}$' AND NOT EXISTS (SELECT 1 FROM m WHERE m.id = s.id)),
    'monto', (SELECT round(sum(s.monto / GREATEST(s.n_sup, 1)), 2) FROM s))
$$;

-- ─── La ficha ────────────────────────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION gobserva_obras_ficha(p_cui TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  i inversion_mef;
  p gobserva_proyecto;
  v_cui CHAR(7);      -- el CUI como la columna (CHAR): comparado con TEXT, Postgres no usa los índices y recorre las tablas
  v_costo NUMERIC;
  v_sector TEXT;
  r JSONB;
BEGIN
  IF p_cui IS NULL OR p_cui !~ '^[0-9]{7}$' THEN
    RETURN NULL;
  END IF;
  v_cui := p_cui;
  SELECT * INTO i FROM inversion_mef WHERE cui = v_cui AND NOT retirada;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO p FROM gobserva_proyecto WHERE cui = v_cui;
  v_costo := CASE WHEN 'costo_imposible' = ANY(i.dudoso) THEN NULLIF(i.monto_viable, 0) ELSE NULLIF(i.costo_actualizado, 0) END;
  v_sector := COALESCE(p.sector, gobserva_obras_sector(i.funcion));

  r := jsonb_build_object(
    'cui', i.cui,
    'nombre', btrim(regexp_replace(i.nombre, '\s+', ' ', 'g')),
    'estado', i.origen,
    'fase', CASE WHEN i.origen = 'cerrada' THEN 'cerrada' ELSE p.fase END,
    'seViene', COALESCE(p.se_viene, false),
    'tipo', COALESCE(p.tipo, CASE WHEN i.nombre ~* '^\s*ADQUISICI' THEN 'equipamiento' ELSE 'obra' END),
    'situacion', i.situacion,
    'nivel', i.nivel,
    'sector', v_sector,
    'funcion', i.funcion,
    'programa', i.programa,
    'tipologia', i.tipologia,
    'tipoInversion', i.tipo_inversion,
    'marco', i.marco,
    'modalidad', gobserva_obras_modalidad(i.modalidad),
    'modalidadTexto', i.modalidad,
    'entidad', jsonb_build_object('ruc', i.entidad_ruc, 'nombre', i.entidad_nombre),
    'unidadEjecutora', COALESCE(i.uei, i.uep),
    'lugar', jsonb_build_object('region', CASE WHEN left(i.ubigeo, 2) BETWEEN '01' AND '25' THEN left(i.ubigeo, 2) END,
                                'departamento', i.departamento, 'provincia', i.provincia, 'distrito', i.distrito, 'ubigeo', i.ubigeo),
    'montos', jsonb_build_object(
      'viable', NULLIF(i.monto_viable, 0), 'actualizado', v_costo, 'expediente', NULLIF(i.monto_et, 0),
      'devengado', COALESCE(i.devengado_acumulado, 0), 'devengadoAnio', COALESCE(i.devengado_anio, 0), 'pimAnio', COALESCE(i.pim_anio, 0),
      'porEjecutar', CASE WHEN v_costo IS NOT NULL THEN GREATEST(v_costo - COALESCE(i.devengado_acumulado, 0), 0) END,
      'liquidacion', NULLIF(i.liquidacion, 0), 'controlConcurrente', NULLIF(i.control_concurrente, 0)),
    'costoDudoso', 'costo_imposible' = ANY(i.dudoso),
    'avanceMef', CASE WHEN i.avance_fisico BETWEEN 0 AND 100.5 THEN LEAST(i.avance_fisico, 100) END,
    'conExpediente', COALESCE(i.expediente_tecnico, false) OR COALESCE(i.monto_et, 0) > 0,
    'fechas', jsonb_build_object(
      'registro', i.fecha_registro, 'viabilidad', i.fecha_viabilidad, 'inicioPrevisto', i.inicio_ejecucion, 'finPrevisto', i.fin_ejecucion,
      'primerGasto', CASE WHEN i.primer_devengado BETWEEN 200001 AND 210012 THEN to_char(make_date(i.primer_devengado / 100, GREATEST(LEAST(i.primer_devengado % 100, 12), 1), 1), 'YYYY-MM') END,
      'ultimoGasto', CASE WHEN i.ultimo_devengado BETWEEN 200001 AND 210012 THEN to_char(make_date(i.ultimo_devengado / 100, GREATEST(LEAST(i.ultimo_devengado % 100, 12), 1), 1), 'YYYY-MM') END,
      'cierre', i.fecha_cierre),
    'beneficiarios', NULLIF(i.beneficiarios, 0),
    'alDia', jsonb_build_object('inversiones', i.dataset_fecha,
                                'infobras', COALESCE((SELECT (valor AT TIME ZONE 'America/Lima')::date FROM obra_refresco WHERE clave = 'infobras_fecha'),
                                                     (SELECT max(dataset_fecha) FROM obra_infobras WHERE cui = v_cui))),
    -- Las obras de INFOBRAS del CUI: el ejecutor y el supervisor, sólo si son empresas (RUC 20).
    'obras', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'codigo', o.codigo, 'nombre', o.nombre, 'estado', o.estado, 'modalidad', o.modalidad, 'esSaldo', o.es_saldo,
               'avance', jsonb_build_object(
                 'fisico', CASE WHEN o.fisico_real BETWEEN 0 AND 100.5 THEN LEAST(o.fisico_real, 100) END,
                 'programado', CASE WHEN o.fisico_prog BETWEEN 0 AND 100.5 THEN LEAST(o.fisico_prog, 100) END,
                 'financiero', CASE WHEN o.financiero_pct BETWEEN 0 AND 200 THEN o.financiero_pct END,
                 'al', CASE WHEN o.avance_fecha <= COALESCE(o.dataset_fecha, current_date) THEN o.avance_fecha END),
               'fechas', jsonb_build_object('inicio', o.fecha_inicio, 'finProgramada', o.fecha_fin_prog, 'finReprogramada', o.fecha_fin_reprog,
                                            'finReal', o.fecha_fin_real, 'recepcion', o.fecha_recepcion, 'expediente', o.fecha_aprob_et),
               'plazo', jsonb_build_object('dias', o.plazo_dias, 'ampliacion', o.dias_ampliacion),
               'montos', jsonb_build_object(
                 'contrato', CASE WHEN o.contrato_monto > 0 AND (v_costo IS NULL OR o.contrato_monto <= 3 * v_costo) THEN o.contrato_monto END,
                 'contratoDudoso', o.contrato_monto > 0 AND v_costo IS NOT NULL AND o.contrato_monto > 3 * v_costo,
                 'expediente', NULLIF(o.costo_et, 0),
                 'supervision', CASE WHEN o.supervision_monto > 0 AND (v_costo IS NULL OR o.supervision_monto <= v_costo) THEN o.supervision_monto END,
                 'adicionales', NULLIF(o.adicionales_monto, 0), 'deductivos', NULLIF(o.deductivos_monto, 0)),
               'adicionalesN', o.adicionales_n,
               'paralizacion', CASE WHEN o.estado = 'Paralizada' OR o.paralizada THEN jsonb_build_object(
                                 'hoy', o.estado = 'Paralizada', 'desde', o.fecha_paralizacion, 'dias', o.dias_paralizada,
                                 'causal', NULLIF(btrim(o.causal_paralizacion), '')) END,
               'ejecutor', CASE
                 WHEN o.ejecutor_ruc ~ '^20[0-9]{9}$' THEN jsonb_build_object('tipo', 'empresa', 'ruc', o.ejecutor_ruc,
                                                                  'nombre', NULLIF(btrim(regexp_replace(o.ejecutor_nombre, '\s+amp\s+', ' & ', 'gi')), ''))
                 WHEN o.ejecutor_ruc ~ '^C[0-9]{10}$' OR o.ejecutor_nombre ILIKE 'CONSORCIO%' THEN jsonb_build_object('tipo', 'consorcio')
                 WHEN o.ejecutor_ruc IS NOT NULL OR NULLIF(btrim(o.ejecutor_nombre), '') IS NOT NULL THEN jsonb_build_object('tipo', 'persona')
                 WHEN o.modalidad = 'Administración directa' THEN jsonb_build_object('tipo', 'entidad') END,
               'supervisor', CASE
                 WHEN o.supervisor_ruc ~ '^20[0-9]{9}$' THEN jsonb_build_object('tipo', 'empresa', 'ruc', o.supervisor_ruc,
                                                                    'nombre', NULLIF(btrim(regexp_replace(o.supervisor_nombre, '\s+amp\s+', ' & ', 'gi')), ''))
                 WHEN o.supervisor_ruc ~ '^C[0-9]{10}$' OR o.supervisor_nombre ILIKE 'CONSORCIO%' THEN jsonb_build_object('tipo', 'consorcio')
                 WHEN o.supervisor_ruc IS NOT NULL OR NULLIF(btrim(o.supervisor_nombre), '') IS NOT NULL THEN jsonb_build_object('tipo', 'persona') END,
               'controversias', o.controversias, 'informesControl', o.informes_control,
               'alDia', o.dataset_fecha)
             ORDER BY CASE o.estado WHEN 'Paralizada' THEN 0 WHEN 'En Ejecución' THEN 1 WHEN 'Sin Ejecución' THEN 2 ELSE 3 END,
                      (similarity(lower(o.nombre), lower(i.nombre)) >= 0.5) DESC,
                      CASE WHEN o.contrato_monto > 0 AND o.contrato_monto <= 3 * GREATEST(COALESCE(o.costo_et, 0), COALESCE(o.monto_viable, 0))
                           THEN o.contrato_monto ELSE NULLIF(o.costo_et, 0) END DESC NULLS LAST,
                      o.fecha_inicio DESC NULLS LAST, o.codigo DESC)
        FROM obra_infobras o WHERE o.cui = v_cui AND NOT o.retirada), '[]'::jsonb),
    'obraRepresenta', COALESCE(p.obra_representa, true),
    -- Los procesos del SEACE que citan el CUI (los 40 más nuevos) y quién los ganó (sólo empresas).
    'procesosTotal', (SELECT count(*) FROM contrato_cui k WHERE k.cui = v_cui),
    'procesos', COALESCE((
      SELECT jsonb_agg(x.j ORDER BY x.fecha DESC NULLS LAST, x.ocid DESC)
        FROM (SELECT c.ocid, c.fecha_convocatoria AS fecha,
                     jsonb_build_object(
                       'ocid', c.ocid, 'codigo', c.codigo, 'objeto', c.objeto, 'tipo', c.tipo_contratacion, 'etapa', c.etapa,
                       'procedimiento', c.ocds_payload->'tender'->>'procurementMethodDetails',
                       'fecha', c.fecha_convocatoria, 'valor', NULLIF(c.cuantia_referencial, 0),
                       'adjudicado', av.monto, 'ganadores', gobserva_obras_ganadores(c.adjudicaciones), 'via', k.origen) AS j
                FROM contrato_cui k JOIN convocatorias c ON c.ocid = k.ocid
                LEFT JOIN adjudicado_vigente av ON av.ocid = c.ocid
               WHERE k.cui = v_cui
               ORDER BY c.fecha_convocatoria DESC NULLS LAST, c.ocid DESC
               LIMIT 40) x), '[]'::jsonb),
    -- Proyectos parecidos: el mismo sector, de preferencia en la misma región, de un costo parecido (un tercio a 3 veces),
    -- que se vienen o están en marcha.
    'parecidos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('cui', g.cui, 'nombre', g.nombre, 'fase', g.fase, 'region', g.region, 'provincia', g.provincia,
                                          'costo', g.costo, 'entidad', g.entidad, 'obraFisico', g.obra_fisico) ORDER BY g.orden)
        FROM (SELECT x.*, row_number() OVER (ORDER BY (x.region IS NOT DISTINCT FROM p.region) DESC,
                                                      abs(ln(x.costo / NULLIF(v_costo, 0))), x.fecha_viable DESC NULLS LAST) AS orden
                FROM gobserva_proyecto x
               WHERE x.sector = v_sector AND x.cui <> v_cui AND x.costo > 0 AND v_costo > 0
                 AND x.costo BETWEEN v_costo / 3 AND v_costo * 3
                 AND (x.se_viene OR x.fase IN ('ejecucion', 'paralizada'))
               ORDER BY (x.region IS NOT DISTINCT FROM p.region) DESC, abs(ln(x.costo / NULLIF(v_costo, 0))), x.fecha_viable DESC NULLS LAST
               LIMIT 6) g), '[]'::jsonb)
  );
  RETURN r;
END $$;

-- ─── El mercado de obras ─────────────────────────────────────────────────────────────────────────────────────────────

/*
 * El mercado de obras de una región (01 a 25; NULL = todo el Perú) y un sector (la clave de gobserva_obras_sector; NULL =
 * todos): lo que hay en el pipeline y en ejecución, por zona (regiones o, con región, provincias), por sector y por tamaño;
 * las paralizadas y sus causas (INFOBRAS); y quién gana las obras y las supervisiones (CONOSCE, adjudicadas en los
 * últimos 12 meses: con sector, sólo los procesos que citan un CUI de ese sector). Sólo agregados y empresas RUC 20.
 */
CREATE OR REPLACE FUNCTION gobserva_obras_mercado(p_region TEXT DEFAULT NULL, p_sector TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  -- CHAR como la columna: comparado con TEXT, el índice (region, sector) no sirve.
  v_region CHAR(2) := CASE WHEN p_region ~ '^(0[1-9]|1[0-9]|2[0-5])$' THEN p_region END;
  v_sector TEXT := CASE WHEN p_sector ~ '^[a-z]{3,20}$' THEN p_sector END;
  v_dep TEXT;
  r JSONB;
  rk JSONB;
BEGIN
  IF v_region IS NOT NULL THEN
    SELECT upper(immutable_unaccent(nombre)) INTO v_dep FROM zonas WHERE nivel = 'departamento' AND ubigeo = v_region;
  END IF;

  -- Sólo las columnas que se cuentan (sin el nombre ni el texto): la tabla temporal de la consulta queda chica.
  WITH g AS MATERIALIZED (
    SELECT cui, region, provincia, sector, se_viene, fase, costo, por_ejecutar, pim_anio, devengado_anio, ejecutor_ruc, obra_causal
      FROM gobserva_proyecto
     WHERE (v_region IS NULL OR region = v_region) AND (v_sector IS NULL OR sector = v_sector)
  )
  SELECT jsonb_build_object(
    'region', v_region, 'sector', v_sector,
    'activas', (SELECT count(*) FROM g),
    'costo', (SELECT round(COALESCE(sum(costo), 0)) FROM g),
    'porEjecutar', (SELECT round(COALESCE(sum(por_ejecutar), 0)) FROM g WHERE se_viene OR fase IN ('ejecucion', 'paralizada')),
    'pimAnio', (SELECT round(COALESCE(sum(pim_anio), 0)) FROM g),
    'devengadoAnio', (SELECT round(COALESCE(sum(devengado_anio), 0)) FROM g),
    'seVienen', (SELECT jsonb_build_object('n', count(*), 'monto', round(COALESCE(sum(costo), 0)),
                                           'conExpediente', count(*) FILTER (WHERE fase IN ('expediente', 'licitacion')),
                                           'montoConExpediente', round(COALESCE(sum(costo) FILTER (WHERE fase IN ('expediente', 'licitacion')), 0)),
                                           'licitando', count(*) FILTER (WHERE fase = 'licitacion'),
                                           'mediana', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY costo)::numeric))
                   FROM g WHERE se_viene),
    'enMarcha', (SELECT jsonb_build_object('n', count(*), 'monto', round(COALESCE(sum(costo), 0)),
                                           'porEjecutar', round(COALESCE(sum(por_ejecutar), 0)),
                                           'mediana', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY costo)::numeric),
                                           'conEmpresa', count(*) FILTER (WHERE ejecutor_ruc IS NOT NULL))
                   FROM g WHERE fase = 'ejecucion'),
    'paralizadas', (SELECT jsonb_build_object('n', count(*), 'monto', round(COALESCE(sum(costo), 0)),
                                              'porEjecutar', round(COALESCE(sum(por_ejecutar), 0)))
                      FROM g WHERE fase = 'paralizada'),
    -- Por zona: las regiones o, con región, sus provincias.
    'porZona', COALESCE((SELECT jsonb_agg(z ORDER BY z->>'clave') FROM (
        SELECT jsonb_build_object('clave', CASE WHEN v_region IS NULL THEN region ELSE COALESCE(provincia, 'Sin provincia') END,
                                  'seVienen', count(*) FILTER (WHERE se_viene),
                                  'seVienenMonto', round(COALESCE(sum(costo) FILTER (WHERE se_viene), 0)),
                                  'enMarcha', count(*) FILTER (WHERE fase = 'ejecucion'),
                                  'enMarchaMonto', round(COALESCE(sum(costo) FILTER (WHERE fase = 'ejecucion'), 0)),
                                  'paralizadas', count(*) FILTER (WHERE fase = 'paralizada'),
                                  'porEjecutar', round(COALESCE(sum(por_ejecutar) FILTER (WHERE se_viene OR fase IN ('ejecucion', 'paralizada')), 0))) AS z
          FROM g WHERE (v_region IS NOT NULL OR region IS NOT NULL)
         GROUP BY CASE WHEN v_region IS NULL THEN region ELSE COALESCE(provincia, 'Sin provincia') END) t), '[]'::jsonb),
    'porSector', COALESCE((SELECT jsonb_agg(z) FROM (
        SELECT jsonb_build_object('clave', sector,
                                  'seVienen', count(*) FILTER (WHERE se_viene),
                                  'seVienenMonto', round(COALESCE(sum(costo) FILTER (WHERE se_viene), 0)),
                                  'enMarcha', count(*) FILTER (WHERE fase = 'ejecucion'),
                                  'enMarchaMonto', round(COALESCE(sum(costo) FILTER (WHERE fase = 'ejecucion'), 0)),
                                  'paralizadas', count(*) FILTER (WHERE fase = 'paralizada')) AS z
          FROM g GROUP BY sector) t), '[]'::jsonb),
    -- Por tamaño: cuántas se vienen y cuántas están en marcha en cada rango de costo.
    'tamanos', COALESCE((SELECT jsonb_agg(z ORDER BY (z->>'orden')::int) FROM (
        SELECT jsonb_build_object('rango', rango, 'orden', orden, 'seVienen', count(*) FILTER (WHERE se_viene),
                                  'enMarcha', count(*) FILTER (WHERE fase IN ('ejecucion', 'paralizada'))) AS z
          FROM (SELECT g.*, CASE WHEN costo <= 1e6 THEN 'hasta_1m' WHEN costo <= 5e6 THEN '1m_5m' WHEN costo <= 2e7 THEN '5m_20m'
                                 WHEN costo <= 1e8 THEN '20m_100m' ELSE 'mas_100m' END AS rango,
                       CASE WHEN costo <= 1e6 THEN 1 WHEN costo <= 5e6 THEN 2 WHEN costo <= 2e7 THEN 3 WHEN costo <= 1e8 THEN 4 ELSE 5 END AS orden
                  FROM g WHERE costo > 0 AND (se_viene OR fase IN ('ejecucion', 'paralizada'))) x
         GROUP BY rango, orden) t), '[]'::jsonb),
    'causales', COALESCE((SELECT jsonb_agg(jsonb_build_object('causal', causal, 'n', n) ORDER BY n DESC, causal) FROM (
        SELECT COALESCE(obra_causal, 'Sin causal registrada') AS causal, count(*)::int AS n FROM g WHERE fase = 'paralizada' GROUP BY 1) t), '[]'::jsonb),
    'mayoresParalizadas', COALESCE((SELECT jsonb_agg(jsonb_build_object('cui', t.cui, 'nombre', t.nombre, 'costo', t.costo, 'region', t.region,
                                                                       'provincia', t.provincia, 'desde', t.obra_paralizada_desde,
                                                                       'causal', t.obra_causal, 'fisico', t.obra_fisico) ORDER BY t.costo DESC NULLS LAST)
        FROM (SELECT x.* FROM gobserva_proyecto x
               WHERE x.fase = 'paralizada' AND (v_region IS NULL OR x.region = v_region) AND (v_sector IS NULL OR x.sector = v_sector)
               ORDER BY x.costo DESC NULLS LAST LIMIT 5) t), '[]'::jsonb)
  ) INTO r;

  -- Quién gana las obras y las supervisiones: CONOSCE, buena pro en los últimos 12 meses, en el departamento del ítem.
  WITH a AS MATERIALIZED (
    SELECT x.codigo_convocatoria AS codigo, x.objeto, x.ruc_proveedor, x.proveedor, x.monto_adjudicado AS monto
      FROM conosce_adjudicaciones x
     WHERE x.anio >= extract(year FROM current_date)::int - 1 AND x.fecha_buenapro >= current_date - 365 AND x.fecha_buenapro <= current_date
       AND x.objeto IN ('Obra', 'Consultoría de Obra') AND x.monto_adjudicado > 0
       AND (v_dep IS NULL OR x.departamento_item = v_dep)
       AND (v_sector IS NULL OR EXISTS (SELECT 1 FROM contrato_cui k JOIN gobserva_proyecto gp ON gp.cui = k.cui
                                         WHERE k.ocid = x.codigo_convocatoria AND gp.sector = v_sector))
  ), m AS (
    -- Los integrantes RUC 20 de cada consorcio ganador y en cuántas partes se reparte.
    SELECT c.ruc_consorcio, c.ruc_miembro, max(c.miembro) AS miembro,
           count(*) OVER (PARTITION BY c.ruc_consorcio) AS partes
      FROM conosce_consorcios c
     WHERE c.ruc_consorcio IN (SELECT DISTINCT ruc_proveedor FROM a WHERE ruc_proveedor !~ '^(10|20)[0-9]{9}$')
     GROUP BY c.ruc_consorcio, c.ruc_miembro
  ), todos AS (
    SELECT a.objeto, a.codigo, a.ruc_proveedor AS ruc, a.proveedor AS nombre, a.monto, false AS consorcio
      FROM a WHERE a.ruc_proveedor ~ '^20[0-9]{9}$'
    UNION ALL
    SELECT a.objeto, a.codigo, m.ruc_miembro, m.miembro, a.monto / m.partes, true
      FROM a JOIN m ON m.ruc_consorcio = a.ruc_proveedor
     WHERE m.ruc_miembro ~ '^20[0-9]{9}$'
  ), rnk AS (
    SELECT objeto, ruc, max(nombre) AS nombre, round(sum(monto)) AS monto, count(DISTINCT codigo) AS procesos,
           count(DISTINCT codigo) FILTER (WHERE consorcio) AS en_consorcio,
           row_number() OVER (PARTITION BY objeto ORDER BY sum(monto) DESC, ruc) AS pos
      FROM todos GROUP BY objeto, ruc
  )
  SELECT jsonb_build_object(
    'adjudicadoObras', (SELECT jsonb_build_object('procesos', count(DISTINCT codigo), 'monto', round(COALESCE(sum(monto), 0)),
                                                  'empresas', (SELECT count(*) FROM rnk WHERE objeto = 'Obra'),
                                                  'mediana', round((SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY t.m)
                                                                      FROM (SELECT sum(monto) AS m FROM a WHERE objeto = 'Obra' GROUP BY codigo) t)::numeric))
                          FROM a WHERE objeto = 'Obra'),
    'quienConstruye', COALESCE((SELECT jsonb_agg(jsonb_build_object('ruc', ruc, 'nombre', nombre, 'monto', monto, 'procesos', procesos,
                                                                    'enConsorcio', en_consorcio) ORDER BY pos)
                                  FROM rnk WHERE objeto = 'Obra' AND pos <= 12), '[]'::jsonb),
    'quienSupervisa', COALESCE((SELECT jsonb_agg(jsonb_build_object('ruc', ruc, 'nombre', nombre, 'monto', monto, 'procesos', procesos,
                                                                    'enConsorcio', en_consorcio) ORDER BY pos)
                                  FROM rnk WHERE objeto = 'Consultoría de Obra' AND pos <= 8), '[]'::jsonb)
  ) INTO rk;

  RETURN r || rk || jsonb_build_object(
    'alDia', (SELECT jsonb_build_object('refrescado', refrescado_at, 'inversiones', inversiones_al, 'infobras', infobras_al)
                FROM gobserva_proyecto_estado WHERE id),
    'conosceHasta', (SELECT max(fecha_buenapro) FROM conosce_adjudicaciones WHERE anio >= extract(year FROM current_date)::int - 1
                                                                                AND fecha_buenapro <= current_date));
END $$;

-- ─── Dueños y permisos (como la 226 y la 227) ────────────────────────────────────────────────────────────────────────

ALTER TABLE gobserva_proyecto OWNER TO vigia_jobs;
ALTER TABLE gobserva_proyecto_estado OWNER TO vigia_jobs;
ALTER FUNCTION gobserva_obras_sector(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION gobserva_obras_modalidad(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION gobserva_refrescar_proyectos() OWNER TO vigia_jobs;
ALTER FUNCTION gobserva_obras_ganadores(JSONB) OWNER TO vigia_jobs;
ALTER FUNCTION gobserva_obras_ficha(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION gobserva_obras_mercado(TEXT, TEXT) OWNER TO vigia_jobs;

-- La tabla es pública (sin personas naturales): la leen la API, el panel y el MCP. Nadie más que su dueño la escribe (los
-- privilegios por defecto de la 43 le dan escritura a vigia_agentes en toda tabla nueva).
GRANT SELECT ON gobserva_proyecto, gobserva_proyecto_estado TO vigia_api, vigia_api_admin, vigia_mcp;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_agentes') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON gobserva_proyecto, gobserva_proyecto_estado FROM vigia_agentes;
  END IF;
END $$;

REVOKE ALL ON FUNCTION gobserva_refrescar_proyectos(), gobserva_obras_ganadores(JSONB), gobserva_obras_ficha(TEXT),
  gobserva_obras_mercado(TEXT, TEXT) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_agentes') THEN
    REVOKE ALL ON FUNCTION gobserva_refrescar_proyectos() FROM vigia_agentes;
  END IF;
END $$;
-- El refresco: la API lo pide en segundo plano con el pool del panel (120 s por sentencia) cuando la tabla tiene más de
-- 20 h; las cargas de invierte_pe e infobras corren como vigia_jobs (el dueño).
GRANT EXECUTE ON FUNCTION gobserva_refrescar_proyectos() TO vigia_api_admin;
GRANT EXECUTE ON FUNCTION gobserva_obras_sector(TEXT), gobserva_obras_modalidad(TEXT), gobserva_obras_ganadores(JSONB),
  gobserva_obras_ficha(TEXT), gobserva_obras_mercado(TEXT, TEXT) TO vigia_api, vigia_api_admin, vigia_mcp;

-- La primera carga.
SELECT gobserva_refrescar_proyectos();
