-- 160 · Obras públicas (INFOBRAS, Contraloría) e inversiones (Invierte.pe, MEF): sus datos, la entidad que las ejecuta,
--       el contrato que las ejecuta o supervisa, y sus banderas, atadas a ESE contrato.
--
-- Dos datasets abiertos que la app no usaba:
--   · INFOBRAS (Contraloría): «DataSet-Obras-Publicas DD-MM-YYYY», un XLSX diario de 97 columnas (191,180 obras el
--     2026-10-26). La Contraloría no responde fuera del Perú: lo baja y lo carga backend/scripts/cargar_obras.py desde una
--     PC en Lima. Su `codigo Entidad` es el código interno de INFOBRAS, NO un RUC.
--   · Invierte.pe (MEF): DETALLE_INVERSIONES.csv (las 150,359 inversiones activas) y CIERRE_INVERSIONES.csv (120,340
--     cerradas). Sin diccionario publicado (devuelve 404): el sentido de cada columna se lee de los datos y está anotado
--     abajo. NO se usan DIRECTORIO_INVIERTE.csv (correos y teléfonos de funcionarios), PROCESO_SELECCION.csv (pese al
--     nombre, es el avance por componente), ni el texto libre de FORMATO_12B y ESTADO_SITUACIONAL.
--
-- La llave es el CUI (Código Único de Inversión, 7 dígitos), que el contrato también trae: proceso_cui lo guarda por
-- proceso, leído del registro OCDS (planning.budget.projectID) o del texto del proceso («CON CUI N° 2655159», o su código
-- SNIP en los procesos viejos), con la misma regla que backend/api/src/lib/proceso.ts (cuiDeTexto).
--
-- La entidad:
--   · de una inversión, su unidad ejecutora (SEC_EJEC) en el registro de la OECE (entidad_siaf, migración 150);
--   · de una obra, la que la registra en INFOBRAS: su código de entidad se resuelve por el consenso de sus obras con CUI
--     (la entidad de esas inversiones) y, si no hay consenso, por su nombre igual al de una entidad de Vigía o del
--     registro de la OECE en el mismo departamento (refrescar_obras()).
--
-- El contrato de una obra (obra_contrato): el proceso del mismo CUI que ganó la empresa (o un integrante del consorcio)
-- que INFOBRAS registra como ejecutora («RUC (Ejecución)») o supervisora («RUC (Supervisión)»); un consorcio que INFOBRAS
-- registra con su código «C000…» se reconoce por su nombre. Sin CUI en el proceso: el mismo ganador, la misma entidad y el
-- mismo monto del contrato (al 1 %).
--
-- Banderas (indicios, no acusaciones; cada una con su evidencia en `detalle`). Una banda, un tipo con su gravedad (como
-- la migración 121). Los mismos umbrales están en backend/api/src/lib/obras.ts (UMBRAL_OBRA): el test obras.test.ts
-- comprueba que coinciden.
--   De la obra (INFOBRAS), al contrato de ejecución y al de supervisión:
--     obra_paralizada_larga        alta   hoy paralizada hace 180 días o más (al día del archivo)
--     obra_paralizada              media  hoy paralizada, hace menos de 180 días
--     obra_paralizacion            baja   se paralizó y después siguió o terminó
--     obra_atraso_grave            alta   en ejecución o paralizada, avance físico real 40 puntos o más bajo el programado
--     obra_atraso                  media  de 20 a 40 puntos
--     obra_pagado_sin_avance       alta   ejecución financiera 50 puntos o más sobre el avance físico (físico < 95 %)
--     obra_pago_adelantado         media  de 30 a 50 puntos
--     obra_adicionales_sobre_tope  alta   por contrata, adicionales netos de deductivos > 15 % del contrato (el tope sin la
--                                         Contraloría de la Ley de Contrataciones; las demás modalidades no lo tienen)
--     obra_adicionales_altos       media  > 10 % (y hasta 15 % en una obra por contrata)
--     obra_adicionales             baja   con adicionales, hasta 10 %
--     obra_plazo_duplicado         media  las ampliaciones de plazo suman el plazo original o más
--     obra_plazo_ampliado          baja   la mitad del plazo original o más
--     obra_controversia            media  INFOBRAS registra controversias (arbitraje, conciliación)
--     obra_informe_control         baja   la Contraloría emitió informes de control sobre la obra
--   De la inversión (Invierte.pe), a todo contrato de ese CUI en esa entidad:
--     inversion_sobrecosto_extremo alta   costo actualizado 2 veces o más el monto viable (y S/ 100 mil más o más)
--     inversion_sobrecosto         media  de 1.5 a 2 veces
--     inversion_laudo              media  registra un monto de laudo arbitral
-- El control concurrente de la Contraloría NO es una bandera: la ley lo exige a toda inversión grande (se muestra como
-- dato).
--
-- Un dato imposible (avance de 1,700 %, adicionales de 300 veces el contrato) no se borra: se guarda tal como vino, con su
-- motivo en `dudoso`, y no dispara banderas.
--
-- Privacidad: de INFOBRAS no se guardan los nombres del residente ni del supervisor (columnas «Nombres Apellidos»), ni los
-- comentarios, la dirección o el documento de aprobación (texto libre). El ejecutor o el supervisor que es una persona
-- natural (RUC 10) se guarda como viene y la API lo publica como {ruc, nombre}: publicar() le pone la ref y le tapa un
-- apellido; un RUC mal escrito no sale (lib/obras.ts). La búsqueda (`texto`) no lleva nombres de personas naturales.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/160_obras_inversiones.sql  (o dev.sh migrar)
-- Después: python backend/scripts/cargar_obras.py --entorno dev|prod   (carga y corre refrescar_obras())
-- Cada corrida del pipeline de cruces (scrapers-worker, comun.ts) llama a refrescar_cruce_obras(): refrescar_cruces()
-- borra cruces_proveedor entero y esto vuelve a poner las banderas de las obras.
-- Las banderas de los contratos tienen un interruptor (obra_refresco, clave 'cruces'): apagado, refrescar_cruce_obras() no
-- las escribe. Se enciende cuando la API y la web que conocen estos tipos ya están desplegadas:
--   python backend/scripts/cargar_obras.py --entorno prod --sin-infobras --sin-mef --encender-cruces --propagar

SET lock_timeout = '10s';

