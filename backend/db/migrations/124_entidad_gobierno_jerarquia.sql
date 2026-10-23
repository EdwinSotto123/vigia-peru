-- 124 · Atribución del partido que gobierna por JERARQUÍA de entidad, no por el nombre.
--
-- Tarea #44 (modelo de dependencia/geo). El modelo YA existe: `entidad_gobierno_amplia` (migración 65) mapea CADA entidad
-- -incluidas las dependientes: UGEL, hospitales, organismos- a su jurisdicción (nivel regional/provincial/distrital +
-- ubigeo), vía MEF (unidad ejecutora) y ubigeo, no por el nombre. Pero `refrescar_cruces._cgob` seguía resolviendo el
-- gobierno por el NOMBRE de la entidad ('MUNICIPALIDAD...%', 'GOBIERNO REGIONAL%'), frágil y dependiente de convenciones.
-- Esta migración enchufa el modelo: `_cgob` ahora cruza entidad_gobierno_amplia × jne_autoridades por nivel+ubigeo. Así
-- `partido_gobernante`/`vendio_gobernante` se atribuyen a la entidad dependiente por su jurisdicción real. Validado:
-- volumen ~neutro (no explota, 1:1 entidad->autoridad), y una UGEL de Ayacucho atribuye bien a su Gobernador Regional.
-- Es la MISMA función con un solo bloque cambiado; el resto es la definición real de prod. Exige regen de refrescar_cruces.

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
  FROM _cp p JOIN onpe_aportantes a ON a.numero_documento = p.dni
  GROUP BY p.ruc, p.dni, p.nombre, p.rol, a.partido;

  INSERT INTO cruces_proveedor (tipo, ruc_empresa, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT 'aporte_empresa', a.numero_documento, 'media', max(a.fecha_aporte), sum(a.monto),
         jsonb_build_object('partido', a.partido, 'aportes', count(*), 'desde', min(a."año"), 'hasta', max(a."año")),
         'onpe_aportantes', 'https://claridad.onpe.gob.pe/'
  FROM onpe_aportantes a WHERE a.numero_documento LIKE '20%' AND a.numero_documento IN (SELECT ruc FROM _cg)
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
