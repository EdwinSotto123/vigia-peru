-- 216: aportes con tarjeta por Mercado Pago (pago único y suscripción mensual con cobro automático), 2026-10-30.
--
-- Un aporte con tarjeta es una fila de `contribuciones` de tipo 'apoyo' con pasarela 'mercadopago' y, en pasarela_ref, el
-- id del pago de Mercado Pago. La suscripción mensual (`suscripciones_mp`) guarda su preapproval y el aporte con el que
-- empezó; cada cobro aprobado de los meses siguientes es un aporte nuevo de la misma persona, ya validado, y cuenta para
-- la constancia del podio como cualquier otro.
--
-- Valida y escribe la API con su rol del panel (vigia_api_admin / dev_api_admin), sólo después de pedirle el pago a
-- Mercado Pago: el rol público sigue sin poder marcar un aporte como pagado (backend/api/src/routes/pagos.ts).
-- Idempotente.

CREATE TABLE IF NOT EXISTS suscripciones_mp (
  id                    bigserial PRIMARY KEY,
  preapproval_id        text NOT NULL UNIQUE,
  financiador_id        bigint NOT NULL REFERENCES financiadores(id),
  contribucion_inicial  bigint REFERENCES contribuciones(id),
  monto_pen             numeric(12,2) NOT NULL CHECK (monto_pen >= 5),
  estado                text NOT NULL,            -- el de Mercado Pago: authorized, paused, cancelled, pending
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE contribuciones ADD COLUMN IF NOT EXISTS suscripcion_id bigint REFERENCES suscripciones_mp(id);

-- Un pago de Mercado Pago valida un solo aporte, aunque el aviso llegue varias veces.
CREATE UNIQUE INDEX IF NOT EXISTS contribuciones_ref_mercadopago
  ON contribuciones (pasarela_ref) WHERE pasarela = 'mercadopago' AND pasarela_ref IS NOT NULL;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api_admin', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON suscripciones_mp TO %I', r);
      EXECUTE format('GRANT USAGE ON SEQUENCE suscripciones_mp_id_seq TO %I', r);
      EXECUTE format('GRANT SELECT (suscripcion_id), INSERT (suscripcion_id), UPDATE (suscripcion_id) ON contribuciones TO %I', r);
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'dev_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT (suscripcion_id) ON contribuciones TO %I', r);
    END IF;
  END LOOP;
END $$;
