-- 382: la ficha de una obra (gobserva_obras_ficha) sin leer miles de filas para elegir 6 parecidos.
--
-- Medido el 2026-11-18 en PROD: de 0,7 a 4,2 s en frío y ~100 ms en caliente, con 12 mil bloques por llamada. Casi todo
-- era «proyectos parecidos»: el índice de la 379 daba los candidatos del sector en el rango de costo (hasta 8 mil en
-- transporte) y había que leer cada fila de gobserva_proyecto (1,8 kB cada una) para ordenarlos por región y fecha.
--
-- Ahora el índice trae cui, región y fecha (INCLUDE): el orden sale de él solo (index-only scan) y después se leen las 6
-- filas elegidas. El procedimiento de cada proceso sale de la columna `modalidad` (llena en 77 497 de 77 498) antes de
-- abrir el ocds_payload, que vive en TOAST y en frío son decenas de kB por proceso. Es lo mismo que hace la lista de
-- contratos. Ojo: al aplicarla, `modalidad` difería del payload en 3 619 procesos por un relleno fuera de orden; lo
-- corrigió reclasificar_desfasadas.py el mismo día y oece_ocds.ts ya no deja que un release viejo la pise.
--
-- Misma salida: comprobado con 17 CUIs (al azar, los de más procesos y los más caros de leer) antes y después.

CREATE INDEX CONCURRENTLY IF NOT EXISTS gobserva_proyecto_parecidos_cubre ON gobserva_proyecto (sector, costo)
    INCLUDE (cui, region, fecha_viable)
    WHERE costo > 0 AND (se_viene OR fase IN ('ejecucion', 'paralizada'));
DROP INDEX CONCURRENTLY IF EXISTS gobserva_proyecto_parecidos;

