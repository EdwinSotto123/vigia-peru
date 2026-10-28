-- 193 · Patrones de visitas (fase 2.2 del plan del 2026-10-27), con el registro nacional de visitas.
--
-- Desde el 28-oct las visitas incluyen el Registro de Visitas en Línea de la PCM completo (fuente portal_visitas_nacional,
-- backend/scripts/cargar_visitas_nacional.py: julio de 2020 en adelante, unas 500 entidades). La «visita previa» (174,
-- 188) pasa a valer para todo el Estado, y se suman tres patrones. Cada uno queda atado al contrato del ganador, con sus
-- visitas como evidencia, y cuenta sólo lo que hizo la gente del ganador (sus socios, representantes y directivos en el
-- RNP, o el titular de un RUC 10, por su DNI) en la MISMA entidad que contrató, en los 180 días antes de la buena pro:
--
--   visita_repetida            visitó al MISMO funcionario en 3 o más días distintos. Grave si ese funcionario decide
--                              la compra (visita_decisor de la 188: titular, gerencia, administración, logística, comité).
--   visita_fuera_horario       una visita en fin de semana, antes de las 7 o desde las 19. No cuenta la duración: el 18 % de
--                              las visitas de la plataforma dura 4 horas o más y su salida se amontona a las 17:00, 17:30 y
--                              18:00 (la marcan al cerrar): una visita «larga» no es rara, es la salida que nadie anotó.
--   visita_antes_convocatoria  una visita en los 7 días previos a la convocatoria del proceso que después ganó (cuando se
--                              cierran las bases). Grave si visitó a quien decide.
--
-- De quien recibió la visita, sólo su cargo y su área: nunca su nombre (se agrupa por él dentro de la base, no sale).
-- Una visita no prueba un favor: es para revisar, y el registro existe para que se vea.
--
-- Refresco: el mismo refrescar_cruce_visita_previa() (Worker de scrapers, comun.ts, y cargar_visitas_nacional.py).
-- Cómo aplicarla: python infrastructure/dev/dev.py migrar backend/db/migrations/193_visitas_patrones.sql (DEV) y en
-- producción la misma migración y luego SELECT refrescar_cruce_visita_previa(); con los refrescos de aplicar_188.py.

