-- 260 · Los refrescos pesados los corre la base (pg_cron), no la conexión de Cloudflare.
--
-- Por qué: Hyperdrive suelta una sentencia a los 10 minutos sin respuesta («Timed out while waiting for a message from
-- the origin database»), pero la base sigue con ella. Cuando termina no tiene a quién avisar («could not send data to
-- client», «connection to client lost») y deshace todo. Mientras tanto el reintento del Workflow ya lanzó otra copia
-- igual: dos refrescos pesados a la vez sobre un disco que ya estaba en su techo (~3 000 lecturas por segundo). Así se
-- perdieron oece_ocds del 1, 2, 3 y 6 de noviembre (refrescar_empresas y refrescar_borde_empresas) y conosce_ordenes del
-- 1 de noviembre (refrescar_personas_senales). Esta última dejó sin rehacer las compras, las órdenes por año y por mes y
-- las señales de personas.
--
-- Cómo: el Workflow pone en refresco_cola la lista de refrescos de su carga (un lote) y espera; pg_cron llama cada
-- minuto a correr_refrescos(), que los corre de a uno, por orden de llegada, cada uno en su transacción. Nadie espera
-- del otro lado de una conexión, así que no hay corte. Además los lotes de distintas fuentes no se enciman: la cola es una
-- sola.
--
-- Requiere pg_cron en shared_preload_libraries y cron.database_name = vigia (grupo de parámetros vigia-db-pg16,
-- 2026-11-07; PROD se reinició para cargarlo, DEV lo toma al encender). Sin pg_cron esta migración falla en la primera
-- línea y el Workflow sigue corriendo los refrescos como antes (src/fuentes/comun.ts: refrescar()).

CREATE EXTENSION IF NOT EXISTS pg_cron;
GRANT USAGE ON SCHEMA cron TO vigia_jobs;

CREATE TABLE IF NOT EXISTS public.refresco_cola (
  id        bigserial PRIMARY KEY,
  lote      text NOT NULL,            -- la instancia del Workflow (o «manual-…»)
  nombre    text NOT NULL,            -- el nombre del paso, como en la bitácora
  sql       text NOT NULL,            -- una sentencia que devuelve una fila con una columna (o ninguna)
  requiere  text,                     -- firma de una función de una migración que puede faltar: sin ella, «saltado»
  estado    text NOT NULL DEFAULT 'pendiente'
            CHECK (estado IN ('pendiente', 'corriendo', 'ok', 'error', 'saltado')),
  intentos  int NOT NULL DEFAULT 0,
  creado    timestamptz NOT NULL DEFAULT now(),
  inicio    timestamptz,
  fin       timestamptz,
  pid       int,
  resultado text,
  error     text,
  UNIQUE (lote, nombre)
);
CREATE INDEX IF NOT EXISTS refresco_cola_pendientes ON public.refresco_cola (id) WHERE estado IN ('pendiente', 'corriendo');
ALTER TABLE public.refresco_cola OWNER TO vigia_jobs;
COMMENT ON TABLE public.refresco_cola IS
  'Refrescos pesados en cola (migración 260): los pone el Workflow de cada carga y los corre correr_refrescos() desde pg_cron.';

-- Corre la cola hasta vaciarla. Cada refresco va en su transacción (como cuando cada uno era un paso del Workflow) y, si
-- falla, se reintenta una vez; un error no frena a los que siguen, que se corren igual (antes un paso caído dejaba sin
-- rehacer todo lo de después). Entre uno y otro se borran las tablas temporales y los ajustes de sesión: cada función se
-- escribió para correr en una conexión nueva.
CREATE OR REPLACE PROCEDURE public.correr_refrescos()
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  v text;
BEGIN
  -- pg_cron no encima dos corridas del mismo trabajo, pero alguien puede llamarla a mano.
  IF NOT pg_try_advisory_lock(hashtext('correr_refrescos')) THEN
    RETURN;
  END IF;
  -- Lo que quedó «corriendo» es de una vuelta que murió (reinicio de la base, proceso cortado): vuelve a la cola.
  UPDATE public.refresco_cola SET estado = 'pendiente' WHERE estado = 'corriendo';
  DELETE FROM public.refresco_cola WHERE creado < now() - interval '90 days' AND estado NOT IN ('pendiente', 'corriendo');
  COMMIT;
  LOOP
    SELECT id, nombre, sql, requiere, intentos INTO r
      FROM public.refresco_cola WHERE estado = 'pendiente' ORDER BY id LIMIT 1;
    EXIT WHEN NOT FOUND;
    IF r.requiere IS NOT NULL AND to_regprocedure(r.requiere) IS NULL THEN
      UPDATE public.refresco_cola SET estado = 'saltado', fin = clock_timestamp(),
             error = r.requiere || ' no existe en esta base' WHERE id = r.id;
      COMMIT;
      CONTINUE;
    END IF;
    IF r.intentos >= 2 THEN
      -- Ya murió a mitad de camino dos veces (no es un error de SQL: la vuelta entera se cayó con él).
      UPDATE public.refresco_cola SET estado = 'error', fin = clock_timestamp(),
             error = coalesce(error, 'la vuelta se cortó dos veces con este refresco') WHERE id = r.id;
      COMMIT;
      CONTINUE;
    END IF;
    UPDATE public.refresco_cola
       SET estado = 'corriendo', inicio = clock_timestamp(), fin = NULL, intentos = intentos + 1, pid = pg_backend_pid()
     WHERE id = r.id;
    COMMIT;
    BEGIN
      EXECUTE r.sql INTO v;
      UPDATE public.refresco_cola SET estado = 'ok', fin = clock_timestamp(), resultado = v, error = NULL WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.refresco_cola
         SET estado = CASE WHEN r.intentos + 1 < 2 THEN 'pendiente' ELSE 'error' END,
             fin = clock_timestamp(), error = left(SQLERRM, 1000)
       WHERE id = r.id;
    END;
    COMMIT;
    EXECUTE 'DISCARD TEMP';
    RESET ALL;
  END LOOP;
  PERFORM pg_advisory_unlock(hashtext('correr_refrescos'));
END $$;
ALTER PROCEDURE public.correr_refrescos() OWNER TO vigia_jobs;

-- Cada minuto, como vigia_jobs (el mismo rol con el que corrían desde el Workflow). Si la cola está vacía, termina al
-- instante.
SET ROLE vigia_jobs;
SELECT cron.schedule('vigia-refrescos', '* * * * *', 'CALL public.correr_refrescos()');
RESET ROLE;

-- La bitácora de pg_cron crece una fila por minuto: una semana basta (la de la cola se limpia sola a los 90 días).
SELECT cron.schedule('vigia-cron-limpieza', '17 4 * * *',
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$$);
