-- 91 · Personas contratadas: las órdenes de servicio a personas naturales (RUC 10) y lo que otros registros dicen de
--      quien las recibe. Y el fraccionamiento, incremental: con las órdenes desde 2018 (~28 M) rehacerlo entero pasa
--      el corte de ~10 min de Hyperdrive.
--
-- El Estado contrata gente por órdenes de servicio de hasta 8 UIT (locadores: asistentes, asesores, choferes…) sin
-- concurso. CONOSCE publica cada orden con el nombre y el RUC 10 de la persona. Lo que queda:
--   · servicio_persona(descripción): el tipo de servicio, por las palabras de la descripción (CONOSCE no lo trae).
--   · persona_codigo: un código al azar por persona, para la URL de su ficha (/app/personas/<código>). Nunca el RUC:
--     lleva el DNI (docs/PRIVACIDAD.md). Sólo crece: el código de una persona no cambia.
--   · persona_orden_anual: entidad × persona × año de emisión: órdenes, meses con orden, monto, tipo de servicio.
--   · servicio_referencia: cuánto se paga por mes (monto del año / meses con orden) a quienes hacen cada tipo de
--     servicio, en cada entidad y en todo el país (entidad_ruc = '').
--   · persona_senal: las señales de cada persona en cada entidad, con su detalle y su fuente.
--   · persona_entidad: el resumen de cada persona en cada entidad, con sus señales, para las listas.
--   · persona_resumen: las cifras de cada alcance de las listas (país, región, entidad, partido), ya contadas.
--
-- Señales. Son indicios para revisar: ninguna prueba un delito ni un parentesco.
--   candidato_gobierna     alta   fue candidato del partido que gobernaba la entidad cuando lo contrataron
--   autoridad_contratada   alta   es autoridad electa en funciones de ese mismo gobierno (media si es alcalde o
--                                 gobernador de otro; baja si es regidor o consejero de otro)
--   inhabilitado           alta   recibió órdenes mientras el Tribunal de Contrataciones lo tenía inhabilitado
--   aporte_gobierna        media  aportó al partido que gobernaba la entidad (ONPE)
--   apellidos_autoridad    media  tiene los dos apellidos de una autoridad de ese gobierno (baja si son comunes)
--   apellidos_funcionario  media  tiene los dos apellidos, poco comunes, de un funcionario de la entidad con DJI
--   funcionario_contratado media  declaró (DJI) trabajar en la misma entidad cuando recibió las órdenes
--   meses_seguidos         media  órdenes en 10 o más meses de un mismo año: un puesto permanente pagado como locación
--   pago_alto              media  cobra por mes 2,5 veces o más la mediana de quienes hacen ese servicio en la entidad
--   candidato              baja   fue candidato de otro partido
--   aporte                 baja   aportó a otro partido
--   visita_previa          baja   visitó la entidad en los 180 días antes de su primera orden del año
--
-- Cruces por DNI (el del RUC 10) cuando la otra fuente lo trae; si no, por el nombre completo y el departamento, y
-- el detalle lo dice (`por`: dni | nombre). Los apellidos se comparan sólo si la pareja es poco común (`frecuencia`:
-- cuántas personas contratadas los llevan).
--
-- refrescar_personas_ordenes(p_desde) rehace persona_orden_anual desde el año de p_desde (NULL: todo) y
-- refrescar_personas_senales() todo lo demás. Los llama conosce_ordenes tras cargar, en pasos separados.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/91_personas_contratadas.sql
-- y después, fuera de Hyperdrive: SELECT refrescar_personas_ordenes(NULL); SELECT refrescar_personas_senales();

-- ── 0 · Fraccionamiento desde una fecha ─────────────────────────────────────────────────────────
-- Un grupo de órdenes fraccionadas es de un mismo día: rehacer desde una fecha de emisión es exacto. El BRIN (unos
-- KB) sirve porque cada mes se carga junto.
CREATE INDEX IF NOT EXISTS conosce_ordenes_emision_brin ON conosce_ordenes USING brin (fecha_emision);

