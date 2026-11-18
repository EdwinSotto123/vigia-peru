-- 384: proceso_postor une al mismo postor cuando un reporte del SEACE corta su nombre en otro largo.
--
-- Hallado el 2026-11-18 al medir la bandera del acta «sólo queda el ganador» contra los reportes leídos sin modelo: en los
-- casos en desacuerdo el que fallaba era proceso_postor, no el acta. Los cuatro reportes se unen por el nombre del postor
-- (la evaluación no trae RUC) y cada uno corta el nombre en un largo distinto: «CONTRATISTAS GENERALES MAEFER SOCIEDAD» y
-- «CONTRATISTAS GENERALES MAEFER SOCIEDAD C…» eran dos postores. 4 265 de 17 808 ítems tenían uno partido; en 1 876 pares
-- era el ganador. Inflaba el número de postores de los hechos (migr. 327) y dejaba ganadores sin admisión ni calificación.
-- Después de aplicarla: SELECT refrescar_proceso_postor(); SELECT refrescar_hecho_documento(); (tarea piezas del CI).

CREATE OR REPLACE FUNCTION public.refrescar_proceso_postor()
 RETURNS integer
 LANGUAGE plpgsql
 SET work_mem TO '128MB'
 SET statement_timeout TO '900s'
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n int;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('refrescar_proceso_postor')) THEN
    RETURN 0;
  END IF;

  -- Cada ítem de cada reporte leído sin sobras. Del mismo reporte repetido (dos copias en el expediente, o uno vuelto a
  -- generar) queda el que el SEACE generó último.
  CREATE TEMP TABLE _pp_i ON COMMIT DROP AS
  SELECT DISTINCT ON (p.ocid, l.lector, (i.it->>'item')::int)
         p.ocid, l.lector, (i.it->>'item')::int AS item, i.it, _hecho_fecha(l.salida->>'generado') AS generado
    FROM pieza_lectura l JOIN documento_pieza p ON p.id = l.pieza_id
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(l.salida->'items') = 'array' THEN l.salida->'items'
                                                ELSE '[]'::jsonb END) AS i(it)
   WHERE l.estado = 'ok' AND l.modelo = 'plantilla' AND (i.it->>'item') ~ '^\d{1,6}$'
   ORDER BY p.ocid, l.lector, (i.it->>'item')::int, _hecho_fecha(l.salida->>'generado') DESC NULLS LAST, l.leido_at DESC;
  CREATE INDEX ON _pp_i (ocid, item, lector);
  ANALYZE _pp_i;

  -- Las filas de postores de los cuatro reportes, con el nombre comparable.
  CREATE TEMP TABLE _pp_f ON COMMIT DROP AS
  SELECT i.ocid, i.item, nombre_plano(o->>'nombre') AS np, o->>'nombre' AS nombre, o->>'ruc' AS codigo,
         CASE WHEN (o->>'hora') ~ '^([01]?\d|2[0-3]):[0-5]\d:[0-5]\d$' AND _hecho_fecha(o->>'fecha') IS NOT NULL
              THEN _hecho_fecha(o->>'fecha') + (o->>'hora')::time END AS presento_at,
         o->>'forma' AS forma, NULL::text AS registro, NULL::boolean AS admitida, NULL::boolean AS calificada,
         NULL::numeric AS puntaje_tecnico, NULL::int AS orden, NULL::numeric AS puntaje_total, false AS gano,
         NULL::numeric AS monto, NULL::numeric AS cantidad, NULL::jsonb AS integrantes, 'reporte_presentacion'::text AS fuente
    FROM _pp_i i CROSS JOIN LATERAL jsonb_array_elements(i.it->'ofertas') o
   WHERE i.lector = 'reporte_presentacion' AND jsonb_typeof(i.it->'ofertas') = 'array'
  UNION ALL
  SELECT i.ocid, i.item, nombre_plano(o->>'nombre'), o->>'nombre', NULL, NULL, NULL, o->>'registro',
         CASE o->>'admitida' WHEN 'true' THEN true WHEN 'false' THEN false END,
         CASE o->>'calificada' WHEN 'true' THEN true WHEN 'false' THEN false END,
         _hecho_num(o->'puntaje_tecnico'), NULL, NULL, false, NULL, NULL, NULL, 'reporte_evaluacion'
    FROM _pp_i i CROSS JOIN LATERAL jsonb_array_elements(i.it->'postores') o
   WHERE i.lector = 'reporte_evaluacion' AND jsonb_typeof(i.it->'postores') = 'array'
  UNION ALL
  SELECT i.ocid, i.item, nombre_plano(o->>'nombre'), o->>'nombre', o->>'ruc', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true,
         _hecho_num(o->'monto'), _hecho_num(o->'cantidad'), NULLIF(o->'integrantes', '[]'::jsonb), 'reporte_otorgamiento'
    FROM _pp_i i CROSS JOIN LATERAL jsonb_array_elements(i.it->'adjudicados') o
   WHERE i.lector = 'reporte_otorgamiento' AND jsonb_typeof(i.it->'adjudicados') = 'array'
  UNION ALL
  SELECT i.ocid, i.item, nombre_plano(o->>'nombre'), o->>'nombre', o->>'ruc', NULL, NULL, NULL, NULL, NULL,
         _hecho_num(o->'puntaje_tecnico'), _hecho_num(o->'orden')::int, _hecho_num(o->'puntaje_total'), false, NULL, NULL, NULL,
         'reporte_desempate'
    FROM _pp_i i CROSS JOIN LATERAL jsonb_array_elements(i.it->'postores') o
   WHERE i.lector = 'reporte_desempate' AND jsonb_typeof(i.it->'postores') = 'array';
  ANALYZE _pp_f;

  -- 384: el mismo postor con el nombre cortado en otro largo según el reporte («… SOCIEDAD» en la evaluación y
  -- «… SOCIEDAD C» en el otorgamiento) quedaba en dos filas: en 4 265 de 17 808 ítems, y en 1 876 de esos pares una era el
  -- ganador (una fila «ganó» sin evaluación y otra «no ganó», admitida y calificada). La clave de cada nombre es el único
  -- nombre más largo del ítem que empieza con él, si tiene 16 letras o más y viene de OTRO reporte (dos filas del mismo
  -- reporte son postores distintos). Si lo extienden dos nombres distintos, queda como está.
  CREATE TEMP TABLE _pp_n ON COMMIT DROP AS
  SELECT ocid, item, np, array_agg(DISTINCT fuente) AS fuentes FROM _pp_f WHERE np <> '' GROUP BY 1, 2, 3;
  CREATE INDEX ON _pp_n (ocid, item);
  ANALYZE _pp_n;
  CREATE TEMP TABLE _pp_c ON COMMIT DROP AS
  SELECT n.ocid, n.item, n.np, CASE WHEN length(n.np) >= 16 AND x.cuantos = 1 THEN x.largo ELSE n.np END AS clave
    FROM _pp_n n
   CROSS JOIN LATERAL (
     SELECT count(*) AS cuantos, max(m.np) AS largo
       FROM _pp_n m
      WHERE m.ocid = n.ocid AND m.item = n.item AND left(m.np, length(n.np)) = n.np
        AND (m.np = n.np OR NOT (m.fuentes && n.fuentes))
        AND NOT EXISTS (SELECT 1 FROM _pp_n z WHERE z.ocid = m.ocid AND z.item = m.item AND z.np <> m.np
                           AND left(z.np, length(m.np)) = m.np AND NOT (z.fuentes && m.fuentes))) x;
  CREATE INDEX ON _pp_c (ocid, item, np);
  ANALYZE _pp_c;

  DELETE FROM proceso_postor;
  INSERT INTO proceso_postor (ocid, item, nombre_plano, nombre, codigo, presento_at, forma, registro, admitida, calificada,
                              puntaje_tecnico, orden_prelacion, puntaje_total, gano, monto_adjudicado, cantidad_adjudicada,
                              integrantes, fuentes)
  SELECT f.ocid, f.item, c.clave, (array_agg(f.nombre ORDER BY length(f.nombre) DESC))[1], max(f.codigo), max(f.presento_at),
         max(f.forma), max(f.registro), bool_or(f.admitida), bool_or(f.calificada), max(f.puntaje_tecnico), min(f.orden),
         max(f.puntaje_total), bool_or(f.gano), max(f.monto), max(f.cantidad),
         (array_agg(f.integrantes) FILTER (WHERE f.integrantes IS NOT NULL))[1], array_agg(DISTINCT f.fuente)
    FROM _pp_f f JOIN _pp_c c ON c.ocid = f.ocid AND c.item = f.item AND c.np = f.np
   WHERE f.np <> '' GROUP BY f.ocid, f.item, c.clave;

  DELETE FROM proceso_item;
  INSERT INTO proceso_item (ocid, item, descripcion, resultado, cuantia, moneda, unidad, cantidad_solicitada, cantidad_desierta,
                            ofertas, admitidas, calificadas, monto_adjudicado, ganadores, fuentes, generado)
  SELECT k.ocid, k.item, COALESCE(o.it->>'descripcion', e.it->>'descripcion', p.it->>'descripcion'),
         o.it->>'resultado', _hecho_num(o.it->'valor_referencial'), o.it->>'moneda', o.it->>'unidad',
         _hecho_num(o.it->'cantidad_solicitada'), _hecho_num(o.it->'cantidad_desierta'),
         CASE WHEN jsonb_typeof(p.it->'ofertas') = 'array' THEN jsonb_array_length(p.it->'ofertas') END,
         CASE WHEN jsonb_typeof(e.it->'postores') = 'array'
              THEN (SELECT count(*) FILTER (WHERE x->>'admitida' = 'true')::int FROM jsonb_array_elements(e.it->'postores') x) END,
         CASE WHEN jsonb_typeof(e.it->'postores') = 'array'
              THEN (SELECT count(*) FILTER (WHERE x->>'calificada' = 'true')::int FROM jsonb_array_elements(e.it->'postores') x) END,
         CASE WHEN jsonb_typeof(o.it->'adjudicados') = 'array'
              THEN (SELECT sum(_hecho_num(x->'monto')) FROM jsonb_array_elements(o.it->'adjudicados') x) END,
         CASE WHEN jsonb_typeof(o.it->'adjudicados') = 'array' THEN jsonb_array_length(o.it->'adjudicados') END,
         array_remove(ARRAY[CASE WHEN p.it IS NOT NULL THEN 'reporte_presentacion' END,
                            CASE WHEN e.it IS NOT NULL THEN 'reporte_evaluacion' END,
                            CASE WHEN o.it IS NOT NULL THEN 'reporte_otorgamiento' END], NULL),
         GREATEST(o.generado, e.generado, p.generado)
    FROM (SELECT DISTINCT ocid, item FROM _pp_i WHERE lector <> 'reporte_desempate') k
    LEFT JOIN _pp_i p ON p.ocid = k.ocid AND p.item = k.item AND p.lector = 'reporte_presentacion'
    LEFT JOIN _pp_i e ON e.ocid = k.ocid AND e.item = k.item AND e.lector = 'reporte_evaluacion'
    LEFT JOIN _pp_i o ON o.ocid = k.ocid AND o.item = k.item AND o.lector = 'reporte_otorgamiento';

  SELECT count(*) INTO v_n FROM proceso_postor;
  ANALYZE proceso_postor;
  ANALYZE proceso_item;
  RETURN v_n;
END $function$;
