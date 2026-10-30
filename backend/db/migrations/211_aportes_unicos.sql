-- 211: aportes ONPE únicos y candidaturas JNE + ONPE una sola vez (auditoría de datos del 2026-10-29).
--
-- 1. El mismo aporte (documento, partido, fecha, monto) está en el informe anual del partido (IFA) y en el de campaña, y
--    la carga vieja sin proceso (2015-2016) repite otros: 7,836 filas de 82,369 (S/ 21 M de S/ 137 M) se contaban dos
--    veces en el perfil, «Su gente», la historia, los cruces `aporte` y las señales de persona. La vista
--    onpe_aporte_unico deja UNA fuente por aporte: la de campaña antes que la anual, con proceso antes que sin él, la
--    carga más reciente. Las filas repetidas DENTRO de un mismo proceso y partido se quedan (528 grupos: 206 con otro
--    tipo de aporte y 214 con otra clave en la fuente, son aportes distintos). Un partido renombrado en el mismo proceso
--    (44 filas) cuenta una vez: la clave usa el RUC de la organización cuando lo hay.
-- 2. refrescar_cruces, refrescar_personas_senales y refrescar_senales_politicas leen la vista. Las dos últimas, además,
--    quitan la candidatura de ONPE cuando el JNE trae la misma (mismo documento, año y partido).
--
-- Sólo funciones y una vista: nada se borra. Los datos precalculados se rehacen al correr los refrescos (ver el pie).

CREATE OR REPLACE VIEW onpe_aporte_unico AS
SELECT id, numero_documento, nombre, nombre_original, partido, "año",
       -- Una fecha imposible (años 217, 1021 o 2916 en la fuente) no se muestra como fecha.
       CASE WHEN fecha_aporte BETWEEN DATE '1990-01-01' AND current_date THEN fecha_aporte END AS fecha_aporte,
       monto, tipo_aporte, nivel, fuente, fuente_url,
       cargado_en, proceso, ruc_organizacion, tipo_receptor, receptor, aporte_clave, sha256, descargado_at
  FROM (
    SELECT a.*,
           first_value(COALESCE(a.proceso, '') || '|' || COALESCE(a.partido, '')) OVER (
             PARTITION BY a.numero_documento, COALESCE(NULLIF(a.ruc_organizacion, '-'), mef_norm(a.partido)),
                          COALESCE(a.fecha_aporte::text, 'id' || a.id), a.monto
             ORDER BY (a.nivel = 'campaña') DESC NULLS LAST, (a.proceso IS NULL), a.cargado_en DESC NULLS LAST, a.id DESC) AS elegido
      FROM onpe_aportantes a) x
 WHERE COALESCE(x.proceso, '') || '|' || COALESCE(x.partido, '') = x.elegido;

COMMENT ON VIEW onpe_aporte_unico IS 'Cada aporte ONPE una vez: entre IFA y campaña (o una carga vieja) la de campaña; migración 211.';

