-- 329 · Indicadores en observación: las visitas por ETAPA del procedimiento y por MOTIVO declarado, las ofertas de
--       rivales vinculados presentadas casi a la vez, y la tasa base de cada señal.
--
-- De la auditoría de datos del 2026-11-17 (mediciones de ese día, sólo agregados):
--
--   · El registro de visitas trae el motivo declarado, el cargo y el área de quien recibe y la hora, llenos al 98-100 %,
--     y ninguna señal miraba el motivo ni la etapa del procedimiento. Entre los postores que NO eran proveedores de la
--     entidad, reunirse con un funcionario que decide las compras mientras se evaluaban las ofertas es 3,2 veces más
--     frecuente en quien gana que en quien pierde (1,01 % contra 0,32 %); entre quienes ya eran proveedores casi no hay
--     diferencia (1,10 % contra 0,81 %): ahí la visita es rutina.
--   · Las parejas de postores rivales que presentan su oferta con minutos de diferencia comparten un socio o
--     representante varias veces más que las que la presentan con horas de diferencia (1,1 % contra 0,16 %).
--   · Casi ninguna señal dice cuán frecuente es lo que marca.
--
-- Qué agrega:
--   1. visita_motivo_clase(motivo): el motivo declarado en una de siete clases (las categorías del registro oficial).
--   2. senal_en_observacion: los tipos de señal que se MUESTRAN con su evidencia y NO entran al puntaje del contrato ni a
--      la cuenta de contratos con antecedentes, hasta que se mida su precisión con una muestra revisada. Sacar la fila de
--      un tipo lo hace puntuar en el siguiente refresco. Es el mismo trato que ya tienen los datos del proveedor
--      (candidatura, aporte: migración 115).
--   3. refrescar_cruce_visita_previa(): la de la 198 más
--        - en cada visita previa, la etapa en que cayó (antes de convocar, convocatoria, evaluación de ofertas, día de la
--          buena pro) y la clase de su motivo;
--        - reunion_en_evaluacion: gente del ganador se reunió con quien decide las compras DESPUÉS de presentar su
--          oferta y ANTES de la buena pro. Media si la empresa no era proveedora de la entidad; baja si ya lo era.
--        - visita_personal_decisor: la misma persona del ganador visitó al mismo funcionario que decide las compras, con
--          motivo declarado «visita personal», en 3 o más días de 2 o más meses distintos, en el año anterior a la buena pro.
--   4. refrescar_cruce_ofertas_a_la_vez(): el ganador y otro postor del mismo ítem comparten un socio o representante y
--      presentaron sus ofertas con 30 minutos o menos de diferencia (reporte de presentación de ofertas del SEACE).
--   5. senal_tasa_base y refrescar_senal_tasa_base(): de cada tipo, en cuántos procesos aparece y sobre cuántos se puede
--      medir (los de entidades con registro de visitas, los que tienen el documento leído…).
--
-- Lo que NO afirman: una reunión durante la evaluación puede ser por otro contrato o una subsanación; una visita
-- «personal» puede ser a un familiar o un error al llenar el motivo; dos ofertas seguidas pueden salir del mismo estudio
-- contable. Son indicios para revisar. De quien recibe la visita se publica sólo el cargo y el área, nunca el nombre.
--
-- Se midió y NO se implementa: la contratación directa repetida a la misma empresa. Sin la causal (no viene en los datos
-- y los documentos de las directas no se guardan) marca sobre todo a proveedores únicos naturales: licencias de software,
-- laboratorios, mantenimiento del fabricante, medios de comunicación.
--
-- Cómo aplicarla: después de la 326. Luego SELECT refrescar_cruce_visita_previa(), refrescar_cruce_ofertas_a_la_vez(),
-- dedup_cruces_proveedor(), refrescar_casos_cruce_base() y refrescar_senal_tasa_base().

