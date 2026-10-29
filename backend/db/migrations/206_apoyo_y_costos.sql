-- 206 · «Ayúdanos a seguir vigilando»: aportes al fondo común, lo que cuesta Vigía cada mes y la cola por riesgo.
--
-- Pedido del usuario del 2026-10-28: dejar de pedir «S/ 3 por contrato». Leer un contrato con IA cuesta ~US$ 0,22
-- (mediana de 350 lecturas); lo caro es fijo (base de datos, servidores, captura de datos), y un precio por unidad no lo
-- explica ni lo cubre: en 2025 hubo 58,925 procesos con buena pro y 3,87 millones de órdenes.
--
--   1. contribuciones.tipo = 'apoyo': un aporte al fondo común, único o mensual, sin contratos ni zona. `para_ruc` /
--      `para_ubigeo` dicen qué lo motivó (la entidad o la región que mirabas): es informativo, no dirige ninguna lectura.
--      asignar_contribucion() ya no hace nada con ellos (contratos = 0: «ya asignó todo»).
--   2. costos_mes: lo que cuesta cada mes, por rubro, con su fuente (la factura de AWS por Cost Explorer, la tarifa de
--      Cloudflare). Lo carga backend/scripts/costos_mes.py. tipo_cambio_mes: el del BCRP, para decirlo en soles.
--   3. La cola de lectura a fondo por riesgo: lo más grave primero (antes, por antigüedad). El que paga sigue sin elegir.
--
-- Idempotente. Aplicar: python infrastructure/dev/dev.py migrar backend/db/migrations/206_apoyo_y_costos.sql (DEV) y
-- con el túnel en PROD.

SET lock_timeout = '5s';

BEGIN;