CREATE OR REPLACE FUNCTION public.refrescar_cruces()
 RETURNS TABLE(tipo text, filas integer)
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Ganadores: un proveedor por adjudicación (los consorcios llegan como varios suppliers). Un consorcio con
  -- código del SEACE (no RUC) se abre en sus integrantes (conosce_consorcios, migración 53): cada integrante
  -- con RUC cuenta como ganador, con el consorcio al lado.
  DROP TABLE IF EXISTS _cg;
  -- Integrantes de consorcios y ganadores del OCDS, cada uno materializado antes del join (migración 56): sin
  -- esto el planificador recorría los ~200 mil integrantes una vez por convocatoria y tardaba horas.
  DROP TABLE IF EXISTS _cmiem;
  CREATE TEMP TABLE _cmiem ON COMMIT DROP AS
    SELECT DISTINCT ruc_consorcio, ruc_miembro, miembro FROM conosce_consorcios WHERE ruc_miembro ~ '^(10|20)\d{9}$';
  CREATE INDEX ON _cmiem (ruc_consorcio);
  DROP TABLE IF EXISTS _csup;
  CREATE TEMP TABLE _csup ON COMMIT DROP AS
    SELECT c.ocid, c.entidad_ruc::text AS entidad_ruc, regexp_replace(s->>'id', '^PE-RUC-', '') AS sup, s->>'name' AS nombre,
           NULLIF(aw->>'date', '')::date AS f
    FROM convocatorias c,
         jsonb_array_elements(COALESCE(COALESCE(c.ocds_payload->'awards', c.adjudicaciones), '[]'::jsonb)) aw,
         jsonb_array_elements(COALESCE(aw->'suppliers', '[]'::jsonb)) s
    WHERE c.ocid NOT LIKE 'ocds-vigia-%';
  ANALYZE _cmiem;
  ANALYZE _csup;
  CREATE TEMP TABLE _cg ON COMMIT DROP AS
    SELECT DISTINCT x.ocid, x.entidad_ruc, COALESCE(m.ruc_miembro, x.sup) AS ruc, COALESCE(m.miembro, x.nombre) AS nombre, x.f,
           CASE WHEN m.ruc_miembro IS NOT NULL THEN x.sup END AS consorcio_ruc,
           CASE WHEN m.ruc_miembro IS NOT NULL THEN x.nombre END AS consorcio
    FROM _csup x
    LEFT JOIN _cmiem m ON m.ruc_consorcio = x.sup AND x.sup !~ '^(10|20)\d{9}$'
    WHERE COALESCE(m.ruc_miembro, x.sup) ~ '^(10|20)\d{9}$';
  CREATE INDEX ON _cg (ruc);

  -- Personas detrás de cada ganador: socios / representantes / directivos con DNI en el RNP, y el titular
  -- de un RUC 10 (sus dígitos 3 a 10 son el DNI).
  DROP TABLE IF EXISTS _cp;
  CREATE TEMP TABLE _cp ON COMMIT DROP AS
    SELECT ruc, dni, max(nombre) AS nombre, string_agg(DISTINCT rol, ', ' ORDER BY rol) AS rol FROM (
      SELECT r.ruc_empresa::text AS ruc, r.numero_documento AS dni, r.nombre, r.tipo_rol AS rol
      FROM rnp_conformacion_juridica r
      WHERE r.tipo_documento LIKE 'DOC. NACIONAL%' AND r.numero_documento ~ '^\d{8}$'
        AND r.ruc_empresa::text IN (SELECT ruc FROM _cg)
      UNION ALL
      SELECT DISTINCT g.ruc, substr(g.ruc, 3, 8), g.nombre, 'TITULAR' FROM _cg g WHERE g.ruc LIKE '10%'
    ) x GROUP BY ruc, dni;
  CREATE INDEX ON _cp (dni);

  DELETE FROM cruces_proveedor;

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, severidad, fecha, monto, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT 'aporte', p.ruc, CASE WHEN sum(a.monto) >= 1000 THEN 'media' ELSE 'baja' END, max(a.fecha_aporte), sum(a.monto), p.dni, p.nombre, p.rol,
         jsonb_build_object('partido', a.partido, 'aportes', count(*), 'desde', min(a."año"), 'hasta', max(a."año")),
         'onpe_aportantes', 'https://claridad.onpe.gob.pe/'
  FROM _cp p JOIN onpe_aporte_unico a ON a.numero_documento = p.dni
  GROUP BY p.ruc, p.dni, p.nombre, p.rol, a.partido;

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT 'aporte_empresa', a.numero_documento, 'media', max(a.fecha_aporte), sum(a.monto),
         jsonb_build_object('partido', a.partido, 'aportes', count(*), 'desde', min(a."año"), 'hasta', max(a."año")),
         'onpe_aportantes', 'https://claridad.onpe.gob.pe/'
  FROM onpe_aporte_unico a WHERE a.numero_documento LIKE '20%' AND a.numero_documento IN (SELECT ruc FROM _cg)
  GROUP BY a.numero_documento, a.partido;

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, severidad, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT DISTINCT 'candidato', p.ruc, 'media', p.dni, p.nombre, p.rol,
         jsonb_build_object('organizacion', k.organizacion, 'proceso', k.proceso, 'departamento', k.departamento),
         'onpe_candidatos', 'https://claridad.onpe.gob.pe/'
  FROM _cp p JOIN onpe_candidatos k ON k.dni = p.dni;

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, severidad, fecha, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT DISTINCT 'autoridad', p.ruc, 'alta', j.periodo_inicio, p.dni, j.nombre, p.rol,
         jsonb_build_object('cargo', j.cargo, 'organizacion', j.organizacion_politica, 'departamento', j.departamento,
                            'provincia', j.provincia, 'distrito', j.distrito, 'desde', j.periodo_inicio, 'hasta', j.periodo_fin),
         'jne_autoridades', j.fuente_url
  FROM _cp p JOIN jne_autoridades j ON j.dni = p.dni;

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT 'penalidad', pe.empresa_ruc::text, 'media', max(pe.fecha), sum(pe.monto),
         jsonb_build_object('penalidades', count(*), 'entidades', count(DISTINCT pe.entidad_contratante),
                            'desde', min(pe.fecha), 'hasta', max(pe.fecha)),
         'penalidades', 'https://www.datosabiertos.gob.pe/dataset/penalidades-aplicadas-contratos-oece'
  FROM penalidades pe WHERE pe.empresa_ruc::text IN (SELECT ruc FROM _cg)
  GROUP BY pe.empresa_ruc;

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT CASE s.tipo WHEN 'definitivo' THEN 'sancion_definitiva' WHEN 'temporal' THEN 'sancion_temporal' ELSE 'sancion_multa' END, s.ruc, CASE s.tipo WHEN 'definitivo' THEN 'alta' WHEN 'temporal' THEN 'media' ELSE 'baja' END,
         COALESCE(s.fecha_desde, s.fecha_resolucion), s.monto_multa_soles,
         jsonb_build_object('tipo', s.tipo, 'infraccion', s.infraccion, 'resolucion', s.resolucion,
                            'desde', s.fecha_desde, 'hasta', s.fecha_hasta, 'estado', s.estado),
         'osce_sancionados', 'https://www.datosabiertos.gob.pe/dataset/proveedores-sancionados-2025'
  FROM osce_sancionados s WHERE s.ruc IN (SELECT ruc FROM _cg);

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (g.ocid, g.ruc) 'sancion_vigente', g.ruc, g.ocid, 'alta', g.f, NULL::numeric,
         jsonb_build_object('tipo', s.tipo, 'infraccion', s.infraccion, 'resolucion', s.resolucion,
                            'desde', s.fecha_desde, 'hasta', s.fecha_hasta),
         'osce_sancionados', 'https://www.datosabiertos.gob.pe/dataset/proveedores-sancionados-2025'
  FROM _cg g JOIN osce_sancionados s ON s.ruc = g.ruc AND s.tipo IN ('temporal', 'definitivo')
   AND g.f >= s.fecha_desde AND (s.fecha_hasta IS NULL OR g.f <= s.fecha_hasta)
  ORDER BY g.ocid, g.ruc, s.fecha_desde DESC;

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT 'visita_previa', g.ruc, g.ocid,
         'alta',
         v.fecha_visita, p.dni, p.nombre, p.rol,
         jsonb_build_object('entidad_visitada', v.entidad_visitada, 'misma_entidad', mef_norm(v.entidad_visitada) = mef_norm(e.nombre),
                            'funcionario', v.funcionario_nombre, 'cargo_funcionario', v.funcionario_cargo, 'motivo', v.motivo,
                            'dias_antes', g.f - v.fecha_visita, 'buena_pro', g.f),
         'visitas_entidades', 'https://www.datosabiertos.gob.pe/'
  FROM _cg g JOIN _cp p ON p.ruc = g.ruc
  JOIN visitas_entidades v ON v.numero_documento = p.dni AND v.fecha_visita BETWEEN g.f - 180 AND g.f
  -- 115: SOLO si visitó la MISMA entidad que contrató. Antes se unía solo por DNI+fecha y una visita a cualquier
  -- entidad (p.ej. Surco) se pegaba a contratos de otra entidad (p.ej. Instituto de Medicina Legal): 99% era ruido.
  JOIN entidades e ON e.ruc::text = g.entidad_ruc AND mef_norm(v.entidad_visitada) = mef_norm(e.nombre);

  -- Postores de cada proceso: los del expediente (postores) y los de CONOSCE (migración 49), sólo con RUC
  -- (los códigos de consorcio del SEACE no cruzan con el RNP).
  DROP TABLE IF EXISTS _pp;
  CREATE TEMP TABLE _pp ON COMMIT DROP AS
    SELECT DISTINCT ocid, ruc FROM (
      SELECT p.ocid, p.empresa_ruc::text AS ruc FROM postores p WHERE p.ocid NOT LIKE 'ocds-vigia-%'
      UNION ALL
      SELECT c.ocid, cp.ruc_postor FROM conosce_postores cp JOIN convocatorias c ON c.ocid = cp.codigo_convocatoria
      WHERE cp.ruc_postor ~ '^(10|20)\d{9}$'
    ) x;
  CREATE INDEX ON _pp (ocid);

  -- Una fila por (proceso, postor, persona): con quién más compitió esa persona en el mismo proceso. Los
  -- postores son ofertas separadas (no miembros de un mismo consorcio: comprobado el 2026-10-14, ninguno de
  -- los pares figura junto en una misma adjudicación).
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT 'socio_comun', a.ruc, a.ocid, 'alta', ra.numero_documento, max(ra.nombre),
         string_agg(DISTINCT ra.tipo_rol, ', ' ORDER BY ra.tipo_rol),
         jsonb_build_object('otros_postores', jsonb_agg(DISTINCT b.ruc), 'rol_en_otros', jsonb_agg(DISTINCT rb.tipo_rol)),
         'rnp_conformacion_juridica', 'https://www.datosabiertos.gob.pe/'
  FROM _pp a JOIN _pp b ON b.ocid = a.ocid AND b.ruc <> a.ruc
  JOIN rnp_conformacion_juridica ra ON ra.ruc_empresa = a.ruc AND ra.tipo_documento LIKE 'DOC. NACIONAL%'
  JOIN rnp_conformacion_juridica rb ON rb.ruc_empresa = b.ruc AND rb.numero_documento = ra.numero_documento
  GROUP BY a.ocid, a.ruc, ra.numero_documento;

  -- Proveedor recurrente: cuántos otros procesos le ganó a la misma entidad desde 2018 (CONOSCE) y qué parte
  -- de lo que adjudicó la entidad se llevó. Desde 3 procesos.
  -- Lo que adjudicó la entidad, acumulado por fecha de buena pro (migración 83): la parte del ganador se mide sobre
  -- lo adjudicado antes de la convocatoria, no sobre todo lo que vino después. Sin fecha, al final ('infinity').
  DROP TABLE IF EXISTS _ent;
  CREATE TEMP TABLE _ent ON COMMIT DROP AS
    SELECT entidad_ruc, fecha,
           (sum(count(*)) OVER (PARTITION BY entidad_ruc ORDER BY fecha))::int AS procesos,
           sum(sum(monto)) OVER (PARTITION BY entidad_ruc ORDER BY fecha) AS monto
    FROM (SELECT a.entidad_ruc, a.codigo_convocatoria, COALESCE(min(a.fecha_buenapro), 'infinity'::date) AS fecha,
                 sum(a.monto_adjudicado) AS monto
            FROM conosce_adjudicaciones a WHERE a.entidad_ruc IN (SELECT entidad_ruc FROM _cg)
           GROUP BY a.entidad_ruc, a.codigo_convocatoria) p
    GROUP BY entidad_ruc, fecha;
  CREATE INDEX ON _ent (entidad_ruc, fecha);
  ANALYZE _ent;
  -- Por proceso (migración 75): lo que el ganador se llevó de la entidad en cada código de convocatoria, para contar
  -- "aparte de este" sin el proceso que se mira (antes se quitaba por ocid, que no es el código: lo contaba).
  DROP TABLE IF EXISTS _rec;
  CREATE TEMP TABLE _rec ON COMMIT DROP AS
    SELECT a.entidad_ruc, a.ruc_proveedor AS ruc, a.codigo_convocatoria AS codigo,
           sum(a.monto_adjudicado) AS monto, min(a.fecha_buenapro) AS fecha
    FROM conosce_adjudicaciones a
    JOIN (SELECT DISTINCT entidad_ruc, ruc FROM _cg) g ON g.entidad_ruc = a.entidad_ruc AND g.ruc = a.ruc_proveedor
    GROUP BY a.entidad_ruc, a.ruc_proveedor, a.codigo_convocatoria;
  CREATE INDEX ON _rec (entidad_ruc, ruc);
  ANALYZE _rec;

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT CASE WHEN r.monto >= 0.5 * NULLIF(t.monto, 0) THEN 'recurrente_dominante'
              WHEN r.procesos >= 10 OR r.monto >= 0.25 * NULLIF(t.monto, 0) THEN 'recurrente_frecuente'
              ELSE 'recurrente' END, g.ruc, g.ocid,
         CASE WHEN r.monto >= 0.5 * NULLIF(t.monto, 0) THEN 'alta'
              WHEN r.procesos >= 10 OR r.monto >= 0.25 * NULLIF(t.monto, 0) THEN 'media' ELSE 'baja' END,
         r.ultima, r.monto,
         jsonb_build_object('procesos', r.procesos, 'desde', r.primera, 'hasta', r.ultima,
                            'participacion', round(r.monto / NULLIF(t.monto, 0), 4), 'procesos_entidad', t.procesos),
         'conosce_adjudicaciones', 'https://conosce.osce.gob.pe/buscador/'
  FROM (SELECT DISTINCT g.ocid, g.ruc, g.entidad_ruc, c.codigo, c.fecha_convocatoria AS fconv
          FROM _cg g JOIN convocatorias c ON c.ocid = g.ocid) g
  JOIN LATERAL (
    -- Sin contar este proceso (por su código de convocatoria) y sólo los de antes (migración 83): un antecedente es lo
    -- que ya había pasado cuando se convocó; los procesos posteriores no lo son.
    SELECT count(*)::int AS procesos, sum(x.monto) AS monto, min(x.fecha) AS primera, max(x.fecha) AS ultima
    FROM _rec x WHERE x.entidad_ruc = g.entidad_ruc AND x.ruc = g.ruc AND x.codigo IS DISTINCT FROM g.codigo
      AND (g.fconv IS NULL OR x.fecha < g.fconv)
  ) r ON r.procesos >= 3
  JOIN LATERAL (
    SELECT e.procesos, e.monto FROM _ent e
     WHERE e.entidad_ruc = g.entidad_ruc AND (g.fconv IS NULL OR e.fecha < g.fconv)
     ORDER BY e.fecha DESC LIMIT 1
  ) t ON true;

  -- Contrato con adicionales o prórrogas (CONOSCE): por contrato, lo adicional sobre lo contratado. Los
  -- adicionales tienen tope legal (bienes y servicios 25 %; obras 15 % sin autorización de la Contraloría).
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT CASE WHEN k.adicional > 0.25 * k.total THEN 'adicional_sobre_tope'
              WHEN k.adicional >= 0.15 * k.total THEN 'adicional_alto' ELSE 'adicional' END, k.ruc, k.ocid,
         CASE WHEN k.adicional > 0.25 * k.total THEN 'alta' WHEN k.adicional >= 0.15 * k.total THEN 'media' ELSE 'baja' END,
         k.suscripcion, k.adicional,
         jsonb_build_object('contrato', k.num_contrato, 'contratado', k.total, 'adicional', k.adicional,
                            'reduccion', k.reduccion, 'prorroga', k.prorroga, 'complementario', k.complementario,
                            'porcentaje', round(100 * k.adicional / NULLIF(k.total, 0), 1), 'url_contrato', k.url),
         'conosce_contratos', COALESCE(k.url, 'https://conosce.osce.gob.pe/buscador/')
  FROM (
    SELECT c.ocid, k.ruc_contratista AS ruc, k.codigo_contrato, max(k.num_contrato) AS num_contrato,
           max(k.monto_contratado_total) AS total, sum(COALESCE(k.monto_adicional, 0)) AS adicional,
           sum(COALESCE(k.monto_reduccion, 0)) AS reduccion, sum(COALESCE(k.monto_prorroga, 0)) AS prorroga,
           sum(COALESCE(k.monto_complementario, 0)) AS complementario, max(k.url_contrato) AS url,
           max(k.fecha_suscripcion) AS suscripcion
    FROM conosce_contratos k JOIN convocatorias c ON c.ocid = k.codigo_convocatoria
    WHERE k.ruc_contratista ~ '^(10|20)\d{9}$' AND c.ocid NOT LIKE 'ocds-vigia-%'
    GROUP BY c.ocid, k.ruc_contratista, k.codigo_contrato
  ) k
  WHERE k.total > 0 AND (k.adicional > 0 OR k.prorroga > 0);

  -- Proveedor de campaña (ONPE, gastos de campaña): el ganador o un socio / representante le vendió a una
  -- organización política en campaña.
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, severidad, monto, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT 'proveedor_campana', q.ruc, CASE WHEN sum(x.monto) >= 5000 THEN 'media' ELSE 'baja' END, sum(x.monto), q.dni, max(q.nombre), max(q.rol),
         jsonb_build_object('organizacion', x.organizacion, 'proceso', x.proceso),
         'onpe_gastos_proveedores', 'https://claridadportal.onpe.gob.pe/'
  FROM (
    SELECT DISTINCT ruc, ruc AS doc, NULL::text AS dni, NULL::text AS nombre, NULL::text AS rol FROM _cg
    UNION ALL
    SELECT ruc, dni, dni, nombre, rol FROM _cp
  ) q JOIN onpe_gastos_proveedores x ON x.documento = q.doc
  GROUP BY q.ruc, q.dni, x.organizacion, x.proceso;

  -- Quién gobernaba la entidad contratante cuando dio la buena pro (JNE): alcalde distrital o provincial,
  -- o gobernador regional, con su organización política.
  DROP TABLE IF EXISTS _cgob;
  CREATE TEMP TABLE _cgob ON COMMIT DROP AS
    SELECT DISTINCT g.ocid, g.ruc, g.f, j.organizacion_politica AS org, mef_norm(j.organizacion_politica) AS org_n, j.cargo
    -- Migración 124: la jurisdicción que gobierna una entidad sale de entidad_gobierno_amplia (migración 65: entidad ->
    -- nivel + ubigeo de su gobierno, vetado por MEF/ubigeo), no del NOMBRE. Así una UGEL/hospital/organismo dependiente
    -- se atribuye a la autoridad de SU región/provincia/distrito, sin depender de que se llame "MUNICIPALIDAD...".
    FROM _cg g JOIN entidad_gobierno_amplia ega ON ega.ruc = g.entidad_ruc
    JOIN jne_autoridades j ON (
         (ega.nivel = 'distrital'  AND j.cargo = 'ALCALDE DISTRITAL'   AND j.ubigeo = ega.ubigeo)
      OR (ega.nivel = 'provincial' AND j.cargo = 'ALCALDE PROVINCIAL'  AND left(j.ubigeo, 4) = ega.ubigeo)
      OR (ega.nivel = 'regional'   AND j.cargo = 'GOBERNADOR REGIONAL' AND left(j.ubigeo, 2) = ega.ubigeo))
     AND (j.periodo_inicio IS NULL OR g.f IS NULL OR g.f >= j.periodo_inicio)
     AND (j.periodo_fin IS NULL OR g.f IS NULL OR g.f <= j.periodo_fin)
    WHERE j.organizacion_politica IS NOT NULL;

  -- Partido gobernante: el ganador (o un socio) aportó o le vendió en campaña a la organización que gobernaba
  -- la entidad que le dio la buena pro. Nombres normalizados; uno puede ser prefijo del otro ("ALIANZA PARA
  -- EL PROGRESO" / "ALIANZA PARA EL PROGRESO DEL PERÚ").
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT CASE WHEN k.tipo = 'proveedor_campana' THEN 'vendio_gobernante' ELSE 'partido_gobernante' END,
         k.ruc_empresa, gb.ocid,
         CASE WHEN k.tipo <> 'proveedor_campana' THEN 'alta' WHEN k.monto >= 1000 THEN 'media' ELSE 'baja' END,
         k.fecha, k.monto, k.persona_doc, k.persona_nombre, k.persona_rol,
         k.detalle || jsonb_build_object('via', k.tipo, 'organizacion_gobernante', gb.org, 'cargo_gobernante', gb.cargo),
         k.fuente, k.fuente_url
  FROM (SELECT c.*, mef_norm(COALESCE(c.detalle->>'partido', c.detalle->>'organizacion')) AS org_n
        FROM cruces_proveedor c WHERE c.tipo IN ('aporte', 'aporte_empresa', 'proveedor_campana')) k
  JOIN _cgob gb ON gb.ruc = k.ruc_empresa
  WHERE (k.org_n = gb.org_n
     OR (least(length(gb.org_n), length(k.org_n)) >= 15 AND (k.org_n LIKE gb.org_n || '%' OR gb.org_n LIKE k.org_n || '%')))
  -- 115: el aporte/venta a la campaña debe PRECEDER a la buena pro (mismo año o antes). Antes, como llevan ocid, se
  -- saltaban el filtro de fecha y una venta a la campaña de 2026 figuraba como antecedente de un contrato de 2023.
    AND (gb.f IS NULL OR COALESCE(
          CASE WHEN k.tipo IN ('aporte', 'aporte_empresa') THEN COALESCE(NULLIF(k.detalle->>'desde', '')::int, extract(year FROM k.fecha)::int)
               ELSE substring(k.detalle->>'proceso' FROM '(\d{4})')::int END, 0) <= extract(year FROM gb.f)::int);

  -- Fraccionamiento (migración 51): el ganador recibió de la misma entidad, en un mismo día, varias órdenes
  -- "hasta 8 UIT" que juntas pasan el tope.
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT 'fraccionamiento', g.ruc, g.ocid, CASE WHEN bool_or(f.severidad = 'alta') THEN 'alta' ELSE 'media' END,
         max(f.fecha), sum(f.total),
         jsonb_build_object('dias', count(*), 'ordenes', sum(f.ordenes), 'total', sum(f.total), 'desde', min(f.fecha),
                            'hasta', max(f.fecha), 'misma_descripcion', count(*) FILTER (WHERE f.misma_descripcion)),
         'conosce_ordenes', 'https://conosce.osce.gob.pe/buscador/'
  FROM (SELECT DISTINCT g.ocid, g.ruc, g.entidad_ruc, c.fecha_convocatoria AS fconv
          FROM _cg g JOIN convocatorias c ON c.ocid = g.ocid) g
  -- Sólo los días anteriores a la convocatoria (migración 83).
  JOIN ordenes_fraccionadas f ON f.entidad_ruc = g.entidad_ruc AND f.ruc_contratista = g.ruc AND (g.fconv IS NULL OR f.fecha < g.fconv)
  GROUP BY g.ocid, g.ruc;

  RETURN QUERY SELECT c.tipo, count(*)::int FROM cruces_proveedor c GROUP BY c.tipo ORDER BY c.tipo;
END $function$;

CREATE OR REPLACE FUNCTION public.refrescar_personas_senales(p_desde date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  n INT;
  v_anio INT := extract(year FROM p_desde)::int;   -- NULL: todo
  t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_personas'));
  SET LOCAL work_mem = '256MB';

  -- entidad_gobierno es una vista (expresiones regulares sobre el nombre de cada entidad): materializada una vez. Cruzada
  -- en vivo, el planificador la recalculaba por cada fila (939 mil × 2 400 entidades: 570 s en DEV).
  CREATE TEMP TABLE _eg ON COMMIT DROP AS SELECT ruc::text AS ruc, nivel, ubigeo::text AS ubigeo FROM entidad_gobierno;
  CREATE UNIQUE INDEX ON _eg (ruc);
  ANALYZE _eg;

  -- Los pares entidad × persona que se rehacen: los que tienen órdenes desde v_anio (con todos sus años), o todos.
  CREATE TEMP TABLE _par ON COMMIT DROP AS
  SELECT DISTINCT entidad_ruc, ruc FROM persona_orden_anual WHERE v_anio IS NULL OR anio >= v_anio;
  CREATE UNIQUE INDEX ON _par (entidad_ruc, ruc);
  ANALYZE _par;
  RAISE NOTICE 'personas: % pares (% s)', (SELECT count(*) FROM _par), round(extract(epoch FROM clock_timestamp() - t0));

  -- Cada persona en cada entidad y año, con quién gobernaba la entidad ese año (los mandatos empiezan el 1 de enero;
  -- si una elección complementaria se superpone, la más reciente).
  CREATE TEMP TABLE _pa ON COMMIT DROP AS
  SELECT a.entidad_ruc, a.ruc, a.anio, a.primera, a.ultima, a.entidad, a.nombre, a.servicio, a.ordenes, a.meses, a.monto,
         substr(a.ruc, 3, 8) AS dni, a.nom_n, a.dep_n, a.ent_n, a.ap1, a.ap2,
         eg.nivel, eg.ubigeo AS gub, gp.org_clave, gp.org_nombre, mef_norm(gp.org_nombre) AS gob_n, gp.anio_eleccion
    FROM persona_orden_anual a
    JOIN _par USING (entidad_ruc, ruc)
    LEFT JOIN _eg eg ON eg.ruc = a.entidad_ruc
    LEFT JOIN LATERAL (
      SELECT g.org_clave, g.org_nombre, g.anio_eleccion FROM gobierno_periodo g
       WHERE g.nivel = eg.nivel AND g.ubigeo = eg.ubigeo AND make_date(a.anio, 7, 1) BETWEEN g.desde AND g.hasta
       ORDER BY g.anio_eleccion DESC LIMIT 1
    ) gp ON TRUE;
  CREATE INDEX ON _pa (dni);
  ANALYZE _pa;

  -- Cuántas personas contratadas llevan cada pareja de apellidos (para no marcar QUISPE MAMANI).
  CREATE TEMP TABLE _frec ON COMMIT DROP AS
  SELECT ap1, ap2, count(*)::int AS frec FROM (SELECT DISTINCT ruc, ap1, ap2 FROM persona_orden_anual) x GROUP BY 1, 2;
  ANALYZE _frec;
  RAISE NOTICE 'personas: _pa y _frec (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  IF v_anio IS NULL THEN
    DELETE FROM persona_senal;
  ELSE
    DELETE FROM persona_senal s USING _par p WHERE s.entidad_ruc = p.entidad_ruc AND s.ruc = p.ruc;
    -- Los pares que ya no tienen órdenes (un mes recargado sin ellas).
    DELETE FROM persona_senal s WHERE NOT EXISTS (SELECT 1 FROM persona_orden_anual a WHERE a.entidad_ruc = s.entidad_ruc AND a.ruc = s.ruc);
  END IF;

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
  -- Migración 211: una candidatura que está en el JNE y también en ONPE Claridad va una vez, la del JNE (con cargo y
  -- resultado). Antes salían las dos y la de ONPE se leía «Sin cargo en la fuente» (17,916 pares señal-año en PROD).
  CREATE INDEX ON _pc (entidad_ruc, ruc, anio_cand);
  DELETE FROM _pc o USING _pc j
   WHERE o.cargo IS NULL AND o.resultado IS NULL AND j.cargo IS NOT NULL
     AND j.entidad_ruc = o.entidad_ruc AND j.ruc = o.ruc AND j.anio = o.anio AND j.anio_cand = o.anio_cand
     AND mismo_partido(j.org_n, o.org_n);

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
    FROM _pa p JOIN onpe_aporte_unico a ON a.numero_documento = p.dni
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
        FROM _pa p JOIN _aut a ON a.ap1 = p.ap1 AND a.ap2 = p.ap2 AND a.dep_n = p.dep_n
       WHERE a.dni IS NULL AND misma_persona(a.nom_n, p.nom_n) AND p.primera <= a.hasta AND p.ultima >= a.desde
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
         AND NOT misma_persona(a.nom_n, p.nom_n) AND (a.dni IS NULL OR a.dni <> p.dni)
    ) x
   GROUP BY entidad_ruc, ruc;
  RAISE NOTICE 'personas: candidaturas, aportes y autoridades (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- ── DJI: quienes declararon trabajar en la entidad (por su nombre), en la declaración de cada año.
  CREATE TEMP TABLE _ent ON COMMIT DROP AS SELECT DISTINCT ent_n FROM _pa;
  CREATE TEMP TABLE _djie ON COMMIT DROP AS
  SELECT x.entidad, mef_norm(x.entidad) AS ent_n FROM (SELECT DISTINCT entidad FROM dji_funcionarios WHERE entidad IS NOT NULL) x;
  CREATE TEMP TABLE _dji ON COMMIT DROP AS
  SELECT DISTINCT m.ent_n, f.nombre_norm AS nom_n, mef_norm(f.apellido_paterno) AS ap1, mef_norm(f.apellido_materno) AS ap2,
         trim(COALESCE(f.nombres, '') || ' ' || COALESCE(f.apellido_paterno, '') || ' ' || COALESCE(f.apellido_materno, '')) AS nombre,
         f.cargo, extract(year FROM fecha_dji(f.fecha_presentacion))::int AS anio,
         fecha_dji(f.fecha_inicio_cargo) AS inicio, fecha_dji(f.fecha_cese_cargo) AS cese
    FROM dji_funcionarios f
    JOIN _djie m ON m.entidad = f.entidad
    JOIN _ent e ON e.ent_n = m.ent_n
   WHERE f.nombre_norm IS NOT NULL;
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
   WHERE f.frec <= 20 AND length(p.ap1) > 1 AND length(p.ap2) > 1 AND NOT misma_persona(d.nom_n, p.nom_n) AND d.anio BETWEEN p.anio - 1 AND p.anio
   GROUP BY p.entidad_ruc, p.ruc;

  RAISE NOTICE 'personas: DJI (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- ── inhabilitado: órdenes emitidas dentro de una inhabilitación del Tribunal (temporal o definitiva).
  CREATE TEMP TABLE _san ON COMMIT DROP AS
  SELECT s.ruc, s.tipo, s.resolucion, s.fecha_desde, s.fecha_hasta, left(s.infraccion, 300) AS infraccion,
         COALESCE(s.fecha_hasta, CASE WHEN s.tipo = 'definitivo' THEN DATE '9999-12-31' END) AS hasta
    FROM osce_sancionados s
   WHERE s.ruc ~ '^10\d{9}$' AND s.tipo IN ('temporal', 'definitivo') AND s.fecha_desde IS NOT NULL
     AND s.ruc IN (SELECT ruc FROM _par);
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
        JOIN _par p ON p.entidad_ruc = c.entidad_ruc AND p.ruc = c.ruc_contratista
       WHERE c.tipo_orden = 'Orden de Servicio' AND c.estado IS DISTINCT FROM 'Anulada' AND c.moneda = 'Nuevos Soles' AND c.monto > 0
       ORDER BY c.entidad_ruc, c.orden, c.fecha_emision, c.anio DESC, c.mes DESC
    ) o
   GROUP BY o.entidad_ruc, o.ruc;

  -- ── meses_seguidos: órdenes en 10 o más meses de un mismo año.
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT entidad_ruc, ruc, 'meses_seguidos', 'media',
         jsonb_build_object('anios', jsonb_agg(jsonb_build_object('anio', anio, 'meses', meses, 'ordenes', ordenes, 'monto', monto) ORDER BY anio)),
         'conosce_ordenes', 'https://conosce.osce.gob.pe/buscador/'
    FROM persona_orden_anual JOIN _par USING (entidad_ruc, ruc) WHERE meses >= 10
   GROUP BY entidad_ruc, ruc;

  -- ── Lo que se paga por mes por cada tipo de servicio, en cada entidad y en todo el país.
  DELETE FROM servicio_referencia WHERE v_anio IS NULL OR anio >= v_anio;
  INSERT INTO servicio_referencia (entidad_ruc, anio, servicio, personas, mediana_mes, p25_mes, p75_mes, p90_mes)
  SELECT entidad_ruc, anio, servicio, count(*),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY monto / meses), percentile_cont(0.25) WITHIN GROUP (ORDER BY monto / meses),
         percentile_cont(0.75) WITHIN GROUP (ORDER BY monto / meses), percentile_cont(0.9) WITHIN GROUP (ORDER BY monto / meses)
    FROM persona_orden_anual WHERE servicio IS NOT NULL AND meses > 0 AND (v_anio IS NULL OR anio >= v_anio)
   GROUP BY entidad_ruc, anio, servicio
  UNION ALL
  SELECT '', anio, servicio, count(*),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY monto / meses), percentile_cont(0.25) WITHIN GROUP (ORDER BY monto / meses),
         percentile_cont(0.75) WITHIN GROUP (ORDER BY monto / meses), percentile_cont(0.9) WITHIN GROUP (ORDER BY monto / meses)
    FROM persona_orden_anual WHERE servicio IS NOT NULL AND meses > 0 AND (v_anio IS NULL OR anio >= v_anio)
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
    JOIN _par p ON p.entidad_ruc = a.entidad_ruc AND p.ruc = a.ruc
    JOIN servicio_referencia r ON r.entidad_ruc = a.entidad_ruc AND r.anio = a.anio AND r.servicio = a.servicio
   WHERE servicio_es_personal(a.servicio) AND a.servicio <> 'Otros servicios personales' AND a.meses >= 2
     AND r.personas >= 10 AND r.mediana_mes > 0
     AND a.monto / a.meses >= 2.5 * r.mediana_mes AND a.monto / a.meses >= 6000
   GROUP BY a.entidad_ruc, a.ruc;

  -- ── visita_previa (migración 195): visitó la entidad en los 180 días antes de su PRIMERA orden ahí, por el RUC de la
  --    entidad visitada (todos sus nombres: también los de la plataforma nacional de visitas). persona_visita_previa_insertar().
  CREATE TEMP TABLE _vpf ON COMMIT DROP AS
    SELECT entidad_ruc, ruc, dni, min(primera) AS primera FROM _pa GROUP BY entidad_ruc, ruc, dni;
  CREATE INDEX ON _vpf (dni);
  ANALYZE _vpf;
  PERFORM persona_visita_previa_insertar();

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
    FROM persona_senal JOIN _par USING (entidad_ruc, ruc) GROUP BY entidad_ruc, ruc;
  RAISE NOTICE 'personas: señales (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  IF v_anio IS NULL THEN
    DELETE FROM persona_entidad;
  ELSE
    DELETE FROM persona_entidad pe USING _par p WHERE pe.entidad_ruc = p.entidad_ruc AND pe.ruc = p.ruc;
    DELETE FROM persona_entidad pe WHERE NOT EXISTS (SELECT 1 FROM persona_orden_anual a WHERE a.entidad_ruc = pe.entidad_ruc AND a.ruc = pe.ruc);
  END IF;
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

  RAISE NOTICE 'personas: listo (% s)', round(extract(epoch FROM clock_timestamp() - t0));
  RETURN n;
