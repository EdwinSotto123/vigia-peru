-- 435 · Los índices de significado chicos, siempre en memoria.
--
-- El 2026-11-20 la prueba del MCP vio buscar_informes_control cortado por tiempo (19,8 s y luego un 504): con el índice
-- HNSW de las observaciones de la Contraloría fuera de memoria (lo desaloja una cadena de refrescos grande), la parte de
-- significado se pasaba de su tope de 8 s y la de palabras, en frío, del suyo. En caliente la misma búsqueda tarda
-- 0,5 a 1,6 s en la base. Precalentar los dos índices chicos (Contraloría 84 MB, normas 70 MB) cuesta 133 ms si ya están
-- y hasta 3 s si no; sus TOAST (los vectores que se leen para medir la distancia de los 300 cercanos, unos 95 MB cada
-- uno) van a la caché del sistema ('read'), sin ocupar shared_buffers. El de los documentos (980 MB, la mitad de
-- shared_buffers) se queda fuera: desalojaría lo demás.

CREATE OR REPLACE FUNCTION precalentar_vectores() RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  n bigint := 0;
  r record;
BEGIN
  FOR r IN SELECT c.oid FROM pg_class c
            WHERE c.relname IN ('informe_control_fragmento_embedding', 'norma_fragmento_embedding') AND c.relkind = 'i' LOOP
    n := n + pg_prewarm(r.oid::regclass, 'buffer');
  END LOOP;
  -- Por la tabla y no por el nombre del TOAST: si la tabla se reescribe, su TOAST cambia de nombre.
  FOR r IN SELECT c.reltoastrelid AS oid FROM pg_class c
            WHERE c.relname IN ('informe_control_fragmento', 'norma_fragmento') AND c.relkind = 'r' AND c.reltoastrelid <> 0 LOOP
    n := n + pg_prewarm(r.oid::regclass, 'read');
  END LOOP;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION precalentar_vectores() FROM PUBLIC;

SELECT cron.schedule('vigia-precalentar-vectores', '*/10 * * * *', 'SELECT public.precalentar_vectores()');
SELECT precalentar_vectores();
