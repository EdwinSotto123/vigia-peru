-- 271: automatización de empleo público (2026-11-08). El plan está en docs/automatizacion_cas.md: leer todas las plazas
-- CAS y prácticas del Estado, sus bases y los pasos para postular, y avisar cuando algo cambia.
--
-- Lo que agrega:
--   - servir_practica: las prácticas de Talento Perú (`modalidades_formativas`). Van en tabla hermana porque el detalle de
--     una práctica NO trae número de aviso: su identidad es entidad + número de convocatoria + año + título + unidad.
--   - servir_convocatoria.listado / modalidad: de qué listado salió cada plaza CAS (`ofertas_laborales`,
--     `contratacion_directa`) y qué modalidad es (`cas`, `276`, `728`, `30057`, `otro`; generada del número).
--   - empleo_fuente: una fila por sitio de convocatorias (dominio), con su familia (A-H del plan), adaptador, receta,
--     si necesita salir por Lima y su estado. Es el registro que ordena la cola larga.
--   - empleo_documento: cada documento encontrado (bases, perfil, anexo, cronograma, comunicado, resultado) con su copia
--     en R2 (clave y hash) y cuándo se vio por primera y por última vez.
--   - empleo_guia: por fuente, cómo se postula (canal, URL, cuenta, formato, límites, manual y pasos).
--   - empleo_evento: lo que cambió en una convocatoria (documento nuevo, cronograma distinto, comunicado, resultado).
--   - empleo_cobertura: la medición diaria por fuente (abiertas, con documentos, con lectura, con guía, errores).
--   - empleo_plaza: vista unificada de CAS y prácticas (`cas:<aviso>` / `practica:<clave>`) para la app.
--
-- DEV: bash infrastructure/deploy/dev.sh migrar backend/db/migrations/271_empleo_automatizacion.sql
-- PROD: lo mismo por el túnel (tunel_rds).

-- ── Prácticas de Talento Perú ───────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.servir_practica (
  -- Determinística: entidad + número + año + título + unidad orgánica, normalizados (src/fuentes/servir_practicas.ts).
  clave             text PRIMARY KEY CHECK (length(clave) BETWEEN 1 AND 400),
  titulo            text NOT NULL,
  entidad           text NOT NULL,
  entidad_ruc       text,
  -- practica_pre (técnica / preprofesional) o practica_pro (profesional); `otra` si el listado no lo dice.
  modalidad         text NOT NULL DEFAULT 'otra' CHECK (modalidad IN ('practica_pre', 'practica_pro', 'otra')),
  tipo_modalidad    text,
  ubicacion         text,
  numero            text,
  anio              integer,
  vacantes          integer,
  subvencion        numeric(14, 2),
  duracion_meses    integer,
  jornada_horas     numeric(5, 1),
  fecha_inicio      date,
  fecha_fin         date,
  unidad_organica   text,
  direccion         text,
  actividades       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(actividades) = 'array'),
  requerimientos    jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(requerimientos) = 'array'),
  conocimientos     text,
  beneficios        jsonb,
  cronograma        jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(cronograma) = 'array'),
  -- El correo institucional del detalle es el canal de postulación: se conserva si termina en .gob.pe o .edu.pe.
  correo            text,
  web               text,
  detalle_url       text,
  primera_vez       timestamptz NOT NULL DEFAULT now(),
  ultima_vez        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS servir_practica_abiertas ON public.servir_practica (fecha_fin DESC, modalidad);
CREATE INDEX IF NOT EXISTS servir_practica_entidad ON public.servir_practica (entidad, fecha_inicio DESC);

-- ── Lo que se agrega a las plazas CAS ───────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.servir_convocatoria ADD COLUMN IF NOT EXISTS listado text NOT NULL DEFAULT 'ofertas_laborales';
-- La modalidad sale del número de convocatoria («D.LEG 1057 - …-108», «276-5», «728-019», «LEY 30057-13»): columna
-- generada, así el scraper (que inserta con columnas explícitas) no cambia y las plazas de antes quedan bien. 1057
-- primero: el final del número es el del proceso y puede ser «-276» o «-728».
ALTER TABLE public.servir_convocatoria ADD COLUMN IF NOT EXISTS modalidad text GENERATED ALWAYS AS (
  CASE
    WHEN numero ~* '1057|\mCAS\M' THEN 'cas'
    WHEN numero ~* '^\s*728\M|D\.?\s*LEG\.?\s*728' THEN '728'
    WHEN numero ~* '^\s*276\M|D\.?\s*LEG\.?\s*276' THEN '276'
    WHEN numero ~* '30057' THEN '30057'
    ELSE 'otro'
  END) STORED;
