-- 150 · La llave oficial RUC → unidad ejecutora del SIAF: el registro «Entidades contratantes» de la OECE.
--
-- El MEF publica el presupuesto por unidad ejecutora (sec_ejec) y sin RUC, y hasta acá refrescar_mef_presupuesto()
-- (migraciones 47, 62 y 63) adivinaba la unidad de cada entidad por ubigeo o por el parecido del nombre: el 2026-10-26,
-- 424 de 3,162 fichas quedaban sin presupuesto (13 % de las entidades, 18 % de los contratos), 127 mostraban el pliego
-- regional entero y una veintena mostraba el de otra entidad (Qali Warma con el PAE, la Unión Asháninka con Pichari, el
-- Hospital de Vitarte con el de Lima Este). La OECE publica, para cada RUC que contrata con el Estado, su CODIGO_SIAF:
--   https://osce-gob-pe.atlassian.net/wiki/download/attachments/106889265/entidades_contratantes.csv
--   RUC|NOMBRE_DE_ENTIDAD|DEPARTAMENTO|PROVINCIA|DISTRITO|CODIGO_SIAF|CODCONSUCODE|ESTADO|ULTIMAACTUALIZACION
-- (3,364 filas; tiene a 3,160 de las 3,162 entidades de Vigía). El código es el sec_ejec del MEF escrito con ceros
-- ("0117" = 117, la Administración Central del MINSA); vacío o 930xxx = la entidad no está en el SIAF (empresas de
-- FONAFE, EsSalud, EPS, institutos viales, beneficencias, BCRP, SBS…). Esta tabla lo guarda tal cual, y
-- refrescar_mef_presupuesto() (migración 151) lo usa antes que cualquier parecido.
--
-- La carga backend/scripts/cargar_entidades_oece.py (baja el CSV, o usa la última copia local; upsert idempotente).
--
-- Además, corregir_ubigeo_municipal(): las municipalidades distritales nuevas llegaban del OCDS con el ubigeo del
-- distrito del que se separaron (Canayre con el de Ayahuanco, Unión Asháninka con el de Pichari, Yaguas con el de
-- Balsapuerto) o sin ubigeo (Kimbiri): así salían en otra zona, con otro gobernante y, en la ficha, con el presupuesto
-- de la vecina. El ubigeo bueno es el de su propia unidad ejecutora en el MEF (en los gobiernos locales, el campo
-- `ejecutora` ES el ubigeo), a la que se llega por el código de la OECE. El DEPARTAMENTO/PROVINCIA/DISTRITO de la OECE no
-- sirve para esto: repite el distrito viejo. Cada cambio queda en entidad_ubigeo_correccion.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/150_entidad_siaf.sql   (o dev.sh migrar)
-- Después: python backend/scripts/cargar_entidades_oece.py --entorno dev|prod  y la migración 151.

CREATE TABLE IF NOT EXISTS entidad_siaf (
  ruc           CHAR(11) PRIMARY KEY,
  sec_ejec      INT,                              -- CODIGO_SIAF como número ("0117" → 117); NULL si no está en el SIAF
  es_pliego     BOOLEAN NOT NULL DEFAULT false,   -- el código es el de un pliego, no el de una unidad ejecutora: sec_ejec es
                                                  -- entonces la sede de ese pliego (su UE de menor código) y el presupuesto
                                                  -- que se muestra es el del pliego entero (keyword 'pliego …')
  fuera_siaf    BOOLEAN NOT NULL DEFAULT false,   -- CODIGO_SIAF vacío o 930xxx: su presupuesto no está en el del MEF
  codigo_siaf   TEXT,                             -- tal como lo publica la OECE ("0117", "930016", NULL si vacío)
  nombre        TEXT NOT NULL,
  departamento  TEXT,
  provincia     TEXT,
  distrito      TEXT,
  codconsucode  TEXT,
  estado        TEXT,                             -- Activo / Inactivo
  actualizado   DATE,                             -- ULTIMAACTUALIZACION de la fila en la OECE (dd/mm/aa)
  cargado       TIMESTAMPTZ NOT NULL DEFAULT now(), -- cuándo se escribió (o cambió) la fila en Vigía
  CONSTRAINT entidad_siaf_codigo CHECK (NOT (fuera_siaf AND sec_ejec IS NOT NULL) AND NOT (es_pliego AND sec_ejec IS NULL))
);
CREATE INDEX IF NOT EXISTS entidad_siaf_sec_ejec_idx ON entidad_siaf (sec_ejec);
COMMENT ON TABLE entidad_siaf IS
  'Registro «Entidades contratantes» de la OECE: RUC → CODIGO_SIAF (sec_ejec del MEF). La carga backend/scripts/cargar_entidades_oece.py. Migración 150.';