-- ─── Obras de INFOBRAS ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS obra_infobras (
  codigo              INT PRIMARY KEY,            -- Código INFOBRAS (su ficha: /InfobrasWeb/Mapa/Sumario?ObraId=<codigo>)
  entidad_codigo      TEXT,                       -- «codigo Entidad»: el código de INFOBRAS, no un RUC
  entidad_nombre      TEXT,
  entidad_ruc         CHAR(11),                   -- refrescar_obras()
  entidad_via         TEXT,                       -- cómo se llegó al RUC: 'cui' (consenso de sus inversiones) | 'nombre'
  nombre              TEXT NOT NULL,
  modalidad           TEXT,                       -- Contrata | Administración directa | Por núcleo ejecutor | Obras por impuestos…
  es_saldo            BOOLEAN NOT NULL DEFAULT false,
  obra_inicial        INT,                        -- la obra de la que es saldo
  naturaleza          TEXT,
  tipo1               TEXT,
  tipo2               TEXT,
  tipo3               TEXT,
  estado              TEXT,                       -- Finalizado | En Ejecución | Paralizada | Sin Ejecución
  informes_control    INT NOT NULL DEFAULT 0,
  veedurias           INT NOT NULL DEFAULT 0,
  comentarios_ciudadanos INT NOT NULL DEFAULT 0,
  nivel_gobierno      TEXT,
  sector              TEXT,
  cui                 CHAR(7),
  snip                TEXT,
  inversion_nombre    TEXT,
  monto_viable        NUMERIC(18, 2),
  obras_en_inversion  INT,
  departamento        TEXT,
  provincia           TEXT,
  distrito            TEXT,
  ubigeo              CHAR(6),                    -- de los nombres, contra `zonas` (refrescar_obras())
  fecha_aprob_et      DATE,                       -- aprobación del expediente técnico
  costo_et            NUMERIC(18, 2),             -- costo de obra según el expediente técnico, en soles
  moneda_et           TEXT,
  ejecutor_ruc        TEXT,                       -- tal como lo publica: RUC, código de consorcio «C000…» o nada
  ejecutor_nombre     TEXT,
  contrato_monto      NUMERIC(18, 2),             -- el contrato de ejecución, en soles
  supervisor_ruc      TEXT,
  supervisor_nombre   TEXT,
  supervision_monto   NUMERIC(18, 2),
  supervision_inicio  DATE,
  supervision_fin     DATE,
  fecha_inicio        DATE,
  fecha_fin_prog      DATE,
  plazo_dias          INT,
  entrega_terreno     TEXT,
  terreno_pct         NUMERIC(9, 2),
  fecha_terreno       DATE,
  avance_fecha        DATE,                       -- cuándo registró la entidad su último avance
  avance_anio         SMALLINT,
  avance_mes          SMALLINT,
  fisico_prog         NUMERIC(12, 2),             -- avance físico programado acumulado (%)
  fisico_real         NUMERIC(12, 2),             -- avance físico real acumulado (%)
  valorizado_prog     NUMERIC(18, 2),
  valorizado_real     NUMERIC(18, 2),
  financiero_pct      NUMERIC(14, 2),             -- ejecución financiera (%)
  financiero_monto    NUMERIC(18, 2),
  paralizada          BOOLEAN NOT NULL DEFAULT false,   -- «Existe Paralización» = Si
  causal_paralizacion TEXT,
  fecha_paralizacion  DATE,
  dias_paralizada     INT,
  modificaciones      INT NOT NULL DEFAULT 0,
  dias_ampliacion     INT NOT NULL DEFAULT 0,     -- «N° días de modificaciones de plazo»
  nuevo_plazo         INT,
  fecha_fin_reprog    DATE,
  controversias       INT NOT NULL DEFAULT 0,
  adicionales_n       INT NOT NULL DEFAULT 0,
  adicionales_monto   NUMERIC(18, 2) NOT NULL DEFAULT 0,
  adic_sup_n          INT NOT NULL DEFAULT 0,
  adic_sup_monto      NUMERIC(18, 2) NOT NULL DEFAULT 0,
  deductivos_n        INT NOT NULL DEFAULT 0,
  deductivos_monto    NUMERIC(18, 2) NOT NULL DEFAULT 0,
  deduc_sup_n         INT NOT NULL DEFAULT 0,
  deduc_sup_monto     NUMERIC(18, 2) NOT NULL DEFAULT 0,
  fecha_fin_real      DATE,
  motivo_no_100       TEXT,
  recepcion           BOOLEAN,
  fecha_recepcion     DATE,
  liquidacion         BOOLEAN,
  fecha_liquidacion   DATE,
  costo_liquidacion   NUMERIC(18, 2),
  transferida         BOOLEAN,
  fecha_transferencia DATE,
  receptora           TEXT,
  devengado_desde     SMALLINT,
  devengado_total     NUMERIC(18, 2),
  -- Lo que calcula refrescar_obras():
  banderas            JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{tipo, severidad, …evidencia}]
  severidad           TEXT,                                 -- la más alta de sus banderas
  dudoso              TEXT[] NOT NULL DEFAULT '{}',          -- datos imposibles, tal como vinieron
  texto               TEXT,                                 -- para buscar (sin nombres de personas naturales)
  retirada            BOOLEAN NOT NULL DEFAULT false,        -- ya no vino en el último archivo completo
  huella              TEXT NOT NULL,                         -- md5 de la fila como vino: el upsert sólo reescribe lo que cambió
  dataset_fecha       DATE,                                  -- «Fecha de consulta» del archivo que la trajo
  cargado_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  cambiado_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS obra_infobras_entidad ON obra_infobras (entidad_ruc, fecha_inicio DESC NULLS LAST) WHERE NOT retirada;
CREATE INDEX IF NOT EXISTS obra_infobras_cui ON obra_infobras (cui) WHERE cui IS NOT NULL;
CREATE INDEX IF NOT EXISTS obra_infobras_ejecutor ON obra_infobras (ejecutor_ruc) WHERE ejecutor_ruc IS NOT NULL;
CREATE INDEX IF NOT EXISTS obra_infobras_supervisor ON obra_infobras (supervisor_ruc) WHERE supervisor_ruc IS NOT NULL;
CREATE INDEX IF NOT EXISTS obra_infobras_entidad_codigo ON obra_infobras (entidad_codigo);
COMMENT ON TABLE obra_infobras IS
  'Obras públicas de INFOBRAS (Contraloría), una por Código INFOBRAS. La carga backend/scripts/cargar_obras.py desde una PC en el Perú. Migración 160.';