-- ── 1 · Aportes al fondo común ───────────────────────────────────────────────────────────────────
ALTER TABLE contribuciones ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'lectura';
ALTER TABLE contribuciones ADD COLUMN IF NOT EXISTS periodicidad TEXT;
ALTER TABLE contribuciones ADD COLUMN IF NOT EXISTS para_ruc TEXT;
ALTER TABLE contribuciones ADD COLUMN IF NOT EXISTS para_ubigeo TEXT;
COMMENT ON COLUMN contribuciones.tipo IS
  '''lectura'': financia N contratos de una zona, entidad o partido (S/ por contrato, tarifas). ''apoyo'': aporte al fondo '
  'común que sostiene la vigilancia (migración 206), sin contratos ni zona.';
COMMENT ON COLUMN contribuciones.periodicidad IS 'Aporte de apoyo: ''unica'' o ''mensual'' (lo que eligió quien aporta).';
COMMENT ON COLUMN contribuciones.para_ruc IS 'Aporte de apoyo: la entidad que lo motivó (informativo; no dirige lecturas).';
COMMENT ON COLUMN contribuciones.para_ubigeo IS 'Aporte de apoyo: la región o zona que lo motivó (informativo).';

-- El apoyo no tiene zona ni tarifa por contrato.
ALTER TABLE contribuciones ALTER COLUMN ubigeo DROP NOT NULL;
ALTER TABLE contribuciones ALTER COLUMN tarifa_id DROP NOT NULL;

ALTER TABLE contribuciones DROP CONSTRAINT IF EXISTS contribuciones_tipo_check;
ALTER TABLE contribuciones ADD CONSTRAINT contribuciones_tipo_check CHECK (tipo IN ('lectura', 'apoyo'));

-- Por zona, mínimo 5; por entidad, mínimo 1 (39); el apoyo no lleva contratos.
ALTER TABLE contribuciones DROP CONSTRAINT IF EXISTS contribuciones_contratos_check;
ALTER TABLE contribuciones ADD CONSTRAINT contribuciones_contratos_check
  CHECK (tipo = 'apoyo' OR contratos >= 5 OR (entidad_ruc IS NOT NULL AND contratos >= 1));

ALTER TABLE contribuciones DROP CONSTRAINT IF EXISTS contribuciones_apoyo_check;
ALTER TABLE contribuciones ADD CONSTRAINT contribuciones_apoyo_check CHECK (
  (tipo = 'lectura' AND periodicidad IS NULL AND para_ruc IS NULL AND para_ubigeo IS NULL
     AND ubigeo IS NOT NULL AND tarifa_id IS NOT NULL)
  OR (tipo = 'apoyo' AND contratos = 0 AND periodicidad IN ('unica', 'mensual') AND monto_pen >= 5
     AND entidad_ruc IS NULL AND partido_clave IS NULL
     AND (para_ruc IS NULL OR para_ruc ~ '^\d{11}$')
     AND (para_ubigeo IS NULL OR para_ubigeo ~ '^\d{2}(\d{2}(\d{2})?)?$')));

-- Lo recaudado por mes (la meta del mes) y los aportes de apoyo de cada aliado.
CREATE INDEX IF NOT EXISTS contribuciones_apoyo_pagada ON contribuciones (pagada_at) WHERE tipo = 'apoyo';

-- El público crea el aporte (por columnas, como en la 37).
GRANT INSERT (tipo, periodicidad, para_ruc, para_ubigeo) ON public.contribuciones TO vigia_api;

-- ── 2 · Lo que cuesta Vigía cada mes ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS costos_mes (
  mes          DATE NOT NULL CHECK (mes = date_trunc('month', mes)::date),
  rubro        TEXT NOT NULL,                        -- 'aws_base_datos', 'aws_servidores', 'cloudflare'…
  titulo       TEXT NOT NULL,                        -- 'Base de datos'
  proveedor    TEXT NOT NULL,                        -- 'AWS', 'Cloudflare'
  detalle      TEXT,                                 -- 'Amazon Relational Database Service'
  monto_usd    NUMERIC(12, 2) NOT NULL CHECK (monto_usd >= 0),
  fuente       TEXT NOT NULL CHECK (fuente IN ('factura', 'estimado')),
  -- El mes no cerró: lo facturado hasta `al` proyectado al mes entero.
  parcial      BOOLEAN NOT NULL DEFAULT false,
  al           DATE,
  nota         TEXT,
  actualizado  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (mes, rubro)
);
COMMENT ON TABLE costos_mes IS
  'Lo que cuesta mantener Vigía cada mes, por rubro y con su fuente (factura de AWS por Cost Explorer; tarifa de '
  'Cloudflare). La IA de las lecturas se mide en cada lectura (alertas.analisis_full->llm_metrics), no aquí. '
  'La carga backend/scripts/costos_mes.py. Migración 206.';

CREATE TABLE IF NOT EXISTS tipo_cambio_mes (
  mes          DATE PRIMARY KEY CHECK (mes = date_trunc('month', mes)::date),
  pen_por_usd  NUMERIC(8, 4) NOT NULL CHECK (pen_por_usd > 0),
  fuente       TEXT NOT NULL,
  actualizado  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE tipo_cambio_mes IS 'Tipo de cambio venta promedio del mes (BCRP, serie PD04640PD), para decir los costos en soles. Migración 206.';

GRANT SELECT ON costos_mes, tipo_cambio_mes TO vigia_api, vigia_api_admin;

-- ── 3 · La cola de lectura a fondo por riesgo ────────────────────────────────────────────────────
-- El riesgo de un contrato: el mayor puntaje de sus cruces (10 por grave, 3 por medio, 1 por leve; casos_cruce).
CREATE INDEX IF NOT EXISTS casos_cruce_ocid ON casos_cruce (ocid);

CREATE OR REPLACE FUNCTION riesgo_contrato(p_ocid TEXT) RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(max(puntaje), 0)::int FROM casos_cruce WHERE ocid = p_ocid
$$;
COMMENT ON FUNCTION riesgo_contrato(TEXT) IS
  'El riesgo de un contrato para ordenar la cola de lectura: el mayor puntaje de casos_cruce (0 sin cruces). Migración 206.';

ALTER TABLE procesamientos ADD COLUMN IF NOT EXISTS prioridad INT NOT NULL DEFAULT 0;
COMMENT ON COLUMN procesamientos.prioridad IS 'riesgo_contrato() al encolarse: la cola se lee de lo más grave a lo menos (migración 206).';
CREATE INDEX IF NOT EXISTS procesamientos_cola_riesgo
  ON procesamientos (prioridad DESC, encolado_at, ocid) WHERE estado = 'encolado';

CREATE OR REPLACE FUNCTION encolar_procesamiento() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO procesamientos (ocid, contribucion_id, prioridad)
  VALUES (NEW.ocid, NEW.contribucion_id, riesgo_contrato(NEW.ocid))
  ON CONFLICT (ocid) DO NOTHING;
  RETURN NEW;
END $$;

-- Los que ya esperan: con su riesgo de hoy.
UPDATE procesamientos SET prioridad = riesgo_contrato(ocid) WHERE estado = 'encolado' AND prioridad = 0;

-- El dispatcher reclama lo más grave primero (antes, el más antiguo; 36).
CREATE OR REPLACE FUNCTION reclamar_procesamientos(n INT, p_worker TEXT) RETURNS SETOF TEXT
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Latido vencido: con intentos disponibles vuelve a la cola; sin intentos, error visible.
  UPDATE procesamientos
     SET estado = CASE WHEN intentos >= 3 THEN 'error' ELSE 'encolado' END,
         worker = NULL,
         error = CASE WHEN intentos >= 3 THEN 'timeout sin latido: sin intentos restantes' ELSE 'timeout sin latido' END
   WHERE estado = 'procesando' AND latido_at < now() - interval '20 minutes';
  RETURN QUERY
  WITH c AS (
    SELECT ocid FROM procesamientos
     WHERE estado = 'encolado' AND intentos < 3
     ORDER BY prioridad DESC, encolado_at, ocid LIMIT n FOR UPDATE SKIP LOCKED)
  UPDATE procesamientos p SET estado = 'procesando', worker = p_worker, intentos = p.intentos + 1,
         iniciado_at = now(), latido_at = now(), fase_actual = 'started', fase_index = 0, error = NULL,
         fases = '{}'::jsonb, eventos = '[]'::jsonb
    FROM c WHERE p.ocid = c.ocid RETURNING p.ocid;
END $$;

-- La asignación de un aporte por zona, entidad o partido: dentro de lo que eligió quien aporta, lo más grave primero
-- (antes, por zona, el más antiguo; por entidad o partido, al azar). A igual riesgo, como antes.
CREATE OR REPLACE FUNCTION asignar_contribucion(p_contribucion_id BIGINT) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ubigeo     TEXT;
  v_entidad    CHAR(11);
  v_partido    TEXT;
  v_anio       INT;
  v_total      INT;
  v_solo       BOOLEAN;
  v_tipos      TEXT[];
  v_ya         INT;
  v_insertados INT;
  v_faltan     INT;
BEGIN
  SELECT ubigeo, entidad_ruc, partido_clave, partido_anio, contratos, solo_con_documentos, tipos
    INTO v_ubigeo, v_entidad, v_partido, v_anio, v_total, v_solo, v_tipos
  FROM contribuciones WHERE id = p_contribucion_id AND estado IN ('pagada','en_proceso') AND tipo = 'lectura';
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT count(*) INTO v_ya FROM asignaciones WHERE contribucion_id = p_contribucion_id;
  IF v_ya >= v_total THEN RETURN 0; END IF;

  IF v_partido IS NOT NULL THEN
    INSERT INTO asignaciones (contribucion_id, ocid)
    SELECT p_contribucion_id, q.ocid
    FROM cola_auditoria q
    JOIN convocatorias c ON c.ocid = q.ocid
    JOIN contrato_partido cp ON cp.ocid = q.ocid
    WHERE cp.org_clave = v_partido AND cp.anio_eleccion = v_anio
      AND (v_tipos IS NULL OR c.tipo_contratacion = ANY (v_tipos))
      AND (NOT v_solo OR documentos_listos(q.ocid))
    ORDER BY riesgo_contrato(q.ocid) DESC, documentos_listos(q.ocid) DESC, random()
    LIMIT (v_total - v_ya)
    ON CONFLICT (ocid) DO NOTHING;
    GET DIAGNOSTICS v_insertados = ROW_COUNT;
  ELSIF v_entidad IS NULL THEN
    INSERT INTO asignaciones (contribucion_id, ocid)
    SELECT p_contribucion_id, q.ocid
    FROM cola_auditoria q
    JOIN convocatorias c ON c.ocid = q.ocid
    WHERE q.ubigeo LIKE v_ubigeo || '%'
      AND (v_tipos IS NULL OR c.tipo_contratacion = ANY (v_tipos))
      AND (NOT v_solo OR documentos_listos(q.ocid))
    ORDER BY riesgo_contrato(q.ocid) DESC, q.fecha_convocatoria NULLS LAST, q.ocid
    LIMIT (v_total - v_ya)
    ON CONFLICT (ocid) DO NOTHING;
    GET DIAGNOSTICS v_insertados = ROW_COUNT;
  ELSE
    INSERT INTO asignaciones (contribucion_id, ocid)
    SELECT p_contribucion_id, q.ocid
    FROM cola_auditoria q
    JOIN convocatorias c ON c.ocid = q.ocid
    WHERE c.entidad_ruc = v_entidad
      AND (v_tipos IS NULL OR c.tipo_contratacion = ANY (v_tipos))
      AND (NOT v_solo OR documentos_listos(q.ocid))
    ORDER BY riesgo_contrato(q.ocid) DESC, documentos_listos(q.ocid) DESC, random()
    LIMIT (v_total - v_ya)
    ON CONFLICT (ocid) DO NOTHING;
    GET DIAGNOSTICS v_insertados = ROW_COUNT;
  END IF;

  -- No alcanzaron los contratos listos: pedir al batch los que faltan, sin asignarlos; también los más graves primero.
  v_faltan := v_total - v_ya - v_insertados;
  IF v_solo AND v_faltan > 0 THEN
    IF v_partido IS NOT NULL THEN
      PERFORM pedir_descarga(s.ocid, 'financiado')
      FROM (SELECT q.ocid
            FROM cola_auditoria q
            JOIN convocatorias c ON c.ocid = q.ocid
            JOIN contrato_partido cp ON cp.ocid = q.ocid
            WHERE cp.org_clave = v_partido AND cp.anio_eleccion = v_anio
              AND (v_tipos IS NULL OR c.tipo_contratacion = ANY (v_tipos))
              AND NOT documentos_listos(q.ocid)
            ORDER BY riesgo_contrato(q.ocid) DESC, md5(p_contribucion_id::text || ':' || q.ocid)
            LIMIT v_faltan) s;
    ELSIF v_entidad IS NULL THEN
      PERFORM pedir_descarga(s.ocid, 'financiado')
      FROM (SELECT q.ocid
            FROM cola_auditoria q
            JOIN convocatorias c ON c.ocid = q.ocid
            WHERE q.ubigeo LIKE v_ubigeo || '%'
              AND (v_tipos IS NULL OR c.tipo_contratacion = ANY (v_tipos))
              AND NOT documentos_listos(q.ocid)
            ORDER BY riesgo_contrato(q.ocid) DESC, q.fecha_convocatoria NULLS LAST, q.ocid
            LIMIT v_faltan) s;
    ELSE
      PERFORM pedir_descarga(s.ocid, 'financiado')
      FROM (SELECT q.ocid
            FROM cola_auditoria q
            JOIN convocatorias c ON c.ocid = q.ocid
            WHERE c.entidad_ruc = v_entidad
              AND (v_tipos IS NULL OR c.tipo_contratacion = ANY (v_tipos))
              AND NOT documentos_listos(q.ocid)
            ORDER BY riesgo_contrato(q.ocid) DESC, md5(p_contribucion_id::text || ':' || q.ocid)
            LIMIT v_faltan) s;
    END IF;
  END IF;

  IF v_insertados > 0 THEN
    UPDATE contribuciones SET estado = 'en_proceso' WHERE id = p_contribucion_id AND estado = 'pagada';
  END IF;
  RETURN v_insertados;
END $$;

COMMIT;
