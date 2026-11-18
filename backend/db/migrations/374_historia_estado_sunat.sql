-- 374: la historia del estado de las empresas en la SUNAT (activo, de baja, en suspensión; habido, no habido).
--
-- Hasta ahora `empresas.estado_sunat` y `metadata->>'condicion'` guardaban sólo el estado DE HOY: cada semana el padrón
-- reducido (migración 224) lo pisa y la foto anterior se pierde (`sunat_padron` se vacía y el ZIP crudo se borra de R2
-- porque trae personas naturales). Por eso las señales «dada de baja», «suspendida» y «no habida» (migración 116) son de la
-- empresa y no de un contrato: no se sabía desde cuándo. Ni el padrón ni la Consulta Múltiple traen la fecha de baja.
--
-- Desde esta migración, cada cambio queda anotado con la ventana en que pasó: entre la foto anterior en la que todavía no
-- estaba (`desde_tras`) y la primera que lo mostró (`visto`). Con eso, más adelante: «orden emitida a una empresa que ya
-- estaba de baja / no habida» (la orden es posterior a `visto`), atada a la orden. La historia empieza con el padrón del
-- 17-nov-2026: antes de eso, NULL (no se sabe).
--
-- Sólo RUC 20 (personas jurídicas): el estado de una persona natural no se guarda.