END $function$;

CREATE OR REPLACE FUNCTION public.refrescar_senales_politicas()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE n_loc int := 0; n_pla int := 0; t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_senales_politicas'));
  SET LOCAL work_mem = '256MB';

  -- A. El gobierno de cada entidad en cada tramo: el local (gobierno_periodo por el nivel y el ubigeo de su gobierno) y el
  --    nacional (el partido del Presidente, en el Ejecutivo). `eleccion` = el proceso ONPE de la campaña que lo eligió.
  CREATE TEMP TABLE _sgp ON COMMIT DROP AS
    SELECT eg.ruc, g.nivel, g.desde, g.hasta, g.org_nombre, mef_norm(g.org_nombre) AS gob_n, 'ERM' || g.anio_eleccion AS eleccion,
           NULL::text AS presidente
      FROM (SELECT ruc::text AS ruc, nivel, ubigeo::text AS ubigeo FROM entidad_gobierno) eg
      JOIN gobierno_periodo g ON g.nivel = eg.nivel AND g.ubigeo = eg.ubigeo
     WHERE g.org_nombre IS NOT NULL
    UNION ALL
    SELECT en.ruc, 'nacional', gn.desde, gn.hasta, gn.org_nombre, mef_norm(gn.org_nombre), gn.eleccion, gn.presidente
      FROM entidad_ejecutivo_nacional en CROSS JOIN gobierno_nacional_periodo gn;
  CREATE INDEX ON _sgp (ruc);
  ANALYZE _sgp;

  -- B. Aportes (ONPE Claridad, con DNI) y candidaturas con DNI (ONPE; JNE cuando lo trae).
  CREATE TEMP TABLE _sap ON COMMIT DROP AS
    SELECT a.id, a.numero_documento AS dni, mef_norm(a.nombre) AS nom_n, a.nombre, a.partido, mef_norm(a.partido) AS partido_n,
           a.proceso, a.nivel, a.fecha_aporte AS fecha, a."año" AS anio, a.monto
      FROM onpe_aporte_unico a
     WHERE a.partido IS NOT NULL AND a.numero_documento ~ '^\d{8}$';
  CREATE INDEX ON _sap (dni);
  CREATE INDEX ON _sap (nom_n);
  ANALYZE _sap;
  CREATE TEMP TABLE _sca ON COMMIT DROP AS
    SELECT DISTINCT dni, nom_n, org_n, partido, cargo, anio, resultado, nombre FROM (
      SELECT c.dni, mef_norm(c.apellidos || ' ' || c.nombres) AS nom_n, mef_norm(c.organizacion) AS org_n, c.organizacion AS partido,
             NULL::text AS cargo, substring(c.proceso FROM '\d{4}')::int AS anio, NULL::text AS resultado, c.apellidos || ' ' || c.nombres AS nombre
        FROM onpe_candidatos c WHERE c.dni ~ '^\d{8}$' AND c.organizacion IS NOT NULL
      UNION ALL
      SELECT j.numero_documento, mef_norm(j.nombre), mef_norm(j.partido), j.partido, j.cargo, j."año", j.resultado, j.nombre
        FROM jne_candidaturas j WHERE j.numero_documento ~ '^\d{8}$' AND j.partido IS NOT NULL) x;
  CREATE INDEX ON _sca (dni);
  -- Migración 211: la candidatura del JNE y la misma en ONPE Claridad, una vez (la del JNE, con cargo y resultado).
  DELETE FROM _sca o USING _sca j
   WHERE o.cargo IS NULL AND o.resultado IS NULL AND j.cargo IS NOT NULL
     AND j.dni = o.dni AND j.anio = o.anio AND mismo_partido(j.org_n, o.org_n);
  ANALYZE _sca;
  RAISE NOTICE 'senales politicas: gobiernos, aportes y candidaturas (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- C. Locadores: cada entidad × persona × gobierno en que recibió órdenes, sólo para quien aportó o postuló.
  CREATE TEMP TABLE _sdni ON COMMIT DROP AS SELECT dni FROM _sap UNION SELECT dni FROM _sca;
  CREATE TEMP TABLE _slo ON COMMIT DROP AS
    SELECT po.entidad_ruc, po.ruc, substr(po.ruc, 3, 8) AS dni, g.nivel, g.desde, g.hasta, g.org_nombre, g.gob_n, g.eleccion, g.presidente
      FROM persona_orden_anual po
      JOIN _sgp g ON g.ruc = po.entidad_ruc AND po.ultima >= g.desde AND po.primera <= g.hasta
     WHERE po.ruc LIKE '10%' AND substr(po.ruc, 3, 8) IN (SELECT dni FROM _sdni)
     GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10;
  ANALYZE _slo;

  -- Los pares que hoy llevan estas señales (para rehacer su resumen aunque se queden sin ninguna).
  CREATE TEMP TABLE _spar ON COMMIT DROP AS
    SELECT DISTINCT entidad_ruc, ruc FROM persona_senal
     WHERE tipo = 'financio_campana' OR (tipo IN ('candidato_gobierna', 'aporte_gobierna') AND detalle->>'nivel' = 'nacional');
  DELETE FROM persona_senal WHERE tipo = 'financio_campana' OR (tipo IN ('candidato_gobierna', 'aporte_gobierna') AND detalle->>'nivel' = 'nacional');

  -- Los aportes al partido de cada gobierno en que trabajó (de campaña de su elección o no).
  CREATE TEMP TABLE _sla ON COMMIT DROP AS
    SELECT l.*, a.id, a.partido, a.monto, a.fecha, a.anio, a.proceso, a.nivel AS nivel_aporte, a.nombre,
           (a.nivel = 'campaña' AND a.proceso = l.eleccion) AS de_su_campana
      FROM _slo l JOIN _sap a ON a.dni = l.dni
     WHERE mismo_partido(a.partido_n, l.gob_n)
       AND (l.nivel <> 'nacional' OR a.anio BETWEEN extract(year FROM l.desde)::int - 5 AND extract(year FROM l.hasta)::int);
  -- Las órdenes de cada par durante ese gobierno, contadas de verdad (CONOSCE, una vez cada orden).
  CREATE TEMP TABLE _slord ON COMMIT DROP AS
    SELECT p.entidad_ruc, p.ruc, p.desde, o.primera, o.ultima, o.ordenes, o.monto
      FROM (SELECT DISTINCT entidad_ruc, ruc, desde, hasta FROM _sla WHERE de_su_campana) p
      CROSS JOIN LATERAL (
        SELECT min(x.fecha_emision) AS primera, max(x.fecha_emision) AS ultima, count(*)::int AS ordenes, sum(x.monto) AS monto
          FROM (SELECT DISTINCT ON (c.orden, c.fecha_emision) c.fecha_emision, c.monto
                  FROM conosce_ordenes c
                 WHERE c.ruc_contratista = p.ruc AND c.entidad_ruc = p.entidad_ruc AND c.tipo_orden = 'Orden de Servicio'
                   AND c.estado IS DISTINCT FROM 'Anulada' AND c.monto > 0 AND c.fecha_emision BETWEEN p.desde AND p.hasta
                 ORDER BY c.orden, c.fecha_emision, c.anio DESC, c.mes DESC) x) o
     WHERE o.ordenes > 0;

  -- C1. financio_campana: aportó a la campaña que puso a ese gobierno y después recibió sus órdenes (todas las órdenes
  --     son del gobierno ya instalado, es decir, posteriores a la campaña). El detalle trae todos sus aportes a ese partido.
  -- Un aporte cuenta una vez aunque trabajara en dos gobiernos del mismo partido (sus filas en _sla se repiten por tramo).
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  WITH ap AS (
    SELECT entidad_ruc, ruc, id, max(nombre) AS nombre, max(partido) AS partido, max(monto) AS monto, max(fecha) AS fecha,
           max(anio) AS anio, max(proceso) AS proceso, bool_or(de_su_campana) AS campana
      FROM _sla GROUP BY entidad_ruc, ruc, id),
  gob AS (
    -- El gobierno cuya campaña financió (el más reciente, si fueron dos).
    SELECT DISTINCT ON (entidad_ruc, ruc) entidad_ruc, ruc, org_nombre, nivel, presidente, eleccion, desde, hasta
      FROM _sla WHERE de_su_campana ORDER BY entidad_ruc, ruc, desde DESC),
  o AS (SELECT entidad_ruc, ruc, min(primera) AS primera, sum(ordenes)::int AS ordenes, sum(monto) AS monto FROM _slord GROUP BY 1, 2)
  SELECT g.entidad_ruc, g.ruc, 'financio_campana', 'alta',
         jsonb_build_object('partido', g.org_nombre, 'nivel', g.nivel, 'presidente', g.presidente, 'eleccion', g.eleccion,
                            'gobierno_desde', g.desde, 'gobierno_hasta', g.hasta,
                            'primera_orden', o.primera, 'ordenes', o.ordenes, 'monto_ordenes', o.monto,
                            'monto', x.monto, 'aportes', x.aportes),
         'onpe_aportantes', 'https://claridad.onpe.gob.pe/'
    FROM gob g
    JOIN o ON o.entidad_ruc = g.entidad_ruc AND o.ruc = g.ruc
    CROSS JOIN LATERAL (
      SELECT sum(ap.monto) AS monto,
             jsonb_agg(jsonb_build_object('nombre', ap.nombre, 'partido', ap.partido, 'monto', ap.monto, 'fecha', ap.fecha,
                                          'anio', ap.anio, 'proceso', ap.proceso, 'campana', ap.campana) ORDER BY ap.fecha) AS aportes
        FROM ap WHERE ap.entidad_ruc = g.entidad_ruc AND ap.ruc = g.ruc) x;
  GET DIAGNOSTICS n_loc = ROW_COUNT;
  -- Quien ya tiene financio_campana no repite su aporte como aporte_gobierna (el detalle de arriba los trae todos).
  DELETE FROM persona_senal s USING (SELECT entidad_ruc, ruc FROM persona_senal WHERE tipo = 'financio_campana') f
   WHERE s.tipo = 'aporte_gobierna' AND s.entidad_ruc = f.entidad_ruc AND s.ruc = f.ruc;

  -- C2. En el Ejecutivo nacional: candidato y aporte al partido del Presidente (media), como en lo local.
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT l.entidad_ruc, l.ruc, 'candidato_gobierna', 'media',
         jsonb_build_object('partido', max(l.org_nombre), 'nivel', 'nacional', 'presidente', max(l.presidente), 'por', 'dni',
                            'gobierno_desde', min(l.desde), 'gobierno_hasta', max(l.hasta), 'anios', jsonb_agg(DISTINCT extract(year FROM l.desde)::int),
                            'candidaturas', jsonb_agg(DISTINCT jsonb_build_object('nombre', c.nombre, 'partido', c.partido, 'cargo', c.cargo,
                                                                                 'anio', c.anio, 'resultado', c.resultado))),
         'onpe_candidatos', 'https://claridad.onpe.gob.pe/'
    FROM _slo l JOIN _sca c ON c.dni = l.dni
   WHERE l.nivel = 'nacional' AND mismo_partido(c.org_n, l.gob_n)
     AND c.anio BETWEEN extract(year FROM l.desde)::int - 5 AND extract(year FROM l.hasta)::int + 1
   GROUP BY l.entidad_ruc, l.ruc;
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT a.entidad_ruc, a.ruc, 'aporte_gobierna', 'media',
         jsonb_build_object('partido', max(a.org_nombre), 'nivel', 'nacional', 'presidente', max(a.presidente), 'monto', sum(a.monto),
                            'gobierno_desde', min(a.desde), 'gobierno_hasta', max(a.hasta),
                            'aportes', jsonb_agg(DISTINCT jsonb_build_object('nombre', a.nombre, 'partido', a.partido, 'monto', a.monto,
                                                                             'fecha', a.fecha, 'anio', a.anio, 'proceso', a.proceso))),
         'onpe_aportantes', 'https://claridad.onpe.gob.pe/'
    FROM _sla a
   WHERE a.nivel = 'nacional'
     AND NOT EXISTS (SELECT 1 FROM persona_senal f WHERE f.entidad_ruc = a.entidad_ruc AND f.ruc = a.ruc AND f.tipo = 'financio_campana')
   GROUP BY a.entidad_ruc, a.ruc;
  -- En el Ejecutivo, refrescar_personas_senales() no conoce al partido del Presidente y marca ese aporte o esa candidatura
  -- como «a otro partido» (baja): si todo lo que lista es del partido que ahora sí gobierna, sale (ya está arriba).
  DELETE FROM persona_senal a
   USING (SELECT entidad_ruc, ruc, max(detalle->>'partido') AS partido FROM persona_senal
           WHERE tipo = 'financio_campana' OR (tipo IN ('aporte_gobierna', 'candidato_gobierna') AND detalle->>'nivel' = 'nacional')
           GROUP BY 1, 2) g
   WHERE a.entidad_ruc = g.entidad_ruc AND a.ruc = g.ruc AND a.tipo IN ('aporte', 'candidato')
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(a.detalle->CASE a.tipo WHEN 'aporte' THEN 'aportes' ELSE 'candidaturas' END, '[]')) x
                      WHERE NOT mismo_partido(mef_norm(x->>'partido'), mef_norm(g.partido)));
  RAISE NOTICE 'senales politicas: locadores (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- C3. El resumen de cada par tocado (como refrescar_nepotismo_senal): se vacía y se rehace desde persona_senal.
  INSERT INTO _spar SELECT DISTINCT entidad_ruc, ruc FROM persona_senal
   WHERE tipo = 'financio_campana' OR (tipo IN ('candidato_gobierna', 'aporte_gobierna') AND detalle->>'nivel' = 'nacional');
  CREATE TEMP TABLE _spar2 ON COMMIT DROP AS SELECT DISTINCT entidad_ruc, ruc FROM _spar;
  UPDATE persona_entidad pe SET tipos = '{}', senales = '[]', n_senales = 0, sev = 0
    FROM _spar2 p WHERE pe.entidad_ruc = p.entidad_ruc AND pe.ruc = p.ruc;
  UPDATE persona_entidad pe
     SET tipos = s.tipos, senales = s.senales, n_senales = s.n, sev = s.sev
    FROM (SELECT ps.entidad_ruc, ps.ruc, array_agg(ps.tipo ORDER BY ps.tipo) AS tipos, count(*)::int AS n,
                 max(CASE ps.severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END)::smallint AS sev,
                 jsonb_agg(jsonb_build_object('tipo', ps.tipo, 'severidad', ps.severidad)
                           ORDER BY CASE ps.severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, ps.tipo) AS senales
            FROM persona_senal ps JOIN _spar2 p ON p.entidad_ruc = ps.entidad_ruc AND p.ruc = ps.ruc
           GROUP BY ps.entidad_ruc, ps.ruc) s
   WHERE pe.entidad_ruc = s.entidad_ruc AND pe.ruc = s.ruc;

  -- D. Planilla, por nombre completo. Sin homónimos: el nombre tiene un solo DNI entre los aportantes (o los candidatos) y
  --    está en a lo más dos entidades de la planilla; tres palabras o más.
  CREATE TEMP TABLE _snu ON COMMIT DROP AS
    SELECT nom_n, min(dni) AS dni FROM (SELECT DISTINCT nom_n, dni FROM _sap) x GROUP BY nom_n HAVING count(*) = 1;
  CREATE INDEX ON _snu (nom_n);
  CREATE TEMP TABLE _snc ON COMMIT DROP AS
    SELECT nom_n, min(dni) AS dni FROM (SELECT DISTINCT nom_n, dni FROM _sca) x GROUP BY nom_n HAVING count(*) = 1;
  CREATE INDEX ON _snc (nom_n);
  CREATE TEMP TABLE _spn ON COMMIT DROP AS
    SELECT nombre_norm FROM planilla_persona
     WHERE nombre_norm ~ '^\S+ \S+ \S+' AND (nombre_norm IN (SELECT nom_n FROM _snu) OR nombre_norm IN (SELECT nom_n FROM _snc))
     GROUP BY 1 HAVING count(DISTINCT entidad_ruc) <= 2;
  -- El primer mes cargado de cada entidad: quien aparece después entró a la planilla dentro de lo que se ve.
  CREATE TEMP TABLE _sdesde ON COMMIT DROP AS
    SELECT entidad_ruc, make_date(min(anio * 100 + mes) / 100, min(anio * 100 + mes) % 100, 1) AS desde FROM planilla_pte
     WHERE entidad_ruc IN (SELECT DISTINCT p.entidad_ruc FROM planilla_persona p JOIN _spn n ON n.nombre_norm = p.nombre_norm)
     GROUP BY entidad_ruc;
  CREATE TEMP TABLE _spl ON COMMIT DROP AS
    SELECT p.entidad_ruc, p.nombre_norm, p.primer_mes, p.ultimo_mes, (p.primer_mes > d.desde) AS entro_en_lo_visto, p.regimen,
           g.nivel, g.desde, g.hasta, g.org_nombre, g.gob_n, g.eleccion, g.presidente
      FROM planilla_persona p
      JOIN _spn n ON n.nombre_norm = p.nombre_norm
      JOIN _sgp g ON g.ruc = p.entidad_ruc AND p.ultimo_mes >= g.desde AND p.primer_mes <= g.hasta
      LEFT JOIN _sdesde d ON d.entidad_ruc = p.entidad_ruc;
  CREATE TEMP TABLE _sps (entidad_ruc text, nombre_norm text, tipo text, severidad text, detalle jsonb) ON COMMIT DROP;
  -- financio_campana: alta si entró a la planilla dentro de los meses cargados (después del aporte y ya con ese gobierno) o
  -- si es alto funcionario (régimen 7: un cargo que el gobierno designa); media si ya figuraba en el primer mes cargado.
  INSERT INTO _sps
  SELECT l.entidad_ruc, l.nombre_norm, 'financio_campana',
         CASE WHEN bool_or(l.entro_en_lo_visto) OR bool_or(l.regimen = 7) THEN 'alta' ELSE 'media' END,
         jsonb_build_object('partido', max(l.org_nombre), 'nivel', max(l.nivel), 'presidente', max(l.presidente), 'por', 'nombre',
                            'eleccion', max(l.eleccion), 'gobierno_desde', max(l.desde), 'gobierno_hasta', max(l.hasta),
                            'primer_mes', min(l.primer_mes), 'entro_en_lo_visto', bool_or(l.entro_en_lo_visto), 'alto_funcionario', bool_or(l.regimen = 7),
                            'monto', sum(a.monto),
                            'aportes', jsonb_agg(DISTINCT jsonb_build_object('nombre', a.nombre, 'partido', a.partido, 'monto', a.monto, 'fecha', a.fecha,
                                                                             'anio', a.anio, 'proceso', a.proceso, 'campana', true)))
    FROM _spl l JOIN _snu u ON u.nom_n = l.nombre_norm JOIN _sap a ON a.dni = u.dni
   WHERE mismo_partido(a.partido_n, l.gob_n) AND a.nivel = 'campaña' AND a.proceso = l.eleccion
   GROUP BY l.entidad_ruc, l.nombre_norm;
  -- aporte_gobierna: otros aportes a ese partido (anuales, o de otra campaña), si no lleva ya financio_campana.
  INSERT INTO _sps
  SELECT l.entidad_ruc, l.nombre_norm, 'aporte_gobierna', 'media',
         jsonb_build_object('partido', max(l.org_nombre), 'nivel', max(l.nivel), 'presidente', max(l.presidente), 'por', 'nombre',
                            'gobierno_desde', min(l.desde), 'gobierno_hasta', max(l.hasta), 'monto', sum(a.monto),
                            'aportes', jsonb_agg(DISTINCT jsonb_build_object('nombre', a.nombre, 'partido', a.partido, 'monto', a.monto,
                                                                             'fecha', a.fecha, 'anio', a.anio, 'proceso', a.proceso)))
    FROM _spl l JOIN _snu u ON u.nom_n = l.nombre_norm JOIN _sap a ON a.dni = u.dni
   WHERE mismo_partido(a.partido_n, l.gob_n)
     AND (l.nivel <> 'nacional' OR a.anio BETWEEN extract(year FROM l.desde)::int - 5 AND extract(year FROM l.hasta)::int)
     AND NOT EXISTS (SELECT 1 FROM _sps f WHERE f.entidad_ruc = l.entidad_ruc AND f.nombre_norm = l.nombre_norm)
   GROUP BY l.entidad_ruc, l.nombre_norm;
  -- candidato_gobierna en el Ejecutivo nacional (lo local ya lo hace refrescar_planilla, por nombre y departamento).
  INSERT INTO _sps
  SELECT l.entidad_ruc, l.nombre_norm, 'candidato_gobierna', 'media',
         jsonb_build_object('partido', max(l.org_nombre), 'nivel', 'nacional', 'presidente', max(l.presidente), 'por', 'nombre',
                            'gobierno_desde', min(l.desde), 'gobierno_hasta', max(l.hasta), 'anios', jsonb_agg(DISTINCT extract(year FROM l.desde)::int),
                            'candidaturas', jsonb_agg(DISTINCT jsonb_build_object('nombre', c.nombre, 'partido', c.partido, 'cargo', c.cargo,
                                                                                 'anio', c.anio, 'resultado', c.resultado)))
    FROM _spl l JOIN _snc u ON u.nom_n = l.nombre_norm JOIN _sca c ON c.dni = u.dni
   WHERE l.nivel = 'nacional' AND mismo_partido(c.org_n, l.gob_n)
     AND c.anio BETWEEN extract(year FROM l.desde)::int - 5 AND extract(year FROM l.hasta)::int + 1
   GROUP BY l.entidad_ruc, l.nombre_norm;
  RAISE NOTICE 'senales politicas: planilla (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  -- D1. Las señales de la planilla viven en planilla_persona.senales: se quitan las de esta función (de una corrida
  --     anterior) y se agregan las nuevas, y se rehacen tipos, n_senales y sev de las filas tocadas.
  CREATE TEMP TABLE _sptoc ON COMMIT DROP AS
    SELECT entidad_ruc, nombre_norm FROM planilla_persona
     WHERE senales @> '[{"tipo": "financio_campana"}]' OR senales @> '[{"tipo": "aporte_gobierna"}]'
        OR senales @> '[{"tipo": "candidato_gobierna", "detalle": {"nivel": "nacional"}}]'
    UNION SELECT entidad_ruc, nombre_norm FROM _sps;
  UPDATE planilla_persona p
     SET senales = x.senales, tipos = x.tipos, n_senales = x.n, sev = x.sev
    FROM (
      SELECT t.entidad_ruc, t.nombre_norm,
             COALESCE(jsonb_agg(e.s ORDER BY CASE e.s->>'severidad' WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, e.s->>'tipo')
                        FILTER (WHERE e.s IS NOT NULL), '[]'::jsonb) AS senales,
             COALESCE(array_agg(DISTINCT e.s->>'tipo') FILTER (WHERE e.s IS NOT NULL), '{}') AS tipos,
             count(e.s)::int AS n,
             COALESCE(max(CASE e.s->>'severidad' WHEN 'alta' THEN 3 WHEN 'media' THEN 2 WHEN 'baja' THEN 1 END), 0)::smallint AS sev
        FROM _sptoc t
        JOIN planilla_persona pp ON pp.entidad_ruc = t.entidad_ruc AND pp.nombre_norm = t.nombre_norm
        LEFT JOIN LATERAL (
          SELECT s FROM jsonb_array_elements(pp.senales) s
           WHERE NOT (s->>'tipo' IN ('financio_campana', 'aporte_gobierna')
                      OR (s->>'tipo' = 'candidato_gobierna' AND s->'detalle'->>'nivel' = 'nacional'))
          UNION ALL
          SELECT jsonb_build_object('tipo', n.tipo, 'severidad', n.severidad, 'detalle', n.detalle)
            FROM _sps n WHERE n.entidad_ruc = t.entidad_ruc AND n.nombre_norm = t.nombre_norm
        ) e ON true
       GROUP BY t.entidad_ruc, t.nombre_norm) x
   WHERE p.entidad_ruc = x.entidad_ruc AND p.nombre_norm = x.nombre_norm;
  GET DIAGNOSTICS n_pla = ROW_COUNT;

  -- D2. El resumen de cada alcance de la planilla, como al final de refrescar_planilla() (migración 108).
  CREATE TEMP TABLE _sprb ON COMMIT DROP AS
  SELECT x.alcance, CASE WHEN p.dudoso IS NULL THEN p.total END AS total, p.n_senales, p.sev, p.tipos, p.regimen, p.ultimo_mes,
         p.dudoso IS NOT NULL AS es_dudoso
    FROM planilla_persona p
    CROSS JOIN LATERAL (SELECT 'pais' AS alcance UNION ALL SELECT 'dep:' || p.dep WHERE p.dep IS NOT NULL
                        UNION ALL SELECT 'ent:' || p.entidad_ruc) x;
  DELETE FROM planilla_resumen;
  INSERT INTO planilla_resumen (alcance, resumen)
  SELECT t.alcance, jsonb_build_object('personas', t.personas, 'totalMes', t.total, 'conSenales', t.con, 'alta', t.alta, 'media', t.media,
                                       'ultimoMes', t.ultimo, 'porSenal', COALESCE(ps.l, '[]'), 'porRegimen', COALESCE(pr.l, '[]'),
                                       'dudosos', t.dudosos)
    FROM (SELECT alcance, count(*)::int AS personas, COALESCE(sum(total), 0)::float AS total, count(*) FILTER (WHERE n_senales > 0)::int AS con,
                 count(*) FILTER (WHERE sev = 3)::int AS alta, count(*) FILTER (WHERE sev = 2)::int AS media,
                 to_char(max(ultimo_mes), 'YYYY-MM') AS ultimo, count(*) FILTER (WHERE es_dudoso)::int AS dudosos
            FROM _sprb GROUP BY alcance) t
    LEFT JOIN (SELECT alcance, jsonb_agg(jsonb_build_object('tipo', tipo, 'n', c) ORDER BY c DESC) AS l
                 FROM (SELECT alcance, tipo, count(*)::int AS c FROM _sprb, unnest(_sprb.tipos) tipo GROUP BY 1, 2) z GROUP BY alcance) ps
           ON ps.alcance = t.alcance
    LEFT JOIN (SELECT alcance, jsonb_agg(jsonb_build_object('regimen', regimen, 'n', c) ORDER BY c DESC) AS l
                 FROM (SELECT alcance, regimen, count(*)::int AS c FROM _sprb GROUP BY 1, 2) z GROUP BY alcance) pr
           ON pr.alcance = t.alcance;
  RAISE NOTICE 'senales politicas: % locadores con financio_campana, % filas de planilla tocadas (% s)', n_loc, n_pla,
    round(extract(epoch FROM clock_timestamp() - t0));
  RETURN n_loc + n_pla;
END $function$;

-- Después, por el túnel (procesos largos, desprendidos):
--   SELECT refrescar_cruces();  (y la cadena de casos/resumen que le sigue en conosce_ordenes)
--   SELECT refrescar_personas_senales(NULL); SELECT refrescar_senales_politicas(); refrescar_personas_resumen…