-- ─── Inversiones de Invierte.pe ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inversion_mef (
  cui                 CHAR(7) PRIMARY KEY,
  origen              TEXT NOT NULL CHECK (origen IN ('activa', 'cerrada')),  -- DETALLE_INVERSIONES | CIERRE_INVERSIONES
  snip                TEXT,
  nombre              TEXT,
  nivel               TEXT,                       -- GN, GR, GL
  sector              TEXT,
  entidad_nombre      TEXT,                       -- ENTIDAD (el pliego o la municipalidad)
  sec_ejec            INT,                        -- la unidad ejecutora presupuestal (SEC_EJEC)
  uei                 TEXT,                       -- NOMBRE_UEI: la unidad ejecutora de inversiones
  uep                 TEXT,                       -- NOMBRE_UEP: la unidad ejecutora presupuestal
  estado              TEXT,                       -- ACTIVO | CERRADO
  situacion           TEXT,                       -- VIABLE | APROBADO | EN FORMULACION…
  monto_viable        NUMERIC(18, 2),
  costo_actualizado   NUMERIC(18, 2),
  control_concurrente NUMERIC(18, 2),             -- CTRL_CONCURR: el monto del control concurrente de la Contraloría
  monto_laudo         NUMERIC(18, 2),             -- MONTO_LAUDO: lo que suman los laudos arbitrales registrados
  monto_fianza        NUMERIC(18, 2),             -- MONTO_FIANZA: las cartas fianza registradas
  fecha_registro      DATE,
  fecha_viabilidad    DATE,
  funcion             TEXT,
  programa            TEXT,
  subprograma         TEXT,
  marco               TEXT,                       -- INVIERTE | SNIP
  tipo_inversion      TEXT,
  modalidad           TEXT,                       -- DES_MODALIDAD
  tipologia           TEXT,
  expediente_tecnico  BOOLEAN,
  informe_cierre      BOOLEAN,
  primer_devengado    INT,                        -- AAAAMM
  ultimo_devengado    INT,
  devengado_acumulado NUMERIC(18, 2),             -- activas: el de años anteriores + el del año; cerradas: DEVEN_ACUMULADO
  devengado_anio      NUMERIC(18, 2),
  pim_anio            NUMERIC(18, 2),
  saldo_ejecutar      NUMERIC(18, 2),
  avance_fisico       NUMERIC(12, 2),
  avance_ejecucion    NUMERIC(12, 2),
  monto_et            NUMERIC(18, 2),             -- MONTO_ET_F8: el del expediente técnico (formato 8)
  departamento        TEXT,
  provincia           TEXT,
  distrito            TEXT,
  ubigeo              CHAR(6),
  lat                 NUMERIC(10, 6),
  lon                 NUMERIC(10, 6),
  inicio_ejecucion    DATE,
  fin_ejecucion       DATE,
  inicio_fisica       DATE,
  fin_fisica          DATE,
  beneficiarios       INT,
  fecha_cierre        DATE,
  liquidacion         NUMERIC(18, 2),             -- TOTAL_LIQUIDACION (cerradas)
  fecha_liquidacion   DATE,
  anio_proceso        SMALLINT,
  entidad_ruc         CHAR(11),                   -- por SEC_EJEC en entidad_siaf (refrescar_obras())
  banderas            JSONB NOT NULL DEFAULT '[]'::jsonb,
  severidad           TEXT,
  dudoso              TEXT[] NOT NULL DEFAULT '{}',
  texto               TEXT,
  retirada            BOOLEAN NOT NULL DEFAULT false,
  huella              TEXT NOT NULL,
  dataset_fecha       DATE,
  cargado_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  cambiado_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inversion_mef_entidad ON inversion_mef (entidad_ruc, costo_actualizado DESC NULLS LAST) WHERE NOT retirada;
CREATE INDEX IF NOT EXISTS inversion_mef_sec_ejec ON inversion_mef (sec_ejec);
CREATE INDEX IF NOT EXISTS inversion_mef_snip ON inversion_mef (snip) WHERE snip IS NOT NULL;
COMMENT ON TABLE inversion_mef IS
  'Inversiones de Invierte.pe (MEF): activas (DETALLE_INVERSIONES.csv) y cerradas (CIERRE_INVERSIONES.csv), una por CUI. La carga backend/scripts/cargar_obras.py. Migración 160.';

-- ─── El CUI de cada proceso ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS proceso_cui (
  ocid    TEXT NOT NULL,
  codigo  TEXT NOT NULL,                          -- el número tal como se leyó
  clase   TEXT NOT NULL CHECK (clase IN ('cui', 'snip')),
  origen  TEXT NOT NULL CHECK (origen IN ('ocds', 'texto')),   -- planning.budget.projectID | objeto, descripción o ítems
  PRIMARY KEY (ocid, clase, codigo)
);
CREATE INDEX IF NOT EXISTS proceso_cui_codigo ON proceso_cui (clase, codigo);

-- El CUI de cada contrato ya resuelto (el SNIP llevado a su CUI) y confirmado contra la entidad que contrata
-- (refrescar_cruce_obras()): lo que usan la ficha del contrato, la lista de inversiones y las banderas de la inversión.
CREATE TABLE IF NOT EXISTS contrato_cui (
  ocid    TEXT NOT NULL,
  cui     CHAR(7) NOT NULL,
  origen  TEXT NOT NULL CHECK (origen IN ('ocds', 'texto', 'snip')),
  PRIMARY KEY (ocid, cui)
);
CREATE INDEX IF NOT EXISTS contrato_cui_cui ON contrato_cui (cui);

-- Hasta qué `updated_at` de convocatorias ya se leyó el CUI (para leer sólo lo nuevo en cada corrida del pipeline).
CREATE TABLE IF NOT EXISTS obra_refresco (
  clave  TEXT PRIMARY KEY,
  valor  TIMESTAMPTZ,
  nota   TEXT
);

-- ─── El contrato de cada obra ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS obra_contrato (
  codigo  INT NOT NULL,                           -- la obra (obra_infobras)
  ocid    TEXT NOT NULL,                          -- el proceso (convocatorias)
  rol     TEXT NOT NULL CHECK (rol IN ('ejecucion', 'supervision')),
  via     TEXT NOT NULL,                          -- 'cui_ruc' | 'cui_consorcio' | 'ruc_monto'
  ruc     TEXT,                                   -- el ganador con que calzó (o el código del consorcio)
  PRIMARY KEY (codigo, ocid, rol)
);
CREATE INDEX IF NOT EXISTS obra_contrato_ocid ON obra_contrato (ocid);

-- ─── Funciones ───────────────────────────────────────────────────────────────

-- Mayúsculas, sin tildes y sin signos: para comparar nombres de lugares y entidades.
CREATE OR REPLACE FUNCTION obra_norm(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(btrim(regexp_replace(upper(immutable_unaccent(COALESCE(t, ''))), '[^A-Z0-9]+', ' ', 'g')), '')
$$;

/*
 * Los CUI escritos en un texto: «CON CUI Nº 2655159», «C.U.I. 2233862», «Código Único de Inversión N° 2233862». La misma
 * regla que cuiDeTexto (backend/api/src/lib/proceso.ts): el prefijo y, a menos de 15 caracteres sin dígitos, 7 dígitos
 * que no siguen. El SEACE escribe a veces «¿» por una vocal con tilde: el «.» la cubre.
 */
CREATE OR REPLACE FUNCTION cuis_de_texto(t TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN t IS NULL OR t = '' THEN '{}'::text[] ELSE ARRAY(
    SELECT DISTINCT m[1] FROM regexp_matches(upper(immutable_unaccent(t)),
      '(?:\mC\.?\s?U\.?\s?I\M\.?|C.DIGO\s+.NICO\s+DE\s+INVERSI.N)[^0-9]{0,14}([0-9]{7})(?![0-9])', 'g') m) END
$$;

-- Los códigos SNIP escritos en un texto («CÓDIGO SNIP N° 123456»): los procesos de antes de 2017 citan el SNIP, no el CUI.
CREATE OR REPLACE FUNCTION snips_de_texto(t TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN t IS NULL OR t = '' THEN '{}'::text[] ELSE ARRAY(
    SELECT DISTINCT ltrim(m[1], '0') FROM regexp_matches(upper(immutable_unaccent(t)),
      '\mSNIP\M[^0-9]{0,14}([0-9]{4,7})(?![0-9])', 'g') m) END
$$;

/*
 * El CUI (y el SNIP) de los procesos: del registro OCDS (planning.budget.projectID) o del texto (objeto, descripción y
 * descripción de cada ítem). `p_anio`: los convocados ese año (0 = sin fecha); sin él, los que cambiaron desde la última
 * vez (updated_at, marca en obra_refresco; una hora de solape para lo que se confirmó tarde) y se mueve la marca. Rehace
 * las filas de esos procesos (una sola pasada por convocatorias: ~13 s en prod). Devuelve cuántas filas escribió.
 */
CREATE OR REPLACE FUNCTION refrescar_proceso_cui(p_anio INT DEFAULT NULL) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  v_desde TIMESTAMPTZ;
  v_hasta TIMESTAMPTZ := now();
  n INT;
BEGIN
  IF p_anio IS NULL THEN
    SELECT valor INTO v_desde FROM obra_refresco WHERE clave = 'proceso_cui';
    v_desde := COALESCE(v_desde, '-infinity'::timestamptz);
  END IF;
  -- Los procesos que se leen ahora, con su texto (una sola vez).
  DROP TABLE IF EXISTS _pcv;
  CREATE TEMP TABLE _pcv ON COMMIT DROP AS
    SELECT c.ocid, concat_ws(' ', c.objeto, c.ocds_payload->'tender'->>'description',
             (SELECT string_agg(it->>'description', ' ') FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(c.ocds_payload->'tender'->'items') = 'array' THEN c.ocds_payload->'tender'->'items' ELSE '[]'::jsonb END) it)) AS texto,
           btrim(c.ocds_payload->'planning'->'budget'->>'projectID') AS project
      FROM convocatorias c
     WHERE c.ocid NOT LIKE 'ocds-vigia-%'
       AND CASE WHEN p_anio IS NULL THEN c.updated_at >= v_desde AND c.updated_at < v_hasta
                WHEN p_anio = 0 THEN c.fecha_convocatoria IS NULL
                ELSE c.fecha_convocatoria >= make_date(p_anio, 1, 1) AND c.fecha_convocatoria < make_date(p_anio + 1, 1, 1) END;
  DROP TABLE IF EXISTS _pc;
  CREATE TEMP TABLE _pc ON COMMIT DROP AS
    SELECT v.ocid, v.project AS codigo, 'cui'::text AS clase, 'ocds'::text AS origen FROM _pcv v WHERE v.project ~ '^[0-9]{7}$'
    UNION
    SELECT v.ocid, x, 'cui', 'texto' FROM _pcv v, unnest(cuis_de_texto(v.texto)) x
    UNION
    SELECT v.ocid, x, 'snip', 'texto' FROM _pcv v, unnest(snips_de_texto(v.texto)) x WHERE x <> '';
  -- Lo del registro OCDS gana: el mismo CUI leído también del texto queda como 'ocds'.
  DELETE FROM _pc t WHERE t.origen = 'texto' AND t.clase = 'cui'
     AND EXISTS (SELECT 1 FROM _pc o WHERE o.ocid = t.ocid AND o.codigo = t.codigo AND o.clase = 'cui' AND o.origen = 'ocds');
  DELETE FROM proceso_cui p USING _pcv v WHERE v.ocid = p.ocid;
  INSERT INTO proceso_cui (ocid, codigo, clase, origen) SELECT DISTINCT ON (ocid, clase, codigo) ocid, codigo, clase, origen FROM _pc
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF p_anio IS NULL THEN
    INSERT INTO obra_refresco (clave, valor, nota) VALUES ('proceso_cui', v_hasta - interval '1 hour', 'updated_at de convocatorias ya leído')
    ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;
  END IF;
  RETURN n;
END $$;

/*
 * Las banderas de una obra (lista de la cabecera), cada una con su evidencia. La paralización se cuenta al día del último
 * archivo de INFOBRAS (`p_al`): los días que dice INFOBRAS o, si es más, desde la fecha de paralización. Un dato imposible
 * no dispara nada (va en `dudoso`).
 */
DROP FUNCTION IF EXISTS obra_banderas(obra_infobras);
CREATE OR REPLACE FUNCTION obra_banderas(o obra_infobras, p_al DATE) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH v AS (
    SELECT CASE WHEN o.estado = 'Paralizada'
                THEN greatest(COALESCE(o.dias_paralizada, 0), COALESCE(p_al - o.fecha_paralizacion, 0)) END AS dias_hoy,
           CASE WHEN o.estado IN ('En Ejecución', 'Paralizada') AND o.fisico_prog BETWEEN 0 AND 100.5 AND o.fisico_real BETWEEN 0 AND 100.5
                THEN o.fisico_prog - o.fisico_real END AS atraso,
           CASE WHEN o.fisico_real >= 0 AND o.fisico_real < 95 AND o.financiero_pct BETWEEN 0 AND 200
                THEN o.financiero_pct - o.fisico_real END AS adelanto,
           CASE WHEN o.contrato_monto > 0 THEN o.contrato_monto WHEN o.costo_et > 0 THEN o.costo_et END AS base,
           CASE WHEN o.contrato_monto > 0 THEN 'contrato' WHEN o.costo_et > 0 THEN 'expediente' END AS base_de
  ), b AS (
    -- Paralización: hoy (por cuánto tiempo) o en el pasado.
    SELECT CASE WHEN o.estado = 'Paralizada' AND v.dias_hoy >= 180 THEN 'obra_paralizada_larga'
                WHEN o.estado = 'Paralizada' THEN 'obra_paralizada' ELSE 'obra_paralizacion' END AS tipo,
           CASE WHEN o.estado = 'Paralizada' AND v.dias_hoy >= 180 THEN 'alta' WHEN o.estado = 'Paralizada' THEN 'media' ELSE 'baja' END AS severidad,
           jsonb_build_object('dias', CASE WHEN o.estado = 'Paralizada' THEN v.dias_hoy ELSE o.dias_paralizada END,
                              'dias_infobras', o.dias_paralizada, 'desde', o.fecha_paralizacion, 'causal', o.causal_paralizacion,
                              'estado', o.estado, 'al', p_al) AS d
      FROM v WHERE (o.paralizada OR o.estado = 'Paralizada') AND NOT ('fecha_imposible' = ANY(o.dudoso))
    UNION ALL
    SELECT CASE WHEN v.atraso >= 40 THEN 'obra_atraso_grave' ELSE 'obra_atraso' END,
           CASE WHEN v.atraso >= 40 THEN 'alta' ELSE 'media' END,
           jsonb_build_object('programado', o.fisico_prog, 'real', o.fisico_real, 'puntos', round(v.atraso, 1), 'al', o.avance_fecha,
                              'estado', o.estado)
      FROM v WHERE v.atraso >= 20
    UNION ALL
    SELECT CASE WHEN v.adelanto >= 50 THEN 'obra_pagado_sin_avance' ELSE 'obra_pago_adelantado' END,
           CASE WHEN v.adelanto >= 50 THEN 'alta' ELSE 'media' END,
           jsonb_build_object('financiero', o.financiero_pct, 'fisico', o.fisico_real, 'puntos', round(v.adelanto, 1),
                              'pagado', o.financiero_monto, 'al', o.avance_fecha, 'estado', o.estado)
      FROM v WHERE v.adelanto >= 30
    UNION ALL
    -- Adicionales: netos de deductivos (la ley cuenta el 15 % «restando los deductivos vinculados»), sobre el contrato o,
    -- en una obra sin contrato (administración directa), sobre el expediente técnico. El tope del 15 % es de la Ley de
    -- Contrataciones: sólo una obra por contrata lo «pasa»; en otra modalidad, más del 10 % es «altos».
    SELECT CASE WHEN v.base > 0 AND o.adicionales_monto - o.deductivos_monto > 0.15 * v.base AND o.modalidad = 'Contrata'
                THEN 'obra_adicionales_sobre_tope'
                WHEN v.base > 0 AND o.adicionales_monto - o.deductivos_monto > 0.10 * v.base THEN 'obra_adicionales_altos'
                ELSE 'obra_adicionales' END,
           CASE WHEN v.base > 0 AND o.adicionales_monto - o.deductivos_monto > 0.15 * v.base AND o.modalidad = 'Contrata' THEN 'alta'
                WHEN v.base > 0 AND o.adicionales_monto - o.deductivos_monto > 0.10 * v.base THEN 'media' ELSE 'baja' END,
           jsonb_build_object('n', o.adicionales_n, 'monto', o.adicionales_monto, 'deductivos', o.deductivos_monto,
                              'deductivos_n', o.deductivos_n, 'base', v.base, 'base_de', v.base_de,
                              'porcentaje', CASE WHEN v.base > 0 THEN round(100 * o.adicionales_monto / v.base, 1) END,
                              'neto', CASE WHEN v.base > 0 THEN round(100 * (o.adicionales_monto - o.deductivos_monto) / v.base, 1) END)
      FROM v WHERE o.adicionales_monto > 0 AND NOT ('adicionales_imposibles' = ANY(o.dudoso))
    UNION ALL
    SELECT CASE WHEN o.dias_ampliacion >= o.plazo_dias THEN 'obra_plazo_duplicado' ELSE 'obra_plazo_ampliado' END,
           CASE WHEN o.dias_ampliacion >= o.plazo_dias THEN 'media' ELSE 'baja' END,
           jsonb_build_object('plazo', o.plazo_dias, 'ampliacion', o.dias_ampliacion, 'modificaciones', o.modificaciones,
                              'porcentaje', round(100.0 * o.dias_ampliacion / o.plazo_dias), 'fin_programado', o.fecha_fin_prog,
                              'fin_reprogramado', o.fecha_fin_reprog)
      FROM v WHERE o.plazo_dias > 0 AND o.dias_ampliacion >= 0.5 * o.plazo_dias AND NOT ('plazo_imposible' = ANY(o.dudoso))
    UNION ALL
    SELECT 'obra_controversia', 'media', jsonb_build_object('n', o.controversias) FROM v WHERE o.controversias > 0
    UNION ALL
    SELECT 'obra_informe_control', 'baja', jsonb_build_object('n', o.informes_control) FROM v WHERE o.informes_control > 0
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('tipo', b.tipo, 'severidad', b.severidad) || b.d
                            ORDER BY CASE b.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, b.tipo), '[]'::jsonb)
    FROM b
$$;

-- Los datos imposibles de una obra: se guardan tal como vinieron y no disparan banderas.
CREATE OR REPLACE FUNCTION obra_dudoso(o obra_infobras) RETURNS TEXT[]
LANGUAGE sql STABLE AS $$
  SELECT ARRAY(SELECT x FROM unnest(ARRAY[
    CASE WHEN o.fisico_real > 100.5 OR o.fisico_prog > 100.5 OR o.fisico_real < 0 OR o.fisico_prog < 0 THEN 'avance_imposible' END,
    CASE WHEN o.financiero_pct > 300 OR o.financiero_pct < 0 THEN 'financiero_imposible' END,
    CASE WHEN o.adicionales_monto > 3 * greatest(COALESCE(o.contrato_monto, 0), COALESCE(o.costo_et, 0)) AND o.adicionales_monto > 0
         THEN 'adicionales_imposibles' END,
    CASE WHEN o.plazo_dias > 0 AND o.dias_ampliacion > 20 * o.plazo_dias THEN 'plazo_imposible' END,
    CASE WHEN o.fecha_paralizacion > o.dataset_fecha OR o.fecha_inicio > o.dataset_fecha + 366
           OR o.dias_paralizada > 20000 THEN 'fecha_imposible' END
  ]) x WHERE x IS NOT NULL)
$$;

/*
 * Las banderas de una inversión. Sobrecosto: el costo actualizado frente al monto con que se declaró viable, sólo si la
 * diferencia pasa S/ 100 mil (en una inversión de S/ 20 mil, triplicar no dice mucho). El laudo, si registra un monto.
 */
CREATE OR REPLACE FUNCTION inversion_banderas(i inversion_mef) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH b AS (
    SELECT CASE WHEN i.costo_actualizado >= 2 * i.monto_viable THEN 'inversion_sobrecosto_extremo' ELSE 'inversion_sobrecosto' END AS tipo,
           CASE WHEN i.costo_actualizado >= 2 * i.monto_viable THEN 'alta' ELSE 'media' END AS severidad,
           jsonb_build_object('viable', i.monto_viable, 'actualizado', i.costo_actualizado,
                              'veces', round(i.costo_actualizado / i.monto_viable, 2),
                              'diferencia', i.costo_actualizado - i.monto_viable, 'viabilidad', i.fecha_viabilidad) AS d
     WHERE i.monto_viable > 0 AND i.costo_actualizado >= 1.5 * i.monto_viable AND i.costo_actualizado - i.monto_viable >= 100000
       AND NOT ('costo_imposible' = ANY(i.dudoso))
    UNION ALL
    SELECT 'inversion_laudo', 'media', jsonb_build_object('monto', i.monto_laudo, 'actualizado', i.costo_actualizado)
     WHERE i.monto_laudo > 0
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('tipo', b.tipo, 'severidad', b.severidad) || b.d
                            ORDER BY CASE b.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, b.tipo), '[]'::jsonb)
    FROM b
$$;

CREATE OR REPLACE FUNCTION inversion_dudoso(i inversion_mef) RETURNS TEXT[]
LANGUAGE sql STABLE AS $$
  SELECT ARRAY(SELECT x FROM unnest(ARRAY[
    CASE WHEN i.monto_viable > 0 AND i.costo_actualizado > 1000 * i.monto_viable THEN 'costo_imposible' END,
    CASE WHEN i.avance_fisico > 100.5 OR i.avance_fisico < 0 THEN 'avance_imposible' END
  ]) x WHERE x IS NOT NULL)
$$;

-- (Una versión anterior de esta migración tenía obra_ganadores(text[]): un = ANY de 130 mil ocids no se indexaba.)
DROP FUNCTION IF EXISTS obra_ganadores(TEXT[]);

/*
 * Lo que une obras y contratos: el CUI de los procesos nuevos (refrescar_proceso_cui), el CUI confirmado de cada contrato
 * (contrato_cui) y la obra que ejecuta o supervisa cada contrato (obra_contrato). Deja, para la misma transacción, los
 * ganadores de cada contrato (_og) y los CUI confirmados (_occ), que usa refrescar_cruce_obras(). Devuelve cuántas obras
 * quedaron con su contrato.
 *
 * Un CUI cuenta para un contrato si viene del registro OCDS, o si la inversión (por su unidad ejecutora) o una obra de
 * INFOBRAS con ese CUI son de la MISMA entidad que contrata: un CUI leído del texto que es de otra entidad puede ser un
 * error de digitación.
 */
-- (Una versión anterior tenía refrescar_cruce_obras(p_cruces boolean): el pipeline la llama sin argumentos.)
DROP FUNCTION IF EXISTS refrescar_cruce_obras(BOOLEAN);
CREATE OR REPLACE FUNCTION refrescar_obra_contratos() RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE n INT; t0 TIMESTAMPTZ := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_obra_contratos'));
  SET LOCAL work_mem = '128MB';
  PERFORM refrescar_proceso_cui();
  RAISE NOTICE 'obras: CUI de los procesos nuevos (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- El CUI de cada proceso, con el SNIP resuelto a su CUI y confirmado contra la entidad que contrata.
  DROP TABLE IF EXISTS _occ;
  CREATE TEMP TABLE _occ ON COMMIT DROP AS
    WITH p AS (
      SELECT p.ocid, p.codigo AS cui, p.origen FROM proceso_cui p WHERE p.clase = 'cui'
      UNION
      SELECT p.ocid, i.cui, 'snip' FROM proceso_cui p JOIN inversion_mef i ON i.snip = p.codigo AND NOT i.retirada WHERE p.clase = 'snip'
      UNION
      SELECT p.ocid, o.cui, 'snip' FROM proceso_cui p JOIN obra_infobras o ON o.snip = p.codigo AND o.cui IS NOT NULL AND NOT o.retirada
       WHERE p.clase = 'snip'
    )
    SELECT DISTINCT ON (p.ocid, p.cui) p.ocid, p.cui::char(7) AS cui, p.origen, c.entidad_ruc::text AS entidad_ruc
      FROM p JOIN convocatorias c ON c.ocid = p.ocid
     WHERE p.origen = 'ocds'
        OR EXISTS (SELECT 1 FROM inversion_mef i WHERE i.cui = p.cui AND i.entidad_ruc = c.entidad_ruc)
        OR EXISTS (SELECT 1 FROM obra_infobras o WHERE o.cui = p.cui AND o.entidad_ruc = c.entidad_ruc AND NOT o.retirada)
     ORDER BY p.ocid, p.cui, (p.origen = 'ocds') DESC;
  CREATE INDEX ON _occ (cui);
  ANALYZE _occ;
  DELETE FROM contrato_cui;
  INSERT INTO contrato_cui (ocid, cui, origen) SELECT ocid, cui, origen FROM _occ;
  ANALYZE contrato_cui;

  -- Ganadores de los procesos de obras y de consultoría (los candidatos a ejecución o supervisión de una obra) y de los
  -- que tienen un CUI (para las banderas de la inversión, de cualquier tipo de proceso).
  -- Los ganadores como en refrescar_casos_cruce_base() (migración 115): los suppliers del OCDS y, si el ganador es un
  -- consorcio con código del SEACE, sus integrantes con RUC (conosce_consorcios), con el código y el nombre del consorcio.
  -- Los suppliers (_ogs) y los integrantes (_ogm) se materializan ANTES de unirlos, como en refrescar_cruces() (migración
  -- 56): en una sola consulta el planificador recorría los integrantes una vez por convocatoria y tardaba horas. El
  -- OFFSET 0 lee las adjudicaciones de cada convocatoria una sola vez (si no, descomprime el registro OCDS dos veces).
  DROP TABLE IF EXISTS _ogo;
  CREATE TEMP TABLE _ogo ON COMMIT DROP AS
    SELECT c.ocid FROM convocatorias c WHERE c.tipo_contratacion IN ('obras', 'consultoria') AND c.ocid NOT LIKE 'ocds-vigia-%'
    UNION SELECT k.ocid FROM _occ k;
  ALTER TABLE _ogo ADD PRIMARY KEY (ocid);
  ANALYZE _ogo;
  DROP TABLE IF EXISTS _ogs;
  CREATE TEMP TABLE _ogs ON COMMIT DROP AS
    SELECT c.ocid, regexp_replace(s->>'id', '^PE-RUC-', '') AS sup, s->>'name' AS nombre,
           (aw->'value'->>'amount')::numeric AS monto, NULLIF(aw->>'date', '')::date AS f, c.entidad_ruc::text AS entidad_ruc,
           c.tipo_contratacion, c.fecha_convocatoria
      FROM _ogo x
      JOIN convocatorias c ON c.ocid = x.ocid
      CROSS JOIN LATERAL (SELECT COALESCE(c.ocds_payload->'awards', c.adjudicaciones) AS a OFFSET 0) j
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(j.a) = 'array' THEN j.a ELSE '[]'::jsonb END) aw
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(aw->'suppliers') = 'array' THEN aw->'suppliers' ELSE '[]'::jsonb END) s;
  DROP TABLE IF EXISTS _ogm;
  CREATE TEMP TABLE _ogm ON COMMIT DROP AS
    SELECT DISTINCT ON (ruc_consorcio, ruc_miembro) ruc_consorcio, ruc_miembro, miembro
      FROM conosce_consorcios WHERE ruc_miembro ~ '^(10|20)\d{9}$' ORDER BY ruc_consorcio, ruc_miembro, anio DESC;
  CREATE INDEX ON _ogm (ruc_consorcio);
  ANALYZE _ogs;
  ANALYZE _ogm;
  DROP TABLE IF EXISTS _og;
  CREATE TEMP TABLE _og ON COMMIT DROP AS
    SELECT x.ocid, COALESCE(m.ruc_miembro, x.sup) AS ruc, max(COALESCE(m.miembro, x.nombre)) AS nombre,
           max(CASE WHEN m.ruc_miembro IS NOT NULL OR x.sup !~ '^(10|20)\d{9}$' THEN x.sup END) AS consorcio_codigo,
           max(CASE WHEN m.ruc_miembro IS NOT NULL OR x.sup !~ '^(10|20)\d{9}$' THEN x.nombre END) AS consorcio,
           max(x.monto) AS monto, max(x.f) AS f, max(x.entidad_ruc) AS entidad_ruc, max(x.tipo_contratacion) AS tipo_contratacion,
           max(x.fecha_convocatoria) AS fecha_convocatoria
      FROM _ogs x LEFT JOIN _ogm m ON m.ruc_consorcio = x.sup AND x.sup !~ '^(10|20)\d{9}$'
     GROUP BY 1, 2;
  CREATE INDEX ON _og (ocid);
  CREATE INDEX ON _og (ruc);
  ANALYZE _og;
  RAISE NOTICE 'obras: ganadores (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  DELETE FROM obra_contrato;
  -- 1. Mismo CUI y el ganador es quien INFOBRAS registra como ejecutor (en un proceso de obras) o como supervisor (en una
  --    consultoría: la supervisión de obra se contrata como consultoría de obra).
  INSERT INTO obra_contrato (codigo, ocid, rol, via, ruc)
  SELECT DISTINCT o.codigo, g.ocid, r.rol, 'cui_ruc', g.ruc
    FROM obra_infobras o
    JOIN _occ k ON k.cui = o.cui
    JOIN _og g ON g.ocid = k.ocid
    CROSS JOIN LATERAL (VALUES ('ejecucion', o.ejecutor_ruc, 'obras'), ('supervision', o.supervisor_ruc, 'consultoria')) r(rol, ruc, tipo)
   WHERE NOT o.retirada AND r.ruc ~ '^(10|20)\d{9}$' AND g.ruc = r.ruc AND g.tipo_contratacion = r.tipo
  ON CONFLICT DO NOTHING;
  -- 2. Mismo CUI, la obra la ejecuta un consorcio sin RUC (INFOBRAS le pone «C000…» o nada) y el ganador del proceso de
  --    obras es un consorcio de nombre casi igual.
  INSERT INTO obra_contrato (codigo, ocid, rol, via, ruc)
  SELECT DISTINCT ON (o.codigo, g.ocid) o.codigo, g.ocid, 'ejecucion', 'cui_consorcio', g.consorcio_codigo
    FROM obra_infobras o
    JOIN _occ k ON k.cui = o.cui
    JOIN _og g ON g.ocid = k.ocid AND g.tipo_contratacion = 'obras' AND g.consorcio IS NOT NULL
   WHERE NOT o.retirada AND COALESCE(o.ejecutor_ruc, '') !~ '^(10|20)\d{9}$' AND o.ejecutor_nombre ILIKE 'CONSORCIO%'
     AND similarity(obra_norm(o.ejecutor_nombre), obra_norm(g.consorcio)) >= 0.6
     AND NOT EXISTS (SELECT 1 FROM obra_contrato x WHERE x.codigo = o.codigo AND x.rol = 'ejecucion')
   ORDER BY o.codigo, g.ocid
  ON CONFLICT DO NOTHING;
  -- 3. Sin CUI en el proceso: el mismo ganador, la misma entidad, un proceso de obras y el mismo monto del contrato (al 1 %),
  --    convocado antes de empezar la obra (hasta 2 años antes). Sólo si el par es único en los dos sentidos.
  INSERT INTO obra_contrato (codigo, ocid, rol, via, ruc)
  WITH cand AS (
    SELECT DISTINCT o.codigo, g.ocid, g.ruc
      FROM obra_infobras o
      JOIN _og g ON g.ruc = o.ejecutor_ruc AND g.entidad_ruc = o.entidad_ruc AND g.tipo_contratacion = 'obras'
     WHERE NOT o.retirada AND o.ejecutor_ruc ~ '^(10|20)\d{9}$' AND o.contrato_monto > 0 AND g.monto > 0
       AND abs(g.monto - o.contrato_monto) <= 0.01 * o.contrato_monto
       AND (o.fecha_inicio IS NULL OR g.fecha_convocatoria IS NULL
            OR (g.fecha_convocatoria <= o.fecha_inicio AND g.fecha_convocatoria >= o.fecha_inicio - 730))
       AND NOT EXISTS (SELECT 1 FROM obra_contrato x WHERE x.codigo = o.codigo AND x.rol = 'ejecucion')
  ), unico AS (
    SELECT c.*, count(*) OVER (PARTITION BY c.codigo) AS por_obra, count(*) OVER (PARTITION BY c.ocid) AS por_contrato FROM cand c
  )
  SELECT u.codigo, u.ocid, 'ejecucion', 'ruc_monto', u.ruc FROM unico u WHERE u.por_obra = 1 AND u.por_contrato = 1
  ON CONFLICT DO NOTHING;
  ANALYZE obra_contrato;
  RAISE NOTICE 'obras: obra ↔ contrato (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  SELECT count(DISTINCT codigo) INTO n FROM obra_contrato;
  RETURN n;