CREATE INDEX IF NOT EXISTS servir_convocatoria_listado ON public.servir_convocatoria (listado, modalidad, fecha_fin DESC);

-- ── El registro de fuentes ──────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.empleo_fuente (
  id              serial PRIMARY KEY,
  -- El dominio del sitio de convocatorias (`www.gob.pe`, `aplicativo.pj.gob.pe`, `convocatorias.regionpiura.gob.pe`…).
  dominio         text NOT NULL UNIQUE,
  url_lista       text,
  -- La familia del plan: A gob.pe, B aplicativo propio, C plataforma regional, D web propia, E Facebook, F archivo
  -- suelto, G sin enlace, H bloqueada o con captcha.
  familia         text NOT NULL DEFAULT 'D' CHECK (familia IN ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H')),
  adaptador       text NOT NULL DEFAULT 'generico',
  -- La receta del adaptador genérico (URL de la lista, selector de filas, paginación…), cuando se descubre.
  receta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  necesita_lima   boolean NOT NULL DEFAULT false,
  estado          text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'bloqueada', 'captcha', 'solo_facebook', 'sin_web')),
  -- Los nombres de SERVIR y el RUC de las entidades que publican en esta fuente.
  entidades       text[] NOT NULL DEFAULT '{}',
  entidad_ruc     text,
  ultimo_exito    timestamptz,
  ultimo_error    text,
  ultimo_error_at timestamptz,
  plazas_90d      integer NOT NULL DEFAULT 0,
  creado_at       timestamptz NOT NULL DEFAULT now(),
  actualizado_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS empleo_fuente_estado ON public.empleo_fuente (estado, familia);

-- ── Documentos y guías ──────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.empleo_documento (
  id             bigserial PRIMARY KEY,
  fuente_id      integer REFERENCES public.empleo_fuente (id) ON DELETE SET NULL,
  -- La convocatoria unificada: `cas:<aviso>` o `practica:<clave>` (la misma llave de empleo_plaza).
  convocatoria   text NOT NULL,
  aviso          integer,
  url            text NOT NULL,
  titulo         text NOT NULL,
  tipo           text NOT NULL DEFAULT 'otro'
                   CHECK (tipo IN ('bases', 'perfil', 'anexo', 'cronograma', 'comunicado', 'fe_erratas', 'resultado', 'otro')),
  -- La clave de la copia en R2 (`servir/bases/<clave>.pdf`) y su hash; null si sólo se vio el enlace.
  clave_r2       text,
  hash           text,
  content_type   text,
  bytes          integer,
  visto_primero  timestamptz NOT NULL DEFAULT now(),
  visto_ultimo   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (convocatoria, url)
);
CREATE INDEX IF NOT EXISTS empleo_documento_convocatoria ON public.empleo_documento (convocatoria, visto_ultimo DESC);
CREATE INDEX IF NOT EXISTS empleo_documento_fuente ON public.empleo_documento (fuente_id, visto_ultimo DESC);

CREATE TABLE IF NOT EXISTS public.empleo_guia (
  fuente_id      integer PRIMARY KEY REFERENCES public.empleo_fuente (id) ON DELETE CASCADE,
  canal          text CHECK (canal IN ('en_linea', 'correo', 'mesa_de_partes', 'plataforma', 'presencial', 'otro')),
  url            text,
  requiere_cuenta boolean,
  datos_cuenta   text,
  formato        text,
  limites        text,
  manual_url     text,
  manual_clave   text,
  pasos          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(pasos) = 'array'),
  -- De dónde se sacó (la página de trámite de gob.pe, el manual, las bases) y cuándo.
  fuente_de      text,
  creado_at      timestamptz NOT NULL DEFAULT now(),
  actualizado_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.empleo_evento (
  id           bigserial PRIMARY KEY,
  convocatoria text NOT NULL,
  tipo         text NOT NULL CHECK (tipo IN ('documento_nuevo', 'cambio_cronograma', 'comunicado', 'resultado_etapa', 'otro')),
  -- La huella del evento (convocatoria + tipo + url + fecha + detalle): un reintento no duplica el aviso.
  hash         text NOT NULL,
  detalle      jsonb NOT NULL DEFAULT '{}'::jsonb,
  url          text,
  fecha        date,
  visto_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (convocatoria, hash)
);
CREATE INDEX IF NOT EXISTS empleo_evento_convocatoria ON public.empleo_evento (convocatoria, visto_at DESC);

