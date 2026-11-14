-- Dos señales nuevas para quien investiga, y un índice para buscar a una persona por sus apellidos (2026-11-14).
--
-- 1. POSTOR DE RELLENO (cruce `postor_de_relleno`, atado a cada proceso). Una empresa que casi nunca gana y que dedica
--    la mayor parte de sus postulaciones a acompañar al MISMO ganador, en procesos de pocos postores. Es la huella
--    clásica de una oferta de cobertura: alguien se presenta para que haya «competencia» y pierde. No hace falta que
--    las dos empresas compartan socio (eso ya lo mira `turno_postores`); si además lo comparten, la señal es alta.
--    Medido en PROD con los procesos de 2022 en adelante: 2 274 pares con 5 o más procesos juntos; 84 fuertes (el
--    acompañante dedica al menos el 60 % de sus postulaciones a ese ganador y gana 1 de cada 10 o menos), con 77
--    ganadores y 750 procesos.
--
-- 2. PATRONES EN LO QUE LEYERON LOS AGENTES (`patron_agentes`). Una señal en un contrato es un indicio; la misma señal
--    repetida es un patrón. Por entidad: la señal aparece en una parte de sus contratos leídos que es el doble de la
--    del país (y al menos el 40 %). Por proveedor: la misma señal de proceso en 3 o más de sus contratos, en 2 o más
--    entidades. Sale de `banderas` de las alertas publicadas: no agrega hechos, cuenta los que ya están.
--
-- 3. `persona_orden_anual (ap1, ap2)`: buscar las órdenes de una persona natural por sus apellidos tardaba 27 s (recorría
--    5,4 M de filas).

-- ── 1. Postor de relleno ────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS postor_acompanante (
  ruc_acompanante TEXT NOT NULL,
  ruc_ganador     TEXT NOT NULL,
  acompanante     TEXT,
  ganador         TEXT,
  juntos          INT NOT NULL,          -- procesos en que el acompañante postuló y ganó el otro
  entidades       INT NOT NULL,
  postulo         INT NOT NULL,          -- todas las postulaciones del acompañante (procesos con ganador)
  gano            INT NOT NULL,          -- las que ganó
  parte           NUMERIC(5, 4) NOT NULL,-- juntos / postulo
  desde           DATE,
  hasta           DATE,
  vinculo         TEXT,                  -- 'socio_comun' si comparten socio o representante en el RNP
  fuerte          BOOLEAN NOT NULL,
  refrescado_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ruc_acompanante, ruc_ganador)
);
CREATE INDEX IF NOT EXISTS postor_acompanante_ganador ON postor_acompanante (ruc_ganador);

CREATE OR REPLACE FUNCTION refrescar_cruce_postor_relleno() RETURNS integer
LANGUAGE plpgsql SET work_mem = '128MB' AS $$
DECLARE v_filas int;
BEGIN
  CREATE TEMP TABLE _p ON COMMIT DROP AS
    SELECT DISTINCT codigo_convocatoria::text AS codigo, ruc_postor AS ruc, max(postor) AS nombre, max(fecha_convocatoria) AS fecha
      FROM conosce_postores WHERE ruc_postor ~ '^20[0-9]{9}$' AND anio >= 2018 GROUP BY 1, 2;
  CREATE INDEX ON _p (codigo);
  CREATE TEMP TABLE _n ON COMMIT DROP AS SELECT codigo, count(*) AS postores FROM _p GROUP BY 1;
  CREATE INDEX ON _n (codigo);

  DELETE FROM postor_acompanante;
  INSERT INTO postor_acompanante (ruc_acompanante, ruc_ganador, acompanante, ganador, juntos, entidades, postulo, gano, parte, desde, hasta, vinculo, fuerte)
  WITH r AS (
    SELECT codigo, entidad_ruc, rucs FROM conosce_proceso_resumen WHERE rucs IS NOT NULL AND array_length(rucs, 1) >= 1
  ), tot AS (
    SELECT p.ruc, max(p.nombre) AS nombre, count(*) AS postulo, count(*) FILTER (WHERE p.ruc = ANY (r.rucs)) AS gano
      FROM _p p JOIN r USING (codigo) GROUP BY 1
  ), par AS (
    -- Sólo procesos de 2 a 4 postores: con muchos postores, perder juntos no dice nada.
    SELECT p.ruc AS c, w AS w, count(*) AS juntos, count(DISTINCT r.entidad_ruc) AS entidades, min(p.fecha) AS desde, max(p.fecha) AS hasta
      FROM _p p JOIN r USING (codigo) JOIN _n n USING (codigo), unnest(r.rucs) w
     WHERE n.postores BETWEEN 2 AND 4 AND w ~ '^20[0-9]{9}$' AND p.ruc <> w AND NOT (p.ruc = ANY (r.rucs))
     GROUP BY 1, 2 HAVING count(*) >= 5
  )
  SELECT par.c, par.w, t.nombre, COALESCE(e.nombre, tw.nombre), par.juntos, par.entidades, t.postulo, t.gano,
         round(par.juntos::numeric / t.postulo, 4), par.desde, par.hasta,
         CASE WHEN EXISTS (SELECT 1 FROM rnp_conformacion_juridica a JOIN rnp_conformacion_juridica b ON b.numero_documento = a.numero_documento
                            WHERE a.ruc_empresa = par.c AND b.ruc_empresa = par.w AND COALESCE(a.numero_documento, '') <> '') THEN 'socio_comun' END,
         par.juntos >= 0.6 * t.postulo AND t.gano <= 0.1 * t.postulo
    FROM par JOIN tot t ON t.ruc = par.c LEFT JOIN tot tw ON tw.ruc = par.w LEFT JOIN empresa_resumen e ON e.ruc = par.w
   WHERE par.juntos >= 0.4 * t.postulo AND t.gano <= 0.2 * t.postulo;   -- se guardan también los casi fuertes, para quien investiga

  -- El cruce va en cada proceso que ganó el acompañado con su acompañante presente (sólo los pares fuertes).
  DELETE FROM cruces_proveedor WHERE tipo = 'postor_de_relleno';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (a.ruc_ganador, cv.ocid) 'postor_de_relleno', a.ruc_ganador, cv.ocid,
         CASE WHEN a.vinculo IS NOT NULL THEN 'alta' ELSE 'media' END,
         p.fecha, r.monto,
         jsonb_build_object('acompanante', a.acompanante, 'ruc_acompanante', a.ruc_acompanante, 'juntos', a.juntos,
                            'postulaciones_del_acompanante', a.postulo, 'ganadas_del_acompanante', a.gano,
                            'parte', a.parte, 'entidades', a.entidades, 'vinculo', a.vinculo, 'postores_del_proceso', n.postores),
         'conosce_postores', 'https://conosce.osce.gob.pe/buscador/'
    FROM postor_acompanante a
    JOIN _p p ON p.ruc = a.ruc_acompanante
    JOIN _n n ON n.codigo = p.codigo AND n.postores BETWEEN 2 AND 4
    JOIN conosce_proceso_resumen r ON r.codigo = p.codigo AND a.ruc_ganador = ANY (r.rucs) AND NOT (a.ruc_acompanante = ANY (r.rucs))
    JOIN (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
           WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid) cv ON cv.codigo = p.codigo AND cv.entidad_ruc = r.entidad_ruc
   WHERE a.fuerte
   ORDER BY a.ruc_ganador, cv.ocid, a.juntos DESC;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas;