END $$;

/*
 * Las banderas de las obras y de las inversiones en cruces_proveedor, atadas a cada ganador de ESE contrato (como los
 * demás cruces del contrato: casos_cruce las cuenta en la lista «Antecedentes» y la ficha las muestra con su evidencia).
 * Primero refrescar_obra_contratos(). La llama el pipeline de cruces (scrapers-worker, comun.ts) después de
 * refrescar_cruces(), que borra cruces_proveedor entero, y refrescar_obras() después de cada carga. Devuelve cuántas
 * filas quedaron.
 *
 * Con un interruptor: sin la fila 'cruces' en obra_refresco no escribe banderas (y borra las que haya). Así las tablas se
 * pueden cargar en producción antes de que la API y la web que conocen estos tipos estén desplegadas (la ficha de un
 * contrato de hoy mostraría el nombre interno del tipo). Se enciende con backend/scripts/cargar_obras.py --encender-cruces
 * (o INSERT INTO obra_refresco (clave, valor) VALUES ('cruces', now())).
 */
CREATE OR REPLACE FUNCTION refrescar_cruce_obras() RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE n INT; t0 TIMESTAMPTZ := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_cruce_obras'));
  PERFORM refrescar_obra_contratos();
  IF NOT EXISTS (SELECT 1 FROM obra_refresco WHERE clave = 'cruces' AND valor IS NOT NULL) THEN
    DELETE FROM cruces_proveedor WHERE tipo LIKE 'obra\_%' OR tipo LIKE 'inversion\_%';
    RAISE NOTICE 'obras: las banderas de los contratos están apagadas (obra_refresco, clave cruces)';
    RETURN 0;
  END IF;
  -- Las banderas, en cruces_proveedor: una fila por bandera y por ganador del contrato (los integrantes de un consorcio,
  -- cada uno, como en casos_cruce).
  DELETE FROM cruces_proveedor WHERE tipo LIKE 'obra\_%' OR tipo LIKE 'inversion\_%';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT b->>'tipo', g.ruc, oc.ocid, b->>'severidad',
         COALESCE(NULLIF(b->>'desde', '')::date, NULLIF(b->>'al', '')::date, o.dataset_fecha),
         CASE WHEN b->>'tipo' LIKE 'obra\_adicionales%' THEN NULLIF(b->>'monto', '')::numeric ELSE o.contrato_monto END,
         (b - 'tipo' - 'severidad') || jsonb_build_object('obra', o.codigo, 'rol', oc.rol, 'via', oc.via, 'nombre_obra', left(o.nombre, 160),
                                                          'estado_obra', o.estado, 'cui', o.cui, 'contrato_infobras', o.contrato_monto),
         'infobras', 'https://infobras.contraloria.gob.pe/InfobrasWeb/Mapa/Sumario?ObraId=' || o.codigo
    FROM obra_contrato oc
    JOIN obra_infobras o ON o.codigo = oc.codigo
    JOIN _og g ON g.ocid = oc.ocid
    CROSS JOIN LATERAL jsonb_array_elements(o.banderas) b
   WHERE g.ruc ~ '^(10|20)\d{9}$';
  -- Las de la inversión: a cada ganador de un proceso de obras o de consultoría (la obra, su supervisión, su expediente
  -- técnico) con ese CUI, confirmado en esa entidad. Una compra de bienes del mismo proyecto muestra la inversión en su
  -- ficha (contrato_cui), sin la bandera: lo que encarece una inversión es el expediente, la obra y sus adicionales.
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT b->>'tipo', g.ruc, k.ocid, b->>'severidad', i.fecha_viabilidad,
         CASE WHEN b->>'tipo' = 'inversion_laudo' THEN i.monto_laudo ELSE i.costo_actualizado END,
         (b - 'tipo' - 'severidad') || jsonb_build_object('cui', i.cui, 'nombre_inversion', left(i.nombre, 160), 'estado_inversion', i.estado,
                                                          'origen_cui', k.origen),
         'invierte_pe', 'https://ofi5.mef.gob.pe/ssi/Ssi/Index?codigo=' || i.cui || '&tipo=2'
    FROM _occ k
    JOIN inversion_mef i ON i.cui = k.cui AND NOT i.retirada AND i.banderas <> '[]'::jsonb
    JOIN _og g ON g.ocid = k.ocid AND g.tipo_contratacion IN ('obras', 'consultoria')
    CROSS JOIN LATERAL jsonb_array_elements(i.banderas) b
   WHERE g.ruc ~ '^(10|20)\d{9}$';
  SELECT count(*) INTO n FROM cruces_proveedor WHERE tipo LIKE 'obra\_%' OR tipo LIKE 'inversion\_%';
  RAISE NOTICE 'obras: % cruces (% s)', n, round(extract(epoch FROM clock_timestamp() - t0));
  RETURN n;