CREATE TABLE IF NOT EXISTS public.empleo_cobertura (
  fecha           date NOT NULL,
  fuente_id       integer NOT NULL REFERENCES public.empleo_fuente (id) ON DELETE CASCADE,
  familia         text NOT NULL,
  abiertas        integer NOT NULL DEFAULT 0,
  con_documentos  integer NOT NULL DEFAULT 0,
  con_lectura     integer NOT NULL DEFAULT 0,
  con_guia        integer NOT NULL DEFAULT 0,
  errores         integer NOT NULL DEFAULT 0,
  sin_web         integer NOT NULL DEFAULT 0,
  medido_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fecha, fuente_id)
);

-- ── La vista unificada para la app ──────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.empleo_plaza AS
SELECT 'cas:' || s.aviso::text       AS clave,
       'cas'::text                   AS tipo,
       s.aviso,
       s.titulo,
       s.entidad,
       s.entidad_ruc,
       s.ubicacion,
       s.numero,
       s.vacantes,
       s.remuneracion,
       s.fecha_inicio,
       s.fecha_fin,
       s.formacion,
       s.experiencia,
       s.especializacion,
       s.conocimiento,
       s.competencias,
       s.detalle_url,
       s.modalidad,
       s.servicio,
       s.senales,
       s.n_senales,
       s.primera_vez,
       s.ultima_vez
  FROM public.servir_convocatoria s
UNION ALL
SELECT 'practica:' || p.clave,
       'practica'::text,
       NULL::integer,
       p.titulo,
       p.entidad,
       p.entidad_ruc,
       p.ubicacion,
       p.numero,
       p.vacantes,
       p.subvencion,
       p.fecha_inicio,
       p.fecha_fin,
       p.requerimientos::text,
       NULL::text,
       NULL::text,
       p.conocimientos,
       NULL::text,
       p.detalle_url,
       p.modalidad,
       NULL::text,
       '[]'::jsonb,
       0,
       p.primera_vez,
       p.ultima_vez
  FROM public.servir_practica p;

-- ── Permisos ───────────────────────────────────────────────────────────────────────────────────────────────────────
GRANT SELECT ON public.servir_practica TO vigia_api, vigia_api_admin, vigia_jobs;
GRANT SELECT, INSERT, UPDATE ON public.servir_practica TO vigia_jobs;

GRANT SELECT ON public.empleo_fuente, public.empleo_documento, public.empleo_guia, public.empleo_evento, public.empleo_cobertura
  TO vigia_api, vigia_api_admin, vigia_jobs;
GRANT INSERT, UPDATE ON public.empleo_fuente, public.empleo_documento, public.empleo_guia, public.empleo_evento, public.empleo_cobertura
  TO vigia_api_admin, vigia_jobs;
GRANT USAGE, SELECT ON SEQUENCE public.empleo_fuente_id_seq, public.empleo_documento_id_seq, public.empleo_evento_id_seq
  TO vigia_api_admin, vigia_jobs;
-- La API (vigia_api) también escribe: la ficha anota la fuente y los documentos al buscar las bases, y el recolector de la
-- noche corre en la API (lib/empleoRecolector.ts), como servir_resumen (migración 270).
GRANT INSERT, UPDATE ON public.empleo_fuente, public.empleo_documento, public.empleo_evento, public.empleo_cobertura TO vigia_api;
GRANT USAGE, SELECT ON SEQUENCE public.empleo_fuente_id_seq, public.empleo_documento_id_seq, public.empleo_evento_id_seq TO vigia_api;

GRANT SELECT ON public.empleo_plaza TO vigia_api, vigia_api_admin;
