-- 192: «Borrar cuenta» respondía 500 desde la migración 40.
--
-- La 40 redefinió borrar_cuenta(text) con CREATE OR REPLACE, y eso le quitó el SECURITY DEFINER que le había dado la 37
-- (un CREATE OR REPLACE vuelve a los atributos por omisión; el dueño y los permisos sí se quedan). Corría entonces como
-- vigia_api, que a propósito no puede escribir reportes_indexados ni borrar filas de usuarios, y fallaba con 42501
-- (permission denied for table reportes_indexados): nadie podía borrar su cuenta. Se le devuelve lo de la 37.
-- Quien vuelva a redefinirla con CREATE OR REPLACE tiene que repetir estas líneas (lo comprobó, el 2026-10-28, una
-- revisión de las 18 funciones SECURITY DEFINER de la 37: sólo ésta lo había perdido). Idempotente.

ALTER FUNCTION borrar_cuenta(text) OWNER TO postgres;
ALTER FUNCTION borrar_cuenta(text) SECURITY DEFINER SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION borrar_cuenta(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION borrar_cuenta(text) TO vigia_api;
