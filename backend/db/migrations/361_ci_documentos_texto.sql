-- 361 · La tarea nocturna de lectura de documentos no podía leer ni escribir el texto.
--
-- tarea:piezas (GitLab CI, cada noche a las 02:30; backend/lector/texto.py, piezas.py, transcribir.py, por_pieza.py) corre
-- como vigia_ci. Todas sus tablas son de vigia_jobs (de quien vigia_ci hereda) o ya se le habían concedido, menos
-- `documentos_texto`, que es de postgres: su primera corrida programada (2026-11-18) terminó en «permission denied for table
-- documentos_texto» en el primer paso. Desde la PC nunca falló porque ahí se corre con el usuario administrador.
--
-- Lo justo para esa tarea: leer el texto, guardar el de un archivo nuevo y actualizar el de una página transcrita. Sin
-- borrar. Sólo a vigia_ci (el Worker de scrapers, vigia_jobs, no toca esta tabla).
DO $$
DECLARE r text; s text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_ci', 'dev_ci'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.documentos_texto TO %I', r);
      -- Si la tabla numera sus filas con una secuencia, insertar la necesita.
      FOR s IN SELECT pg_get_serial_sequence('public.documentos_texto', a.attname)
                 FROM pg_attribute a
                WHERE a.attrelid = 'public.documentos_texto'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                  AND pg_get_serial_sequence('public.documentos_texto', a.attname) IS NOT NULL LOOP
        EXECUTE format('GRANT USAGE ON SEQUENCE %s TO %I', s, r);
      END LOOP;
    END IF;
  END LOOP;
END $$;
