-- 223: La carga de Invierte.pe pasa al Worker de scrapers. Estas funciones son los lectores de
--      backend/scripts/cargar_obras.py (LECTORES: texto, monto/numero, entero, fecha_iso, cui, snip, si, ubigeo, coordenada)
--      escritos en SQL.
--
-- Por qué existe: las inversiones de Invierte.pe (DETALLE_INVERSIONES.csv, las activas, y CIERRE_INVERSIONES.csv, las
-- cerradas, del MEF; tabla inversion_mef de la migración 160) las cargaba cargar_obras.py desde la PC, junto con INFOBRAS.
-- El MEF responde desde la nube, así que desde ahora las carga cada semana la fuente `invierte_pe` del Worker
-- vigia-scrapers (backend/scrapers-worker/src/fuentes/invierte_pe.ts). cargar_obras.py se queda con INFOBRAS (la
-- Contraloría sólo responde a IP peruana) y ya no toca Invierte.pe, salvo con --con-mef. El Worker no tiene memoria ni CPU
-- para normalizar 270 mil filas de 68 columnas en TypeScript: copia cada CSV tal como viene (todo texto) a una tabla
-- temporal y estas funciones lo normalizan dentro de un INSERT … SELECT, con la misma regla que Python.
--
-- La primera corrida del Worker reescribe TODAS las filas de inversion_mef, una sola vez. La huella (el md5 de los valores
-- normalizados más el origen, que decide si una fila cambió) ahora se arma en SQL y no coincide con la que armaba Python
-- (allí salía del texto de los float de Python), así que ninguna fila queda «igual»: todas pasan por el upsert con
-- cambiado_at y dataset_fecha nuevos (dataset_fecha es el día del Last-Modified del archivo del MEF). Desde la segunda
-- corrida sólo se reescribe lo que de verdad cambió. Lo mismo al revés: si se vuelve a cargar con cargar_obras.py
-- --con-mef, esa vez y la siguiente del Worker reescriben todo.
--
-- Comparadas con LECTORES sobre todos los valores distintos de los dos CSV del 2026-10-27 (unos 2 millones) y casos
-- armados, dan lo mismo salvo, a propósito:
--   - Sólo cuentan las cifras 0-9 (Python acepta también las de otros alfabetos, como el 3 arábigo).
--   - Lo que en Python cortaba la carga entera con una excepción (un monto como «1 -5», que float() no lee) aquí es NULL.
--     inf y nan escritos como monto o coordenada también son NULL, y un exponente de más de 4 cifras también (Postgres no
--     guarda 1e99999). Un monto de 10^16 o más sigue cortando la carga, como en Python: no cabe en NUMERIC(18,2).
--   - Python pasaba cada número por float. En una coordenada que termina justo en 5 en el séptimo decimal (126 en los
--     archivos de prueba), Python redondea el float y aquí se redondea el decimal: difieren en 0,000001 grados.
--   - Python, además, redondeaba todo número a 4 decimales antes de la columna (csv_valor): las coordenadas quedaban con 4
--     decimales. Aquí quedan con los 6 que pide coordenada(). En los montos (NUMERIC(18,2)) da lo mismo.
--
-- Cada lector va en una función de SQL de una sola expresión, para que Postgres la expanda dentro del INSERT (sin el costo
-- de una llamada por celda). Los que tienen una regla larga (monto, entero, fecha_iso, coordenada) resuelven ahí el caso de
-- casi todas las celdas (vacía, o un número o una fecha simple) y sólo lo demás pasa a su versión _completo, en plpgsql.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/223_invierte_pe_worker.sql  (o dev.sh migrar)
-- Probarla: SELECT norm_monto('S/4 195 186 00'), norm_texto(' a' || chr(160) || '  b '), norm_fecha_iso('2022-07-04 00:00:00');

