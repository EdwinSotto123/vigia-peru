-- 352 · Cobra del Estado por dos lados: está en la planilla de una entidad y, en esos mismos meses, otra entidad le
-- emitió órdenes de servicio.
--
-- Salió al unir las fichas de una persona (2026-11-17): la señal «también cobra por órdenes» (tambien_ordenes, 182) y
-- «también en planilla» (tambien_planilla) sólo miran la MISMA entidad. Medido en PROD ese día, con órdenes de cualquier
-- tipo desde 2024: 16 210 personas de planilla con órdenes de otra entidad en su periodo de planilla (S/ 475 M); 2 477
-- pares con 6 meses o más de órdenes.
--
-- La regla: «ningún empleado público puede percibir del Estado más de una remuneración, retribución, emolumento o
-- cualquier tipo de ingreso», salvo la función docente y las dietas de un directorio (artículo 40 de la Constitución;
-- artículo 3 de la Ley 28175, Ley Marco del Empleo Público). Una orden de servicio es una retribución.
--
-- Cómo se arma:
--   · la planilla (Portal de Transparencia) no trae documento: se une por nombre completo, y sólo si ese nombre tiene 4
--     palabras o más y lo lleva UN solo RUC 10 de todo el registro de órdenes (la misma regla de la ficha única);
--   · sólo órdenes de SERVICIO no anuladas, desde 2023, de una entidad distinta;
--   · cuenta los MESES en que coinciden: el mes figura en su planilla y hay una orden de servicio emitida ese mes;
--   · entra con 3 meses o más y S/ 5 mil o más.
--   severidad  media  6 meses o más, y ni su cargo ni la otra entidad son de docencia;
--              baja   el resto (pocos meses, o docencia: la excepción que la ley permite).
-- Nunca alta: el empate es por nombre. Un homónimo exacto con el único RUC de ese nombre saldría aquí.
--
-- La tabla guarda el nombre normalizado como llave interna (igual que planilla_persona y funcionario_resumen): la API
-- no lo devuelve; enlaza por `codigo` (la ficha única) y por `ficha` (su planilla).

CREATE TABLE IF NOT EXISTS doble_percepcion (
  nombre_norm  TEXT NOT NULL,
  entidad_ruc  TEXT NOT NULL,            -- donde está en planilla
  entidad      TEXT,
  cargo        TEXT,
  regimen      SMALLINT,
  sueldo       NUMERIC(14, 2),           -- su sueldo del último mes en esa planilla
  otra_ruc     TEXT NOT NULL,            -- la entidad que le emitió las órdenes de servicio
  otra         TEXT,
  ordenes      INT NOT NULL,             -- órdenes de servicio en los meses que coinciden
  monto        NUMERIC(18, 2) NOT NULL,
  meses        INT NOT NULL,             -- meses en que estuvo en la planilla y recibió una orden de la otra entidad
  desde        DATE NOT NULL,            -- primer mes que coincide
  hasta        DATE NOT NULL,            -- último mes que coincide
  docente      BOOLEAN NOT NULL,         -- su cargo o la otra entidad son de docencia: la excepción legal
  severidad    TEXT NOT NULL,
  codigo       TEXT,                     -- su ficha única (funcionario_codigo)
  ficha        TEXT,                     -- su ficha de planilla
  PRIMARY KEY (nombre_norm, entidad_ruc, otra_ruc)
);
CREATE INDEX IF NOT EXISTS doble_percepcion_entidad ON doble_percepcion (entidad_ruc, monto DESC);
CREATE INDEX IF NOT EXISTS doble_percepcion_otra ON doble_percepcion (otra_ruc, monto DESC);
CREATE INDEX IF NOT EXISTS doble_percepcion_codigo ON doble_percepcion (codigo);
CREATE INDEX IF NOT EXISTS doble_percepcion_orden ON doble_percepcion (severidad, monto DESC);

