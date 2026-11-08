-- 270: «Lo esencial» de cada plaza CAS (2026-11-08, el usuario: «falta más profundidad, ¿resumimos bases y demás?»).
--
-- Haiku lee lo que la plaza trae de SERVIR (formación, experiencia, cursos, conocimientos, competencias, sueldo, plazo)
-- y lo escribe en palabras simples: en una frase, a quién buscan, los requisitos clave y qué mirar con cuidado. Se arma
-- la primera vez que alguien abre la ficha y se guarda acá; `huella` es la de los campos leídos: si SERVIR los cambia,
-- se vuelve a armar. No tiene datos personales (un aviso de SERVIR no los trae). Una fila puede tener sólo las bases.
CREATE TABLE IF NOT EXISTS public.servir_resumen (
  aviso      integer PRIMARY KEY,
  huella     text NOT NULL,
  resumen    jsonb,
  modelo     text NOT NULL,
  creado_at  timestamptz NOT NULL DEFAULT now(),
  -- Las bases de la convocatoria, cuando la web de la entidad las publica (lib/basesPlaza.ts): los documentos encontrados
  -- (título y enlace), lo que dicen en palabras simples, y cuándo se buscaron (si no se encontraron, se reintenta después).
  bases          jsonb,
  bases_estado   text CHECK (bases_estado IN ('encontradas', 'no_encontradas', 'error')),
  bases_at       timestamptz
);

GRANT SELECT, INSERT, UPDATE ON public.servir_resumen TO vigia_api;
GRANT SELECT ON public.servir_resumen TO vigia_api_admin;
