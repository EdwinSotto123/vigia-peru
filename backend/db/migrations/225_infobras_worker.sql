-- 225: La carga de INFOBRAS (obras públicas de la Contraloría, tabla obra_infobras de la migración 160) pasa al Worker de
--      scrapers. Estas funciones son los lectores de backend/scripts/cargar_obras.py que la migración 223 no tenía (fecha,
--      ruc y si_nulo) escritos en SQL; los demás (texto, entero, monto, cui, snip, si) son los de la 223.
--
-- Por qué existe: el XLSX «DataSet-Obras-Publicas DD-MM-YYYY» de https://infobras.contraloria.gob.pe/InfobrasWeb/DataSets
-- lo cargaba cargar_obras.py a mano desde una PC en Lima, porque la Contraloría sólo responde a IPs del Perú. Desde ahora lo
-- carga cada semana la fuente `infobras` del Worker vigia-scrapers (backend/scrapers-worker/src/fuentes/infobras.ts),
-- saliendo por el relay de Lima (backend/relay-lima). cargar_obras.py queda de respaldo. Como con Invierte.pe (223), el
-- Worker no tiene memoria ni CPU para normalizar ~191 mil filas de 97 columnas en TypeScript: lee la hoja en streaming,
-- copia las 80 columnas que se guardan tal como vienen (todo texto) a una tabla temporal y estas funciones las normalizan
-- dentro de un INSERT … SELECT, con la misma regla que Python. Las columnas que nunca se guardan (los nombres del residente
-- y del supervisor, sus fechas de labores, los comentarios, la dirección y el documento de aprobación) ni llegan a la base:
-- el Worker las descarta al leer la hoja.
--
-- entero0 y monto0 de Python (`entero(v) or 0`, `monto(v) or 0.0`) no tienen función: el Worker escribe
-- COALESCE(norm_entero(x), 0) y COALESCE(norm_monto(x), 0).
--
-- La primera corrida del Worker reescribe TODAS las filas de obra_infobras, una sola vez: la huella (el md5 de los valores
-- normalizados, que decide si una fila cambió) se arma en SQL y no coincide con la que armaba Python, así que ninguna fila
-- queda «igual» (todas pasan por el upsert con cambiado_at nuevo; dataset_fecha queda en la «Fecha de consulta» del
-- archivo, como con Python). Desde la segunda corrida sólo se reescribe lo que de verdad cambió. Lo mismo al revés: si se
-- vuelve a cargar con cargar_obras.py, esa vez y la siguiente del Worker reescriben todo.
--
-- Comparadas con cargar_obras.py en un Postgres 16 aparte (2026-10-31): con el archivo de ese día (191 180 obras) las dos
-- cargas dejan la misma obra_infobras, celda por celda en las 88 columnas que no son la huella ni las marcas de tiempo, y
-- las mismas cuentas de «ilegibles»; también al cargar encima del archivo del 26 y con uno armado con obras nuevas,
-- cambiadas, retiradas, repetidas y sin código (las mismas nuevas, cambiadas, iguales y retiradas). norm_fecha, norm_ruc y
-- norm_si_nulo dan lo mismo que Python en todos los valores distintos del archivo (~55 mil) y en casos armados. Las
-- diferencias a propósito son las de la 223: sólo cuentan las cifras 0-9, y un valor que en Python cortaba la carga con
-- una excepción aquí es NULL. norm_ruc pasa a mayúsculas con upper() de la base: las columnas RUC de INFOBRAS traen sólo
-- ASCII (visto el 2026-10-31), así que el locale no cambia nada.
--
-- Cómo aplicarla (después de la 223): psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/225_infobras_worker.sql
-- (o dev.sh migrar). Probarla: SELECT norm_fecha('31/10/2026'), norm_ruc(' c0002088241 '), norm_si_nulo('No');

-- fecha() entera: dd/mm/aaaa al empezar el texto (sin los espacios de los extremos) y, después, nada o un espacio y lo que
-- sea sin saltos de línea (el «(?:\s.*)?» de Python, donde «.» no toma el \n). El día tiene que existir y el año ser de 1980
-- a 2100 (norm_fecha_ymd, de la 223).
CREATE OR REPLACE FUNCTION norm_fecha_completo(v TEXT) RETURNS DATE LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  t CONSTANT TEXT := btrim(COALESCE(v, ''), norm_espacios());
  -- En las expresiones regulares de Postgres el «.» toma también el \n: lo que sigue a la fecha queda entero en m[4].
  m CONSTANT TEXT[] := regexp_match(t, '^([0-9]{1,2})/([0-9]{1,2})/([0-9]{4})(.*)$');
BEGIN
  IF m IS NULL OR (m[4] <> '' AND (strpos(norm_espacios(), left(m[4], 1)) = 0 OR strpos(substr(m[4], 2), chr(10)) > 0)) THEN
    RETURN NULL;
  END IF;
  RETURN norm_fecha_ymd(m[3]::int, m[2]::int, m[1]::int);
END $$;

-- fecha(): «31/10/2026» (INFOBRAS) → 2026-10-31. Una celda vacía o una fecha sola se resuelven aquí; lo demás, con la regla
-- entera.
CREATE OR REPLACE FUNCTION norm_fecha(v TEXT) RETURNS DATE LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN v IS NULL OR v = '' THEN NULL
              WHEN v ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$'
                THEN norm_fecha_ymd(split_part(v, '/', 3)::int, split_part(v, '/', 2)::int, split_part(v, '/', 1)::int)
              ELSE norm_fecha_completo(v) END
$$;

-- ruc(): tal como lo publica INFOBRAS (un RUC, «C0002088241» de un consorcio, a veces dos pegados), con los espacios de
-- texto() y en mayúsculas, hasta 40 caracteres. Vacío, 'none', 'null', 'nan', '-', '--', 'NO APLICA', 'NO CORRESPONDE' o
-- 'N/A' (con mayúsculas o sin ellas) es NULL.
CREATE OR REPLACE FUNCTION norm_ruc(v TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN upper(norm_texto(v)) IN ('NO APLICA', 'NO CORRESPONDE', 'N/A') THEN NULL ELSE left(upper(norm_texto(v)), 40) END
$$;

-- si_nulo(): «SI», «SÍ» o «S» es true; «NO» o «N», false (con mayúsculas o sin ellas, sin los espacios de los extremos);
-- cualquier otra cosa, también vacío, NULL. La í se pasa a Í antes de upper(), como en norm_si: no depende del locale.
CREATE OR REPLACE FUNCTION norm_si_nulo(v TEXT) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN upper(translate(btrim(v, norm_espacios()), chr(237), chr(205))) IN ('SI', 'S' || chr(205), 'S') THEN true
              WHEN upper(btrim(v, norm_espacios())) IN ('NO', 'N') THEN false END
$$;

-- ─── Dueño y permisos: las usa la carga del Worker, como vigia_jobs ───────────────────────────────────────────────────

ALTER FUNCTION norm_fecha_completo(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION norm_fecha(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION norm_ruc(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION norm_si_nulo(TEXT) OWNER TO vigia_jobs;
GRANT EXECUTE ON FUNCTION norm_fecha_completo(TEXT), norm_fecha(TEXT), norm_ruc(TEXT), norm_si_nulo(TEXT) TO vigia_jobs;

COMMENT ON TABLE obra_infobras IS
  'Obras públicas de INFOBRAS (Contraloría), una por Código INFOBRAS. La carga cada semana el Worker de scrapers (fuente infobras, por el relay de Lima); backend/scripts/cargar_obras.py queda de respaldo. Migraciones 160 y 225.';