END $$;
ALTER FUNCTION refrescar_cruce_postor_relleno() OWNER TO vigia_jobs;
ALTER TABLE postor_acompanante OWNER TO vigia_jobs;

-- ── 2. Patrones en lo que leyeron los agentes ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patron_agentes (
  alcance        TEXT NOT NULL CHECK (alcance IN ('entidad', 'proveedor')),
  ruc            TEXT NOT NULL,
  nombre         TEXT,
  regla          TEXT NOT NULL,
  casos          INT NOT NULL,           -- contratos leídos con esa señal
  leidos         INT NOT NULL,           -- contratos leídos de esa entidad o de ese proveedor
  entidades      INT,                    -- (proveedor) en cuántas entidades
  tasa           NUMERIC(5, 4) NOT NULL,
  tasa_pais      NUMERIC(5, 4) NOT NULL,
  veces          NUMERIC(6, 2) NOT NULL, -- tasa / tasa del país
  monto          NUMERIC,                -- suma adjudicada de los contratos con la señal
  ejemplos       TEXT[] NOT NULL,        -- hasta 8 OCID, los de mayor puntaje
  refrescado_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (alcance, ruc, regla)
);
CREATE INDEX IF NOT EXISTS patron_agentes_orden ON patron_agentes (alcance, veces DESC, casos DESC);