CREATE OR REPLACE FUNCTION public.gobserva_obras_ficha(p_cui text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  i inversion_mef;
  p gobserva_proyecto;
  v_cui CHAR(7);      -- el CUI como la columna (CHAR): comparado con TEXT, Postgres no usa los índices y recorre las tablas
  v_costo NUMERIC;
  v_sector TEXT;
  r JSONB;
BEGIN
  IF p_cui IS NULL OR p_cui !~ '^[0-9]{7}$' THEN
    RETURN NULL;
  END IF;
  v_cui := p_cui;
  SELECT * INTO i FROM inversion_mef WHERE cui = v_cui AND NOT retirada;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO p FROM gobserva_proyecto WHERE cui = v_cui;
  v_costo := CASE WHEN 'costo_imposible' = ANY(i.dudoso) THEN NULLIF(i.monto_viable, 0) ELSE NULLIF(i.costo_actualizado, 0) END;
  v_sector := COALESCE(p.sector, gobserva_obras_sector(i.funcion));

  r := jsonb_build_object(
    'cui', i.cui,
    'nombre', btrim(regexp_replace(i.nombre, '\s+', ' ', 'g')),
    'estado', i.origen,
    'fase', CASE WHEN i.origen = 'cerrada' THEN 'cerrada' ELSE p.fase END,
    'seViene', COALESCE(p.se_viene, false),
    'tipo', COALESCE(p.tipo, CASE WHEN i.nombre ~* '^\s*ADQUISICI' THEN 'equipamiento' ELSE 'obra' END),
    'situacion', i.situacion,
    'nivel', i.nivel,
    'sector', v_sector,
    'funcion', i.funcion,
    'programa', i.programa,
    'tipologia', i.tipologia,
    'tipoInversion', i.tipo_inversion,
    'marco', i.marco,
    'modalidad', gobserva_obras_modalidad(i.modalidad),
    'modalidadTexto', i.modalidad,
    'entidad', jsonb_build_object('ruc', i.entidad_ruc, 'nombre', i.entidad_nombre),
    'unidadEjecutora', COALESCE(i.uei, i.uep),
    'lugar', jsonb_build_object('region', CASE WHEN left(i.ubigeo, 2) BETWEEN '01' AND '25' THEN left(i.ubigeo, 2) END,
                                'departamento', i.departamento, 'provincia', i.provincia, 'distrito', i.distrito, 'ubigeo', i.ubigeo),
    'montos', jsonb_build_object(
      'viable', NULLIF(i.monto_viable, 0), 'actualizado', v_costo, 'expediente', NULLIF(i.monto_et, 0),
      'devengado', COALESCE(i.devengado_acumulado, 0), 'devengadoAnio', COALESCE(i.devengado_anio, 0), 'pimAnio', COALESCE(i.pim_anio, 0),
      'porEjecutar', CASE WHEN v_costo IS NOT NULL THEN GREATEST(v_costo - COALESCE(i.devengado_acumulado, 0), 0) END,
      'liquidacion', NULLIF(i.liquidacion, 0), 'controlConcurrente', NULLIF(i.control_concurrente, 0)),
    'costoDudoso', 'costo_imposible' = ANY(i.dudoso),
    'avanceMef', CASE WHEN i.avance_fisico BETWEEN 0 AND 100.5 THEN LEAST(i.avance_fisico, 100) END,
    'conExpediente', COALESCE(i.expediente_tecnico, false) OR COALESCE(i.monto_et, 0) > 0,
    'fechas', jsonb_build_object(
      'registro', i.fecha_registro, 'viabilidad', i.fecha_viabilidad, 'inicioPrevisto', i.inicio_ejecucion, 'finPrevisto', i.fin_ejecucion,
      'primerGasto', CASE WHEN i.primer_devengado BETWEEN 200001 AND 210012 THEN to_char(make_date(i.primer_devengado / 100, GREATEST(LEAST(i.primer_devengado % 100, 12), 1), 1), 'YYYY-MM') END,
      'ultimoGasto', CASE WHEN i.ultimo_devengado BETWEEN 200001 AND 210012 THEN to_char(make_date(i.ultimo_devengado / 100, GREATEST(LEAST(i.ultimo_devengado % 100, 12), 1), 1), 'YYYY-MM') END,
      'cierre', i.fecha_cierre),
    'beneficiarios', NULLIF(i.beneficiarios, 0),
    'alDia', jsonb_build_object('inversiones', i.dataset_fecha,
                                'infobras', COALESCE((SELECT (valor AT TIME ZONE 'America/Lima')::date FROM obra_refresco WHERE clave = 'infobras_fecha'),
                                                     (SELECT max(dataset_fecha) FROM obra_infobras WHERE cui = v_cui))),
    -- Las obras de INFOBRAS del CUI: el ejecutor y el supervisor, sólo si son empresas (RUC 20).
    'obras', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'codigo', o.codigo, 'nombre', o.nombre, 'estado', o.estado, 'modalidad', o.modalidad, 'esSaldo', o.es_saldo,
               'avance', jsonb_build_object(
                 'fisico', CASE WHEN o.fisico_real BETWEEN 0 AND 100.5 THEN LEAST(o.fisico_real, 100) END,
                 'programado', CASE WHEN o.fisico_prog BETWEEN 0 AND 100.5 THEN LEAST(o.fisico_prog, 100) END,
                 'financiero', CASE WHEN o.financiero_pct BETWEEN 0 AND 200 THEN o.financiero_pct END,
                 'al', CASE WHEN o.avance_fecha <= COALESCE(o.dataset_fecha, current_date) THEN o.avance_fecha END),
               'fechas', jsonb_build_object('inicio', o.fecha_inicio, 'finProgramada', o.fecha_fin_prog, 'finReprogramada', o.fecha_fin_reprog,
                                            'finReal', o.fecha_fin_real, 'recepcion', o.fecha_recepcion, 'expediente', o.fecha_aprob_et),
               'plazo', jsonb_build_object('dias', o.plazo_dias, 'ampliacion', o.dias_ampliacion),
               'montos', jsonb_build_object(
                 'contrato', CASE WHEN o.contrato_monto > 0 AND (v_costo IS NULL OR o.contrato_monto <= 3 * v_costo) THEN o.contrato_monto END,
                 'contratoDudoso', o.contrato_monto > 0 AND v_costo IS NOT NULL AND o.contrato_monto > 3 * v_costo,
                 'expediente', NULLIF(o.costo_et, 0),
                 'supervision', CASE WHEN o.supervision_monto > 0 AND (v_costo IS NULL OR o.supervision_monto <= v_costo) THEN o.supervision_monto END,
                 'adicionales', NULLIF(o.adicionales_monto, 0), 'deductivos', NULLIF(o.deductivos_monto, 0)),
               'adicionalesN', o.adicionales_n,
               'paralizacion', CASE WHEN o.estado = 'Paralizada' OR o.paralizada THEN jsonb_build_object(
                                 'hoy', o.estado = 'Paralizada', 'desde', o.fecha_paralizacion, 'dias', o.dias_paralizada,
                                 'causal', NULLIF(btrim(o.causal_paralizacion), '')) END,
               'ejecutor', CASE
                 WHEN o.ejecutor_ruc ~ '^20[0-9]{9}$' THEN jsonb_build_object('tipo', 'empresa', 'ruc', o.ejecutor_ruc,
                                                                  'nombre', NULLIF(btrim(regexp_replace(o.ejecutor_nombre, '\s+amp\s+', ' & ', 'gi')), ''))
                 WHEN o.ejecutor_ruc ~ '^C[0-9]{10}$' OR o.ejecutor_nombre ILIKE 'CONSORCIO%' THEN jsonb_build_object('tipo', 'consorcio')
                 WHEN o.ejecutor_ruc IS NOT NULL OR NULLIF(btrim(o.ejecutor_nombre), '') IS NOT NULL THEN jsonb_build_object('tipo', 'persona')
                 WHEN o.modalidad = 'Administración directa' THEN jsonb_build_object('tipo', 'entidad') END,
               'supervisor', CASE
                 WHEN o.supervisor_ruc ~ '^20[0-9]{9}$' THEN jsonb_build_object('tipo', 'empresa', 'ruc', o.supervisor_ruc,
                                                                    'nombre', NULLIF(btrim(regexp_replace(o.supervisor_nombre, '\s+amp\s+', ' & ', 'gi')), ''))
                 WHEN o.supervisor_ruc ~ '^C[0-9]{10}$' OR o.supervisor_nombre ILIKE 'CONSORCIO%' THEN jsonb_build_object('tipo', 'consorcio')
                 WHEN o.supervisor_ruc IS NOT NULL OR NULLIF(btrim(o.supervisor_nombre), '') IS NOT NULL THEN jsonb_build_object('tipo', 'persona') END,
               'controversias', o.controversias, 'informesControl', o.informes_control,
               'alDia', o.dataset_fecha)
             ORDER BY CASE o.estado WHEN 'Paralizada' THEN 0 WHEN 'En Ejecución' THEN 1 WHEN 'Sin Ejecución' THEN 2 ELSE 3 END,
                      (similarity(lower(o.nombre), lower(i.nombre)) >= 0.5) DESC,
                      CASE WHEN o.contrato_monto > 0 AND o.contrato_monto <= 3 * GREATEST(COALESCE(o.costo_et, 0), COALESCE(o.monto_viable, 0))
                           THEN o.contrato_monto ELSE NULLIF(o.costo_et, 0) END DESC NULLS LAST,
                      o.fecha_inicio DESC NULLS LAST, o.codigo DESC)
        FROM obra_infobras o WHERE o.cui = v_cui AND NOT o.retirada), '[]'::jsonb),
    'obraRepresenta', COALESCE(p.obra_representa, true),
    -- Los procesos del SEACE que citan el CUI (los 40 más nuevos) y quién los ganó (sólo empresas).
    'procesosTotal', (SELECT count(*) FROM contrato_cui k WHERE k.cui = v_cui),
    'procesos', COALESCE((
      SELECT jsonb_agg(x.j ORDER BY x.fecha DESC NULLS LAST, x.ocid DESC)
        FROM (SELECT c.ocid, c.fecha_convocatoria AS fecha,
                     jsonb_build_object(
                       'ocid', c.ocid, 'codigo', c.codigo, 'objeto', c.objeto, 'tipo', c.tipo_contratacion, 'etapa', c.etapa,
                       'procedimiento', COALESCE(c.modalidad, c.ocds_payload->'tender'->>'procurementMethodDetails'),
                       'fecha', c.fecha_convocatoria, 'valor', NULLIF(c.cuantia_referencial, 0),
                       'adjudicado', av.monto, 'ganadores', gobserva_obras_ganadores(c.adjudicaciones), 'via', k.origen) AS j
                FROM contrato_cui k JOIN convocatorias c ON c.ocid = k.ocid
                LEFT JOIN adjudicado_vigente av ON av.ocid = c.ocid
               WHERE k.cui = v_cui
               ORDER BY c.fecha_convocatoria DESC NULLS LAST, c.ocid DESC
               LIMIT 40) x), '[]'::jsonb),
    -- Proyectos parecidos: el mismo sector, de preferencia en la misma región, de un costo parecido (un tercio a 3 veces),
    -- que se vienen o están en marcha.
    'parecidos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('cui', g.cui, 'nombre', g.nombre, 'fase', g.fase, 'region', g.region, 'provincia', g.provincia,
                                          'costo', g.costo, 'entidad', g.entidad, 'obraFisico', g.obra_fisico) ORDER BY g.orden)
        FROM (SELECT g.*, s.orden
                FROM (SELECT x.cui, row_number() OVER (ORDER BY (x.region IS NOT DISTINCT FROM p.region) DESC,
                                                             abs(ln(x.costo / NULLIF(v_costo, 0))), x.fecha_viable DESC NULLS LAST) AS orden
                        FROM gobserva_proyecto x
                       WHERE x.sector = v_sector AND x.cui <> v_cui AND x.costo > 0 AND v_costo > 0
                         AND x.costo BETWEEN v_costo / 3 AND v_costo * 3
                         AND (x.se_viene OR x.fase IN ('ejecucion', 'paralizada'))
                       ORDER BY (x.region IS NOT DISTINCT FROM p.region) DESC, abs(ln(x.costo / NULLIF(v_costo, 0))), x.fecha_viable DESC NULLS LAST
                       LIMIT 6) s
                JOIN gobserva_proyecto g ON g.cui = s.cui) g), '[]'::jsonb)
  );
  RETURN r;
END $function$;
