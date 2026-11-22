-- 442 · Gobserva Salud, la cuenta gratis (2026-11-21, el usuario: «que capaz se cree alguna cuenta sencilla»): lo que cada
-- quien guarda para volver a verlo (un establecimiento, un médico por su colegiatura, un medicamento) y desde cuándo, para
-- avisarle lo nuevo (una sanción, un cambio en RENIPRESS, una alerta de DIGEMID).
--
-- Es aparte de gobserva_guardados (migración 230) a propósito: Salud no tiene planes ni pagos, y su cuenta es la de su
-- propio grupo de Cognito (infrastructure/aws/cognito_gobserva.py, «gobserva-salud»). `uid` es el `sub` de ese grupo.
-- Nada de lo guardado es de otra persona: el número de colegiatura lo escribe quien lo guarda.

CREATE TABLE IF NOT EXISTS salud_guardado (
  uid        text NOT NULL CHECK (length(uid) BETWEEN 1 AND 128),
  tipo       text NOT NULL CHECK (tipo IN ('establecimiento', 'medico', 'medicamento')),
  ref        text NOT NULL CHECK (ref ~ '^[0-9]{1,10}$'),   -- código IPRESS, N.° de colegiatura o código del medicamento
  nombre     text CHECK (length(nombre) <= 200),            -- cómo se llamaba al guardarlo (si después deja de figurar)
  creado_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (uid, tipo, ref)
);
CREATE INDEX IF NOT EXISTS salud_guardado_ref ON salud_guardado (tipo, ref);

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE salud_guardado OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON salud_guardado TO %I', r);
    END IF;
  END LOOP;
END $$;