DROP FUNCTION IF EXISTS refrescar_fraccionamiento();
CREATE OR REPLACE FUNCTION refrescar_fraccionamiento(p_desde date DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n INT;
  v_desde date := COALESCE(p_desde, DATE '1900-01-01');
BEGIN
  DELETE FROM ordenes_fraccionadas WHERE fecha >= v_desde;
  INSERT INTO ordenes_fraccionadas (entidad_ruc, entidad, ruc_contratista, contratista, fecha, objeto, ordenes, total, tope,
                                    misma_descripcion, severidad, detalle)
  SELECT o.entidad_ruc, max(o.entidad), o.ruc_contratista, max(o.contratista), o.fecha_emision, o.objeto, count(*), sum(o.monto),
         max(o.n_uit) * uit_soles(extract(year FROM o.fecha_emision)::int),
         count(DISTINCT left(mef_norm(o.descripcion), 40)) = 1,
         CASE WHEN count(DISTINCT left(mef_norm(o.descripcion), 40)) = 1 THEN 'alta' ELSE 'media' END,
         jsonb_agg(jsonb_build_object('orden', o.orden, 'monto', o.monto, 'descripcion', left(o.descripcion, 200), 'estado', o.estado)
                   ORDER BY o.monto DESC)
  FROM (
    -- Una vez cada orden (un mismo archivo puede repetirla).
    SELECT DISTINCT ON (entidad_ruc, orden, fecha_emision) *,
           COALESCE(substring(tipo_contratacion FROM 'hasta (\d+) UIT')::int, 8) AS n_uit,
           regexp_replace(orden, '^[^-]*-[^-]*-\d{4}-?', '') AS unidad
    FROM conosce_ordenes
    WHERE fecha_emision >= v_desde
      AND tipo_contratacion ILIKE 'Contrataciones hasta%' AND estado IS DISTINCT FROM 'Anulada'
      AND moneda = 'Nuevos Soles' AND ruc_contratista ~ '^20\d{9}$' AND fecha_emision IS NOT NULL AND monto > 0
      AND ruc_contratista IS DISTINCT FROM entidad_ruc   -- la entidad no es su propio proveedor (migración 55)
      AND mef_norm(descripcion) !~ '(^| )(RECIBO|SUMINISTRO|ENERGIA ELECTRICA|AGUA POTABLE|TELEFONIA|INTERNET|PASAJES?|BOLETOS?|PACIENTES?)( |$)'
    ORDER BY entidad_ruc, orden, fecha_emision, anio DESC, mes DESC
  ) o
  GROUP BY o.entidad_ruc, o.unidad, o.ruc_contratista, o.fecha_emision, o.objeto
  HAVING count(*) BETWEEN 2 AND 10 AND sum(o.monto) > max(o.n_uit) * uit_soles(extract(year FROM o.fecha_emision)::int);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_fraccionamiento(date) OWNER TO vigia_jobs;

-- ── 1 · Tipo de servicio ───────────────────────────────────────────────────────────────────────
-- Por palabras de la descripción, en este orden: primero lo que no es trabajo de una persona (alquilar un vehículo,
-- dar de comer, imprimir), después el puesto y la profesión ("asistente administrativo" o "arquitecto" en Logística son
-- eso) y al final el área. Lo que no encaja: 'Otros servicios personales' si habla de una persona o un profesional, si no 'Otros'.
-- En PL/pgSQL y con LIKE: con ~25 expresiones regulares (o como función SQL con subconsulta) costaba 0,6-0,7 ms por
-- llamada; así, ~90 µs (medido en DEV con 50 mil órdenes). Cada palabra va con un espacio delante: empieza una palabra.
CREATE OR REPLACE FUNCTION servicio_persona(d text) RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE t text := ' ' || mef_norm(d) || ' ';
BEGIN
  IF t LIKE ANY (ARRAY['% ALQUILER%', '% ARRENDAMIENTO%', '% ARRIENDO%']) THEN RETURN 'Alquiler'; END IF;
  IF t LIKE ANY (ARRAY['% ALIMENTACION%', '% ALIMENTOS%', '% REFRIGERIO%', '% ALMUERZO%', '% DESAYUNO%', '% RACIONES%', '% CATERING%', '% COFFEE%', '% BOCADITOS%']) THEN RETURN 'Alimentación'; END IF;
  IF t LIKE ANY (ARRAY['% IMPRESION%', '% FOTOCOPIA%', '% ANILLADO%', '% EMPASTADO%', '% GIGANTOGRAFIA%', '% BANNER%', '% PUBLICIDAD%', '% SPOT%']) THEN RETURN 'Impresión y publicidad'; END IF;
  IF t LIKE ANY (ARRAY['% TRANSPORTE%', '% FLETE%', '% TRASLADO%', '% ACARREO%', '% MUDANZA%', '% COURIER%', '% ENCOMIENDA%']) AND NOT t LIKE ANY (ARRAY['% CONDUCTOR%', '% CHOFER%']) THEN RETURN 'Transporte'; END IF;
  IF t LIKE ANY (ARRAY['% HOSPEDAJE%', '% ALOJAMIENTO%', '% SONIDO%', '% AMBIENTACION%', '% DECORACION%', '% ESCENARIO%', '% TOLDO%']) THEN RETURN 'Hospedaje y eventos'; END IF;
  IF t LIKE ANY (ARRAY['% ABOGAD%', '% LEGAL %', '% JURIDIC%', '% ASESORIA LEGAL%', '% ASESORIA JURIDICA%', '% ASISTENCIA LEGAL%', '% ASESOR LEGAL%', '% ASESOR JURIDICO%', '% MATERIA LEGAL%', '% MATERIA JURIDICA%', '% PROCURADURIA%', '% DEFENSA LEGAL%', '% PATROCINIO%']) THEN RETURN 'Asesoría legal'; END IF;
  IF t LIKE ANY (ARRAY['% ASISTENTE ADMINISTRATIV%', '% ASISTENCIA ADMINISTRATIV%', '% AUXILIAR ADMINISTRATIV%', '% APOYO ADMINISTRATIV%', '% GESTION ADMINISTRATIV%', '% ASISTENCIA TECNICA ADMINISTRATIV%', '% ASISTENTE TECNICO ADMINISTRATIV%', '% SECRETARI%', '% MESA DE PARTES%', '% TRAMITE DOCUMENTARIO%', '% ARCHIVO%', '% ARCHIVISTA%']) THEN RETURN 'Asistencia administrativa'; END IF;
  IF t LIKE ANY (ARRAY['% CHOFER%', '% CONDUCTOR%', '% CONDUCCION DE%', '% PILOTO%', '% MAQUINISTA%', '% OPERADOR DE MAQUINARIA%', '% OPERADOR DE VEHICULO%', '% OPERADOR DE CAMION%', '% OPERADOR DE VOLQUETE%', '% OPERADOR DE CARGADOR%', '% OPERADOR DE RETROEXCAVADORA%', '% OPERADOR DE MOTONIVELADORA%', '% OPERADOR DE TRACTOR%', '% OPERADOR DE CISTERNA%', '% OPERADOR DE COMPACTADORA%']) THEN RETURN 'Conducción de vehículos'; END IF;
  IF t LIKE ANY (ARRAY['% VIGILAN%', '% GUARDIAN%', '% SERENAZGO%', '% SERENO%', '% AGENTE DE SEGURIDAD%', '% AGENTES DE SEGURIDAD%', '% SEGURIDAD CIUDADANA%', '% PORTERIA%', '% CONTROL DE ACCESO%', '% POLICIA MUNICIPAL%']) THEN RETURN 'Seguridad y vigilancia'; END IF;
  IF t LIKE ANY (ARRAY['% LIMPIEZA%', '% BARRIDO%', '% RECOLECCION%', '% RECOJO DE RESIDUOS%', '% RESIDUOS SOLIDOS%', '% JARDINER%', '% AREAS VERDES%', '% OPERARI%', '% OBRERO%', '% PEON%', '% AYUDANTE%', '% MANO DE OBRA%', '% ALBANIL%', '% GASFITER%', '% ELECTRICISTA%', '% CARPINTER%', '% SOLDADOR%', '% PINTOR%', '% GUARDAPARQUE%']) THEN RETURN 'Limpieza y obreros'; END IF;
  IF t LIKE ANY (ARRAY['% DOCENTE%', '% DOCENCIA%', '% PROFESOR%', '% ENSENANZA%', '% DICTADO%', '% CAPACITACION%', '% CAPACITADOR%', '% INSTRUCTOR%', '% TALLER%', '% TUTOR%', '% AUXILIAR DE EDUCACION%', '% PROMOTOR EDUCATIV%', '% PROMOTORA EDUCATIV%']) THEN RETURN 'Docencia y capacitación'; END IF;
  IF t LIKE ANY (ARRAY['% MEDICO%', '% MEDICA %', '% MEDICOS%', '% MEDICINA%', '% FARMACIA%', '% BRIGADISTA DE SALUD%', '% ENFERMER%', '% OBSTETR%', '% ODONTOLOG%', '% CIRUJAN%', '% NUTRICION%', '% TECNOLOGO MEDICO%', '% LABORATORIO CLINICO%', '% FARMACEUTIC%', '% TERAPI%', '% TERAPEUTA%', '% FISIOTERAP%', '% PSICOLOG%', '% ATENCIONES ESPECIALIZADAS%', '% ATENCION ESPECIALIZADA%', '% ATENCION DE SALUD%', '% BIOLOGO%', '% TECNICO ASISTENCIAL%', '% TECNICO EN ENFERMERIA%', '% ANESTESIOLOG%', '% PEDIATR%', '% GINECOLOG%', '% RADIOLOG%']) THEN RETURN 'Salud'; END IF;
  IF t LIKE ANY (ARRAY['% INGENIER%', '% CATASTR%', '% ARQUITECT%', '% RESIDENTE DE OBRA%', '% RESIDENCIA DE OBRA%', '% SUPERVISOR DE OBRA%', '% SUPERVISION DE OBRA%', '% INSPECTOR DE OBRA%', '% EXPEDIENTE TECNICO%', '% TOPOGRAF%', '% PREINVERSION%', '% PROYECTISTA%', '% METRADOS%', '% LIQUIDACION DE OBRA%']) THEN RETURN 'Ingeniería y obras'; END IF;
  IF t LIKE ANY (ARRAY['% COMUNICACION%', '% COMUNICADOR%', '% PERIODIST%', '% PRENSA%', '% COMMUNITY%', '% REDES SOCIALES%', '% AUDIOVISUAL%', '% FOTOGRAF%', '% FILMACION%', '% DISENO GRAFICO%', '% DISENADOR%', '% RELACIONES PUBLICAS%', '% IMAGEN INSTITUCIONAL%', '% LOCUTOR%', '% PROTOCOLO%']) THEN RETURN 'Comunicaciones y prensa'; END IF;
  IF t LIKE ANY (ARRAY['% INFORMATIC%', '% SOPORTE TECNICO%', '% PROGRAMADOR%', '% DESARROLLADOR%', '% SOFTWARE%', '% BASE DE DATOS%', '% BASES DE DATOS%', '% DIGITADOR%', '% DIGITACION%', '% DIGITALIZACION%', '% SISTEMA DE INFORMACION%', '% SISTEMAS DE INFORMACION%', '% TECNOLOGIAS DE LA INFORMACION%', '% TECNOLOGIA DE LA INFORMACION%']) THEN RETURN 'Informática y digitación'; END IF;
  IF t LIKE ANY (ARRAY['% CONTAB%', '% CONTADOR%', '% TESORERI%', '% FINANZAS%', '% FINANCIER%', '% PRESUPUEST%', '% COSTOS%']) THEN RETURN 'Contabilidad y finanzas'; END IF;
  IF t LIKE ANY (ARRAY['% LOGISTIC%', '% ALMACEN%', '% ABASTECIMIENTO%', '% CONTRATACIONES%', '% ADQUISICIONES%', '% COMPRAS%', '% PATRIMONIO%', '% PATRIMONIAL%', '% COTIZACION%']) THEN RETURN 'Logística y contrataciones'; END IF;
  IF t LIKE ANY (ARRAY['% RECURSOS HUMANOS%', '% PLANILLA%', '% ESCALAFON%', '% BIENESTAR SOCIAL%', '% TALENTO HUMANO%', '% GESTION DE PERSONAL%']) THEN RETURN 'Recursos humanos'; END IF;
  IF t LIKE ANY (ARRAY['% FISCALIZ%', '% INSPECTOR%', '% INSPECCION%', '% NOTIFICADOR%', '% NOTIFICACION%', '% CONTROL URBANO%', '% LICENCIAS%', '% COACTIV%']) THEN RETURN 'Fiscalización e inspección'; END IF;
  IF t LIKE ANY (ARRAY['% PROMOTOR%', '% BRIGADISTA%', '% ENCUESTADOR%', '% EMPADRONADOR%', '% EMPADRONAMIENTO%', '% CENSO%', '% GESTOR%', '% EXTENSIONISTA%', '% TECNICO DE CAMPO%', '% VISITADOR%', '% ACOMPANANTE%', '% ORIENTADOR%', '% FACILITADOR%', '% VASO DE LECHE%', '% ATENCION AL PUBLICO%', '% ATENCION AL CIUDADANO%', '% ATENCION AL USUARIO%', '% RECEPCION%', '% RECEPCIONISTA%', '% ANFITRION%', '% CALL CENTER%', '% PLATAFORMA DE ATENCION%']) THEN RETURN 'Campo y atención al público'; END IF;
  IF t LIKE ANY (ARRAY['% MANTENIMIENTO%', '% REPARACION%', '% INSTALACION%', '% SERVICIO TECNICO%']) THEN RETURN 'Mantenimiento y reparación'; END IF;
  IF t LIKE ANY (ARRAY['% ANALISIS%', '% ELABORACION%', '% REVISION%', '% SUPERVISION%', '% ACTIVIDADES%', '% GESTION%', '% DESARROLLO%', '% CONTROL%', '% REGISTRO%', '% ACTUALIZACION%', '% SOPORTE%', '% ATENCION%', '% ESPECIALISTA%', '% ESPECIALIZADO%', '% ANALISTA%', '% COORDINADOR%', '% COORDINACION%', '% MONITOR%', '% SEGUIMIENTO%', '% EVALUACION%', '% PLANEAMIENTO%', '% PLANIFICACION%', '% PROFESIONAL%', '% CONSULTOR%', '% ASESOR%', '% ASISTENCIA TECNICA%', '% ASISTENTE%', '% AUXILIAR%', '% APOYO%', '% LOCACION%', '% LOCADOR%', '% PERSONA NATURAL%', '% PERSONAL%', '% TECNICO%']) THEN RETURN 'Otros servicios personales'; END IF;
  RETURN 'Otros';
END $$;
ALTER FUNCTION servicio_persona(text) OWNER TO vigia_jobs;

-- ¿El servicio es el trabajo de una persona? (para comparar lo que cobra por mes con otros que hacen lo mismo)
CREATE OR REPLACE FUNCTION servicio_es_personal(s text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT s NOT IN ('Alquiler', 'Alimentación', 'Impresión y publicidad', 'Transporte', 'Hospedaje y eventos',
                   'Mantenimiento y reparación', 'Otros')
$$;
ALTER FUNCTION servicio_es_personal(text) OWNER TO vigia_jobs;

-- Dos nombres de partido normalizados (mef_norm) son el mismo: iguales, o uno empieza con el otro si son largos
-- (el mismo criterio que el cruce partido_gobernante de la migración 87).
CREATE OR REPLACE FUNCTION mismo_partido(a text, b text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT a = b OR (least(length(a), length(b)) >= 15 AND (a LIKE b || '%' OR b LIKE a || '%'))
$$;
ALTER FUNCTION mismo_partido(text, text) OWNER TO vigia_jobs;

-- Fecha 'dd/mm/aa' o 'dd/mm/aaaa' de la DJI, o NULL.
CREATE OR REPLACE FUNCTION fecha_dji(t text) RETURNS date
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN
  IF t ~ '^\d{2}/\d{2}/\d{4}$' THEN RETURN to_date(t, 'DD/MM/YYYY'); END IF;
  IF t ~ '^\d{2}/\d{2}/\d{2}$' THEN RETURN to_date(t, 'DD/MM/YY'); END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
ALTER FUNCTION fecha_dji(text) OWNER TO vigia_jobs;

-- ── 2 · Tablas ─────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS persona_codigo (
  ruc    TEXT PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
);

CREATE TABLE IF NOT EXISTS persona_orden_anual (
  entidad_ruc  TEXT NOT NULL,
  ruc          TEXT NOT NULL,
  anio         SMALLINT NOT NULL,          -- de la fecha de emisión
  entidad      TEXT,
  nombre       TEXT,                       -- como lo escribe CONOSCE (orden SUNAT: apellidos primero)
  departamento TEXT,                       -- el de la entidad
  servicio     TEXT,                       -- el tipo de servicio de su orden más grande de ese año (servicio_persona)
  ordenes      INT NOT NULL,
  meses        SMALLINT NOT NULL,          -- meses distintos con al menos una orden
  monto        NUMERIC(16, 2) NOT NULL,
  primera      DATE,
  ultima       DATE,
  PRIMARY KEY (entidad_ruc, ruc, anio)
);
CREATE INDEX IF NOT EXISTS persona_orden_anual_ruc ON persona_orden_anual (ruc);

CREATE TABLE IF NOT EXISTS servicio_referencia (
  entidad_ruc TEXT NOT NULL,               -- '' = todo el país
  anio        SMALLINT NOT NULL,
  servicio    TEXT NOT NULL,
  personas    INT NOT NULL,
  mediana_mes NUMERIC(14, 2),
  p25_mes     NUMERIC(14, 2),
  p75_mes     NUMERIC(14, 2),
  p90_mes     NUMERIC(14, 2),
  PRIMARY KEY (entidad_ruc, anio, servicio)
);

CREATE TABLE IF NOT EXISTS persona_senal (
  entidad_ruc TEXT NOT NULL,
  ruc         TEXT NOT NULL,
  tipo        TEXT NOT NULL,
  severidad   TEXT NOT NULL CHECK (severidad IN ('alta', 'media', 'baja')),
  detalle     JSONB NOT NULL DEFAULT '{}',
  fuente      TEXT,
  fuente_url  TEXT,
  PRIMARY KEY (entidad_ruc, ruc, tipo)
);
CREATE INDEX IF NOT EXISTS persona_senal_ruc ON persona_senal (ruc);

CREATE TABLE IF NOT EXISTS persona_entidad (
  entidad_ruc TEXT NOT NULL,
  ruc         TEXT NOT NULL,
  codigo      TEXT NOT NULL,
  entidad     TEXT,
  nombre      TEXT,
  dep         TEXT,                        -- ubigeo del departamento de la entidad (2 dígitos)
  servicio    TEXT,
  ordenes     INT NOT NULL,
  meses       INT NOT NULL,
  monto       NUMERIC(16, 2) NOT NULL,
  primera     DATE,
  ultima      DATE,
  anios       SMALLINT[] NOT NULL,
  gobiernos   TEXT[] NOT NULL DEFAULT '{}', -- 'org_clave:anio_eleccion' de quien gobernaba la entidad en esos años
  tipos       TEXT[] NOT NULL DEFAULT '{}', -- tipos de señal
  senales     JSONB NOT NULL DEFAULT '[]',  -- [{tipo, severidad}], de la más grave a la menos
  n_senales   INT NOT NULL DEFAULT 0,
  sev         SMALLINT NOT NULL DEFAULT 0,  -- 3 alta, 2 media, 1 baja, 0 ninguna
  PRIMARY KEY (entidad_ruc, ruc)
);
CREATE INDEX IF NOT EXISTS persona_entidad_ruc ON persona_entidad (ruc);
CREATE INDEX IF NOT EXISTS persona_entidad_codigo ON persona_entidad (codigo);
CREATE INDEX IF NOT EXISTS persona_entidad_orden ON persona_entidad (sev DESC, n_senales DESC, monto DESC);
CREATE INDEX IF NOT EXISTS persona_entidad_entidad ON persona_entidad (entidad_ruc, sev DESC, n_senales DESC, monto DESC);
CREATE INDEX IF NOT EXISTS persona_entidad_dep ON persona_entidad (dep, sev DESC, n_senales DESC, monto DESC);
CREATE INDEX IF NOT EXISTS persona_entidad_tipos ON persona_entidad USING gin (tipos);
CREATE INDEX IF NOT EXISTS persona_entidad_gobiernos ON persona_entidad USING gin (gobiernos);

-- El resumen de cada alcance de las listas ('pais', 'dep:15', 'ent:<ruc>', 'par:<clave>:<año>'), ya contado: el del
-- país sobre 1,2 M filas tardaba ~9 s en vivo (el rol de la API corta a los 10).
CREATE TABLE IF NOT EXISTS persona_resumen (
  alcance TEXT PRIMARY KEY,
  resumen JSONB NOT NULL
);

ALTER TABLE persona_resumen OWNER TO vigia_jobs;
ALTER TABLE persona_codigo OWNER TO vigia_jobs;
ALTER TABLE persona_orden_anual OWNER TO vigia_jobs;
ALTER TABLE servicio_referencia OWNER TO vigia_jobs;
ALTER TABLE persona_senal OWNER TO vigia_jobs;
ALTER TABLE persona_entidad OWNER TO vigia_jobs;

-- ── 3 · Órdenes por persona y año ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refrescar_personas_ordenes(p_desde date DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_anio INT := greatest(COALESCE(extract(year FROM p_desde)::int, 2018), 2018);
  n INT;
BEGIN
  SET LOCAL work_mem = '256MB';
  -- Una vez cada orden (un mismo archivo mensual puede repetirla; vale la del archivo más nuevo).
  CREATE TEMP TABLE _po ON COMMIT DROP AS
    SELECT DISTINCT ON (entidad_ruc, orden, fecha_emision)
           entidad_ruc, ruc_contratista AS ruc, entidad, contratista, departamento, fecha_emision, monto, descripcion,
           extract(year FROM fecha_emision)::smallint AS anio
      FROM conosce_ordenes
     WHERE fecha_emision >= make_date(v_anio, 1, 1) AND fecha_emision <= current_date + 31
       AND ruc_contratista ~ '^10\d{9}$' AND tipo_orden = 'Orden de Servicio'
       AND estado IS DISTINCT FROM 'Anulada' AND moneda = 'Nuevos Soles' AND monto > 0
       AND entidad_ruc ~ '^\d{11}$'
     ORDER BY entidad_ruc, orden, fecha_emision, anio DESC, mes DESC;

  DELETE FROM persona_orden_anual WHERE anio >= v_anio;
  INSERT INTO persona_orden_anual (entidad_ruc, ruc, anio, entidad, nombre, departamento, servicio, ordenes, meses, monto, primera, ultima)
  SELECT g.entidad_ruc, g.ruc, g.anio, g.entidad, g.contratista, g.departamento, servicio_persona(g.descripcion),
         g.ordenes, g.meses, g.monto, g.primera, g.ultima
    FROM (
      -- El tipo de servicio sale de la descripción de su orden más grande: clasificar cada orden (millones de
      -- expresiones regulares) tardaba más que todo lo demás.
      -- CONOSCE escribe la Ñ como "¿" en muchos nombres ("NURE¿A"): se repone (sin ella, ni el cruce por nombre ni el
      -- tapado del apellido reconocen la palabra).
      SELECT p.entidad_ruc, p.ruc, p.anio, max(p.entidad) AS entidad, max(replace(p.contratista, '¿', 'Ñ')) AS contratista,
             max(p.departamento) AS departamento,
             (array_agg(p.descripcion ORDER BY p.monto DESC))[1] AS descripcion,
             count(*) AS ordenes, count(DISTINCT date_trunc('month', p.fecha_emision)) AS meses, sum(p.monto) AS monto,
             min(p.fecha_emision) AS primera, max(p.fecha_emision) AS ultima
        FROM _po p
       GROUP BY p.entidad_ruc, p.ruc, p.anio
    ) g;
  GET DIAGNOSTICS n = ROW_COUNT;

  INSERT INTO persona_codigo (ruc) SELECT DISTINCT ruc FROM _po ON CONFLICT (ruc) DO NOTHING;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_personas_ordenes(date) OWNER TO vigia_jobs;

-- ── 4 · Señales, referencias y resumen ─────────────────────────────────────────────────────────
-- Toda sentencia de cruce va por igualdad (hash): un OR en el JOIN haría un bucle de millones × miles.
CREATE OR REPLACE FUNCTION refrescar_personas_senales() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  SET LOCAL work_mem = '256MB';

  -- Cada persona en cada entidad y año, con quién gobernaba la entidad ese año (los mandatos empiezan el 1 de enero;
  -- si una elección complementaria se superpone, la más reciente).
  CREATE TEMP TABLE _pa ON COMMIT DROP AS
  SELECT a.entidad_ruc, a.ruc, a.anio, a.primera, a.ultima, a.entidad, a.nombre, a.servicio, a.ordenes, a.meses, a.monto,
         substr(a.ruc, 3, 8) AS dni, mef_norm(a.nombre) AS nom_n, mef_norm(a.departamento) AS dep_n, mef_norm(a.entidad) AS ent_n,
         split_part(mef_norm(a.nombre), ' ', 1) AS ap1, split_part(mef_norm(a.nombre), ' ', 2) AS ap2,
         eg.nivel, eg.ubigeo::text AS gub, gp.org_clave, gp.org_nombre, mef_norm(gp.org_nombre) AS gob_n, gp.anio_eleccion
    FROM persona_orden_anual a
    LEFT JOIN entidad_gobierno eg ON eg.ruc = a.entidad_ruc
    LEFT JOIN LATERAL (
      SELECT g.org_clave, g.org_nombre, g.anio_eleccion FROM gobierno_periodo g
       WHERE g.nivel = eg.nivel AND g.ubigeo = eg.ubigeo AND make_date(a.anio, 7, 1) BETWEEN g.desde AND g.hasta
       ORDER BY g.anio_eleccion DESC LIMIT 1
    ) gp ON TRUE;
  CREATE INDEX ON _pa (dni);
  ANALYZE _pa;

  -- Cuántas personas contratadas llevan cada pareja de apellidos (para no marcar QUISPE MAMANI).
  CREATE TEMP TABLE _frec ON COMMIT DROP AS
  SELECT ap1, ap2, count(DISTINCT ruc)::int AS frec FROM _pa GROUP BY 1, 2;
  ANALYZE _frec;

  DELETE FROM persona_senal;

  -- ── Candidaturas: JNE (desde 2014) y ONPE Claridad (con DNI). Sin DNI en la fuente, por nombre y departamento.
  CREATE TEMP TABLE _cand ON COMMIT DROP AS
  SELECT DISTINCT * FROM (
    SELECT NULLIF(numero_documento, '') AS dni, mef_norm(nombre) AS nom_n, mef_norm(region) AS dep_n,
           mef_norm(partido) AS org_n, partido, cargo, "año" AS anio, resultado, nombre
      FROM jne_candidaturas WHERE partido IS NOT NULL AND nombre IS NOT NULL
    UNION ALL
    SELECT dni, mef_norm(apellidos || ' ' || nombres), mef_norm(departamento), mef_norm(organizacion), organizacion, NULL,
           substring(proceso FROM '\d{4}')::int, NULL, apellidos || ' ' || nombres
      FROM onpe_candidatos WHERE dni ~ '^\d{8}$' AND organizacion IS NOT NULL
  ) x;
  ANALYZE _cand;

  CREATE TEMP TABLE _pc ON COMMIT DROP AS
  SELECT p.entidad_ruc, p.ruc, p.anio, p.gob_n, p.org_nombre, p.anio_eleccion, c.org_n, c.partido, c.cargo,
         c.anio AS anio_cand, c.resultado, c.nombre, 'dni'::text AS por
    FROM _pa p JOIN _cand c ON c.dni = p.dni
  UNION ALL
  SELECT p.entidad_ruc, p.ruc, p.anio, p.gob_n, p.org_nombre, p.anio_eleccion, c.org_n, c.partido, c.cargo,
         c.anio, c.resultado, c.nombre, 'nombre'
    FROM _pa p JOIN _cand c ON c.nom_n = p.nom_n AND c.dep_n = p.dep_n
   WHERE c.dni IS NULL;

  -- candidato_gobierna: del partido que gobernaba, en la elección que lo puso o después (hasta un año tras la orden).
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT entidad_ruc, ruc, 'candidato_gobierna', 'alta',
         jsonb_build_object('partido', max(org_nombre), 'por', min(por),
                            'anios', jsonb_agg(DISTINCT anio),
                            'candidaturas', jsonb_agg(DISTINCT jsonb_build_object('nombre', nombre, 'partido', partido, 'cargo', cargo,
                                                                                 'anio', anio_cand, 'resultado', resultado))),
         'jne_candidaturas', 'https://plataformaelectoral.jne.gob.pe/'
    FROM _pc
   WHERE gob_n IS NOT NULL AND mismo_partido(org_n, gob_n) AND anio_cand BETWEEN anio_eleccion - 4 AND anio + 1
   GROUP BY entidad_ruc, ruc;

  -- candidato: de otro partido, en los 8 años antes de la orden o el siguiente.
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT c.entidad_ruc, c.ruc, 'candidato', 'baja',
         jsonb_build_object('por', min(c.por),
                            'candidaturas', jsonb_agg(DISTINCT jsonb_build_object('nombre', c.nombre, 'partido', c.partido, 'cargo', c.cargo,
                                                                                 'anio', c.anio_cand, 'resultado', c.resultado))),
         'jne_candidaturas', 'https://plataformaelectoral.jne.gob.pe/'
    FROM _pc c
   WHERE c.anio_cand BETWEEN c.anio - 8 AND c.anio + 1
     AND NOT (c.gob_n IS NOT NULL AND mismo_partido(c.org_n, c.gob_n))
     AND NOT EXISTS (SELECT 1 FROM persona_senal g WHERE g.entidad_ruc = c.entidad_ruc AND g.ruc = c.ruc AND g.tipo = 'candidato_gobierna')
   GROUP BY c.entidad_ruc, c.ruc;

  -- ── Aportes (ONPE, sólo con DNI). Cada aporte una vez aunque la persona tenga órdenes de varios años.
  CREATE TEMP TABLE _ap ON COMMIT DROP AS
  SELECT DISTINCT ON (p.entidad_ruc, p.ruc, a.id, (p.gob_n IS NOT NULL AND mismo_partido(mef_norm(a.partido), p.gob_n)))
         p.entidad_ruc, p.ruc, p.org_nombre, (p.gob_n IS NOT NULL AND mismo_partido(mef_norm(a.partido), p.gob_n)) AS al_que_gobierna,
         a.id, a.partido, a.monto, a.fecha_aporte, a."año" AS anio, a.nombre
    FROM _pa p JOIN onpe_aportantes a ON a.numero_documento = p.dni
   WHERE a.partido IS NOT NULL
   ORDER BY p.entidad_ruc, p.ruc, a.id, 4, p.anio DESC;
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT entidad_ruc, ruc, 'aporte_gobierna', 'media',
         jsonb_build_object('partido', max(org_nombre), 'monto', sum(monto),
                            'aportes', jsonb_agg(jsonb_build_object('nombre', nombre, 'partido', partido, 'monto', monto,
                                                                    'fecha', fecha_aporte, 'anio', anio) ORDER BY fecha_aporte)),
         'onpe_aportantes', 'https://claridad.onpe.gob.pe/'
    FROM _ap WHERE al_que_gobierna
   GROUP BY entidad_ruc, ruc;
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT entidad_ruc, ruc, 'aporte', 'baja',
         jsonb_build_object('monto', sum(monto),
                            'aportes', jsonb_agg(jsonb_build_object('nombre', nombre, 'partido', partido, 'monto', monto,
                                                                    'fecha', fecha_aporte, 'anio', anio) ORDER BY fecha_aporte)),
         'onpe_aportantes', 'https://claridad.onpe.gob.pe/'
    FROM _ap a
   WHERE NOT al_que_gobierna
     AND NOT EXISTS (SELECT 1 FROM _ap g WHERE g.entidad_ruc = a.entidad_ruc AND g.ruc = a.ruc AND g.id = a.id AND g.al_que_gobierna)
     AND NOT EXISTS (SELECT 1 FROM persona_senal g WHERE g.entidad_ruc = a.entidad_ruc AND g.ruc = a.ruc AND g.tipo = 'aporte_gobierna')
   GROUP BY entidad_ruc, ruc;

  -- ── Autoridades electas con su gobierno: JNE autoridades (ERM 2022 y complementarias, con ubigeo) y los electos de
  -- 2014 y 2018 de las candidaturas (el gobierno sale de los nombres de lugar, que vienen sin ubigeo).
  CREATE TEMP TABLE _zon ON COMMIT DROP AS
  SELECT d.ubigeo AS dist, p.ubigeo AS prov, r.ubigeo AS dep, mef_norm(d.nombre) AS dn, mef_norm(p.nombre) AS pn, mef_norm(r.nombre) AS rn
    FROM zonas d JOIN zonas p ON p.ubigeo = d.padre_ubigeo JOIN zonas r ON r.ubigeo = p.padre_ubigeo
   WHERE d.nivel = 'distrito';
  CREATE TEMP TABLE _el ON COMMIT DROP AS
  SELECT NULLIF(c.numero_documento, '') AS dni, mef_norm(c.nombre) AS nom_n, mef_norm(c.region) AS rn, mef_norm(c.provincia) AS pn,
         mef_norm(c.distrito) AS dn, c.nombre, c.cargo, c.partido, c."año" AS anio,
         CASE WHEN c.cargo ILIKE '%DISTRITAL' THEN 'distrital' WHEN c.cargo ILIKE '%PROVINCIAL' THEN 'provincial' ELSE 'regional' END AS nivel
    FROM jne_candidaturas c
   WHERE c."año" IN (2014, 2018) AND c.resultado = 'electo' AND c.cargo ~* '(DISTRITAL|PROVINCIAL|REGIONAL)$';
  CREATE TEMP TABLE _aut ON COMMIT DROP AS
  SELECT DISTINCT * FROM (
    SELECT NULLIF(a.dni, '') AS dni, mef_norm(a.nombre) AS nom_n, mef_norm(a.departamento) AS dep_n, a.nombre, a.cargo,
           a.organizacion_politica AS partido, a.periodo_inicio AS desde, COALESCE(a.periodo_fin, DATE '2026-12-31') AS hasta,
           CASE WHEN a.cargo ILIKE '%DISTRITAL' THEN 'distrital' WHEN a.cargo ILIKE '%PROVINCIAL' THEN 'provincial'
                WHEN a.cargo ILIKE '%REGIONAL' THEN 'regional' END AS nivel,
           CASE WHEN a.cargo ILIKE '%DISTRITAL' THEN a.ubigeo WHEN a.cargo ILIKE '%PROVINCIAL' THEN left(a.ubigeo, 4)
                WHEN a.cargo ILIKE '%REGIONAL' THEN left(a.ubigeo, 2) END AS gub
      FROM jne_autoridades a WHERE a.ubigeo IS NOT NULL AND a.periodo_inicio IS NOT NULL
    UNION ALL
    SELECT e.dni, e.nom_n, e.rn, e.nombre, e.cargo, e.partido, make_date(e.anio + 1, 1, 1), make_date(e.anio + 4, 12, 31), e.nivel,
           CASE e.nivel WHEN 'distrital' THEN zd.dist WHEN 'provincial' THEN zp.prov ELSE zr.dep END
      FROM _el e
      LEFT JOIN (SELECT DISTINCT ON (rn, pn, dn) rn, pn, dn, dist FROM _zon ORDER BY rn, pn, dn, dist) zd
             ON e.nivel = 'distrital' AND zd.rn = e.rn AND zd.pn = e.pn AND zd.dn = e.dn
      LEFT JOIN (SELECT DISTINCT ON (rn, pn) rn, pn, prov FROM _zon ORDER BY rn, pn, prov) zp
             ON e.nivel = 'provincial' AND zp.rn = e.rn AND zp.pn = e.pn
      LEFT JOIN (SELECT DISTINCT ON (rn) rn, dep FROM _zon ORDER BY rn, dep) zr
             ON e.nivel = 'regional' AND zr.rn = e.rn
  ) x WHERE nivel IS NOT NULL;
  ALTER TABLE _aut ADD COLUMN ap1 text, ADD COLUMN ap2 text;
  UPDATE _aut SET ap1 = split_part(nom_n, ' ', 1), ap2 = split_part(nom_n, ' ', 2);
  ANALYZE _aut;

  -- autoridad_contratada: la persona es la autoridad, con el mandato en curso.
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT entidad_ruc, ruc, 'autoridad_contratada',
         CASE max(CASE WHEN mismo THEN 3 WHEN cargo ~* '^(ALCALDE|GOBERNADOR|VICEGOBERNADOR)' THEN 2 ELSE 1 END)
              WHEN 3 THEN 'alta' WHEN 2 THEN 'media' ELSE 'baja' END,
         jsonb_build_object('mismo_gobierno', bool_or(mismo), 'por', min(por),
                            'autoridades', jsonb_agg(DISTINCT jsonb_build_object('nombre', nombre, 'cargo', cargo, 'partido', partido,
                                                                                'desde', desde, 'hasta', hasta, 'mismo_gobierno', mismo))),
         'jne_autoridades', 'https://plataformaelectoral.jne.gob.pe/'
    FROM (
      SELECT p.entidad_ruc, p.ruc, a.nombre, a.cargo, a.partido, a.desde, a.hasta,
             COALESCE(a.nivel = p.nivel AND a.gub = p.gub, false) AS mismo, 'dni' AS por
        FROM _pa p JOIN _aut a ON a.dni = p.dni
       WHERE p.primera <= a.hasta AND p.ultima >= a.desde
      UNION ALL
      SELECT p.entidad_ruc, p.ruc, a.nombre, a.cargo, a.partido, a.desde, a.hasta,
             COALESCE(a.nivel = p.nivel AND a.gub = p.gub, false), 'nombre'
        FROM _pa p JOIN _aut a ON a.nom_n = p.nom_n AND a.dep_n = p.dep_n
       WHERE a.dni IS NULL AND p.primera <= a.hasta AND p.ultima >= a.desde
    ) x
   GROUP BY entidad_ruc, ruc;

  -- apellidos_autoridad: los dos apellidos de una autoridad del gobierno de la entidad, en su mandato; no ella misma.
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT entidad_ruc, ruc, 'apellidos_autoridad', CASE WHEN min(frec) <= 20 THEN 'media' ELSE 'baja' END,
         jsonb_build_object('frecuencia', min(frec),
                            'autoridades', jsonb_agg(DISTINCT jsonb_build_object('nombre', nombre, 'cargo', cargo, 'partido', partido,
                                                                                'desde', desde, 'hasta', hasta))),
         'jne_autoridades', 'https://plataformaelectoral.jne.gob.pe/'
    FROM (
      SELECT p.entidad_ruc, p.ruc, a.nombre, a.cargo, a.partido, a.desde, a.hasta, f.frec
        FROM _pa p
        JOIN _aut a ON a.nivel = p.nivel AND a.gub = p.gub AND a.ap1 = p.ap1 AND a.ap2 = p.ap2
        JOIN _frec f ON f.ap1 = p.ap1 AND f.ap2 = p.ap2
       WHERE length(p.ap1) > 1 AND length(p.ap2) > 1
         AND p.primera <= a.hasta AND p.ultima >= a.desde
         AND a.nom_n <> p.nom_n AND (a.dni IS NULL OR a.dni <> p.dni)
    ) x
   GROUP BY entidad_ruc, ruc;

  -- ── DJI: quienes declararon trabajar en la entidad (por su nombre), en la declaración de cada año.
  CREATE TEMP TABLE _ent ON COMMIT DROP AS SELECT DISTINCT ent_n FROM _pa;
  CREATE TEMP TABLE _dji ON COMMIT DROP AS
  SELECT DISTINCT d.* FROM (
    SELECT mef_norm(f.entidad) AS ent_n, f.nombre_norm AS nom_n, mef_norm(f.apellido_paterno) AS ap1, mef_norm(f.apellido_materno) AS ap2,
           trim(COALESCE(f.nombres, '') || ' ' || COALESCE(f.apellido_paterno, '') || ' ' || COALESCE(f.apellido_materno, '')) AS nombre,
           f.cargo, extract(year FROM fecha_dji(f.fecha_presentacion))::int AS anio,
           fecha_dji(f.fecha_inicio_cargo) AS inicio, fecha_dji(f.fecha_cese_cargo) AS cese
      FROM dji_funcionarios f
     WHERE f.entidad IS NOT NULL AND f.nombre_norm IS NOT NULL
  ) d JOIN _ent e ON e.ent_n = d.ent_n;
  ANALYZE _dji;

  -- funcionario_contratado: la misma persona declaró trabajar en la entidad el año de las órdenes, con el cargo vigente.
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT p.entidad_ruc, p.ruc, 'funcionario_contratado', 'media',
         jsonb_build_object('anios', jsonb_agg(DISTINCT p.anio),
                            'cargos', jsonb_agg(DISTINCT jsonb_build_object('cargo', d.cargo, 'anio', d.anio, 'inicio', d.inicio, 'cese', d.cese))),
         'dji_contraloria', 'https://www.datosabiertos.gob.pe/'
    FROM _pa p JOIN _dji d ON d.ent_n = p.ent_n AND d.nom_n = p.nom_n
   WHERE d.anio = p.anio AND (d.inicio IS NULL OR d.inicio <= p.ultima) AND (d.cese IS NULL OR d.cese >= p.primera)
   GROUP BY p.entidad_ruc, p.ruc;

  -- apellidos_funcionario: los dos apellidos, poco comunes, de otro declarante de la entidad, ese año o el anterior.
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT p.entidad_ruc, p.ruc, 'apellidos_funcionario', 'media',
         jsonb_build_object('frecuencia', min(f.frec),
                            'funcionarios_designados', jsonb_agg(DISTINCT jsonb_build_object('nombre', d.nombre, 'cargo', d.cargo, 'anio', d.anio))),
         'dji_contraloria', 'https://www.datosabiertos.gob.pe/'
    FROM _pa p
    JOIN _dji d ON d.ent_n = p.ent_n AND d.ap1 = p.ap1 AND d.ap2 = p.ap2
    JOIN _frec f ON f.ap1 = p.ap1 AND f.ap2 = p.ap2
   WHERE f.frec <= 20 AND length(p.ap1) > 1 AND length(p.ap2) > 1 AND d.nom_n <> p.nom_n AND d.anio BETWEEN p.anio - 1 AND p.anio
   GROUP BY p.entidad_ruc, p.ruc;

  -- ── inhabilitado: órdenes emitidas dentro de una inhabilitación del Tribunal (temporal o definitiva).
  CREATE TEMP TABLE _san ON COMMIT DROP AS
  SELECT s.ruc, s.tipo, s.resolucion, s.fecha_desde, s.fecha_hasta, left(s.infraccion, 300) AS infraccion,
         COALESCE(s.fecha_hasta, CASE WHEN s.tipo = 'definitivo' THEN DATE '9999-12-31' END) AS hasta
    FROM osce_sancionados s
   WHERE s.ruc ~ '^10\d{9}$' AND s.tipo IN ('temporal', 'definitivo') AND s.fecha_desde IS NOT NULL
     AND s.ruc IN (SELECT ruc FROM persona_codigo);
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT o.entidad_ruc, o.ruc, 'inhabilitado', 'alta',
         jsonb_build_object('ordenes', count(*), 'monto', sum(o.monto),
                            'sanciones', (SELECT jsonb_agg(jsonb_build_object('tipo', s.tipo, 'resolucion', s.resolucion, 'desde', s.fecha_desde,
                                                                              'hasta', s.fecha_hasta, 'infraccion', s.infraccion) ORDER BY s.fecha_desde)
                                            FROM _san s WHERE s.ruc = o.ruc)),
         'osce_sancionados', 'https://www.gob.pe/tce'
    FROM (
      SELECT DISTINCT ON (c.entidad_ruc, c.orden, c.fecha_emision) c.entidad_ruc, c.ruc_contratista AS ruc, c.monto
        FROM _san s
        JOIN conosce_ordenes c ON c.ruc_contratista = s.ruc AND c.fecha_emision BETWEEN s.fecha_desde AND s.hasta
       WHERE c.tipo_orden = 'Orden de Servicio' AND c.estado IS DISTINCT FROM 'Anulada' AND c.moneda = 'Nuevos Soles' AND c.monto > 0
       ORDER BY c.entidad_ruc, c.orden, c.fecha_emision, c.anio DESC, c.mes DESC
    ) o
   GROUP BY o.entidad_ruc, o.ruc;

  -- ── meses_seguidos: órdenes en 10 o más meses de un mismo año.
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT entidad_ruc, ruc, 'meses_seguidos', 'media',
         jsonb_build_object('anios', jsonb_agg(jsonb_build_object('anio', anio, 'meses', meses, 'ordenes', ordenes, 'monto', monto) ORDER BY anio)),
         'conosce_ordenes', 'https://conosce.osce.gob.pe/buscador/'
    FROM persona_orden_anual WHERE meses >= 10
   GROUP BY entidad_ruc, ruc;

  -- ── Lo que se paga por mes por cada tipo de servicio, en cada entidad y en todo el país.
  DELETE FROM servicio_referencia;
  INSERT INTO servicio_referencia (entidad_ruc, anio, servicio, personas, mediana_mes, p25_mes, p75_mes, p90_mes)
  SELECT entidad_ruc, anio, servicio, count(*),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY monto / meses), percentile_cont(0.25) WITHIN GROUP (ORDER BY monto / meses),
         percentile_cont(0.75) WITHIN GROUP (ORDER BY monto / meses), percentile_cont(0.9) WITHIN GROUP (ORDER BY monto / meses)
    FROM persona_orden_anual WHERE servicio IS NOT NULL AND meses > 0
   GROUP BY entidad_ruc, anio, servicio
  UNION ALL
  SELECT '', anio, servicio, count(*),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY monto / meses), percentile_cont(0.25) WITHIN GROUP (ORDER BY monto / meses),
         percentile_cont(0.75) WITHIN GROUP (ORDER BY monto / meses), percentile_cont(0.9) WITHIN GROUP (ORDER BY monto / meses)
    FROM persona_orden_anual WHERE servicio IS NOT NULL AND meses > 0
   GROUP BY anio, servicio;

  -- pago_alto: 2,5 veces o más la mediana por mes de la entidad para ese servicio (con 10 personas o más), y
  -- S/ 6,000 o más por mes, con órdenes en dos meses o más (una sola orden grande puede pagar varios meses de trabajo).
  -- Sólo servicios que son el trabajo de una persona, y no "otros servicios personales" (mezcla demasiado).
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT a.entidad_ruc, a.ruc, 'pago_alto', 'media',
         jsonb_build_object('anios', jsonb_agg(jsonb_build_object('anio', a.anio, 'servicio', a.servicio, 'por_mes', round(a.monto / a.meses, 2),
                                                                  'mediana_mes', r.mediana_mes, 'personas', r.personas,
                                                                  'veces', round(a.monto / a.meses / r.mediana_mes, 1)) ORDER BY a.anio)),
         'conosce_ordenes', 'https://conosce.osce.gob.pe/buscador/'
    FROM persona_orden_anual a
    JOIN servicio_referencia r ON r.entidad_ruc = a.entidad_ruc AND r.anio = a.anio AND r.servicio = a.servicio
   WHERE servicio_es_personal(a.servicio) AND a.servicio <> 'Otros servicios personales' AND a.meses >= 2
     AND r.personas >= 10 AND r.mediana_mes > 0
     AND a.monto / a.meses >= 2.5 * r.mediana_mes AND a.monto / a.meses >= 6000
   GROUP BY a.entidad_ruc, a.ruc;

  -- ── visita_previa: registro de visitas (con DNI) a la misma entidad, hasta 180 días antes de la primera orden del año.
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT p.entidad_ruc, p.ruc, 'visita_previa', 'baja',
         jsonb_build_object('visitas', jsonb_agg(DISTINCT jsonb_build_object('fecha', v.fecha_visita, 'cargo_visitado', v.funcionario_cargo,
                                                                            'area', v.funcionario_area, 'motivo', left(v.motivo, 200)))),
         'visitas_entidades', 'https://visitas.servicios.gob.pe/'
    FROM _pa p JOIN visitas_entidades v ON v.numero_documento = p.dni
   WHERE mef_norm(v.entidad_visitada) = p.ent_n AND v.fecha_visita BETWEEN p.primera - 180 AND p.primera
   GROUP BY p.entidad_ruc, p.ruc;

  -- ── Lo que sale de la planilla (migración 92: tambien_planilla, antes_locador), si ya está.
  IF to_regprocedure('senales_planilla_de_personas()') IS NOT NULL THEN
    PERFORM senales_planilla_de_personas();
  END IF;

  -- ── Resumen por persona y entidad, para las listas.
  CREATE TEMP TABLE _ps ON COMMIT DROP AS
  SELECT entidad_ruc, ruc, array_agg(tipo ORDER BY tipo) AS tipos, count(*)::int AS n,
         max(CASE severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END)::smallint AS sev,
         jsonb_agg(jsonb_build_object('tipo', tipo, 'severidad', severidad)
                   ORDER BY CASE severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, tipo) AS senales
    FROM persona_senal GROUP BY entidad_ruc, ruc;

  DELETE FROM persona_entidad;
  INSERT INTO persona_entidad (entidad_ruc, ruc, codigo, entidad, nombre, dep, servicio, ordenes, meses, monto, primera, ultima, anios,
                               gobiernos, tipos, senales, n_senales, sev)
  SELECT p.entidad_ruc, p.ruc, pc.codigo, max(p.entidad), max(p.nombre), max(left(e.ubigeo, 2)),
         (array_agg(p.servicio ORDER BY p.monto DESC))[1],
         sum(p.ordenes), sum(p.meses), sum(p.monto), min(p.primera), max(p.ultima), array_agg(p.anio ORDER BY p.anio),
         COALESCE(array_agg(DISTINCT p.org_clave || ':' || p.anio_eleccion) FILTER (WHERE p.org_clave IS NOT NULL), '{}'),
         COALESCE(max(s.tipos), '{}'), COALESCE((array_agg(s.senales))[1], '[]'), COALESCE(max(s.n), 0), COALESCE(max(s.sev), 0)
    FROM _pa p
    JOIN persona_codigo pc ON pc.ruc = p.ruc
    LEFT JOIN entidades e ON e.ruc = p.entidad_ruc
    LEFT JOIN _ps s ON s.entidad_ruc = p.entidad_ruc AND s.ruc = p.ruc
   GROUP BY p.entidad_ruc, p.ruc, pc.codigo;
  GET DIAGNOSTICS n = ROW_COUNT;

  -- ── El resumen de cada alcance (lo que GET /personas devuelve como `resumen`).
  CREATE TEMP TABLE _rb ON COMMIT DROP AS
  SELECT x.alcance, pe.ruc, pe.monto, pe.ordenes, pe.n_senales, pe.sev, pe.tipos, pe.servicio, pe.anios
    FROM persona_entidad pe
    CROSS JOIN LATERAL (
      SELECT 'pais' AS alcance
      UNION ALL SELECT 'dep:' || pe.dep WHERE pe.dep IS NOT NULL
      UNION ALL SELECT 'ent:' || pe.entidad_ruc
      UNION ALL SELECT 'par:' || g FROM unnest(pe.gobiernos) g
    ) x;
  DELETE FROM persona_resumen;
  INSERT INTO persona_resumen (alcance, resumen)
  SELECT t.alcance, jsonb_build_object(
           'filas', t.filas, 'personas', t.personas, 'monto', t.monto, 'ordenes', t.ordenes, 'conSenales', t.con,
           'alta', t.alta, 'media', t.media, 'baja', t.baja,
           'porSenal', COALESCE(ps.l, '[]'), 'porServicio', COALESCE(sv.l, '[]'), 'porAnio', COALESCE(pa.l, '[]'))
    FROM (SELECT alcance, count(*)::int AS filas, count(DISTINCT ruc)::int AS personas, COALESCE(sum(monto), 0)::float AS monto,
                 COALESCE(sum(ordenes), 0)::int AS ordenes, count(*) FILTER (WHERE n_senales > 0)::int AS con,
                 count(*) FILTER (WHERE sev = 3)::int AS alta, count(*) FILTER (WHERE sev = 2)::int AS media,
                 count(*) FILTER (WHERE sev = 1)::int AS baja
            FROM _rb GROUP BY alcance) t
    LEFT JOIN (SELECT alcance, jsonb_agg(jsonb_build_object('tipo', tipo, 'n', c) ORDER BY c DESC) AS l
                 FROM (SELECT alcance, tipo, count(*)::int AS c FROM _rb, unnest(_rb.tipos) tipo GROUP BY 1, 2) z GROUP BY alcance) ps
           ON ps.alcance = t.alcance
    LEFT JOIN (SELECT alcance, jsonb_agg(jsonb_build_object('servicio', servicio, 'n', c, 'monto', m) ORDER BY c DESC) AS l
                 FROM (SELECT alcance, COALESCE(servicio, 'Otros') AS servicio, count(*)::int AS c, sum(monto)::float AS m FROM _rb GROUP BY 1, 2) z
                GROUP BY alcance) sv
           ON sv.alcance = t.alcance
    LEFT JOIN (SELECT alcance, jsonb_agg(jsonb_build_object('anio', anio, 'n', c) ORDER BY anio) AS l
                 FROM (SELECT alcance, a AS anio, count(*)::int AS c FROM _rb, unnest(_rb.anios) a GROUP BY 1, 2) z GROUP BY alcance) pa
           ON pa.alcance = t.alcance;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_personas_senales() OWNER TO vigia_jobs;

-- ── 5 · Permisos ───────────────────────────────────────────────────────────────────────────────
-- Llevan RUC 10 y nombres completos: sólo la API (que tapa con publicar()) y el panel. Ni el MCP ni los agentes.
GRANT SELECT ON persona_codigo, persona_orden_anual, servicio_referencia, persona_senal, persona_entidad, persona_resumen TO vigia_api, vigia_api_admin;
GRANT EXECUTE ON FUNCTION servicio_persona(text), servicio_es_personal(text), mismo_partido(text, text), fecha_dji(text)
  TO vigia_jobs, vigia_api, vigia_api_admin;
REVOKE EXECUTE ON FUNCTION refrescar_personas_ordenes(date), refrescar_personas_senales(), refrescar_fraccionamiento(date) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_agentes') THEN
    REVOKE ALL ON persona_codigo, persona_orden_anual, servicio_referencia, persona_senal, persona_entidad, persona_resumen FROM vigia_agentes;
  END IF;
END $$;
