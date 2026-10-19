-- 61 · Objetos y descripciones sin `\n` / `\t` / `\r` escritos como texto.
--
-- El SEACE manda en algunos procesos los saltos de línea escapados ("…PANEL LED \nPARA LA UNIVERSIDAD…"), y la web los
-- mostraba tal cual (366 objetos con `\n`, 24 con `\t`). Desde el commit de esta migración, vigia-scrapers los limpia al
-- cargar (`sinEscapes`, backend/scrapers-worker/src/fuentes/oece_ocds.ts); esto arregla lo ya cargado: el objeto de
-- `convocatorias` y de `alertas`, y la descripción del tender en el payload OCDS. `texto_busqueda` es una columna
-- generada: se recalcula sola.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/61_objeto_sin_escapes.sql

CREATE OR REPLACE FUNCTION sin_escapes(t TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(regexp_replace(t, '\\[nrt]', ' ', 'g'), '\s{2,}', ' ', 'g'))
$$;

UPDATE convocatorias
   SET objeto = sin_escapes(objeto)
 WHERE objeto ~ '\\[nrt]';

UPDATE convocatorias
   SET ocds_payload = jsonb_set(ocds_payload, '{tender,description}', to_jsonb(sin_escapes(ocds_payload->'tender'->>'description')))
 WHERE ocds_payload->'tender'->>'description' ~ '\\[nrt]';

UPDATE alertas
   SET objeto = sin_escapes(objeto)
 WHERE objeto ~ '\\[nrt]';