CREATE OR REPLACE FUNCTION refrescar_patron_agentes() RETURNS integer
LANGUAGE plpgsql SET work_mem = '64MB' AS $$
DECLARE v_filas int;
BEGIN
  CREATE TEMP TABLE _f ON COMMIT DROP AS
    SELECT a.id, ocid_corto(a.ocid) AS ocid, a.score, cv.entidad_ruc, cv.proveedor_ruc, av.monto,
           array_agg(DISTINCT b.regla) FILTER (WHERE b.regla IS NOT NULL) AS reglas
      FROM alertas a
      JOIN convocatorias cv ON cv.ocid = ocid_corto(a.ocid)
      LEFT JOIN adjudicado_vigente av ON av.ocid = cv.ocid
      LEFT JOIN banderas b ON b.alerta_id = a.id AND COALESCE(b.puntua, true)
     WHERE alerta_publicada(a.estado) AND a.score IS NOT NULL AND a.ocid NOT LIKE 'ocds-vigia-%'
     GROUP BY a.id, a.ocid, a.score, cv.entidad_ruc, cv.proveedor_ruc, av.monto;

  DELETE FROM patron_agentes;
  -- Por entidad: el doble de la tasa del país y al menos el 40 % de sus leídos, con 8 leídos y 5 casos como mínimo.
  INSERT INTO patron_agentes (alcance, ruc, nombre, regla, casos, leidos, entidades, tasa, tasa_pais, veces, monto, ejemplos)
  WITH total AS (SELECT count(*)::numeric AS n FROM _f),
       pais AS (SELECT r AS regla, count(*) / (SELECT n FROM total) AS tasa FROM _f, unnest(_f.reglas) r GROUP BY 1),
       le AS (SELECT entidad_ruc, count(*) AS leidos FROM _f WHERE entidad_ruc IS NOT NULL GROUP BY 1 HAVING count(*) >= 8),
       e AS (SELECT f.entidad_ruc, r AS regla, count(*) AS casos, sum(f.monto) AS monto,
                    (array_agg(f.ocid ORDER BY f.score DESC NULLS LAST))[1:8] AS ejemplos
               FROM _f f, unnest(f.reglas) r WHERE f.entidad_ruc IS NOT NULL GROUP BY 1, 2 HAVING count(*) >= 5)
  SELECT 'entidad', e.entidad_ruc, es.nombre, e.regla, e.casos, le.leidos, NULL, round(e.casos::numeric / le.leidos, 4), round(p.tasa, 4),
         round((e.casos::numeric / le.leidos) / NULLIF(p.tasa, 0), 2), e.monto, e.ejemplos
    FROM e JOIN le USING (entidad_ruc) JOIN pais p USING (regla) LEFT JOIN entidad_stats es ON es.ruc = e.entidad_ruc
   WHERE e.casos::numeric / le.leidos >= GREATEST(0.4, 2 * p.tasa)
     AND e.regla NOT IN ('extraccion_documento_fallida');
  GET DIAGNOSTICS v_filas = ROW_COUNT;

  -- Por proveedor (sólo empresas): la misma señal DE PROCESO en 3 o más contratos y 2 o más entidades. Las que hablan
  -- de la historia del proveedor (sanciones, penalidades, prensa) se repiten por definición y no son un patrón.
  INSERT INTO patron_agentes (alcance, ruc, nombre, regla, casos, leidos, entidades, tasa, tasa_pais, veces, monto, ejemplos)
  WITH total AS (SELECT count(*)::numeric AS n FROM _f),
       pais AS (SELECT r AS regla, count(*) / (SELECT n FROM total) AS tasa FROM _f, unnest(_f.reglas) r GROUP BY 1),
       lp AS (SELECT proveedor_ruc, count(*) AS leidos FROM _f WHERE proveedor_ruc ~ '^20[0-9]{9}$' GROUP BY 1 HAVING count(*) >= 3),
       v AS (SELECT f.proveedor_ruc, r AS regla, count(*) AS casos, count(DISTINCT f.entidad_ruc) AS entidades, sum(f.monto) AS monto,
                    (array_agg(f.ocid ORDER BY f.score DESC NULLS LAST))[1:8] AS ejemplos
               FROM _f f, unnest(f.reglas) r WHERE f.proveedor_ruc ~ '^20[0-9]{9}$'
              GROUP BY 1, 2 HAVING count(*) >= 3 AND count(DISTINCT f.entidad_ruc) >= 2)
  SELECT 'proveedor', v.proveedor_ruc, er.nombre, v.regla, v.casos, lp.leidos, v.entidades, round(v.casos::numeric / lp.leidos, 4), round(p.tasa, 4),
         round((v.casos::numeric / lp.leidos) / NULLIF(p.tasa, 0), 2), v.monto, v.ejemplos
    FROM v JOIN lp USING (proveedor_ruc) JOIN pais p USING (regla) LEFT JOIN empresa_resumen er ON er.ruc = v.proveedor_ruc
   WHERE v.regla IN ('unica_oferta_valida', 'unico_postor_alto', 'oferta_igual_valor_referencial', 'postores_vinculados_rnp',
                     'lobby_visits_pre_convocatoria', 'red_flag_documental', 'sobreprecio_elevado', 'sobreprecio_muy_elevado',
                     'fraccionamiento', 'ofertas_agrupadas', 'oferta_mas_barata_no_gana', 'tipo_proceso_vs_monto',
                     'inconsistencia_doc_vs_ocds', 'firmante_con_empresa_rnp', 'ganador_no_invitado', 'personal_clave_vinculado',
                     'directa_recurrente', 'plazo_convocatoria_minimo', 'persona_contratada_senales');
  RETURN v_filas;
END $$;
ALTER FUNCTION refrescar_patron_agentes() OWNER TO vigia_jobs;
ALTER TABLE patron_agentes OWNER TO vigia_jobs;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.postor_acompanante, public.patron_agentes TO %I', r);
    END IF;
  END LOOP;
  -- Las órdenes de personas naturales por apellidos (para el rastro de una persona).
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_api') THEN
    GRANT SELECT ON public.persona_orden_anual, public.persona_codigo TO vigia_api;
  END IF;
END $$;

-- ── 3. Las órdenes de una persona por sus apellidos ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS persona_orden_anual_apellidos ON persona_orden_anual (ap1, ap2);

SELECT refrescar_cruce_postor_relleno() AS cruces_de_relleno;
SELECT refrescar_patron_agentes() AS patrones_por_entidad;