-- ── 1 · La clase del motivo declarado ───────────────────────────────────────────────────────────────────────────────
-- El registro en línea ofrece categorías fijas («Reunión de trabajo», «Provisión de servicios», «Otros motivos - Visita
-- personal», «Gestión de intereses»…) y algunas entidades escriben texto libre. El orden importa: lo operativo (un
-- mantenimiento, una entrega) va antes que «reunión», y «personal» sólo es la categoría «visita personal», no la
-- oficina de personal ni «el personal de la empresa».
CREATE OR REPLACE FUNCTION visita_motivo_clase(motivo text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN x = '' THEN NULL
           WHEN x ~ 'PROCEDIMIENTO DE SELECCI|LICITACI|BUENA PRO|\mOFERTAS?\M' THEN 'seleccion'
           WHEN x ~ 'GESTION DE INTERESES' THEN 'gestion_intereses'
           WHEN x ~ 'PROVISI|MANTENIMIENTO|PROVEEDOR|ENTREGA|SERVICIO|CONCESIONARIO|INSTALACI|VISITA TECNICA|ACONDICIONAMIENTO|REPARACI|DOCUMENT|TRAMITE|COBRO' THEN 'operativa'
           WHEN x ~ 'VISITA PERSONAL' THEN 'personal'
           WHEN x ~ 'REUNI|MESA DE TRABAJO|COORDINACI' THEN 'reunion'
           WHEN x ~ 'PROTOCOL|EVENTO|ACADEMIC|PRENSA|PERIODIST' THEN 'protocolar'
           ELSE 'otra'
         END
    FROM (SELECT mef_norm(COALESCE(motivo, '')) AS x) t
$$;

-- ── 2 · Los tipos de señal en observación ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS senal_en_observacion (
  tipo   TEXT PRIMARY KEY,
  desde  DATE NOT NULL DEFAULT current_date,
  motivo TEXT NOT NULL
);
INSERT INTO senal_en_observacion (tipo, motivo) VALUES
  ('reunion_en_evaluacion', 'Indicador nuevo del 2026-11-17: falta medir su precisión con una muestra revisada.'),
  ('visita_personal_decisor', 'Indicador nuevo del 2026-11-17: falta medir su precisión con una muestra revisada.'),
  ('ofertas_a_la_vez', 'Indicador nuevo del 2026-11-17: pocos casos; falta medir su precisión con una muestra revisada.')
ON CONFLICT (tipo) DO NOTHING;

-- casos_cruce: lo mismo que la versión vigente, con una condición más (los tipos en observación no cuentan).
CREATE OR REPLACE FUNCTION public.refrescar_casos_cruce_base()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE n INT;
BEGIN
  -- Ganadores como en refrescar_cruces() (migración 56): suppliers del OCDS, consorcios abiertos en sus integrantes.
  DROP TABLE IF EXISTS _kc_sup;
  CREATE TEMP TABLE _kc_sup ON COMMIT DROP AS
    SELECT c.ocid, regexp_replace(s->>'id', '^PE-RUC-', '') AS sup, s->>'name' AS nombre,
           (aw->'value'->>'amount')::numeric AS monto, NULLIF(aw->>'date', '')::date AS f
    FROM convocatorias c,
         jsonb_array_elements(COALESCE(COALESCE(c.ocds_payload->'awards', c.adjudicaciones), '[]'::jsonb)) aw,
         jsonb_array_elements(COALESCE(aw->'suppliers', '[]'::jsonb)) s
    WHERE c.ocid NOT LIKE 'ocds-vigia-%';
  DROP TABLE IF EXISTS _kc_miem;
  CREATE TEMP TABLE _kc_miem ON COMMIT DROP AS
    SELECT DISTINCT ON (ruc_consorcio, ruc_miembro) ruc_consorcio, ruc_miembro, miembro
    FROM conosce_consorcios WHERE ruc_miembro ~ '^(10|20)\d{9}$' ORDER BY ruc_consorcio, ruc_miembro, anio DESC;
  CREATE INDEX ON _kc_miem (ruc_consorcio);
  ANALYZE _kc_sup;
  ANALYZE _kc_miem;
  DROP TABLE IF EXISTS _kc_g;
  CREATE TEMP TABLE _kc_g ON COMMIT DROP AS
    SELECT x.ocid, COALESCE(m.ruc_miembro, x.sup) AS ruc, max(COALESCE(m.miembro, x.nombre)) AS proveedor,
           max(CASE WHEN m.ruc_miembro IS NOT NULL THEN x.nombre END) AS consorcio, max(x.monto) AS monto, max(x.f) AS f
    FROM _kc_sup x LEFT JOIN _kc_miem m ON m.ruc_consorcio = x.sup AND x.sup !~ '^(10|20)\d{9}$'
    WHERE COALESCE(m.ruc_miembro, x.sup) ~ '^(10|20)\d{9}$'
    GROUP BY 1, 2;
  CREATE INDEX ON _kc_g (ruc);
  ANALYZE _kc_g;

  DELETE FROM casos_cruce;
  INSERT INTO casos_cruce (ocid, ruc, proveedor, consorcio, codigo, objeto, tipo_contratacion, entidad_ruc, entidad,
                           departamento, fecha_buena_pro, monto, tipos, cruces, n_alta, n_media, n_baja, severidad,
                           puntaje, texto)
  SELECT g.ocid, g.ruc, g.proveedor, g.consorcio, c.codigo, c.objeto,
         COALESCE(c.tipo_contratacion, CASE c.categoria WHEN 'goods' THEN 'bienes' WHEN 'services' THEN 'servicios'
                                                          WHEN 'works' THEN 'obras' END),
         c.entidad_ruc::text, e.nombre, left(c.ubigeo_zona, 2),
         COALESCE(c.fecha_buena_pro, g.f), g.monto,   -- la columna casi nunca viene: la fecha de la adjudicación del OCDS
         k.tipos, k.cruces, k.n_alta, k.n_media, k.n_baja,
         CASE WHEN k.n_alta > 0 THEN 'alta' WHEN k.n_media > 0 THEN 'media' ELSE 'baja' END,
         10 * k.n_alta + 3 * k.n_media + k.n_baja,
         -- Una persona natural (RUC 10) no se busca por su nombre ni su RUC: la API le tapa un apellido.
         lower(unaccent(concat_ws(' ', CASE WHEN g.ruc LIKE '20%' THEN g.proveedor END, g.consorcio, e.nombre, c.objeto,
                                  c.codigo, CASE WHEN g.ruc LIKE '20%' THEN g.ruc END, c.entidad_ruc)))
  FROM _kc_g g
  JOIN convocatorias c ON c.ocid = g.ocid
  LEFT JOIN entidades e ON e.ruc = c.entidad_ruc
  CROSS JOIN LATERAL (
    -- Un tipo cuenta una vez, con su severidad más alta.
    SELECT array_agg(t.tipo ORDER BY t.rango, t.tipo) AS tipos,
           jsonb_agg(jsonb_build_object('tipo', t.tipo, 'severidad', t.severidad, 'n', t.n) ORDER BY t.rango, t.tipo) AS cruces,
           count(*) FILTER (WHERE t.severidad = 'alta')::int AS n_alta,
           count(*) FILTER (WHERE t.severidad = 'media')::int AS n_media,
           count(*) FILTER (WHERE t.severidad = 'baja')::int AS n_baja
    FROM (
      SELECT p.tipo, min(CASE p.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END) AS rango,
             (ARRAY['alta', 'media', 'baja'])[1 + min(CASE p.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END)] AS severidad,
             count(*)::int AS n
      FROM cruces_proveedor p
      -- 115: los DATOS DEL PROVEEDOR (candidatura, aporte, venta a campaña, ser autoridad electa) son hechos de quien
      -- ganó, no antecedentes de ESTA contratación: no cuentan para el riesgo ni para el filtro «Antecedentes» del
      -- contrato. Se muestran aparte en la ficha (del contrato y de la empresa). Las versiones LIGADAS a la entidad
      -- (partido_gobernante / vendio_gobernante) sí quedan.
      WHERE p.ruc_empresa = g.ruc
        AND p.tipo NOT IN ('candidato', 'aporte', 'aporte_empresa', 'proveedor_campana', 'autoridad')
        -- 329: los indicadores EN OBSERVACIÓN se muestran en la ficha con su evidencia, pero no puntúan ni hacen de un
        -- contrato un «contrato con antecedentes» hasta que se mida su precisión (senal_en_observacion).
        AND p.tipo NOT IN (SELECT o.tipo FROM senal_en_observacion o)
        AND (p.ocid = g.ocid OR (p.ocid IS NULL AND cruce_es_antecedente(p.tipo, p.fecha, p.detalle, c.fecha_convocatoria)))
      GROUP BY p.tipo
    ) t
  ) k
  WHERE k.tipos IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE casos_cruce;
  RETURN n;
END $function$;

-- ── 3 · Las visitas, con su etapa y su motivo ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refrescar_cruce_visita_previa() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n int;
  v_obs_reunion boolean := EXISTS (SELECT 1 FROM senal_en_observacion WHERE tipo = 'reunion_en_evaluacion');
  v_obs_personal boolean := EXISTS (SELECT 1 FROM senal_en_observacion WHERE tipo = 'visita_personal_decisor');
BEGIN
  SET LOCAL work_mem = '256MB';

  -- El RUC de cada entidad visitada: el mapeo de visita_entidad_ruc (migraciones 186 y 197), el mismo de la pestaña
  -- Visitas. Lo rehace refrescar_visita_entidad_ruc() al cargar visitas; si está vacío, aquí.
  IF NOT EXISTS (SELECT 1 FROM visita_entidad_ruc) THEN
    PERFORM refrescar_visita_entidad_ruc();
  END IF;
  CREATE TEMP TABLE _vpm ON COMMIT DROP AS
    SELECT entidad_visitada AS t, ruc FROM visita_entidad_ruc;
  CREATE INDEX ON _vpm (t);

  -- 329: el día en que cada postor presentó su oferta (CONOSCE), para saber cuándo empieza la evaluación.
  CREATE TEMP TABLE _vpo ON COMMIT DROP AS
    SELECT codigo_convocatoria AS cod, ruc_postor AS postor, min(fecha_propuesta) AS fo
      FROM conosce_postores WHERE fecha_propuesta IS NOT NULL GROUP BY 1, 2;
  CREATE INDEX ON _vpo (cod, postor);
  ANALYZE _vpo;

  -- Cada buena pro con su convocatoria (para «antes de la convocatoria») y el día de la oferta de quien ganó, de las
  -- entidades cuyas visitas tenemos. Las mismas filas que antes: la oferta va agregada para no multiplicarlas.
  CREATE TEMP TABLE _vpg ON COMMIT DROP AS
    SELECT cv.ocid, COALESCE(m.ruc_miembro, a.ruc_proveedor) AS ruc, a.entidad_ruc::text AS entidad_ruc,
           a.fecha_buenapro AS f, a.fecha_convocatoria AS fc, min(o.fo) AS fo
      FROM conosce_adjudicaciones a
      JOIN (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
             WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid) cv
        ON cv.codigo = a.codigo_convocatoria AND cv.entidad_ruc = a.entidad_ruc
      LEFT JOIN conosce_consorcios m ON m.ruc_consorcio = a.ruc_proveedor AND a.ruc_proveedor !~ '^(10|20)\d{9}$'
      LEFT JOIN _vpo o ON o.cod = a.codigo_convocatoria AND o.postor = a.ruc_proveedor
     WHERE a.fecha_buenapro >= (SELECT min(fecha_visita) FROM visitas_entidades)
       AND a.fecha_buenapro <= (SELECT max(fecha_visita) FROM visitas_entidades) + 180
       AND COALESCE(m.ruc_miembro, a.ruc_proveedor) ~ '^(10|20)\d{9}$'
       AND a.entidad_ruc::text IN (SELECT ruc FROM _vpm)
     GROUP BY 1, 2, 3, 4, 5;
  CREATE INDEX ON _vpg (ruc);

  CREATE TEMP TABLE _vpp ON COMMIT DROP AS
    SELECT ruc, dni, max(nombre) AS nombre, string_agg(DISTINCT rol, ', ' ORDER BY rol) AS rol FROM (
      SELECT r.ruc_empresa::text AS ruc, r.numero_documento AS dni, r.nombre, r.tipo_rol AS rol
        FROM rnp_conformacion_juridica r
       WHERE r.tipo_documento LIKE 'DOC. NACIONAL%' AND r.numero_documento ~ '^\d{8}$'
         AND r.ruc_empresa::text IN (SELECT ruc FROM _vpg)
      UNION ALL
      SELECT DISTINCT g.ruc, substr(g.ruc, 3, 8), NULL, 'TITULAR' FROM _vpg g WHERE g.ruc LIKE '10%') x
     GROUP BY ruc, dni;
  CREATE INDEX ON _vpp (dni);

  -- Las visitas de la gente del ganador a la entidad que contrató, en el AÑO antes de la buena pro (329: antes eran 180
  -- días; el año entero sólo lo lee «visita personal a quien decide»). Cada una con la etapa del procedimiento en que
  -- cayó y la clase de su motivo.
  CREATE TEMP TABLE _vpw ON COMMIT DROP AS
    SELECT g.ocid, g.ruc, g.entidad_ruc, g.f, g.fc, g.fo, v.id, v.fecha_visita, v.hora_ingreso, v.hora_salida, v.duracion_min,
           v.funcionario_nombre, v.funcionario_cargo, v.funcionario_area, v.motivo, v.entidad_visitada, v.visitante,
           v.fuente AS fuente_visita,
           visita_decisor(v.funcionario_cargo, v.funcionario_area) AS decisor, p.dni, p.nombre, p.rol,
           visita_motivo_clase(v.motivo) AS clase,
           CASE WHEN g.fc IS NOT NULL AND v.fecha_visita < g.fc THEN 'antes_de_convocar'
                WHEN v.fecha_visita = g.f THEN 'dia_buena_pro'
                WHEN g.fo IS NOT NULL AND g.fo < g.f AND v.fecha_visita > g.fo THEN 'evaluacion'
                WHEN g.fc IS NOT NULL AND g.fo IS NOT NULL AND v.fecha_visita <= g.fo THEN 'convocatoria'
           END AS etapa
      FROM _vpg g
      JOIN _vpp p ON p.ruc = g.ruc
      JOIN visitas_entidades v ON v.numero_documento = p.dni AND v.fecha_visita BETWEEN g.f - 365 AND g.f
      JOIN _vpm m ON m.t = v.entidad_visitada AND m.ruc = g.entidad_ruc;
  ANALYZE _vpw;
  -- Lo que leen los cuatro patrones de siempre: los 180 días antes de la buena pro.
  CREATE TEMP TABLE _vpv ON COMMIT DROP AS
    SELECT * FROM _vpw WHERE fecha_visita >= f - 180;

  DELETE FROM cruces_proveedor
   WHERE tipo IN ('visita_previa', 'visita_repetida', 'visita_fuera_horario', 'visita_antes_convocatoria',
                  'reunion_en_evaluacion', 'visita_personal_decisor');

  -- 1. Cada visita previa (como en la 188), con su etapa y la clase de su motivo (329).
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (x.ocid, x.ruc, x.id)
         'visita_previa', x.ruc, x.ocid, CASE WHEN x.decisor THEN 'alta' ELSE 'media' END,
         x.fecha_visita, x.dni, COALESCE(x.nombre, x.visitante), x.rol,
         jsonb_build_object('entidad_visitada', x.entidad_visitada, 'misma_entidad', true,
                            'cargo_funcionario', x.funcionario_cargo, 'area_funcionario', x.funcionario_area,
                            'decisor', x.decisor, 'motivo', x.motivo, 'dias_antes', x.f - x.fecha_visita, 'buena_pro', x.f,
                            'fuente_visita', x.fuente_visita, 'etapa', x.etapa, 'clase_motivo', x.clase),
         'visitas_entidades', 'https://visitas.servicios.gob.pe/consultas'
    FROM _vpv x
   ORDER BY x.ocid, x.ruc, x.id;
  GET DIAGNOSTICS n = ROW_COUNT;

  -- 2. Al mismo funcionario en 3 o más días distintos (el que más visitas tuvo, si fueron varios).
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (r.ocid, r.ruc)
         'visita_repetida', r.ruc, r.ocid, CASE WHEN r.decisor THEN 'alta' ELSE 'media' END,
         r.ultima, r.dni, r.nombre, r.rol,
         jsonb_build_object('entidad_visitada', r.entidad_visitada, 'misma_entidad', true,
                            'cargo_funcionario', r.cargo, 'area_funcionario', r.area, 'decisor', r.decisor,
                            'dias', r.dias, 'visitas_n', r.n, 'primera', r.primera, 'ultima', r.ultima,
                            'dias_antes', r.f - r.ultima, 'buena_pro', r.f, 'visitas', r.visitas, 'fuente_visita', r.fuente_visita),
         'visitas_entidades', 'https://visitas.servicios.gob.pe/consultas'
    FROM (SELECT x.ocid, x.ruc, x.f, x.funcionario_nombre,
                 count(DISTINCT x.fecha_visita) AS dias, count(*) AS n,
                 min(x.fecha_visita) AS primera, max(x.fecha_visita) AS ultima, bool_or(x.decisor) AS decisor,
                 (array_agg(x.funcionario_cargo ORDER BY x.fecha_visita DESC))[1] AS cargo,
                 (array_agg(x.funcionario_area ORDER BY x.fecha_visita DESC))[1] AS area,
                 (array_agg(x.entidad_visitada ORDER BY x.fecha_visita DESC))[1] AS entidad_visitada,
                 (array_agg(x.dni ORDER BY x.fecha_visita DESC))[1] AS dni,
                 (array_agg(COALESCE(x.nombre, x.visitante) ORDER BY x.fecha_visita DESC))[1] AS nombre,
                 (array_agg(x.rol ORDER BY x.fecha_visita DESC))[1] AS rol,
                 (array_agg(x.fuente_visita ORDER BY x.fecha_visita DESC))[1] AS fuente_visita,
                 (jsonb_agg(jsonb_build_object('fecha', x.fecha_visita, 'hora', to_char(x.hora_ingreso, 'HH24:MI'),
                                               'minutos', x.duracion_min) ORDER BY x.fecha_visita, x.hora_ingreso)) AS visitas
            FROM _vpv x
           WHERE COALESCE(btrim(x.funcionario_nombre), '') <> ''
           GROUP BY x.ocid, x.ruc, x.f, x.funcionario_nombre
          HAVING count(DISTINCT x.fecha_visita) >= 3) r
   ORDER BY r.ocid, r.ruc, r.decisor DESC, r.dias DESC;

  -- 3. Fuera de horario: fin de semana, antes de las 7 o desde las 19 (la duración no cuenta).
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT r.tipo, r.ruc, r.ocid, 'media', r.primera, r.dni, r.nombre, r.rol,
         jsonb_build_object('entidad_visitada', r.entidad_visitada, 'misma_entidad', true, 'decisor', r.decisor,
                            'visitas_n', r.n, 'buena_pro', r.f, 'dias_antes', r.f - r.ultima, 'visitas', r.visitas,
                            'fuente_visita', r.fuente_visita),
         'visitas_entidades', 'https://visitas.servicios.gob.pe/consultas'
    FROM (SELECT 'visita_fuera_horario' AS tipo, y.ocid, y.ruc, y.f, count(*) AS n, min(y.fecha_visita) AS primera,
                 max(y.fecha_visita) AS ultima, bool_or(y.decisor) AS decisor,
                 (array_agg(y.entidad_visitada ORDER BY y.fecha_visita))[1] AS entidad_visitada,
                 (array_agg(y.dni ORDER BY y.fecha_visita))[1] AS dni,
                 (array_agg(COALESCE(y.nombre, y.visitante) ORDER BY y.fecha_visita))[1] AS nombre,
                 (array_agg(y.rol ORDER BY y.fecha_visita))[1] AS rol,
                 (array_agg(y.fuente_visita ORDER BY y.fecha_visita))[1] AS fuente_visita,
                 jsonb_agg(jsonb_build_object('fecha', y.fecha_visita, 'hora', to_char(y.hora_ingreso, 'HH24:MI'),
                                              'minutos', y.duracion_min, 'por', y.por, 'cargo', y.funcionario_cargo,
                                              'area', y.funcionario_area, 'decisor', y.decisor)
                           ORDER BY y.fecha_visita, y.hora_ingreso) AS visitas
            FROM (SELECT x.*, CASE
                           WHEN extract(isodow FROM x.fecha_visita) IN (6, 7) THEN 'fin_de_semana'
                           WHEN x.hora_ingreso < '07:00' THEN 'temprano'
                           WHEN x.hora_ingreso >= '19:00' THEN 'noche' END AS por
                    FROM _vpv x) y
           WHERE y.por IS NOT NULL
           GROUP BY y.ocid, y.ruc, y.f) r;

  -- 4. En los 7 días previos a la convocatoria del proceso que después ganó.
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT 'visita_antes_convocatoria', r.ruc, r.ocid, CASE WHEN r.decisor THEN 'alta' ELSE 'media' END,
         r.ultima, r.dni, r.nombre, r.rol,
         jsonb_build_object('entidad_visitada', r.entidad_visitada, 'misma_entidad', true, 'decisor', r.decisor,
                            'visitas_n', r.n, 'convocatoria', r.fc, 'buena_pro', r.f, 'dias_antes_convocatoria', r.fc - r.ultima,
                            'visitas', r.visitas, 'fuente_visita', r.fuente_visita),
         'visitas_entidades', 'https://visitas.servicios.gob.pe/consultas'
    FROM (SELECT x.ocid, x.ruc, x.f, x.fc, count(*) AS n, max(x.fecha_visita) AS ultima, bool_or(x.decisor) AS decisor,
                 (array_agg(x.entidad_visitada ORDER BY x.fecha_visita DESC))[1] AS entidad_visitada,
                 (array_agg(x.dni ORDER BY x.decisor DESC, x.fecha_visita DESC))[1] AS dni,
                 (array_agg(COALESCE(x.nombre, x.visitante) ORDER BY x.decisor DESC, x.fecha_visita DESC))[1] AS nombre,
                 (array_agg(x.rol ORDER BY x.decisor DESC, x.fecha_visita DESC))[1] AS rol,
                 (array_agg(x.fuente_visita ORDER BY x.decisor DESC, x.fecha_visita DESC))[1] AS fuente_visita,
                 jsonb_agg(jsonb_build_object('fecha', x.fecha_visita, 'hora', to_char(x.hora_ingreso, 'HH24:MI'),
                                              'cargo', x.funcionario_cargo, 'area', x.funcionario_area, 'decisor', x.decisor)
                           ORDER BY x.fecha_visita, x.hora_ingreso) AS visitas
            FROM _vpv x
           WHERE x.fc IS NOT NULL AND x.fecha_visita BETWEEN x.fc - 7 AND x.fc
           GROUP BY x.ocid, x.ruc, x.f, x.fc) r;

  -- 5. (329) Reunión con quien decide las compras DESPUÉS de presentar su oferta y ANTES de la buena pro. Sólo los
  --    motivos de trato directo (reunión, visita personal, gestión de intereses, por el procedimiento): un mantenimiento
  --    o una entrega no cuentan. Media si la empresa no era proveedora de la entidad (sin órdenes ese año ni el
  --    anterior y sin otra buena pro en los dos años previos a la convocatoria); baja si ya lo era, donde la visita suele
  --    ser por lo que ya tiene contratado. Sólo empresas: de una persona natural no se publica nada de esto.
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (r.ocid, r.ruc)
         'reunion_en_evaluacion', r.ruc, r.ocid, CASE WHEN r.ya_proveedor THEN 'baja' ELSE 'media' END,
         r.ultima, r.dni, r.nombre, r.rol,
         jsonb_build_object('entidad_visitada', r.entidad_visitada, 'misma_entidad', true, 'decisor', true,
                            'visitas_n', r.n, 'oferta', r.fo, 'buena_pro', r.f, 'dias_evaluacion', r.f - r.fo,
                            'ya_proveedor', r.ya_proveedor, 'visitas', r.visitas, 'fuente_visita', r.fuente_visita,
                            'en_observacion', v_obs_reunion),
         'visitas_entidades', 'https://visitas.servicios.gob.pe/consultas'
    FROM (SELECT x.ocid, x.ruc, x.entidad_ruc, x.f, x.fo, x.fc, count(*) AS n, max(x.fecha_visita) AS ultima,
                 (array_agg(x.entidad_visitada ORDER BY x.fecha_visita DESC))[1] AS entidad_visitada,
                 (array_agg(x.dni ORDER BY x.fecha_visita DESC))[1] AS dni,
                 (array_agg(COALESCE(x.nombre, x.visitante) ORDER BY x.fecha_visita DESC))[1] AS nombre,
                 (array_agg(x.rol ORDER BY x.fecha_visita DESC))[1] AS rol,
                 (array_agg(x.fuente_visita ORDER BY x.fecha_visita DESC))[1] AS fuente_visita,
                 jsonb_agg(jsonb_build_object('fecha', x.fecha_visita, 'hora', to_char(x.hora_ingreso, 'HH24:MI'),
                                              'minutos', x.duracion_min, 'cargo', x.funcionario_cargo,
                                              'area', x.funcionario_area, 'decisor', true, 'clase', x.clase)
                           ORDER BY x.fecha_visita, x.hora_ingreso) AS visitas,
                 (EXISTS (SELECT 1 FROM empresa_orden_anual o
                           WHERE o.ruc = x.ruc AND o.entidad_ruc = x.entidad_ruc
                             AND o.anio IN (extract(year FROM COALESCE(x.fc, x.fo))::int - 1, extract(year FROM COALESCE(x.fc, x.fo))::int)
                             AND o.primera < COALESCE(x.fc, x.fo))
                  OR EXISTS (SELECT 1 FROM conosce_adjudicaciones y
                              WHERE y.ruc_proveedor = x.ruc AND y.entidad_ruc = x.entidad_ruc
                                AND y.fecha_buenapro < COALESCE(x.fc, x.fo) AND y.fecha_buenapro >= COALESCE(x.fc, x.fo) - 730)) AS ya_proveedor
            FROM _vpv x
           WHERE x.etapa = 'evaluacion' AND x.decisor AND x.ruc LIKE '20%'
             AND x.clase IN ('reunion', 'personal', 'gestion_intereses', 'seleccion')
           GROUP BY x.ocid, x.ruc, x.entidad_ruc, x.f, x.fo, x.fc) r
   ORDER BY r.ocid, r.ruc, r.n DESC, r.f DESC;

  -- 6. (329) La misma persona del ganador visitó al MISMO funcionario que decide las compras, con motivo declarado
  --    «visita personal», en 3 o más días de 2 o más meses distintos, en el año anterior a la buena pro: una relación
  --    personal declarada entre quien vende y quien decide. Sólo empresas.
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (r.ocid, r.ruc)
         'visita_personal_decisor', r.ruc, r.ocid, 'media', r.ultima, r.dni, r.nombre, r.rol,
         jsonb_build_object('entidad_visitada', r.entidad_visitada, 'misma_entidad', true,
                            'cargo_funcionario', r.cargo, 'area_funcionario', r.area, 'decisor', true,
                            'dias', r.dias, 'meses', r.meses, 'visitas_n', r.n, 'primera', r.primera, 'ultima', r.ultima,
                            'dias_antes', r.f - r.ultima, 'buena_pro', r.f, 'visitas', r.visitas,
                            'fuente_visita', r.fuente_visita, 'en_observacion', v_obs_personal),
         'visitas_entidades', 'https://visitas.servicios.gob.pe/consultas'
    FROM (SELECT x.ocid, x.ruc, x.f, x.dni, x.funcionario_nombre,
                 count(DISTINCT x.fecha_visita) AS dias, count(DISTINCT date_trunc('month', x.fecha_visita)) AS meses, count(*) AS n,
                 min(x.fecha_visita) AS primera, max(x.fecha_visita) AS ultima,
                 (array_agg(x.funcionario_cargo ORDER BY x.fecha_visita DESC))[1] AS cargo,
                 (array_agg(x.funcionario_area ORDER BY x.fecha_visita DESC))[1] AS area,
                 (array_agg(x.entidad_visitada ORDER BY x.fecha_visita DESC))[1] AS entidad_visitada,
                 (array_agg(COALESCE(x.nombre, x.visitante) ORDER BY x.fecha_visita DESC))[1] AS nombre,
                 (array_agg(x.rol ORDER BY x.fecha_visita DESC))[1] AS rol,
                 (array_agg(x.fuente_visita ORDER BY x.fecha_visita DESC))[1] AS fuente_visita,
                 (jsonb_agg(jsonb_build_object('fecha', x.fecha_visita, 'hora', to_char(x.hora_ingreso, 'HH24:MI'),
                                               'minutos', x.duracion_min) ORDER BY x.fecha_visita, x.hora_ingreso)) AS visitas
            FROM _vpw x
           WHERE x.clase = 'personal' AND x.decisor AND x.fecha_visita < x.f AND x.ruc LIKE '20%'
             AND COALESCE(btrim(x.funcionario_nombre), '') <> ''
           GROUP BY x.ocid, x.ruc, x.f, x.dni, x.funcionario_nombre
          HAVING count(DISTINCT x.fecha_visita) >= 3 AND count(DISTINCT date_trunc('month', x.fecha_visita)) >= 2) r
   ORDER BY r.ocid, r.ruc, r.dias DESC, r.f DESC;

  RETURN n;
END $$;
ALTER FUNCTION refrescar_cruce_visita_previa() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_cruce_visita_previa() FROM PUBLIC;

-- ── 4 · Ofertas de rivales vinculados, casi a la vez ────────────────────────────────────────────────────────────────
-- El reporte de presentación de ofertas del SEACE trae la fecha y la hora en que cada postor registró la suya
-- (proceso_postor, migración 326). Aquí: el ganador de un ítem y otro postor de ese ítem (los dos empresas con RUC)
-- registraron sus ofertas con 30 minutos o menos de diferencia Y comparten una persona en el Registro Nacional de
-- Proveedores (socio, representante o directivo, por su documento; no cuentan quienes figuran en más de 10 empresas).
-- El vínculo ya lo dice «socio común»; esto agrega que las dos ofertas se registraron una tras otra.
CREATE OR REPLACE FUNCTION refrescar_cruce_ofertas_a_la_vez() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n int;
  v_obs boolean := EXISTS (SELECT 1 FROM senal_en_observacion WHERE tipo = 'ofertas_a_la_vez');
BEGIN
  CREATE TEMP TABLE _oa_p ON COMMIT DROP AS
    SELECT ocid, item, codigo AS ruc, min(presento_at) AS t, bool_or(gano) AS gano
      FROM proceso_postor WHERE codigo ~ '^20\d{9}$' AND presento_at IS NOT NULL GROUP BY 1, 2, 3;
  CREATE INDEX ON _oa_p (ocid, item);
  ANALYZE _oa_p;

  CREATE TEMP TABLE _oa_par ON COMMIT DROP AS
    SELECT g.ocid, g.item, g.ruc, o.ruc AS otro, g.t AS t_ganador, o.t AS t_otro,
           abs(extract(epoch FROM (g.t - o.t))) / 60 AS minutos
      FROM _oa_p g JOIN _oa_p o ON o.ocid = g.ocid AND o.item = g.item AND o.ruc <> g.ruc
     WHERE g.gano AND abs(extract(epoch FROM (g.t - o.t))) <= 1800;

  CREATE TEMP TABLE _oa_s ON COMMIT DROP AS
    SELECT r.ruc_empresa::text AS ruc, r.numero_documento AS doc, max(r.nombre) AS nombre,
           string_agg(DISTINCT r.tipo_rol, ', ' ORDER BY r.tipo_rol) AS rol
      FROM rnp_conformacion_juridica r
     WHERE r.tipo_documento LIKE 'DOC. NACIONAL%' AND r.numero_documento ~ '^\d{8}$'
       AND r.ruc_empresa::text IN (SELECT ruc FROM _oa_par UNION SELECT otro FROM _oa_par)
     GROUP BY 1, 2;
  DELETE FROM _oa_s s
   WHERE (SELECT count(DISTINCT x.ruc_empresa) FROM rnp_conformacion_juridica x WHERE x.numero_documento = s.doc) > 10;

  DELETE FROM cruces_proveedor WHERE tipo = 'ofertas_a_la_vez';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (p.ocid, p.ruc, p.otro)
         'ofertas_a_la_vez', p.ruc, p.ocid, 'media', p.t_ganador::date, a.doc, a.nombre, a.rol,
         jsonb_build_object('otros_postores', jsonb_build_array(p.otro), 'rol_en_otros', to_jsonb(string_to_array(b.rol, ', ')),
                            'minutos', round(p.minutos::numeric, 1), 'hora_ganador', to_char(p.t_ganador, 'HH24:MI'),
                            'hora_otro', to_char(p.t_otro, 'HH24:MI'), 'item', p.item, 'en_observacion', v_obs),
         'seace_reporte_presentacion', NULL
    FROM _oa_par p
    JOIN _oa_s a ON a.ruc = p.ruc
    JOIN _oa_s b ON b.ruc = p.otro AND b.doc = a.doc
   ORDER BY p.ocid, p.ruc, p.otro, p.minutos;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ── 5 · La tasa base de cada señal ──────────────────────────────────────────────────────────────────────────────────
-- En cuántos procesos aparece cada tipo y sobre cuántos se puede medir. El universo depende de la fuente: una señal de
-- visitas sólo puede salir en las entidades cuyo registro de visitas tenemos; una del acta, en los procesos con el acta
-- leída. Los tipos sin proceso (sanciones, penalidades, aportes: datos de la empresa) se cuentan por empresa.
CREATE TABLE IF NOT EXISTS senal_tasa_base (
  tipo          TEXT PRIMARY KEY,
  casos         INTEGER NOT NULL,
  universo      INTEGER,
  universo_que  TEXT,
  refrescado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION refrescar_senal_tasa_base() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n int;
  u_todos int; u_visitas int; u_acta int; u_bases int; u_consultas int; u_ofertas int; u_empresas int;
  f_min date; f_max date;
BEGIN
  SELECT min(fecha_visita), max(fecha_visita) INTO f_min, f_max FROM visitas_entidades;
  -- Procesos adjudicados que la base puede enlazar a su ficha, y los de entidades con registro de visitas.
  SELECT count(DISTINCT cv.ocid),
         count(DISTINCT cv.ocid) FILTER (WHERE a.fecha_buenapro BETWEEN f_min AND f_max + 180
                                           AND a.entidad_ruc::text IN (SELECT ruc FROM visita_entidad_ruc))
    INTO u_todos, u_visitas
    FROM conosce_adjudicaciones a
    JOIN (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
           WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid) cv
      ON cv.codigo = a.codigo_convocatoria AND cv.entidad_ruc = a.entidad_ruc;
  SELECT count(DISTINCT ocid) FILTER (WHERE clase = 'buena_pro'), count(DISTINCT ocid) FILTER (WHERE clase = 'bases'),
         count(DISTINCT ocid) FILTER (WHERE clase = 'consultas')
    INTO u_acta, u_bases, u_consultas FROM documento_lectura;
  SELECT count(DISTINCT ocid) INTO u_ofertas
    FROM (SELECT ocid FROM proceso_postor WHERE codigo ~ '^20\d{9}$' AND presento_at IS NOT NULL
           GROUP BY ocid, item HAVING count(DISTINCT codigo) >= 2) z;
  SELECT count(*) INTO u_empresas FROM empresa_resumen WHERE adj_procesos > 0;

  DELETE FROM senal_tasa_base;
  INSERT INTO senal_tasa_base (tipo, casos, universo, universo_que)
  SELECT t.tipo, t.casos,
         CASE WHEN NOT t.por_proceso THEN u_empresas
              WHEN t.tipo ~ '^visita_|^reunion_en_evaluacion$' THEN u_visitas
              WHEN t.tipo LIKE 'acta\_%' THEN u_acta
              WHEN t.tipo LIKE 'bases\_%' THEN u_bases
              WHEN t.tipo LIKE 'consultas\_%' THEN u_consultas
              WHEN t.tipo = 'ofertas_a_la_vez' THEN u_ofertas
              WHEN t.tipo ~ '^(obra|inversion)_' THEN NULL
              ELSE u_todos END,
         CASE WHEN NOT t.por_proceso THEN 'empresas que ganaron algún proceso'
              WHEN t.tipo ~ '^visita_|^reunion_en_evaluacion$' THEN 'procesos adjudicados en entidades con registro de visitas'
              WHEN t.tipo LIKE 'acta\_%' THEN 'procesos con el acta de buena pro leída'
              WHEN t.tipo LIKE 'bases\_%' THEN 'procesos con las bases leídas'
              WHEN t.tipo LIKE 'consultas\_%' THEN 'procesos con el pliego de consultas leído'
              WHEN t.tipo = 'ofertas_a_la_vez' THEN 'procesos con dos o más ofertas de empresas y su hora de registro'
              WHEN t.tipo ~ '^(obra|inversion)_' THEN NULL
              ELSE 'procesos adjudicados' END
    FROM (SELECT tipo, bool_or(ocid IS NOT NULL) AS por_proceso,
                 CASE WHEN bool_or(ocid IS NOT NULL) THEN count(DISTINCT ocid) ELSE count(DISTINCT ruc_empresa) END::int AS casos
            FROM cruces_proveedor GROUP BY tipo) t;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.senal_en_observacion OWNER TO vigia_jobs;
    ALTER TABLE public.senal_tasa_base OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_cruce_ofertas_a_la_vez() OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_senal_tasa_base() OWNER TO vigia_jobs;
    ALTER FUNCTION public.visita_motivo_clase(text) OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.senal_en_observacion, public.senal_tasa_base TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.visita_motivo_clase(text) TO %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_cruce_ofertas_a_la_vez() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refrescar_senal_tasa_base() FROM PUBLIC;
