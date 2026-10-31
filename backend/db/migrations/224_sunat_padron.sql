-- 224: El padrón reducido de RUC de la SUNAT, para tener cada semana el estado y la condición de las empresas sin captcha.
--
-- Hasta ahora el estado del contribuyente (activo, de baja, en suspensión) y la condición del domicilio (habido, no habido)
-- de `empresas` salían sólo de la Consulta Múltiple de RUC (backend/scrapers-pc/sunat_ruc/): un formulario con reCAPTCHA
-- que corres con tu Chrome, en lotes de 100, cada tanto. Las señales de la migración 116 (dada de baja, suspendida, no
-- habida) se quedaban con la foto de ese día.
--
-- La SUNAT publica además el padrón reducido (https://www2.sunat.gob.pe/padron_reducido_ruc.zip): un ZIP público, sin
-- captcha, que regenera a diario, con todos los contribuyentes. La fuente `sunat_padron` del Worker de scrapers
-- (src/fuentes/sunat_padron.ts) lo baja cada semana, se queda SÓLO con los RUC 20 (personas jurídicas: las líneas de RUC
-- 10, 15 y 17 son de personas naturales y se descartan sin leerlas) y lo copia entero a `sunat_padron` (TRUNCATE + COPY
-- en una transacción). Después llama a aplicar_padron_sunat() y a refrescar_senales_sunat().
--
-- aplicar_padron_sunat() no inserta empresas: sólo actualiza las que ya están en `empresas` y cambiaron (estado, condición,
-- y el domicilio si no tenían). Es SECURITY DEFINER porque `empresas` es de postgres y vigia_jobs no la puede escribir:
-- mejor una función acotada que un GRANT UPDATE sobre toda la tabla.
--
-- El padrón corta el estado y la condición a 20 caracteres («BAJA MULT.INSCR. Y O», «NO HALLADO SE MUDO D»); la Consulta
-- Múltiple los trae enteros. Un valor cortado que es el comienzo del que ya tiene la empresa NO es un cambio, y uno que sí
-- cambia se escribe con el texto entero que ya tenga otra empresa (si ninguna lo tiene, cortado). Así las señales
-- (ILIKE 'BAJA%', 'SUSPENSION%', 'NO HABIDO%') y la ficha leen lo mismo que con la Consulta Múltiple.
--
-- Idempotente. Después: POST /correr {"fuente": "sunat_padron", "seco": true}, y sin seco.

-- ─── La foto del padrón (sólo RUC 20) ───────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sunat_padron (
  ruc          TEXT PRIMARY KEY CHECK (ruc ~ '^20[0-9]{9}$'),   -- sólo personas jurídicas: nunca un RUC 10, 15 o 17
  razon_social TEXT,
  estado       TEXT,          -- estado del contribuyente, como viene en el padrón (cortado a 20 caracteres)
  condicion    TEXT,          -- condición del domicilio fiscal (ídem)
  ubigeo       TEXT,
  domicilio    TEXT,          -- vía, número, km, manzana, lote, dpto., interior y zona, como en la ficha RUC
  cargado_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sunat_padron OWNER TO vigia_jobs;
-- Información pública de empresas: la API y el panel la pueden leer.
GRANT SELECT ON sunat_padron TO vigia_api, vigia_api_admin;

COMMENT ON TABLE sunat_padron IS 'Padrón reducido de RUC de la SUNAT, sólo RUC 20 (personas jurídicas). Foto completa: la fuente sunat_padron del Worker de scrapers la reemplaza cada semana (TRUNCATE + COPY). Migración 224.';

-- ─── De la foto a `empresas` ────────────────────────────────────────────────────────────────────────────────────────────

-- Devuelve cuántas empresas cambió (`actualizadas`) y por qué: estado nuevo, condición nueva o domicilio que no tenían (una
-- empresa puede sumar en más de una). `fuera_del_padron`: RUC 20 de empresas que el padrón no trae (debería ser casi cero).
CREATE OR REPLACE FUNCTION aplicar_padron_sunat(p_fecha DATE DEFAULT NULL)
RETURNS TABLE (actualizadas INT, estado_cambiado INT, condicion_cambiada INT, domicilio_puesto INT, fuera_del_padron INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  -- La fecha del padrón (su Last-Modified en hora de Lima, la pasa el Worker); sin ella, la de su última carga.
  v_fecha TEXT := to_char(COALESCE(p_fecha,
                    (SELECT (d.descargado_at AT TIME ZONE 'America/Lima')::date FROM datasets_cargas d
                      WHERE d.fuente = 'sunat_padron' AND d.clave = 'padron_reducido' AND d.estado = 'ok'),
                    current_date), 'YYYY-MM-DD');
BEGIN
  DROP TABLE IF EXISTS pg_temp._padron_largo, pg_temp._padron_cambio;

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

COMMENT ON FUNCTION aplicar_padron_sunat(DATE) IS 'Pasa a empresas (sólo las que ya están y cambiaron) el estado, la condición y, si no tenían, el domicilio de sunat_padron; marca metadata->>fuente_padron con la fecha del padrón. SECURITY DEFINER: empresas es de postgres. Migración 224.';