-- Cada ubigeo de entidad corregido (por corregir_ubigeo_municipal): qué había, qué quedó y por qué.
CREATE TABLE IF NOT EXISTS entidad_ubigeo_correccion (
  id              BIGSERIAL PRIMARY KEY,
  ruc             CHAR(11) NOT NULL,
  ubigeo_antes    CHAR(6),
  ubigeo_nuevo    CHAR(6) NOT NULL,
  distrito_antes  TEXT,
  distrito_nuevo  TEXT,
  provincia_antes TEXT,
  provincia_nuevo TEXT,
  motivo          TEXT NOT NULL,
  corregido       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS entidad_ubigeo_correccion_ruc_idx ON entidad_ubigeo_correccion (ruc, corregido DESC);

/*
 * Pone a cada municipalidad (provincial o distrital) el ubigeo de su propia unidad ejecutora del MEF, a la que llega por
 * el CODIGO_SIAF de la OECE, cuando el que tiene es otro o ninguno. Sólo municipalidades: en ellas el ubigeo es el de su
 * jurisdicción y el MEF lo trae exacto (`ejecutora` de nivel M = ubigeo del distrito; en las provinciales, el del distrito
 * capital). El resto de entidades tiene el ubigeo de su domicilio, que no se toca. No pisa un ubigeo bueno con uno peor:
 * el nuevo tiene que existir en `zonas`, la unidad del MEF tiene que ser una municipalidad del mismo tipo (provincial o
 * distrital) y quedar en el mismo departamento que la entidad (por su ubigeo o, si no tiene, por su región). Deja cada
 * cambio en entidad_ubigeo_correccion y los devuelve. Idempotente: corrida dos veces, la segunda no cambia nada. Al
 * cambiar el ubigeo, el disparador de la migración 32 rehace la zona de sus contratos sin ubigeo propio, y el de derivados
 * marca 'contratos' para el próximo refresco.
 */
CREATE OR REPLACE FUNCTION corregir_ubigeo_municipal()
RETURNS TABLE (ruc CHAR(11), nombre TEXT, ubigeo_antes CHAR(6), ubigeo_nuevo CHAR(6), distrito_nuevo TEXT)
LANGUAGE sql AS $$
  WITH ue AS (
    SELECT DISTINCT ON (m.sec_ejec) m.sec_ejec, btrim(m.ejecutora) AS ubigeo, mef_norm(m.ejecutora_nombre) AS xn
      FROM mef_ejecutora_anual m WHERE m.nivel_gobierno = 'M' ORDER BY m.sec_ejec, m.anio DESC),
  cand AS (
    SELECT DISTINCT ON (e.ruc) e.ruc, e.nombre, e.ubigeo AS antes, u.ubigeo::char(6) AS nuevo, e.distrito AS d_antes,
           e.provincia AS p_antes, z.nombre AS d_nuevo, coalesce(zp.nombre, e.provincia) AS p_nuevo
      FROM entidades e
      JOIN entidad_siaf s ON s.ruc = e.ruc AND s.sec_ejec IS NOT NULL AND NOT s.es_pliego
      JOIN ue u ON u.sec_ejec = s.sec_ejec::text AND u.ubigeo ~ '^\d{6}$' AND u.xn LIKE 'MUNICIPALIDAD %'
      JOIN zonas z ON z.ubigeo = u.ubigeo AND z.nivel = 'distrito'
      LEFT JOIN zonas zp ON zp.ubigeo = left(u.ubigeo, 4) AND zp.nivel = 'provincia'
      LEFT JOIN zonas zd ON zd.ubigeo = left(u.ubigeo, 2) AND zd.nivel = 'departamento'
     WHERE mef_norm(e.nombre) ~ '^(MUNICIPALIDAD|GOBIERNO LOCAL|CONCEJO) '
       AND mef_norm(e.nombre) !~ 'CENTRO POBLADO'
       AND NOT (mef_norm(e.nombre) ~ '\mDISTRITAL\M' AND u.xn ~ '\mPROVINCIAL\M')
       AND NOT (mef_norm(e.nombre) ~ '\mPROVINCIAL\M' AND u.xn ~ '\mDISTRITAL\M')
       AND e.ubigeo IS DISTINCT FROM u.ubigeo::char(6)
       AND CASE WHEN nullif(btrim(e.ubigeo), '') IS NOT NULL THEN left(e.ubigeo, 2) = left(u.ubigeo, 2)
                WHEN e.region IS NOT NULL THEN mef_norm(e.region) = mef_norm(zd.nombre)
                ELSE true END
     ORDER BY e.ruc),
  log AS (
    INSERT INTO entidad_ubigeo_correccion (ruc, ubigeo_antes, ubigeo_nuevo, distrito_antes, distrito_nuevo, provincia_antes,
                                           provincia_nuevo, motivo)
    SELECT c.ruc, c.antes, c.nuevo, c.d_antes, c.d_nuevo, c.p_antes, c.p_nuevo,
           'ubigeo de su unidad ejecutora del MEF (CODIGO_SIAF de la OECE)'
      FROM cand c
    RETURNING entidad_ubigeo_correccion.ruc)
  UPDATE entidades e
     SET ubigeo = c.nuevo, distrito = c.d_nuevo, provincia = c.p_nuevo, updated_at = now()
    FROM cand c
   WHERE e.ruc = c.ruc AND EXISTS (SELECT 1 FROM log l WHERE l.ruc = c.ruc)
  RETURNING e.ruc, e.nombre, c.antes, c.nuevo, c.d_nuevo
$$;

-- Las carga vigia_jobs (dueño, como las demás tablas de datasets: 37/46); el script del operador entra como postgres, que
-- es miembro de vigia_jobs. Datos públicos: los leen la API, el panel, el MCP y los agentes (sin escribir).
ALTER TABLE entidad_siaf OWNER TO vigia_jobs;
ALTER TABLE entidad_ubigeo_correccion OWNER TO vigia_jobs;
ALTER FUNCTION corregir_ubigeo_municipal() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION corregir_ubigeo_municipal() FROM PUBLIC;
GRANT SELECT ON entidad_siaf, entidad_ubigeo_correccion TO vigia_api, vigia_api_admin, vigia_mcp;
DO $$
BEGIN
  -- Los privilegios por defecto de la 43 dan a vigia_agentes escritura en toda tabla nueva: aquí sólo lee.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_agentes') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON entidad_siaf, entidad_ubigeo_correccion FROM vigia_agentes;
    REVOKE ALL ON SEQUENCE entidad_ubigeo_correccion_id_seq FROM vigia_agentes;
    REVOKE EXECUTE ON FUNCTION corregir_ubigeo_municipal() FROM vigia_agentes;
    GRANT SELECT ON entidad_siaf, entidad_ubigeo_correccion TO vigia_agentes;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_ab') THEN
    GRANT SELECT ON entidad_siaf, entidad_ubigeo_correccion TO vigia_ab;
  END IF;
END $$;
