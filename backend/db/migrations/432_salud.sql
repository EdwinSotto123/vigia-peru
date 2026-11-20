-- 432 · Gobserva Salud (salud.gobserva.cloud): verificar establecimientos de salud y médicos con fuentes oficiales.
--
-- Qué se carga y de dónde (todo de la Superintendencia Nacional de Salud, SUSALUD; ver docs/SALUD.md):
--   salud_ipress           RENIPRESS: el registro de las IPRESS (públicas, privadas y mixtas), CSV de datos abiertos
--                          (datos.susalud.gob.pe, «Registro Nacional de IPRESS - RENIPRESS»). Una fila por código único.
--   salud_ipress_cambio    lo que cambió de una IPRESS entre dos cargas (estado, categoría, nombre, dirección…): la
--                          historia que el CSV no guarda.
--   salud_ipress_detalle   la consulta pública por código de RENIPRESS (app20.susalud.gob.pe, «Búsqueda de IPRESS por
--                          código»): propietario (sólo si es persona jurídica), categorización con su resolución, servicios
--                          (UPSS, UPS), especialidades, cartera de servicios y el colegio y número de colegiatura de quien
--                          responde por la atención. NUNCA el nombre ni el documento de una persona: el cargador no los
--                          guarda (RENIPRESS los muestra; nosotros no).
--   salud_sancion          el Registro de Sanciones de SUSALUD (gob.pe, XLSX): las sanciones FIRMES impuestas a IPRESS,
--                          IAFAS y UGIPRESS. Una sanción que deja de figurar en el registro no se borra (queda con
--                          `en_registro = false`) pero tampoco se publica: pudo ser anulada.
--   salud_denuncia_anual   el reporte anonimizado de consultas y denuncias ante SUSALUD, contado por institución y año.
--                          Son pedidos de ciudadanos, NO hechos comprobados: se muestran siempre con ese rótulo.
--   salud_recursos         recursos declarados por IPRESS (consultorios, camas, médicos…), el último mes publicado.
--   salud_cirugia_mes      producción de intervenciones quirúrgicas declarada por IPRESS, por mes.
--   salud_indicador        lo anterior resumido por IPRESS (salud_refrescar()): lo leen la lista, el mapa y la ficha.
--   salud_detalle_pedido   las fichas que la gente abrió y no tienen detalle (o es viejo): el cargador las lee primero.
--
-- Trazabilidad: cada archivo cargado queda en datasets_cargas (fuente susalud_*, sha256, URL y fecha); cada fila guarda
-- cuándo apareció y cuándo se vio por última vez. Lo que dice RENIPRESS es declaración jurada de la IPRESS (art. 7 de la
-- R.S. N.° 004-2021-SUSALUD/S): la web lo dice junto al dato.