END $$;

/*
 * Después de cargar las obras y las inversiones (backend/scripts/cargar_obras.py): la entidad de cada inversión (por su
 * unidad ejecutora) y de cada obra (el consenso de sus inversiones o su nombre), el ubigeo de cada obra, los datos
 * imposibles, las banderas y el texto de búsqueda; al final, refrescar_cruce_obras(). Sólo reescribe las filas que
 * cambian. Devuelve un resumen (jsonb) de la cobertura. `p_cruces`: el de refrescar_cruce_obras().
 */
DROP FUNCTION IF EXISTS refrescar_obras();
CREATE OR REPLACE FUNCTION refrescar_obras(p_cruces BOOLEAN DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  r jsonb := '{}'::jsonb;
  n INT;
  t0 TIMESTAMPTZ := clock_timestamp();
  -- El día del último archivo de INFOBRAS (lo deja el script de carga); sin él, el más nuevo que trajo alguna obra.
  v_al DATE := COALESCE((SELECT (valor AT TIME ZONE 'America/Lima')::date FROM obra_refresco WHERE clave = 'infobras_fecha'),
                        (SELECT max(dataset_fecha) FROM obra_infobras), current_date);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_obras'));
  SET LOCAL work_mem = '128MB';

  -- 1. La entidad de cada inversión: su SEC_EJEC en el registro de la OECE (una sola entidad con ese código).
  WITH s AS (SELECT sec_ejec, min(ruc) AS ruc FROM entidad_siaf
              WHERE sec_ejec IS NOT NULL AND NOT es_pliego AND NOT fuera_siaf GROUP BY sec_ejec HAVING count(*) = 1),
  nuevo AS (SELECT i.cui, s.ruc FROM inversion_mef i LEFT JOIN s ON s.sec_ejec = i.sec_ejec)
  UPDATE inversion_mef i SET entidad_ruc = nu.ruc FROM nuevo nu WHERE nu.cui = i.cui AND i.entidad_ruc IS DISTINCT FROM nu.ruc;
  RAISE NOTICE 'obras: entidad de las inversiones (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- 2. La entidad de cada obra. Primero, el consenso de las obras de cada código de entidad de INFOBRAS con un CUI de
  --    Invierte.pe: la entidad de la mayoría (60 % o más, y al menos 2 obras, o la única con CUI si su nombre se parece).
  DROP TABLE IF EXISTS _ov;
  CREATE TEMP TABLE _ov ON COMMIT DROP AS
    SELECT o.entidad_codigo, i.entidad_ruc AS ruc, count(*)::int AS votos
      FROM obra_infobras o JOIN inversion_mef i ON i.cui = o.cui
     WHERE o.entidad_codigo IS NOT NULL AND i.entidad_ruc IS NOT NULL AND NOT o.retirada
     GROUP BY 1, 2;
  DROP TABLE IF EXISTS _oe;
  CREATE TEMP TABLE _oe ON COMMIT DROP AS
    SELECT DISTINCT ON (x.entidad_codigo) x.entidad_codigo, x.ruc, x.votos, x.total
      FROM (SELECT v.*, sum(v.votos) OVER (PARTITION BY v.entidad_codigo)::int AS total FROM _ov v) x
     ORDER BY x.entidad_codigo, x.votos DESC, x.ruc;
  DROP TABLE IF EXISTS _onom;
  CREATE TEMP TABLE _onom ON COMMIT DROP AS
    SELECT entidad_codigo, max(entidad_nombre) AS nombre, mode() WITHIN GROUP (ORDER BY obra_norm(departamento)) AS dep
      FROM obra_infobras WHERE entidad_codigo IS NOT NULL AND NOT retirada GROUP BY 1;
  DROP TABLE IF EXISTS _oruc;
  CREATE TEMP TABLE _oruc ON COMMIT DROP AS
    SELECT e.entidad_codigo, e.ruc, 'cui'::text AS via
      FROM _oe e JOIN _onom nm ON nm.entidad_codigo = e.entidad_codigo
      LEFT JOIN entidades en ON en.ruc = e.ruc
      LEFT JOIN entidad_siaf es ON es.ruc = e.ruc
     WHERE e.votos::numeric / e.total >= 0.6
       AND (e.votos >= 2 OR similarity(obra_norm(nm.nombre), obra_norm(COALESCE(en.nombre, es.nombre))) >= 0.5);
  -- Si no, su nombre: igual (sin tildes ni signos) al de una entidad de Vigía o del registro de la OECE, y una sola en el
  -- departamento de sus obras (hay muchas «Municipalidad Distrital de San Juan»).
  INSERT INTO _oruc (entidad_codigo, ruc, via)
  SELECT c.entidad_codigo, min(c.ruc), 'nombre'
    FROM (SELECT nm.entidad_codigo, x.ruc
            FROM _onom nm
            JOIN (SELECT e.ruc, obra_norm(e.nombre) AS n, obra_norm(e.region) AS dep FROM entidades e
                  UNION
                  SELECT s.ruc, obra_norm(s.nombre), obra_norm(s.departamento) FROM entidad_siaf s) x
              ON x.n = obra_norm(nm.nombre) AND (x.dep IS NULL OR nm.dep IS NULL OR x.dep = nm.dep
                                                  OR x.dep LIKE '%' || nm.dep || '%' OR nm.dep LIKE '%' || x.dep || '%')
           WHERE NOT EXISTS (SELECT 1 FROM _oruc o WHERE o.entidad_codigo = nm.entidad_codigo)) c
   GROUP BY c.entidad_codigo HAVING count(DISTINCT c.ruc) = 1;
  WITH nuevo AS (SELECT o.codigo, r2.ruc, r2.via FROM obra_infobras o LEFT JOIN _oruc r2 ON r2.entidad_codigo = o.entidad_codigo)
  UPDATE obra_infobras o SET entidad_ruc = nu.ruc, entidad_via = nu.via
    FROM nuevo nu WHERE nu.codigo = o.codigo AND (o.entidad_ruc IS DISTINCT FROM nu.ruc OR o.entidad_via IS DISTINCT FROM nu.via);
  RAISE NOTICE 'obras: entidad de las obras (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- 3. El ubigeo de cada obra, por sus nombres de departamento, provincia y distrito.
  DROP TABLE IF EXISTS _oz;
  CREATE TEMP TABLE _oz ON COMMIT DROP AS
    SELECT x.ubigeo, obra_norm(regexp_replace(d.nombre, '^Provincia Constitucional del ', '', 'i')) AS dn, obra_norm(p.nombre) AS pn,
           obra_norm(x.nombre) AS xn
      FROM zonas x JOIN zonas p ON p.ubigeo = x.padre_ubigeo JOIN zonas d ON d.ubigeo = p.padre_ubigeo
     WHERE x.nivel = 'distrito';
  WITH k AS (
    SELECT o.codigo, obra_norm(o.distrito) AS xn, obra_norm(o.provincia) AS pn,
           regexp_replace(COALESCE(obra_norm(o.departamento), ''), '^PROVINCIA CONSTITUCIONAL DEL ', '') AS dn
      FROM obra_infobras o),
  m AS (SELECT k.codigo, min(z.ubigeo) AS ubigeo FROM k JOIN _oz z ON z.xn = k.xn AND z.pn = k.pn
         WHERE z.dn = k.dn OR k.dn LIKE z.dn || '%' GROUP BY k.codigo),
  nuevo AS (SELECT o.codigo, m.ubigeo FROM obra_infobras o LEFT JOIN m ON m.codigo = o.codigo)
  UPDATE obra_infobras o SET ubigeo = nu.ubigeo FROM nuevo nu WHERE nu.codigo = o.codigo AND o.ubigeo IS DISTINCT FROM nu.ubigeo;
  RAISE NOTICE 'obras: ubigeo (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- 4. Datos imposibles, banderas y texto de búsqueda (sin el nombre de una persona natural: sólo de una empresa, RUC 20,
  --    o de un consorcio).
  UPDATE obra_infobras o SET dudoso = d.v FROM (SELECT x.codigo, obra_dudoso(x) AS v FROM obra_infobras x) d
   WHERE d.codigo = o.codigo AND o.dudoso IS DISTINCT FROM d.v;
  UPDATE obra_infobras o SET banderas = b.v, severidad = b.v->0->>'severidad'
    FROM (SELECT x.codigo, obra_banderas(x, v_al) AS v FROM obra_infobras x) b
   WHERE b.codigo = o.codigo AND (o.banderas IS DISTINCT FROM b.v OR o.severidad IS DISTINCT FROM b.v->0->>'severidad');
  UPDATE obra_infobras o SET texto = t.v
    FROM (SELECT x.codigo, lower(immutable_unaccent(concat_ws(' ', x.nombre, x.codigo::text, x.cui, x.snip, x.inversion_nombre,
                   CASE WHEN x.ejecutor_ruc ~ '^20\d{9}$' OR x.ejecutor_ruc ~ '^C\d{10}$' OR x.ejecutor_nombre ILIKE 'CONSORCIO%' THEN x.ejecutor_nombre END,
                   CASE WHEN x.ejecutor_ruc ~ '^20\d{9}$' THEN x.ejecutor_ruc END,
                   CASE WHEN x.supervisor_ruc ~ '^20\d{9}$' OR x.supervisor_nombre ILIKE 'CONSORCIO%' THEN x.supervisor_nombre END,
                   CASE WHEN x.supervisor_ruc ~ '^20\d{9}$' THEN x.supervisor_ruc END,
                   x.distrito, x.provincia, x.departamento, x.causal_paralizacion))) AS v
            FROM obra_infobras x) t
   WHERE t.codigo = o.codigo AND o.texto IS DISTINCT FROM t.v;
  UPDATE inversion_mef i SET dudoso = d.v FROM (SELECT x.cui, inversion_dudoso(x) AS v FROM inversion_mef x) d
   WHERE d.cui = i.cui AND i.dudoso IS DISTINCT FROM d.v;
  UPDATE inversion_mef i SET banderas = b.v, severidad = b.v->0->>'severidad'
    FROM (SELECT x.cui, inversion_banderas(x) AS v FROM inversion_mef x) b
   WHERE b.cui = i.cui AND (i.banderas IS DISTINCT FROM b.v OR i.severidad IS DISTINCT FROM b.v->0->>'severidad');
  UPDATE inversion_mef i SET texto = t.v
    FROM (SELECT x.cui, lower(immutable_unaccent(concat_ws(' ', x.nombre, x.cui, x.snip, x.funcion, x.programa, x.distrito, x.provincia,
                                                              x.departamento, x.uei))) AS v FROM inversion_mef x) t
   WHERE t.cui = i.cui AND i.texto IS DISTINCT FROM t.v;
  ANALYZE obra_infobras;
  ANALYZE inversion_mef;
  RAISE NOTICE 'obras: banderas (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- Sin cruces (p_cruces = false): para cargar en producción antes de que la API y la web que conocen estos tipos estén
  -- desplegadas (la ficha de un contrato mostraría el nombre interno del tipo).
  IF p_cruces THEN
    n := refrescar_cruce_obras();
  ELSE
    PERFORM refrescar_obra_contratos();
    n := 0;
  END IF;

  SELECT jsonb_build_object(
    'obras', count(*) FILTER (WHERE NOT retirada),
    'obras_con_entidad', count(*) FILTER (WHERE NOT retirada AND entidad_ruc IS NOT NULL),
    'obras_entidad_por_cui', count(*) FILTER (WHERE NOT retirada AND entidad_via = 'cui'),
    'obras_entidad_por_nombre', count(*) FILTER (WHERE NOT retirada AND entidad_via = 'nombre'),
    'obras_con_ubigeo', count(*) FILTER (WHERE NOT retirada AND ubigeo IS NOT NULL),
    'obras_con_banderas', count(*) FILTER (WHERE NOT retirada AND banderas <> '[]'::jsonb),
    'obras_con_contrato', (SELECT count(DISTINCT codigo) FROM obra_contrato),
    'obras_dudosas', count(*) FILTER (WHERE NOT retirada AND dudoso <> '{}'))
    INTO r FROM obra_infobras;
  SELECT r || jsonb_build_object(
    'inversiones', count(*) FILTER (WHERE NOT retirada),
    'inversiones_con_entidad', count(*) FILTER (WHERE NOT retirada AND entidad_ruc IS NOT NULL),
    'inversiones_con_banderas', count(*) FILTER (WHERE NOT retirada AND banderas <> '[]'::jsonb),
    'inversiones_con_contrato', (SELECT count(DISTINCT k.cui) FROM contrato_cui k JOIN inversion_mef i ON i.cui = k.cui),
    'contratos_con_obra', (SELECT count(DISTINCT ocid) FROM obra_contrato),
    'cruces', n)
    INTO r FROM inversion_mef;
  RETURN r;