-- 1. Las fotos del padrón que se aplicaron (para saber cuál fue la anterior). Las cuatro que ya se cargaron, por la marca
--    `metadata->>'fuente_padron'` que dejó aplicar_padron_sunat en las empresas que cambiaron.
--    `historia` = false: se aplicó antes de que existiera la historia (sus cambios no quedaron anotados). La última de esas
--    es la foto de partida: desde ella se sabe el estado de cada empresa.
CREATE TABLE IF NOT EXISTS sunat_padron_fecha (
  padron      date PRIMARY KEY,
  historia    boolean NOT NULL DEFAULT true,
  aplicado_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO sunat_padron_fecha (padron, historia)
SELECT DISTINCT (metadata->>'fuente_padron')::date, false FROM empresas
 WHERE metadata->>'fuente_padron' ~ '^\d{4}-\d{2}-\d{2}$'
ON CONFLICT DO NOTHING;
COMMENT ON TABLE sunat_padron_fecha IS 'Fechas de los padrones reducidos de la SUNAT ya aplicados a empresas (la anterior acota cuándo pasó un cambio); historia = false, aplicados antes de la migración 374.';

-- 2. Los cambios.
CREATE TABLE IF NOT EXISTS empresa_estado_sunat_cambio (
  id            bigserial PRIMARY KEY,
  ruc           text NOT NULL CHECK (ruc ~ '^20[0-9]{9}$'),
  campo         text NOT NULL CHECK (campo IN ('estado', 'condicion')),
  antes         text,
  despues       text,
  visto         date NOT NULL,   -- la foto (padrón o consulta) que lo mostró por primera vez
  desde_tras    date,            -- la foto anterior, en la que todavía no estaba: el cambio pasó en (desde_tras, visto]. NULL: no se sabe
  fuente        text NOT NULL,   -- 'padron', 'consulta_ruc' u 'otro'
  registrado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS empresa_estado_sunat_cambio_ruc ON empresa_estado_sunat_cambio (ruc, campo, visto);
CREATE INDEX IF NOT EXISTS empresa_estado_sunat_cambio_visto ON empresa_estado_sunat_cambio (visto);
COMMENT ON TABLE empresa_estado_sunat_cambio IS 'Cada cambio de estado del contribuyente o de condición del domicilio de una empresa (RUC 20) en la SUNAT, con la ventana (desde_tras, visto] en que pasó. La llena un trigger de empresas. Migración 374.';

-- 3. El trigger: cualquiera que cambie el estado o la condición deja su fila (el padrón, la Consulta Múltiple o a mano).
--    Quien escribe puede decir de qué foto viene con set_config(…, true): vigia.sunat_visto, vigia.sunat_desde y
--    vigia.sunat_fuente. Sin eso: visto = hoy, desde_tras NULL y fuente 'otro'.
CREATE OR REPLACE FUNCTION registrar_cambio_estado_sunat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_visto  date := COALESCE(NULLIF(current_setting('vigia.sunat_visto', true), '')::date, current_date);
  v_desde  date := NULLIF(current_setting('vigia.sunat_desde', true), '')::date;
  v_fuente text := COALESCE(NULLIF(current_setting('vigia.sunat_fuente', true), ''), 'otro');
  a_est  text := NULLIF(upper(btrim(OLD.estado_sunat)), '');
  n_est  text := NULLIF(upper(btrim(NEW.estado_sunat)), '');
  a_cond text := NULLIF(upper(btrim(CASE WHEN jsonb_typeof(OLD.metadata) = 'object' THEN OLD.metadata->>'condicion' END)), '');
  n_cond text := NULLIF(upper(btrim(CASE WHEN jsonb_typeof(NEW.metadata) = 'object' THEN NEW.metadata->>'condicion' END)), '');
BEGIN
  IF NEW.ruc !~ '^20[0-9]{9}$' THEN RETURN NULL; END IF;
  -- Un valor que aparece donde no había nada (la primera carga de la empresa) no es un cambio.
  IF a_est IS NOT NULL AND n_est IS NOT NULL AND a_est <> n_est THEN
    INSERT INTO empresa_estado_sunat_cambio (ruc, campo, antes, despues, visto, desde_tras, fuente)
    VALUES (NEW.ruc, 'estado', a_est, n_est, v_visto, v_desde, v_fuente);
  END IF;
  IF a_cond IS NOT NULL AND n_cond IS NOT NULL AND a_cond <> n_cond THEN
    INSERT INTO empresa_estado_sunat_cambio (ruc, campo, antes, despues, visto, desde_tras, fuente)
    VALUES (NEW.ruc, 'condicion', a_cond, n_cond, v_visto, v_desde, v_fuente);
  END IF;
  RETURN NULL;
END $$;
ALTER FUNCTION registrar_cambio_estado_sunat() OWNER TO postgres;
REVOKE ALL ON FUNCTION registrar_cambio_estado_sunat() FROM PUBLIC;

DROP TRIGGER IF EXISTS empresas_cambio_estado_sunat ON empresas;
CREATE TRIGGER empresas_cambio_estado_sunat
  AFTER UPDATE OF estado_sunat, metadata ON empresas
  FOR EACH ROW
  WHEN (OLD.estado_sunat IS DISTINCT FROM NEW.estado_sunat OR OLD.metadata->'condicion' IS DISTINCT FROM NEW.metadata->'condicion')
  EXECUTE FUNCTION registrar_cambio_estado_sunat();

-- 4. aplicar_padron_sunat (migración 224) dice de qué foto viene el cambio y anota la fecha del padrón. Lo demás, igual.
CREATE OR REPLACE FUNCTION aplicar_padron_sunat(p_fecha DATE DEFAULT NULL)
RETURNS TABLE (actualizadas INT, estado_cambiado INT, condicion_cambiada INT, domicilio_puesto INT, fuera_del_padron INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  -- La fecha del padrón (su Last-Modified en hora de Lima, la pasa el Worker); sin ella, la de su última carga.
  v_fecha TEXT := to_char(COALESCE(p_fecha,
                    (SELECT (d.descargado_at AT TIME ZONE 'America/Lima')::date FROM datasets_cargas d
                      WHERE d.fuente = 'sunat_padron' AND d.clave = 'padron_reducido' AND d.estado = 'ok'),
                    current_date), 'YYYY-MM-DD');
  v_anterior DATE;
BEGIN
  DROP TABLE IF EXISTS pg_temp._padron_largo, pg_temp._padron_cambio;

  -- 0. La foto anterior: el cambio que se vea ahora pasó entre ella y esta (migración 374).
  SELECT max(f.padron) INTO v_anterior FROM sunat_padron_fecha f WHERE f.padron < v_fecha::date;
  PERFORM set_config('vigia.sunat_visto', v_fecha, true),
          set_config('vigia.sunat_desde', COALESCE(to_char(v_anterior, 'YYYY-MM-DD'), ''), true),
          set_config('vigia.sunat_fuente', 'padron', true);

  -- 1. Cada estado o condición cortado (20 caracteres) → el texto entero que ya usa alguna empresa (el más usado).
  CREATE TEMP TABLE _padron_largo ON COMMIT DROP AS
    WITH cortos AS (
      SELECT 'estado' AS campo, s.estado AS corto FROM sunat_padron s WHERE length(s.estado) = 20 GROUP BY s.estado
      UNION ALL
      SELECT 'condicion', s.condicion FROM sunat_padron s WHERE length(s.condicion) = 20 GROUP BY s.condicion
    ), largos AS (
      SELECT 'estado' AS campo, upper(btrim(e.estado_sunat)) AS largo, count(*) AS veces
        FROM empresas e WHERE length(btrim(e.estado_sunat)) > 20 GROUP BY 2
      UNION ALL
      SELECT 'condicion', upper(btrim(e.metadata->>'condicion')), count(*)
        FROM empresas e WHERE length(btrim(e.metadata->>'condicion')) > 20 GROUP BY 2
    )
    SELECT DISTINCT ON (c.campo, c.corto) c.campo, c.corto, l.largo
      FROM cortos c JOIN largos l ON l.campo = c.campo AND starts_with(l.largo, c.corto)
     ORDER BY c.campo, c.corto, l.veces DESC, l.largo;

  -- 2. Las empresas que ya están y en las que el padrón dice otra cosa. «Lo mismo» es igual sin mirar mayúsculas ni
  --    espacios de los bordes, o, si el del padrón está cortado, el comienzo del que ya tienen.
  CREATE TEMP TABLE _padron_cambio ON COMMIT DROP AS
    SELECT x.ruc, x.nuevo_estado, x.nueva_condicion, x.nuevo_domicilio, x.cambia_estado, x.cambia_condicion, x.pone_domicilio
      FROM (SELECT e.ruc,
                   COALESCE(le.largo, s.estado) AS nuevo_estado,
                   COALESCE(lc.largo, s.condicion) AS nueva_condicion,
                   s.domicilio AS nuevo_domicilio,
                   (s.estado IS NOT NULL AND a.est <> s.estado
                     AND NOT (length(s.estado) = 20 AND starts_with(a.est, s.estado))) AS cambia_estado,
                   (s.condicion IS NOT NULL AND a.cond <> s.condicion
                     AND NOT (length(s.condicion) = 20 AND starts_with(a.cond, s.condicion))) AS cambia_condicion,
                   (s.domicilio IS NOT NULL AND btrim(COALESCE(e.domicilio_fiscal, '')) = '') AS pone_domicilio
              FROM empresas e
              JOIN sunat_padron s ON s.ruc = e.ruc::text
              CROSS JOIN LATERAL (SELECT upper(btrim(COALESCE(e.estado_sunat, ''))) AS est,
                                         upper(btrim(COALESCE(e.metadata->>'condicion', ''))) AS cond) a
              LEFT JOIN pg_temp._padron_largo le ON le.campo = 'estado' AND le.corto = s.estado
              LEFT JOIN pg_temp._padron_largo lc ON lc.campo = 'condicion' AND lc.corto = s.condicion) x
     WHERE x.cambia_estado OR x.cambia_condicion OR x.pone_domicilio;

  -- 3. Sólo esas filas: el estado y la condición del padrón, el domicilio si no tenían y la fecha del padrón que las cambió.
  UPDATE empresas e SET
    estado_sunat     = CASE WHEN c.cambia_estado THEN c.nuevo_estado ELSE e.estado_sunat END,
    domicilio_fiscal = CASE WHEN c.pone_domicilio THEN c.nuevo_domicilio ELSE e.domicilio_fiscal END,
    metadata         = CASE WHEN jsonb_typeof(e.metadata) = 'object' THEN e.metadata ELSE '{}'::jsonb END
                       || CASE WHEN c.cambia_condicion THEN jsonb_build_object('condicion', c.nueva_condicion) ELSE '{}'::jsonb END
                       || jsonb_build_object('fuente_padron', v_fecha),
    updated_at       = now()
    FROM pg_temp._padron_cambio c
   WHERE e.ruc = c.ruc;
  GET DIAGNOSTICS actualizadas = ROW_COUNT;

  -- 4. La ficha y la lista de empresas leen el estado y el domicilio de empresa_resumen, que refrescar_empresas() copia de
  --    `empresas` una vez al día: se copian ya, para que no digan otra cosa que las señales que se rehacen después.
  UPDATE empresa_resumen r SET estado_sunat = e.estado_sunat, domicilio = e.domicilio_fiscal
    FROM pg_temp._padron_cambio c JOIN empresas e ON e.ruc = c.ruc
   WHERE r.ruc = c.ruc::text
     AND (r.estado_sunat IS DISTINCT FROM e.estado_sunat OR r.domicilio IS DISTINCT FROM e.domicilio_fiscal);

  -- 5. Esta foto ya se aplicó (migración 374).
  INSERT INTO sunat_padron_fecha (padron) VALUES (v_fecha::date) ON CONFLICT DO NOTHING;
  PERFORM set_config('vigia.sunat_visto', '', true), set_config('vigia.sunat_desde', '', true), set_config('vigia.sunat_fuente', '', true);

  SELECT count(*) FILTER (WHERE c.cambia_estado)::int, count(*) FILTER (WHERE c.cambia_condicion)::int,
         count(*) FILTER (WHERE c.pone_domicilio)::int
    INTO estado_cambiado, condicion_cambiada, domicilio_puesto
    FROM pg_temp._padron_cambio c;
  SELECT count(*)::int INTO fuera_del_padron
    FROM empresas e
   WHERE e.ruc ~ '^20[0-9]{9}$' AND NOT EXISTS (SELECT 1 FROM sunat_padron s WHERE s.ruc = e.ruc::text);
  RETURN NEXT;
END $$;
ALTER FUNCTION aplicar_padron_sunat(DATE) OWNER TO postgres;
REVOKE ALL ON FUNCTION aplicar_padron_sunat(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aplicar_padron_sunat(DATE) TO vigia_jobs;

-- 5. El estado que la SUNAT mostraba un día dado, si la historia lo sabe (NULL si no):
--    · el último cambio visto hasta ese día → su «después»;
--    · si no, el primer cambio posterior, siempre que su foto anterior (desde_tras) sea de ese día o después y la historia
--      ya hubiera empezado → su «antes»;
--    · sin cambios después de ese día y con la historia ya empezada → el estado de hoy.
--    Un día dentro de la ventana de un cambio (entre desde_tras y visto) no se sabe: NULL.
CREATE OR REPLACE FUNCTION estado_sunat_en(p_ruc text, p_fecha date, p_campo text DEFAULT 'estado') RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH inicio AS (SELECT COALESCE((SELECT max(padron) FROM sunat_padron_fecha WHERE NOT historia),
                                  (SELECT min(padron) FROM sunat_padron_fecha)) AS d),
  previo AS (SELECT c.despues AS valor FROM empresa_estado_sunat_cambio c
              WHERE c.ruc = p_ruc AND c.campo = p_campo AND c.visto <= p_fecha ORDER BY c.visto DESC, c.id DESC LIMIT 1),
  siguiente AS (SELECT c.antes AS valor, c.desde_tras FROM empresa_estado_sunat_cambio c
                 WHERE c.ruc = p_ruc AND c.campo = p_campo AND c.visto > p_fecha ORDER BY c.visto, c.id LIMIT 1)
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM previo) THEN (SELECT valor FROM previo)
    WHEN (SELECT d FROM inicio) IS NULL OR p_fecha < (SELECT d FROM inicio) THEN NULL
    WHEN EXISTS (SELECT 1 FROM siguiente) THEN
      (SELECT CASE WHEN x.desde_tras >= p_fecha THEN x.valor END FROM siguiente x)
    ELSE (SELECT NULLIF(upper(btrim(CASE WHEN p_campo = 'estado' THEN e.estado_sunat ELSE e.metadata->>'condicion' END)), '')
            FROM empresas e WHERE e.ruc = p_ruc)
  END
$$;
COMMENT ON FUNCTION estado_sunat_en(text, date, text) IS 'Estado del contribuyente (o condición del domicilio) que la SUNAT mostraba ese día, si la historia de la migración 374 lo sabe; NULL si no.';

GRANT SELECT ON sunat_padron_fecha, empresa_estado_sunat_cambio TO vigia_api, vigia_api_admin, vigia_jobs;
GRANT EXECUTE ON FUNCTION estado_sunat_en(text, date, text) TO vigia_api, vigia_api_admin, vigia_jobs;
