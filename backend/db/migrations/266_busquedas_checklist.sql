-- 266 · Búsquedas guardadas y checklist de postulación en la cuenta (Gobserva Licitaciones, 2026-11-07).
--
-- Hasta ahora vivían en el navegador (localStorage): no pasaban de un equipo a otro y se perdían al limpiar el
-- navegador. Ahora son de la cuenta (routes/gobservaCuenta.ts: /busquedas y /checklist) y se borran con ella.
--
--   gobserva_busquedas   las búsquedas guardadas de la bandeja («Mi empresa», «Tóner en Lima»): nombre y la búsqueda
--                        como URL (q=…&tipo=…). Hasta 12 por producto (lo controla la API). El nombre no se repite.
--   gobserva_checklist   lo que ya hiciste del checklist de postulación de un proceso (ids de los pasos).

CREATE TABLE IF NOT EXISTS public.gobserva_busquedas (
  id            bigserial PRIMARY KEY,
  firebase_uid  text NOT NULL REFERENCES gobserva_cuentas (firebase_uid),
  producto      text NOT NULL CHECK (producto IN ('empleo', 'licitaciones', 'obras')),
  nombre        text NOT NULL CHECK (length(nombre) BETWEEN 2 AND 60),
  query         text NOT NULL CHECK (length(query) <= 600),
  creado_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gobserva_busquedas_nombre ON public.gobserva_busquedas (firebase_uid, producto, lower(nombre));

CREATE TABLE IF NOT EXISTS public.gobserva_checklist (
  firebase_uid    text NOT NULL REFERENCES gobserva_cuentas (firebase_uid),
  ref             text NOT NULL CHECK (length(ref) BETWEEN 1 AND 80),
  hechos          text[] NOT NULL DEFAULT '{}' CHECK (cardinality(hechos) <= 30),
  actualizado_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (firebase_uid, ref)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gobserva_busquedas, public.gobserva_checklist TO vigia_api;
GRANT USAGE ON SEQUENCE public.gobserva_busquedas_id_seq TO vigia_api;
GRANT SELECT ON public.gobserva_busquedas, public.gobserva_checklist TO vigia_api_admin;
