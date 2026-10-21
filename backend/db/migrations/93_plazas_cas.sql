-- 93 · Plazas CAS: las convocatorias que las entidades publican en SERVIR Talento Perú (app.servir.gob.pe, "Ofertas
--      laborales"), con sus requisitos (experiencia, formación, conocimientos), su sueldo y sus fechas. Lo carga
--      backend/scripts/cargar_servir_convocatorias.py desde una PC en el Perú (SERVIR responde 403 a Cloudflare:
--      GET /diagnostico?partes=pte de vigia-scrapers lo mide). Una vez por semana: las plazas duran unas dos semanas
--      publicadas, y lo que se va de la lista queda guardado.
--
-- Para qué (pedido del 2026-10-21: direccionamiento de plazas): señales de una plaza hecha a la medida de alguien.
-- Son indicios, no pruebas:
--   pide_experiencia_propia  media  exige experiencia en la misma entidad que convoca (sólo la tiene quien ya trabaja ahí)
--   pide_poco                media  paga S/ 6,000 o más y pide menos de un año de experiencia o ningún grado
--   plazo_corto              media  estuvo publicada 3 días o menos
--   ya_hay_locadores         baja   la entidad pagó por órdenes ese mismo tipo de servicio, a 1 a 3 personas, en los 12 meses antes
--   sueldo_alto              media  paga el doble o más que la mediana del mismo tipo de servicio en las plazas del país
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/93_plazas_cas.sql (después de la 91)
-- y la carga: python backend/scripts/cargar_servir_convocatorias.py --entorno prod (primero --seco).

CREATE TABLE IF NOT EXISTS servir_convocatoria (
  aviso           INT PRIMARY KEY,         -- "N° 820922" del aviso: no cambia
  titulo          TEXT NOT NULL,
  entidad         TEXT NOT NULL,
  entidad_ruc     TEXT,                    -- por el nombre (refrescar_plazas)
  ubicacion       TEXT,
  numero          TEXT,                    -- número de convocatoria
  vacantes        INT,
  remuneracion    NUMERIC(14, 2),
  fecha_inicio    DATE,
  fecha_fin       DATE,
  experiencia     TEXT,
  formacion       TEXT,
  especializacion TEXT,
  conocimiento    TEXT,
  competencias    TEXT,
  detalle_url     TEXT,
  servicio        TEXT,                    -- servicio_persona(titulo), para comparar
  exp_general     NUMERIC(5, 2),           -- años de experiencia general que pide (NULL si no se lee)
  primera_vez     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultima_vez      TIMESTAMPTZ NOT NULL DEFAULT now(),
  tipos           TEXT[] NOT NULL DEFAULT '{}',
  senales         JSONB NOT NULL DEFAULT '[]',   -- [{tipo, severidad, detalle}]
  n_senales       INT NOT NULL DEFAULT 0,
  sev             SMALLINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS servir_convocatoria_entidad ON servir_convocatoria (entidad_ruc, fecha_inicio DESC);
CREATE INDEX IF NOT EXISTS servir_convocatoria_orden ON servir_convocatoria (sev DESC, n_senales DESC, fecha_inicio DESC);
CREATE INDEX IF NOT EXISTS servir_convocatoria_tipos ON servir_convocatoria USING gin (tipos);
ALTER TABLE servir_convocatoria OWNER TO vigia_jobs;

-- Años de experiencia general de un texto de SERVIR ("EXPERIENCIA GENERAL: 8.00 AÑO(S), …"); NULL si no lo dice.
CREATE OR REPLACE FUNCTION anios_experiencia(t text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE m text[]; n numeric;
BEGIN
  IF t IS NULL THEN RETURN NULL; END IF;
  IF upper(t) ~ 'EXPERIENCIA GENERAL\s*:\s*(NO REQUIERE|SIN EXPERIENCIA|NINGUNA)' THEN RETURN 0; END IF;
  -- "EXPERIENCIA GENERAL: 8.00 AÑO(S)", "OCHO (8) AÑOS DE EXPERIENCIA GENERAL", "2 AÑOS DE EXPERIENCIA GENERAL".
  m := regexp_match(upper(t), 'EXPERIENCIA GENERAL\s*:?\s*\W{0,3}\s*(?:[A-Z]+\s*)?\(?(\d+(?:[.,]\d+)?)\)?\s*(A.O|MES)');
  IF m IS NULL THEN m := regexp_match(upper(t), '\(?(\d+(?:[.,]\d+)?)\)?\s*(A.O|MES)\S*\s+DE\s+EXPERIENCIA\s+(?:LABORAL\s+)?GENERAL'); END IF;
  IF m IS NULL THEN RETURN NULL; END IF;
  n := replace(m[1], ',', '.')::numeric;
  RETURN CASE WHEN m[2] LIKE 'MES%' THEN round(n / 12, 2) ELSE n END;
END $$;
ALTER FUNCTION anios_experiencia(text) OWNER TO vigia_jobs;

CREATE OR REPLACE FUNCTION refrescar_plazas() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  -- La entidad por su nombre (el de CONOSCE o el del directorio de entidades).
  UPDATE servir_convocatoria s SET entidad_ruc = e.ruc
    FROM (SELECT DISTINCT ON (mef_norm(nombre)) mef_norm(nombre) AS n, ruc FROM (
            SELECT nombre, ruc FROM entidades UNION ALL SELECT entidad, entidad_ruc FROM persona_entidad) x
          WHERE nombre IS NOT NULL ORDER BY mef_norm(nombre), ruc) e
   WHERE s.entidad_ruc IS NULL AND e.n = mef_norm(s.entidad);
  -- Si no hay una igual: la única entidad cuyo nombre empieza con el de SERVIR ("MINISTERIO PUBLICO" →
  -- "MINISTERIO PUBLICO GERENCIA GENERAL").
  UPDATE servir_convocatoria s SET entidad_ruc = c.ruc
    FROM (SELECT s2.entidad, min(x.ruc) AS ruc
            FROM (SELECT DISTINCT entidad FROM servir_convocatoria WHERE entidad_ruc IS NULL) s2
            JOIN (SELECT DISTINCT ruc, mef_norm(nombre) AS n FROM entidades WHERE nombre IS NOT NULL) x
              ON x.n LIKE mef_norm(s2.entidad) || ' %' AND length(mef_norm(s2.entidad)) >= 12
           GROUP BY s2.entidad HAVING count(DISTINCT x.ruc) = 1) c
   WHERE s.entidad_ruc IS NULL AND s.entidad = c.entidad;
  -- El tipo de servicio, del título sin "CONTRATACIÓN ADMINISTRATIVA DE SERVICIOS DE UN(A)" (todas lo llevan). Se
  -- rehace siempre: son unos miles y el clasificador cambia.
  UPDATE servir_convocatoria
     SET servicio = servicio_persona(regexp_replace(titulo, '^\s*CONTRATACI.N ADMINISTRATIVA DE SERVICIOS( DE)?( UN\(A\)| UNA?)?\s*', '', 'i')),
         exp_general = anios_experiencia(experiencia);

  CREATE TEMP TABLE _ss (aviso int, tipo text, severidad text, detalle jsonb) ON COMMIT DROP;

  -- pide_experiencia_propia: los requisitos nombran a la propia entidad (o "en la entidad").
  INSERT INTO _ss
  SELECT s.aviso, 'pide_experiencia_propia', 'media', jsonb_build_object('texto', left(s.experiencia, 400))
    FROM servir_convocatoria s
   WHERE (length(mef_norm(s.entidad)) >= 12 AND position(mef_norm(s.entidad) IN mef_norm(COALESCE(s.experiencia, '') || ' ' || COALESCE(s.conocimiento, ''))) > 0)
      OR mef_norm(s.experiencia) ~ 'EXPERIENCIA (LABORAL )?EN LA (ENTIDAD|MISMA ENTIDAD|INSTITUCION CONVOCANTE)';

  -- pide_poco: S/ 6,000 o más con menos de un año de experiencia general o sin grado (secundaria, estudiante, egresado técnico).
  INSERT INTO _ss
  SELECT s.aviso, 'pide_poco', 'media',
         jsonb_build_object('remuneracion', s.remuneracion, 'exp_general', s.exp_general, 'formacion', left(s.formacion, 300))
    FROM servir_convocatoria s
   WHERE s.remuneracion >= 6000
     AND ((s.exp_general IS NOT NULL AND s.exp_general < 1)
       OR (mef_norm(s.formacion) ~ '\m(SECUNDARIA|ESTUDIANTE|ESTUDIOS (UNIVERSITARIOS|TECNICOS) (EN CURSO|INCOMPLETOS))' AND mef_norm(s.formacion) !~ '\m(BACHILLER|TITULO|TITULADO|LICENCIAD|MAESTR|DOCTOR)'));

  -- plazo_corto: publicada 3 días o menos.
  INSERT INTO _ss
  SELECT s.aviso, 'plazo_corto', 'media', jsonb_build_object('dias', s.fecha_fin - s.fecha_inicio + 1, 'desde', s.fecha_inicio, 'hasta', s.fecha_fin)
    FROM servir_convocatoria s
   WHERE s.fecha_inicio IS NOT NULL AND s.fecha_fin IS NOT NULL AND s.fecha_fin - s.fecha_inicio + 1 <= 3;

  -- sueldo_alto: el doble o más que la mediana de las plazas del mismo tipo de servicio en el país (con 20 o más).
  INSERT INTO _ss
  SELECT s.aviso, 'sueldo_alto', 'media', jsonb_build_object('remuneracion', s.remuneracion, 'mediana', r.mediana, 'plazas', r.n, 'servicio', s.servicio)
    FROM servir_convocatoria s
    JOIN (SELECT servicio, count(*) AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY remuneracion) AS mediana
            FROM servir_convocatoria WHERE remuneracion > 0 GROUP BY servicio) r ON r.servicio = s.servicio
   WHERE servicio_es_personal(s.servicio) AND s.servicio <> 'Otros servicios personales' AND r.n >= 20 AND s.remuneracion >= 2 * r.mediana;

  -- ya_hay_locadores: en los 12 meses antes de publicar la plaza, la entidad pagó por órdenes ese tipo de servicio a una,
  -- dos o tres personas (con más, es un servicio común de la entidad y no dice nada de esta plaza).
  INSERT INTO _ss
  SELECT s.aviso, 'ya_hay_locadores', 'baja', jsonb_build_object('personas', count(DISTINCT a.ruc), 'servicio', s.servicio)
    FROM servir_convocatoria s
    JOIN persona_orden_anual a ON a.entidad_ruc = s.entidad_ruc AND a.servicio = s.servicio
                              AND a.ultima >= s.fecha_inicio - 365 AND a.primera <= s.fecha_inicio
   WHERE s.entidad_ruc IS NOT NULL AND servicio_es_personal(s.servicio) AND s.servicio <> 'Otros servicios personales'
   GROUP BY s.aviso, s.servicio
  HAVING count(DISTINCT a.ruc) BETWEEN 1 AND 3;

  UPDATE servir_convocatoria SET tipos = '{}', senales = '[]', n_senales = 0, sev = 0 WHERE n_senales > 0 OR sev > 0;
  UPDATE servir_convocatoria s SET tipos = x.tipos, senales = x.senales, n_senales = x.n, sev = x.sev
    FROM (
      SELECT aviso, array_agg(tipo ORDER BY tipo) AS tipos, count(*)::int AS n,
             max(CASE severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END)::smallint AS sev,
             jsonb_agg(jsonb_build_object('tipo', tipo, 'severidad', severidad, 'detalle', detalle)
                       ORDER BY CASE severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, tipo) AS senales
        FROM _ss GROUP BY aviso
    ) x
   WHERE x.aviso = s.aviso;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_plazas() OWNER TO vigia_jobs;

GRANT SELECT ON servir_convocatoria TO vigia_api, vigia_api_admin;
GRANT EXECUTE ON FUNCTION anios_experiencia(text) TO vigia_jobs, vigia_api, vigia_api_admin;
REVOKE EXECUTE ON FUNCTION refrescar_plazas() FROM PUBLIC;
-- La carga desde la PC usa el rol de los scrapers.
GRANT SELECT, INSERT, UPDATE ON servir_convocatoria TO vigia_jobs;