CREATE OR REPLACE FUNCTION refrescar_cruce_visita_previa() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  SET LOCAL work_mem = '256MB';

  CREATE TEMP TABLE _vpo ON COMMIT DROP AS
    SELECT DISTINCT ruc, nombre FROM (
      SELECT ruc::text AS ruc, nombre FROM entidades WHERE nombre IS NOT NULL
      UNION ALL SELECT DISTINCT entidad_ruc::text, entidad FROM empresa_orden_anual WHERE entidad IS NOT NULL
      UNION ALL SELECT DISTINCT entidad_ruc::text, entidad FROM conosce_adjudicaciones WHERE entidad IS NOT NULL) x
     WHERE ruc ~ '^\d{11}$';
  CREATE TEMP TABLE _vpn ON COMMIT DROP AS
    SELECT DISTINCT ruc, mef_norm(nombre) AS k, 0 AS nivel FROM _vpo
    UNION
    SELECT DISTINCT ruc, mef_norm(regexp_replace(nombre, '\s+-\s+.*$', '')), 1 FROM _vpo WHERE nombre ~ '\s-\s';
  DELETE FROM _vpn WHERE k = '';
  CREATE TEMP TABLE _vpk ON COMMIT DROP AS
    SELECT x.k, x.ruc
      FROM _vpn x
      JOIN (SELECT k, min(nivel) AS nivel FROM _vpn GROUP BY k) m ON m.k = x.k AND m.nivel = x.nivel
      JOIN (SELECT y.k FROM _vpn y JOIN (SELECT k, min(nivel) AS nivel FROM _vpn GROUP BY k) mm ON mm.k = y.k AND mm.nivel = y.nivel
              LEFT JOIN entidades e ON e.ruc::text = y.ruc
             GROUP BY y.k HAVING count(DISTINCT COALESCE(e.ubigeo, y.ruc)) = 1) ok ON ok.k = x.k;
  CREATE INDEX ON _vpk (k);

  CREATE TEMP TABLE _vpm ON COMMIT DROP AS
    SELECT DISTINCT v.t, k.ruc
      FROM (SELECT DISTINCT entidad_visitada AS t FROM visitas_entidades WHERE entidad_visitada IS NOT NULL) v
     CROSS JOIN LATERAL unnest(claves_entidad_visitada(v.t)) c(k)
      JOIN _vpk k ON k.k = c.k;
  CREATE INDEX ON _vpm (t);

  -- Cada buena pro con su convocatoria (para «antes de la convocatoria»), de las entidades cuyas visitas tenemos.
  CREATE TEMP TABLE _vpg ON COMMIT DROP AS
    SELECT DISTINCT cv.ocid, COALESCE(m.ruc_miembro, a.ruc_proveedor) AS ruc, a.entidad_ruc::text AS entidad_ruc,
           a.fecha_buenapro AS f, a.fecha_convocatoria AS fc
      FROM conosce_adjudicaciones a
      JOIN (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
             WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid) cv
        ON cv.codigo = a.codigo_convocatoria AND cv.entidad_ruc = a.entidad_ruc
      LEFT JOIN conosce_consorcios m ON m.ruc_consorcio = a.ruc_proveedor AND a.ruc_proveedor !~ '^(10|20)\d{9}$'
     WHERE a.fecha_buenapro >= (SELECT min(fecha_visita) FROM visitas_entidades)
       AND a.fecha_buenapro <= (SELECT max(fecha_visita) FROM visitas_entidades) + 180
       AND COALESCE(m.ruc_miembro, a.ruc_proveedor) ~ '^(10|20)\d{9}$'
       AND a.entidad_ruc::text IN (SELECT ruc FROM _vpm);
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

  -- Las visitas de la gente del ganador a la entidad que contrató, en los 180 días antes de la buena pro.
  CREATE TEMP TABLE _vpv ON COMMIT DROP AS
    SELECT g.ocid, g.ruc, g.entidad_ruc, g.f, g.fc, v.id, v.fecha_visita, v.hora_ingreso, v.hora_salida, v.duracion_min,
           v.funcionario_nombre, v.funcionario_cargo, v.funcionario_area, v.motivo, v.entidad_visitada, v.visitante,
           v.fuente AS fuente_visita,
           visita_decisor(v.funcionario_cargo, v.funcionario_area) AS decisor, p.dni, p.nombre, p.rol
      FROM _vpg g
      JOIN _vpp p ON p.ruc = g.ruc
      JOIN visitas_entidades v ON v.numero_documento = p.dni AND v.fecha_visita BETWEEN g.f - 180 AND g.f
      JOIN _vpm m ON m.t = v.entidad_visitada AND m.ruc = g.entidad_ruc;

  DELETE FROM cruces_proveedor
   WHERE tipo IN ('visita_previa', 'visita_repetida', 'visita_fuera_horario', 'visita_antes_convocatoria');

  -- 1. Cada visita previa (como en la 188).
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (x.ocid, x.ruc, x.id)
         'visita_previa', x.ruc, x.ocid, CASE WHEN x.decisor THEN 'alta' ELSE 'media' END,
         x.fecha_visita, x.dni, COALESCE(x.nombre, x.visitante), x.rol,
         jsonb_build_object('entidad_visitada', x.entidad_visitada, 'misma_entidad', true,
                            'cargo_funcionario', x.funcionario_cargo, 'area_funcionario', x.funcionario_area,
                            'decisor', x.decisor, 'motivo', x.motivo, 'dias_antes', x.f - x.fecha_visita, 'buena_pro', x.f,
                            'fuente_visita', x.fuente_visita),
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

  -- 3. Fuera de horario: fin de semana, antes de las 7 o desde las 19 (la duración no cuenta: ver arriba).
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

  RETURN n;
END $$;
ALTER FUNCTION refrescar_cruce_visita_previa() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_cruce_visita_previa() FROM PUBLIC;