END $$;

-- ─── Dueños y permisos (como la 150): las carga vigia_jobs; las leen la API, el panel, el MCP y los agentes ───

ALTER TABLE obra_infobras OWNER TO vigia_jobs;
ALTER TABLE inversion_mef OWNER TO vigia_jobs;
ALTER TABLE proceso_cui OWNER TO vigia_jobs;
ALTER TABLE obra_refresco OWNER TO vigia_jobs;
ALTER TABLE obra_contrato OWNER TO vigia_jobs;
ALTER TABLE contrato_cui OWNER TO vigia_jobs;
ALTER FUNCTION obra_norm(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION cuis_de_texto(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION snips_de_texto(TEXT) OWNER TO vigia_jobs;
ALTER FUNCTION refrescar_proceso_cui(INT) OWNER TO vigia_jobs;
ALTER FUNCTION obra_banderas(obra_infobras, DATE) OWNER TO vigia_jobs;
ALTER FUNCTION obra_dudoso(obra_infobras) OWNER TO vigia_jobs;
ALTER FUNCTION inversion_banderas(inversion_mef) OWNER TO vigia_jobs;
ALTER FUNCTION inversion_dudoso(inversion_mef) OWNER TO vigia_jobs;
ALTER FUNCTION refrescar_obra_contratos() OWNER TO vigia_jobs;
ALTER FUNCTION refrescar_cruce_obras() OWNER TO vigia_jobs;
ALTER FUNCTION refrescar_obras(BOOLEAN) OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_proceso_cui(INT), refrescar_obra_contratos(), refrescar_cruce_obras(), refrescar_obras(BOOLEAN) FROM PUBLIC;
GRANT SELECT ON obra_infobras, inversion_mef, proceso_cui, obra_contrato, contrato_cui, obra_refresco TO vigia_api, vigia_api_admin, vigia_mcp;
DO $$
BEGIN
  -- Los privilegios por defecto de la 43 dan a vigia_agentes escritura en toda tabla nueva: aquí sólo lee.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_agentes') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON obra_infobras, inversion_mef, proceso_cui, obra_contrato, contrato_cui, obra_refresco FROM vigia_agentes;
    REVOKE EXECUTE ON FUNCTION refrescar_proceso_cui(INT), refrescar_obra_contratos(), refrescar_cruce_obras(), refrescar_obras(BOOLEAN) FROM vigia_agentes;
    GRANT SELECT ON obra_infobras, inversion_mef, proceso_cui, obra_contrato, contrato_cui TO vigia_agentes;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_ab') THEN
    GRANT SELECT ON obra_infobras, inversion_mef, proceso_cui, obra_contrato, contrato_cui TO vigia_ab;
  END IF;
END $$;