-- Los espacios de Python: lo que cortan str.split() y str.strip() (str.isspace()). Tabulador, saltos de línea, 0x0B y
-- 0x0C, los separadores 0x1C a 0x1F, el espacio, NEL (0x85), el espacio duro (0xA0, que el CSV del MEF trae en unos 500
-- textos) y los espacios de Unicode (0x1680, 0x2000 a 0x200A, 0x2028, 0x2029, 0x202F, 0x205F y 0x3000). Van con chr(): se
-- leen y no dependen de la codificación con que se aplique este archivo. No se usa la clase de espacios de las expresiones
-- regulares de Postgres porque depende del locale de la base. Postgres la calcula una vez por consulta, no por fila.
CREATE OR REPLACE FUNCTION norm_espacios() RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT string_agg(chr(c), '' ORDER BY c)
    FROM unnest(ARRAY[9, 10, 11, 12, 13, 28, 29, 30, 31, 32, 133, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199,
                      8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288]) c
$$;

-- texto(): los espacios seguidos quedan como uno y se quitan los de los extremos. Vacío, 'none', 'null', 'nan', '-' o '--'
-- (con mayúsculas o sin ellas) es NULL.
CREATE OR REPLACE FUNCTION norm_texto(v TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN v IS NULL OR v ~* ('^[' || norm_espacios() || ']*(none|null|nan|--?)?[' || norm_espacios() || ']*$') THEN NULL
              ELSE btrim(regexp_replace(v, '[' || norm_espacios() || ']+', ' ', 'g'), ' ') END
$$;

/*
 * monto() entero (también el lector «numero», que en Python es el mismo): «1205287 56» → 1205287.56 y «S/4 195 186 00» →
 * 4195186 (un último grupo de 1 o 2 cifras son los céntimos), «4 195 186» → 4195186, «99 9» → 99.9, «12,5» → 12.5,
 * «1,234,567.5» → 1234567.5 (si la coma no es decimal, es de miles), «1e5» → 100000. Vacío, 'none', 'null', 'nan', '-' o
 * '--' es NULL, y lo que no se lee, también. Sin ceros de más a la derecha (trim_scale): «1.50» y «1.5» dan el mismo valor
 * y la misma huella.
 */
CREATE OR REPLACE FUNCTION norm_monto_completo(v TEXT) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  e CONSTANT TEXT := '[' || norm_espacios() || ']';
  t TEXT := btrim(COALESCE(v, ''), norm_espacios());
BEGIN
  IF lower(t) IN ('', 'none', 'null', 'nan', '-', '--') THEN
    RETURN NULL;
  END IF;
  -- La moneda adelante: «S/», «S/.», «US$» o «$», con mayúsculas o sin ellas.
  t := btrim(regexp_replace(t, '^(S/[.]?|US[$]|[$])', '', 'i'), norm_espacios());
  -- «12,5» o «-3,25»: la coma es decimal. Si no, las comas son de miles y se quitan.
  t := btrim(CASE WHEN t ~ '^-?[0-9]+,[0-9]{1,2}$' THEN replace(t, ',', '.') ELSE replace(t, ',', '') END, norm_espacios());
  -- Sólo grupos de cifras separados por espacios, como los escribe INFOBRAS.
  IF t ~ ('^-?[0-9]+(' || e || '+-?[0-9]+)*$') THEN
    IF t ~ (e || '+(-[0-9]|[0-9]{1,2})$') THEN
      -- Más de un grupo y el último de 1 o 2 caracteres: son los céntimos. Python cae con «1 -5» o «1 -2 50» (float() no
      -- lee «1.-5»): aquí, NULL.
      t := regexp_replace(regexp_replace(t, e || '+(-?[0-9]+)$', '.\1'), e || '+', '', 'g');
      RETURN CASE WHEN t ~ '^-?[0-9]+[.][0-9]{1,2}$' THEN trim_scale(t::numeric) END;
    END IF;
    -- Un solo grupo, o el último de 3 cifras o más: todo junto. «1 -234» también hacía caer a Python: NULL.
    t := regexp_replace(t, e || '+', '', 'g');
    RETURN CASE WHEN t ~ '^-?[0-9]+$' THEN trim_scale(t::numeric) END;
  END IF;
  -- Lo que lee float() de Python: signo, punto decimal, exponente y «_» entre cifras (inf y nan no; un exponente de hasta 4
  -- cifras: Postgres no guarda 1e99999).
  RETURN CASE WHEN t ~ '^[+-]?([0-9](_?[0-9])*([.]([0-9](_?[0-9])*)?)?|[.][0-9](_?[0-9])*)([eE][+-]?[0-9](_?[0-9]){0,3})?$'
              THEN trim_scale(replace(t, '_', '')::numeric) END;
END $$;

-- monto() y «numero»: una celda vacía o un número simple («1853953.5», «0.0», «60912») se resuelven aquí; lo demás, con la
-- regla entera.
CREATE OR REPLACE FUNCTION norm_monto(v TEXT) RETURNS NUMERIC LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN v IS NULL OR v = '' THEN NULL
              WHEN v ~ '^-?[0-9]+([.][0-9]+)?$' THEN trim_scale(v::numeric)
              ELSE norm_monto_completo(v) END
$$;

-- devengado_acumulado de las activas (leer_mef): DEVEN_ACUMUL_ANIO_ANT + DEV_ANIO_ACTUAL. NULL si no se lee ninguno de los
-- dos; si falta uno, cuenta como 0.
CREATE OR REPLACE FUNCTION norm_suma_montos(a TEXT, b TEXT) RETURNS NUMERIC LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN norm_monto(a) IS NULL AND norm_monto(b) IS NULL THEN NULL
              ELSE trim_scale(COALESCE(norm_monto(a), 0) + COALESCE(norm_monto(b), 0)) END
$$;

-- entero() entero: el monto, sin nada de más de 2 mil millones (no cabe en INT), redondeado como round() de Python: un .5
-- exacto va al par (2.5 → 2, 3.5 → 4, -2.5 → -2), no lejos del cero como round() de Postgres.
CREATE OR REPLACE FUNCTION norm_entero_completo(v TEXT) RETURNS INT LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  m NUMERIC := norm_monto(v);
BEGIN
  IF m IS NULL OR abs(m) > 2000000000 THEN
    RETURN NULL;
  END IF;
  RETURN (CASE WHEN abs(m - trunc(m)) = 0.5 THEN 2 * round(m / 2) ELSE round(m) END)::int;
END $$;

-- entero(): una celda vacía o un entero simple («300790», «202602») se resuelven aquí; lo demás («703.0», «1 234»), con la
-- regla entera.
CREATE OR REPLACE FUNCTION norm_entero(v TEXT) RETURNS INT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN v IS NULL OR v = '' THEN NULL
              WHEN v ~ '^-?[0-9]{1,9}$' THEN v::int
              ELSE norm_entero_completo(v) END
$$;

-- El día a-m-d si existe y es de 1980 a 2100 (como fecha_iso() de Python); si no, NULL.
CREATE OR REPLACE FUNCTION norm_fecha_ymd(a INT, m INT, d INT) RETURNS DATE LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN a BETWEEN 1980 AND 2100 AND m BETWEEN 1 AND 12
               AND d BETWEEN 1 AND CASE WHEN m = 2 THEN CASE WHEN (a % 4 = 0 AND a % 100 <> 0) OR a % 400 = 0 THEN 29 ELSE 28 END
                                        WHEN m IN (4, 6, 9, 11) THEN 30 ELSE 31 END
              THEN make_date(a, m, d) END
$$;

-- fecha_iso() entero: AAAA-MM-DD al empezar el texto, sin los espacios de los extremos; lo que sigue no importa.
CREATE OR REPLACE FUNCTION norm_fecha_iso_completo(v TEXT) RETURNS DATE LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  t TEXT := btrim(COALESCE(v, ''), norm_espacios());
BEGIN
  IF t !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
    RETURN NULL;
  END IF;
  RETURN norm_fecha_ymd(substr(t, 1, 4)::int, substr(t, 6, 2)::int, substr(t, 9, 2)::int);
END $$;

-- fecha_iso(): «2022-07-04 00:00:00» o «2001-06-12». Lo que empieza con la fecha se resuelve aquí; lo demás, con la regla
-- entera.
CREATE OR REPLACE FUNCTION norm_fecha_iso(v TEXT) RETURNS DATE LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN v IS NULL OR v = '' THEN NULL
              WHEN v ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN norm_fecha_ymd(substr(v, 1, 4)::int, substr(v, 6, 2)::int, substr(v, 9, 2)::int)
              ELSE norm_fecha_iso_completo(v) END
$$;

-- cui(): sólo las cifras del texto, y tienen que ser 7 y no empezar con 0.
CREATE OR REPLACE FUNCTION norm_cui(v TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN v ~ '^[1-9][0-9]{6}$' THEN v
              WHEN regexp_replace(v, '[^0-9]+', '', 'g') ~ '^[1-9][0-9]{6}$' THEN regexp_replace(v, '[^0-9]+', '', 'g') END
$$;

-- snip(): sin espacios en los extremos ni ceros a la izquierda, de 3 a 7 cifras.
CREATE OR REPLACE FUNCTION norm_snip(v TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN ltrim(btrim(v, norm_espacios()), '0') ~ '^[0-9]{3,7}$' THEN ltrim(btrim(v, norm_espacios()), '0') END
$$;

-- si(): «SI», «SÍ» o «S», con mayúsculas o sin ellas, es true; cualquier otra cosa, también vacío, es false (nunca NULL).
-- chr(237) es la í y chr(205), la Í: la í se pasa a Í antes de upper(), así no depende del locale de la base.
CREATE OR REPLACE FUNCTION norm_si(v TEXT) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(upper(translate(btrim(v, norm_espacios()), chr(237), chr(205))) IN ('SI', 'S' || chr(205), 'S'), false)
$$;

-- ubigeo(): 5 o 6 cifras, con un 0 adelante si son 5.
CREATE OR REPLACE FUNCTION norm_ubigeo(v TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN btrim(v, norm_espacios()) ~ '^[0-9]{5,6}$' THEN lpad(btrim(v, norm_espacios()), 6, '0') END
$$;

-- coordenada() entera: lo que lee float(), distinto de 0 y entre -180 y 180, redondeado a 6 decimales.
CREATE OR REPLACE FUNCTION norm_coordenada_completo(v TEXT) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  t TEXT := btrim(COALESCE(v, ''), norm_espacios());
  x NUMERIC;
BEGIN
  IF t !~ '^[+-]?([0-9](_?[0-9])*([.]([0-9](_?[0-9])*)?)?|[.][0-9](_?[0-9])*)([eE][+-]?[0-9](_?[0-9]){0,3})?$' THEN
    RETURN NULL;
  END IF;
  x := replace(t, '_', '')::numeric;
  RETURN CASE WHEN x <> 0 AND x BETWEEN -180 AND 180 THEN trim_scale(round(x, 6)) END;
END $$;

-- coordenada(): una celda vacía o un decimal simple («-13.233869415294627») se resuelven aquí; lo demás, con la regla entera.
CREATE OR REPLACE FUNCTION norm_coordenada(v TEXT) RETURNS NUMERIC LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN v IS NULL OR v = '' THEN NULL
              WHEN v ~ '^-?[0-9]{1,3}([.][0-9]+)?$' THEN
                CASE WHEN v::numeric <> 0 AND v::numeric BETWEEN -180 AND 180 THEN trim_scale(round(v::numeric, 6)) END
              ELSE norm_coordenada_completo(v) END
$$;

-- ─── Dueño y permisos: las usa la carga del Worker, como vigia_jobs ───────────────────────────────────────────────────

ALTER FUNCTION norm_espacios() OWNER TO vigia_jobs;
ALTER FUNCTION norm_texto(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION norm_monto_completo(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION norm_monto(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION norm_suma_montos(TEXT, TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION norm_entero_completo(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION norm_entero(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION norm_fecha_ymd(INT, INT, INT) OWNER TO vigia_jobs;
ALTER FUNCTION norm_fecha_iso_completo(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION norm_fecha_iso(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION norm_cui(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION norm_snip(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION norm_si(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION norm_ubigeo(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION norm_coordenada_completo(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION norm_coordenada(TEXT) OWNER TO vigia_jobs;
GRANT EXECUTE ON FUNCTION norm_espacios(), norm_texto(TEXT), norm_monto_completo(TEXT), norm_monto(TEXT),
  norm_suma_montos(TEXT, TEXT), norm_entero_completo(TEXT), norm_entero(TEXT), norm_fecha_ymd(INT, INT, INT),
  norm_fecha_iso_completo(TEXT), norm_fecha_iso(TEXT), norm_cui(TEXT), norm_snip(TEXT), norm_si(TEXT), norm_ubigeo(TEXT),
  norm_coordenada_completo(TEXT), norm_coordenada(TEXT) TO vigia_jobs;