CREATE TABLE IF NOT EXISTS salud_ipress (
  codigo            text PRIMARY KEY,           -- código único de IPRESS, 8 cifras
  nombre            text NOT NULL,
  nombre_norm       text NOT NULL,              -- mayúsculas sin tildes ni signos: búsqueda y cruces
  institucion       text,                       -- PRIVADO, GOBIERNO REGIONAL, MINSA, ESSALUD, SANIDAD…, tal como viene
  sector            text,                       -- publico | privado | otro (de `institucion`)
  clasificacion     text,
  tipo              text,                       -- con o sin internamiento, servicio médico de apoyo…
  categoria         text,                       -- I-1 … III-2, II-E, III-E; NULL si RENIPRESS dice «0» (sin categoría)
  estado            text,                       -- ACTIVO, CIERRE TEMPORAL DE OFICIO, BAJA DEFINITIVA…
  activo            boolean NOT NULL DEFAULT false,
  departamento      text,
  provincia         text,
  distrito          text,
  ubigeo            text,
  direccion         text,
  disa              text,
  red               text,
  microred          text,
  unidad_ejecutora  text,
  cod_ue            int,
  telefono          text,                       -- el del establecimiento (público en RENIPRESS)
  horario           text,
  inicio_actividad  date,                       -- NULL si RENIPRESS trae 1900-01-01 (sin dato)
  lat               double precision,
  lon               double precision,
  imagenes          text[],
  huella            text NOT NULL,              -- md5 de los campos que se comparan entre cargas
  fuente_archivo    text,                       -- el CSV de donde salió la versión vigente
  primera_vez       timestamptz NOT NULL DEFAULT now(),
  cambio_at         timestamptz,
  visto_at          timestamptz NOT NULL DEFAULT now(),
  en_registro       boolean NOT NULL DEFAULT true  -- false: ya no figura en el último CSV de RENIPRESS
);
CREATE INDEX IF NOT EXISTS salud_ipress_nombre_trgm ON salud_ipress USING gin (nombre_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS salud_ipress_ubigeo ON salud_ipress (ubigeo);
CREATE INDEX IF NOT EXISTS salud_ipress_depto ON salud_ipress (departamento, categoria);

CREATE TABLE IF NOT EXISTS salud_ipress_cambio (
  id          bigserial PRIMARY KEY,
  codigo      text NOT NULL,
  campo       text NOT NULL,                    -- estado, categoria, nombre, direccion, tipo, institucion…; «alta» o «baja_registro»
  antes       text,
  despues     text,
  detectado   timestamptz NOT NULL DEFAULT now(),
  fuente      text NOT NULL                     -- renipress_csv | renipress_detalle
);
CREATE INDEX IF NOT EXISTS salud_ipress_cambio_codigo ON salud_ipress_cambio (codigo, detectado DESC);

CREATE TABLE IF NOT EXISTS salud_ipress_detalle (
  codigo                   text PRIMARY KEY,
  ruc                      text,                -- del propietario, sólo si es RUC 20 (persona jurídica o entidad)
  razon_social             text,                -- sólo con RUC 20
  propietario_natural      boolean,             -- el propietario es una persona natural (no se nombra)
  categoria                text,
  categoria_documento      text,                -- «RESOLUCIÓN RD N° 049-2022»
  categoria_fecha          date,
  resolucion_creacion      text,
  fecha_registro           date,                -- alta en RENIPRESS
  ambientes                int,
  camas                    int,
  upss                     jsonb NOT NULL DEFAULT '[]',   -- [{codigo, nombre, estado}] Unidades Productoras de Servicios de Salud
  ups                      jsonb NOT NULL DEFAULT '[]',   -- [{codigo, nombre, estado}]
  upss_suspendidas         jsonb NOT NULL DEFAULT '[]',
  especialidades           jsonb NOT NULL DEFAULT '[]',   -- [{codigo, nombre}]
  cartera                  jsonb NOT NULL DEFAULT '[]',   -- [{codigo, nombre}]
  documentos               jsonb NOT NULL DEFAULT '[]',   -- [{tipo, numero, fecha, adjunto, id}] lo que la IPRESS declaró:
                                                          -- licencia municipal, compatibilidad de uso, resoluciones…
  categoria_doc_id         text,                -- el archivo de la resolución de categorización en RENIPRESS
  telefono_emergencia      text,
  consultores              jsonb NOT NULL DEFAULT '[]',   -- telesalud: [{codigo, nombre}] IPRESS que le dan teleconsulta
  responsable_colegio      text,                -- COLEGIO MEDICO DEL PERU, COLEGIO DE ENFERMEROS DEL PERU…
  responsable_colegiatura  text,                -- sin ceros a la izquierda
  responsable_rne          text,                -- Registro Nacional de Especialidad; NULL si no tiene
  situacion_estado         text,
  situacion_condicion      text,
  historial                jsonb NOT NULL DEFAULT '[]',   -- [{estado, condicion, motivo, inicio, fin, cierre}]
  huella                   text,
  leido_at                 timestamptz,
  intentos                 int NOT NULL DEFAULT 0,
  error                    text,
  proximo_at               timestamptz          -- tras un error, no antes de esto
);
CREATE INDEX IF NOT EXISTS salud_ipress_detalle_colegiatura ON salud_ipress_detalle (responsable_colegiatura) WHERE responsable_colegiatura IS NOT NULL;
CREATE INDEX IF NOT EXISTS salud_ipress_detalle_ruc ON salud_ipress_detalle (ruc) WHERE ruc IS NOT NULL;

CREATE TABLE IF NOT EXISTS salud_detalle_pedido (
  codigo     text PRIMARY KEY,
  pedido_at  timestamptz NOT NULL DEFAULT now(),
  veces      int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS salud_sancion (
  id                   text PRIMARY KEY,        -- md5 de los campos que identifican la fila en el registro
  administrada_tipo    text,                    -- IPRESS | IAFAS | UGIPRESS
  naturaleza           text,                    -- Pública | Privada | Mixta
  institucion          text,
  codigo_registro      text,                    -- tal como viene («9409», «SIN CÓDIGO ÚNICO»)
  ipress_codigo        text,                    -- el código de 8 cifras si se unió a una IPRESS de RENIPRESS
  enlace               text,                    -- codigo | codigo_otro_nombre | nombre | NULL (sin unir)
  nombre               text NOT NULL,           -- razón social o nombre comercial, como lo registró SUSALUD
  pas                  text,                    -- procedimiento administrativo sancionador
  resolucion           text,
  fecha_emision        date,
  fecha_notificacion   date,
  fecha_inscripcion    date,
  tipo_sancion         text,                    -- amonestacion | multa | cierre_definitivo | otra
  tipo_sancion_texto   text,
  multa_uit            numeric,
  medidas_correctivas  text,
  ejecucion_forzosa    text,
  judicializacion      text,
  judicializada        boolean NOT NULL DEFAULT false,
  cancelacion          text,
  departamento         text,
  provincia            text,
  distrito             text,
  infraccion_codigo    text,
  gravedad             text,                    -- leve | grave | muy_grave (del código del Reglamento, D.S. 031-2014-SA)
  infraccion           text,
  normas               text,
  fuente_url           text,
  fuente_archivo       text,
  primera_vez          timestamptz NOT NULL DEFAULT now(),
  visto_at             timestamptz NOT NULL DEFAULT now(),
  en_registro          boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS salud_sancion_ipress ON salud_sancion (ipress_codigo) WHERE ipress_codigo IS NOT NULL;
CREATE INDEX IF NOT EXISTS salud_sancion_fecha ON salud_sancion (fecha_emision DESC);

-- El catálogo de infracciones del Reglamento (hoja «RIS» del mismo archivo): explica cada código en palabras de la norma.
CREATE TABLE IF NOT EXISTS salud_infraccion (
  codigo      text PRIMARY KEY,                 -- III-A-Leve-27
  administrado text,
  anexo       text,
  gravedad    text,
  detalle     text
);

CREATE TABLE IF NOT EXISTS salud_denuncia_anual (
  codigo        text NOT NULL,                  -- CO_INSTITUCION: código de IPRESS (8 cifras) u otro de la institución
  anio          int NOT NULL,
  tipo_inst     text,                           -- IPRESS, IAFAS, SUSALUD…
  nombre        text,
  consultas     int NOT NULL DEFAULT 0,
  denuncias     int NOT NULL DEFAULT 0,
  de_oficio     int NOT NULL DEFAULT 0,         -- intervenciones de oficio de SUSALUD
  fuente_archivo text,
  PRIMARY KEY (codigo, anio)
);

CREATE TABLE IF NOT EXISTS salud_recursos (
  codigo                 text PRIMARY KEY,
  anio                   int NOT NULL,
  mes                    int NOT NULL,
  consultorios           int,
  consultorios_funcionales int,
  camas                  int,
  medicos                int,
  medicos_serums         int,
  medicos_residentes     int,
  enfermeras             int,
  odontologos            int,
  psicologos             int,
  nutricionistas         int,
  tecnologos             int,
  obstetrices            int,
  farmaceuticos          int,
  auxiliares             int,
  otros_profesionales    int,
  ambulancias            int,
  fuente_archivo         text
);

CREATE TABLE IF NOT EXISTS salud_cirugia_mes (
  codigo        text NOT NULL,
  anio          int NOT NULL,
  mes           int NOT NULL,
  programacion  int NOT NULL,                   -- 1 programada, 2 de emergencia (diccionario de SUSALUD); 0 sin dato
  mayores       int,
  menores       int,
  horas_programadas numeric,
  horas_efectivas   numeric,
  horas_acto        numeric,
  suspendidas   int,
  fuente_archivo text,
  PRIMARY KEY (codigo, anio, mes, programacion)
);

CREATE TABLE IF NOT EXISTS salud_indicador (
  codigo              text PRIMARY KEY,
  sanciones           int NOT NULL DEFAULT 0,   -- firmes y en el registro
  sanciones_multa_uit numeric,
  ultima_sancion      date,
  cierre_definitivo   boolean NOT NULL DEFAULT false,
  sanciones_judicializadas int NOT NULL DEFAULT 0,
  denuncias_anio      int,                      -- el último año publicado
  consultas_anio      int,
  denuncias_de        int,                      -- qué año
  cirugias_12m        int,                      -- mayores + menores declaradas en los últimos 12 meses publicados
  cirugias_hasta      date,
  medicos             int,
  camas               int,
  recursos_al         date,
  ruc                 text,
  razon_social        text,
  con_detalle         boolean NOT NULL DEFAULT false,
  quirurgico          boolean,                  -- tiene la UPSS de centro quirúrgico activa según el detalle (NULL sin detalle)
  internamiento       boolean,
  actualizado         timestamptz NOT NULL DEFAULT now()
);

/*
 * Une cada sanción a su IPRESS y rehace salud_indicador. La corren las cargas de SUSALUD al terminar (unos segundos).
 *   · Con código numérico de una IPRESS: se une por el código (lo asignó SUSALUD en su propio registro). Si ni el nombre
 *     comercial ni la razón social se parecen al nombre de la sanción, `enlace = codigo_otro_nombre`: la ficha muestra a
 *     nombre de quién se registró (2026-11-20: 34 de 2 604, casi todas razón social contra nombre comercial).
 *   · Sin código: sólo si hay UNA IPRESS con el mismo nombre normalizado en el mismo departamento (`enlace = nombre`).
 */
CREATE OR REPLACE FUNCTION salud_refrescar() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET work_mem = '64MB' AS $$
DECLARE
  unidas_codigo int; unidas_nombre int; otro_nombre int; ind int;
BEGIN
  UPDATE salud_sancion s SET ipress_codigo = NULL, enlace = NULL WHERE s.ipress_codigo IS NOT NULL OR s.enlace IS NOT NULL;

  WITH c AS (
    SELECT s.id, i.codigo,
           (similarity(mef_norm(s.nombre), i.nombre_norm) >= 0.25
            OR (d.razon_social IS NOT NULL AND similarity(mef_norm(s.nombre), mef_norm(d.razon_social)) >= 0.35)
            OR position(i.nombre_norm IN mef_norm(s.nombre)) > 0
            OR position(mef_norm(s.nombre) IN i.nombre_norm) > 0) AS parecido
      FROM salud_sancion s
      JOIN salud_ipress i ON i.codigo = lpad(s.codigo_registro, 8, '0')
      LEFT JOIN salud_ipress_detalle d ON d.codigo = i.codigo
     WHERE s.administrada_tipo = 'IPRESS' AND s.codigo_registro ~ '^\d{1,8}$'
  )
  UPDATE salud_sancion s SET ipress_codigo = c.codigo, enlace = CASE WHEN c.parecido THEN 'codigo' ELSE 'codigo_otro_nombre' END
    FROM c WHERE c.id = s.id;
  GET DIAGNOSTICS unidas_codigo = ROW_COUNT;

  WITH cand AS (
    SELECT s.id, min(i.codigo) AS codigo, count(*) AS n
      FROM salud_sancion s
      JOIN salud_ipress i ON i.nombre_norm = mef_norm(s.nombre)
                         AND mef_norm(coalesce(i.departamento, '')) = mef_norm(coalesce(s.departamento, ''))
     WHERE s.ipress_codigo IS NULL AND s.administrada_tipo = 'IPRESS'
     GROUP BY s.id
  )
  UPDATE salud_sancion s SET ipress_codigo = cand.codigo, enlace = 'nombre' FROM cand WHERE cand.id = s.id AND cand.n = 1;
  GET DIAGNOSTICS unidas_nombre = ROW_COUNT;
  SELECT count(*) INTO otro_nombre FROM salud_sancion WHERE enlace = 'codigo_otro_nombre';

  TRUNCATE salud_indicador;
  INSERT INTO salud_indicador (codigo, sanciones, sanciones_multa_uit, ultima_sancion, cierre_definitivo, sanciones_judicializadas,
                               denuncias_anio, consultas_anio, denuncias_de, cirugias_12m, cirugias_hasta, medicos, camas,
                               recursos_al, ruc, razon_social, con_detalle, quirurgico, internamiento)
  SELECT i.codigo,
         coalesce(s.n, 0), s.uit, s.ultima, coalesce(s.cierre, false), coalesce(s.judicial, 0),
         dn.denuncias, dn.consultas, dn.anio,
         q.total, q.hasta,
         r.medicos, coalesce(d.camas, r.camas), CASE WHEN r.anio IS NOT NULL THEN make_date(r.anio, r.mes, 1) END,
         d.ruc, d.razon_social, d.leido_at IS NOT NULL,
         CASE WHEN d.leido_at IS NULL THEN NULL
              ELSE EXISTS (SELECT 1 FROM jsonb_array_elements(d.upss) u
                            WHERE (u->>'nombre') ILIKE '%QUIR%RGIC%' AND coalesce(u->>'estado', 'ACTIVO') ILIKE 'ACTIVO%') END,
         i.tipo ILIKE '%CON INTERNAMIENTO%'
    FROM salud_ipress i
    LEFT JOIN salud_ipress_detalle d ON d.codigo = i.codigo
    LEFT JOIN salud_recursos r ON r.codigo = i.codigo
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS n, sum(x.multa_uit) AS uit, max(x.fecha_emision) AS ultima,
             bool_or(x.tipo_sancion = 'cierre_definitivo') AS cierre, count(*) FILTER (WHERE x.judicializada)::int AS judicial
        FROM salud_sancion x WHERE x.ipress_codigo = i.codigo AND x.en_registro) s ON true
    LEFT JOIN LATERAL (
      SELECT a.anio, a.denuncias, a.consultas FROM salud_denuncia_anual a
       WHERE a.codigo = i.codigo ORDER BY a.anio DESC LIMIT 1) dn ON true
    LEFT JOIN LATERAL (
      SELECT sum(coalesce(m.mayores, 0) + coalesce(m.menores, 0))::int AS total, max(make_date(m.anio, m.mes, 1)) AS hasta
        FROM salud_cirugia_mes m
       WHERE m.codigo = i.codigo
         AND make_date(m.anio, m.mes, 1) > (SELECT max(make_date(anio, mes, 1)) FROM salud_cirugia_mes) - interval '12 months'
      HAVING count(*) FILTER (WHERE m.mayores IS NOT NULL OR m.menores IS NOT NULL) > 0) q ON true;
  GET DIAGNOSTICS ind = ROW_COUNT;
  ANALYZE salud_indicador;
  RETURN jsonb_build_object('sanciones_por_codigo', unidas_codigo, 'sanciones_por_nombre', unidas_nombre,
                            'codigo_otro_nombre', otro_nombre, 'indicadores', ind);
END $$;

-- Una ficha abierta sin detalle (o con uno de más de 30 días): el cargador la lee primero. La llama la API.
CREATE OR REPLACE FUNCTION salud_pedir_detalle(p_codigo text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO salud_detalle_pedido (codigo) SELECT p_codigo WHERE p_codigo ~ '^\d{8}$'
  ON CONFLICT (codigo) DO UPDATE SET pedido_at = now(), veces = salud_detalle_pedido.veces + 1
$$;

/*
 * El RAG de normas de salud (materia 'salud' en `norma`, cargadas con backend/scripts/cargar_normas.py). Lo usa el
 * asistente de Gobserva Salud y el MCP. Corpus chico (unas miles de piezas): el vector se compara contra todas sus
 * piezas sin pasar por el índice HNSW, que con el filtro de materia podía dejarlas fuera de sus 300 vecinos.
 */
CREATE OR REPLACE FUNCTION buscar_norma_salud(p_q TEXT, p_vec halfvec, p_n INT DEFAULT 12)
RETURNS TABLE (id BIGINT, slug TEXT, documento TEXT, numero TEXT, tipo TEXT, jerarquia SMALLINT, fecha_emision DATE,
               vigencia_hasta DATE, articulo TEXT, epigrafe TEXT, texto TEXT, url_oficial TEXT, puntaje DOUBLE PRECISION)
LANGUAGE sql STABLE AS $$
  WITH permitidas AS (
    SELECT n.* FROM norma n
     WHERE n.materia = 'salud' AND (n.vigencia_hasta IS NULL OR n.vigencia_hasta >= CURRENT_DATE)
  ),
  consulta AS (
    SELECT to_tsquery('spanish', string_agg(l, ' | ')) AS q
      FROM unnest(tsvector_to_array(to_tsvector('spanish', translate(lower(p_q), 'áéíóúüñ', 'aeiouun')))) l
  ),
  palabras AS (
    SELECT f.id, row_number() OVER (ORDER BY ts_rank_cd(f.tsv, c.q, 32) + 0.5 * ts_rank_cd(f.tsv_titulo, c.q, 32) DESC)::int AS rango
      FROM norma_fragmento f JOIN permitidas p ON p.slug = f.slug, consulta c
     WHERE c.q IS NOT NULL AND f.tsv @@ c.q
     LIMIT 60
  ),
  vector AS (
    SELECT f.id, row_number() OVER (ORDER BY f.embedding <=> p_vec)::int AS rango
      FROM norma_fragmento f JOIN permitidas p ON p.slug = f.slug
     WHERE p_vec IS NOT NULL AND f.embedding IS NOT NULL
     ORDER BY f.embedding <=> p_vec
     LIMIT 60
  ),
  fusion AS (
    SELECT COALESCE(a.id, v.id) AS id,
           COALESCE(1.0 / (60 + a.rango), 0) + COALESCE(1.0 / (60 + v.rango), 0) AS rrf
      FROM palabras a FULL JOIN vector v ON v.id = a.id
  )
  SELECT f.id, p.slug, p.documento, p.numero, p.tipo, p.jerarquia, p.fecha_emision, p.vigencia_hasta, f.articulo, f.epigrafe,
         f.texto, p.url_oficial,
         x.rrf * (CASE p.jerarquia WHEN 1 THEN 1.30 WHEN 2 THEN 1.25 WHEN 3 THEN 0.90 WHEN 4 THEN 1.10 WHEN 5 THEN 1.00 ELSE 0.80 END) AS puntaje
    FROM fusion x JOIN norma_fragmento f ON f.id = x.id JOIN permitidas p ON p.slug = f.slug
   ORDER BY puntaje DESC
   LIMIT GREATEST(p_n, 1)
$$;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE salud_ipress OWNER TO vigia_jobs;
    ALTER TABLE salud_ipress_cambio OWNER TO vigia_jobs;
    ALTER SEQUENCE salud_ipress_cambio_id_seq OWNER TO vigia_jobs;
    ALTER TABLE salud_ipress_detalle OWNER TO vigia_jobs;
    ALTER TABLE salud_detalle_pedido OWNER TO vigia_jobs;
    ALTER TABLE salud_sancion OWNER TO vigia_jobs;
    ALTER TABLE salud_infraccion OWNER TO vigia_jobs;
    ALTER TABLE salud_denuncia_anual OWNER TO vigia_jobs;
    ALTER TABLE salud_recursos OWNER TO vigia_jobs;
    ALTER TABLE salud_cirugia_mes OWNER TO vigia_jobs;
    ALTER TABLE salud_indicador OWNER TO vigia_jobs;
    ALTER FUNCTION salud_refrescar() OWNER TO vigia_jobs;
    ALTER FUNCTION salud_pedir_detalle(text) OWNER TO vigia_jobs;
    ALTER FUNCTION buscar_norma_salud(TEXT, halfvec, INT) OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON salud_ipress, salud_ipress_cambio, salud_ipress_detalle, salud_sancion, salud_infraccion,
                      salud_denuncia_anual, salud_recursos, salud_cirugia_mes, salud_indicador TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION salud_pedir_detalle(text), buscar_norma_salud(TEXT, halfvec, INT) TO %I', r);
    END IF;
  END LOOP;
  -- Los roles de DEV (dev_api, dev_api_admin) heredan de vigia_api y vigia_api_admin.
END $$;
REVOKE EXECUTE ON FUNCTION salud_refrescar() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION salud_pedir_detalle(text) FROM PUBLIC;

-- La búsqueda general de normas (la de los contratos) no trae las de salud: sólo se piden con buscar_norma_salud().
-- Misma función de la migración 331 con 'salud' en la lista de materias excluidas.
SELECT '[1,2,3]'::vector <=> '[1,2,3]'::vector AS pgvector_cargado;
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('buscar_norma(text, halfvec, date, integer, text[], text[])'::regprocedure) INTO def;
  IF position('''integridad'', ''salud''' IN def) = 0 THEN
    def := replace(def, 'n.materia NOT IN (''empleo_publico'', ''especial'', ''integridad'')',
                        'n.materia NOT IN (''empleo_publico'', ''especial'', ''integridad'', ''salud'')');
    -- pg_get_functiondef trae el SET de hnsw.ef_search: se reemplaza la función entera, con su configuración.
    EXECUTE def;
  END IF;
END $$;