CREATE OR REPLACE FUNCTION refrescar_doble_percepcion(p_desde date DEFAULT DATE '2023-01-01') RETURNS integer
LANGUAGE plpgsql SET work_mem = '256MB' AS $$
DECLARE n int;
BEGIN
  -- Personas de planilla con nombre de 4 palabras o más.
  CREATE TEMP TABLE _dpl ON COMMIT DROP AS
    SELECT p.entidad_ruc, p.nombre_norm, p.entidad, p.cargo, p.regimen, p.base, p.ficha
      FROM planilla_persona p
     WHERE array_length(string_to_array(p.nombre_norm, ' '), 1) >= 4;
  CREATE INDEX ON _dpl (nombre_norm); ANALYZE _dpl;
  -- De ellas, las que tienen UN solo RUC 10 con ese nombre en todo el registro de órdenes.
  CREATE TEMP TABLE _dru ON COMMIT DROP AS
    SELECT o.nom_n, min(o.ruc) AS ruc
      FROM persona_orden_anual o
     WHERE o.nom_n IN (SELECT nombre_norm FROM _dpl) AND o.ruc ~ '^10\d{9}$'
     GROUP BY o.nom_n HAVING count(DISTINCT o.ruc) = 1;
  CREATE INDEX ON _dru (ruc); CREATE INDEX ON _dru (nom_n); ANALYZE _dru;
  -- Sus órdenes de servicio por entidad y mes.
  CREATE TEMP TABLE _dos ON COMMIT DROP AS
    SELECT u.nom_n, c.entidad_ruc, max(c.entidad) AS entidad, date_trunc('month', c.fecha_emision)::date AS mes,
           count(DISTINCT c.orden)::int AS ordenes, sum(c.monto) AS monto
      FROM _dru u
      JOIN conosce_ordenes c ON c.ruc_contratista = u.ruc
     WHERE c.fecha_emision >= p_desde AND c.fecha_emision <= current_date
       AND c.tipo_orden ILIKE '%servicio%' AND c.estado IS DISTINCT FROM 'Anulada'
       AND c.moneda = 'Nuevos Soles' AND c.monto > 0 AND c.monto_dudoso IS NULL
     GROUP BY 1, 2, 4;
  CREATE INDEX ON _dos (nom_n, mes); ANALYZE _dos;
  -- Los meses en que figura en cada planilla.
  CREATE TEMP TABLE _dpm ON COMMIT DROP AS
    SELECT DISTINCT t.entidad_ruc, t.nombre_norm, make_date(t.anio::int, t.mes::int, 1) AS mes
      FROM planilla_pte t
     WHERE t.nombre_norm IN (SELECT nom_n FROM _dos) AND make_date(t.anio::int, t.mes::int, 1) >= date_trunc('month', p_desde)::date;
  CREATE INDEX ON _dpm (nombre_norm, mes); ANALYZE _dpm;

  DELETE FROM doble_percepcion;
  INSERT INTO doble_percepcion (nombre_norm, entidad_ruc, entidad, cargo, regimen, sueldo, otra_ruc, otra, ordenes, monto, meses, desde, hasta,
                                docente, severidad, codigo, ficha)
  SELECT x.nombre_norm, x.entidad_ruc, p.entidad, p.cargo, p.regimen, p.base, x.otra_ruc, x.otra, x.ordenes, x.monto, x.meses, x.desde, x.hasta,
         d.docente,
         CASE WHEN x.meses >= 6 AND NOT d.docente THEN 'media' ELSE 'baja' END,
         f.codigo, p.ficha
    FROM (SELECT m.nombre_norm, m.entidad_ruc, o.entidad_ruc AS otra_ruc, max(o.entidad) AS otra, sum(o.ordenes)::int AS ordenes, sum(o.monto) AS monto,
                 count(DISTINCT o.mes)::int AS meses, min(o.mes) AS desde, max(o.mes) AS hasta
            FROM _dpm m JOIN _dos o ON o.nom_n = m.nombre_norm AND o.mes = m.mes AND o.entidad_ruc <> m.entidad_ruc
           GROUP BY 1, 2, 3
          HAVING count(DISTINCT o.mes) >= 3 AND sum(o.monto) >= 5000) x
    JOIN _dpl p ON p.entidad_ruc = x.entidad_ruc AND p.nombre_norm = x.nombre_norm
    CROSS JOIN LATERAL (SELECT (upper(immutable_unaccent(COALESCE(p.cargo, ''))) ~ '(DOCENTE|PROFESOR|CATEDRA|JEFE DE PRACTICA|AUXILIAR DE EDUCACION)'
                                OR upper(immutable_unaccent(COALESCE(x.otra, ''))) ~ '(UNIVERSIDAD|INSTITUTO DE EDUCACION|INSTITUTO SUPERIOR|UGEL|UNIDAD DE GESTION EDUCATIVA)'
                                OR upper(immutable_unaccent(COALESCE(p.entidad, ''))) ~ '(UNIVERSIDAD)') AS docente) d
    LEFT JOIN funcionario_codigo f ON f.nombre_norm = x.nombre_norm;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE doble_percepcion;
  RETURN n;
END $$;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.doble_percepcion OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_doble_percepcion(date) OWNER TO vigia_jobs;
  END IF;
  REVOKE ALL ON public.doble_percepcion FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'dev_api', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.doble_percepcion TO %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_doble_percepcion(date) FROM PUBLIC;
