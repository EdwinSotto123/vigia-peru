-- 327 · hecho_documento: los hechos leídos SIN modelo, de los reportes del SEACE y de las secciones de las bases.
--
-- Fase 3 del plan de extracción por tipo de documento. Hasta aquí hecho_documento sólo traía lo que un modelo leyó
-- (documento_lectura). Ahora suma lo que se lee sin modelo (pieza_lectura, proceso_item y proceso_postor, migr. 325-326):
--   · del reporte de otorgamiento: la cuantía (suma de los ítems), lo adjudicado, cuántos ítems y cuántos desiertos;
--   · del reporte de presentación: cuántos presentaron oferta; del de evaluación: a cuántos se admitió y calificó;
--   · del acta de no formulación: que nadie consultó;
--   · de las bases, leídas por secciones: la cuantía o que está RESERVADA, la experiencia exigida (requisito de
--     calificación) y la experiencia adicional (factor de evaluación), cada una con su página y su cita.
-- Lo último es la respuesta directa al error del 2026-11-16: la experiencia adicional sale como lo que es, y en las bases
-- con cuantía reservada queda dicho que el monto no existe en el documento.
--
-- `verificado` gana un valor: 'plantilla' (lo dice un reporte que genera el propio SEACE, leído sin modelo). La lista de
-- tipos deja de ser un CHECK y pasa a la tabla hecho_tipo: un tipo nuevo es una fila. Dos columnas de procedencia:
-- `sha256` (el archivo) y `pagina`. La vista expediente_hechos da UN valor por proceso y tipo, el mejor comprobado.

SET lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.hecho_tipo (
  tipo        TEXT PRIMARY KEY,
  que_es      TEXT NOT NULL,
  unidad      TEXT NOT NULL CHECK (unidad IN ('monto', 'cuenta', 'dias', 'anios', 'pct', 'fecha', 'si_no', 'veces')),
  grupo       TEXT NOT NULL CHECK (grupo IN ('proceso', 'requisitos', 'competencia', 'consultas', 'adjudicacion', 'contrato'))
);
COMMENT ON TABLE public.hecho_tipo IS
  'La lista cerrada de tipos de hecho_documento: qué es cada dato, en qué unidad va y a qué grupo pertenece (migración 327).';
INSERT INTO public.hecho_tipo (tipo, que_es, unidad, grupo) VALUES
  ('valor_referencial', 'La cuantía de la contratación (antes, valor referencial)', 'monto', 'proceso'),
  ('cuantia_reservada', 'Las bases no dan a conocer la cuantía', 'si_no', 'proceso'),
  ('plazo_dias', 'El plazo de ejecución o de entrega', 'dias', 'proceso'),
  ('items', 'Cuántos ítems tiene el proceso', 'cuenta', 'proceso'),
  ('experiencia_exigida_monto', 'La experiencia que se exige al postor, en monto facturado', 'monto', 'requisitos'),
  ('experiencia_exigida_veces', 'La experiencia que se exige al postor, en veces la cuantía', 'veces', 'requisitos'),
  ('experiencia_exigida_anios', 'Los años en que se cuenta esa experiencia', 'anios', 'requisitos'),
  ('experiencia_adicional_monto', 'La experiencia adicional que da puntaje (factor de evaluación)', 'monto', 'requisitos'),
  ('ofertas_presentadas', 'Cuántos postores presentaron oferta', 'cuenta', 'competencia'),
  ('postores_admitidos', 'A cuántos postores se les admitió la oferta', 'cuenta', 'competencia'),
  ('postores_calificados', 'Cuántos postores quedaron calificados', 'cuenta', 'competencia'),
  ('postores', 'Cuántos postores figuran en el acta', 'cuenta', 'competencia'),
  ('consultas', 'Cuántas consultas y observaciones trae el pliego', 'cuenta', 'consultas'),
  ('sin_consultas', 'Nadie formuló consultas ni observaciones', 'si_no', 'consultas'),
  ('monto_adjudicado', 'Lo adjudicado según el reporte de otorgamiento', 'monto', 'adjudicacion'),
  ('items_desiertos', 'Cuántos ítems quedaron desiertos', 'cuenta', 'adjudicacion'),
  ('monto_contratado', 'El monto del contrato firmado', 'monto', 'contrato'),
  ('fecha_suscripcion', 'La fecha de firma del contrato', 'fecha', 'contrato'),
  ('adelanto_directo_pct', 'El adelanto directo', 'pct', 'contrato'),
  ('penalidad_mora_tope_pct', 'El tope de la penalidad por mora', 'pct', 'contrato'),
  ('contrato_de_otro_proceso', 'El archivo publicado como contrato es de otra compra', 'si_no', 'contrato')
ON CONFLICT (tipo) DO UPDATE SET que_es = EXCLUDED.que_es, unidad = EXCLUDED.unidad, grupo = EXCLUDED.grupo;

ALTER TABLE public.hecho_documento DROP CONSTRAINT IF EXISTS hecho_documento_tipo_check;
ALTER TABLE public.hecho_documento DROP CONSTRAINT IF EXISTS hecho_documento_verificado_check;
ALTER TABLE public.hecho_documento DROP CONSTRAINT IF EXISTS hecho_documento_tipo_fk;
ALTER TABLE public.hecho_documento ADD CONSTRAINT hecho_documento_tipo_fk FOREIGN KEY (tipo) REFERENCES public.hecho_tipo (tipo);
ALTER TABLE public.hecho_documento ADD CONSTRAINT hecho_documento_verificado_check
  CHECK (verificado IN ('registro', 'contradice_registro', 'plantilla', 'cita', 'dos_lecturas', 'sin_verificar'));
ALTER TABLE public.hecho_documento ADD COLUMN IF NOT EXISTS sha256 TEXT;
ALTER TABLE public.hecho_documento ADD COLUMN IF NOT EXISTS pagina INT;

-- Un valor por proceso y tipo: el mejor comprobado (registro, plantilla, cita, dos lecturas) y, a igualdad, la fuente más
-- fiable. `fuentes` dice cuántas lecturas hay de ese dato y `con_contradiccion` si alguna choca con el registro.
CREATE OR REPLACE VIEW public.expediente_hechos AS
SELECT DISTINCT ON (h.ocid, h.tipo) h.ocid, h.tipo, h.clase, h.version, h.valor_num, h.valor_fecha, h.cita, h.verificado, h.contra,
       h.modelo, h.leido_at, h.sha256, h.pagina,
       (count(*) OVER (PARTITION BY h.ocid, h.tipo))::int AS fuentes,
       bool_or(h.verificado = 'contradice_registro') OVER (PARTITION BY h.ocid, h.tipo) AS con_contradiccion
  FROM public.hecho_documento h
 ORDER BY h.ocid, h.tipo,
          array_position(ARRAY['registro', 'plantilla', 'cita', 'dos_lecturas', 'sin_verificar', 'contradice_registro'], h.verificado),
          array_position(ARRAY['reporte_otorgamiento', 'reporte_presentacion', 'reporte_evaluacion', 'acta_no_formulacion',
                               'bases_secciones', 'contrato', 'bases', 'buena_pro', 'consultas'], h.clase);
COMMENT ON VIEW public.expediente_hechos IS
  'Un valor por proceso y tipo de hecho: el mejor comprobado de hecho_documento, con cuántas fuentes lo traen y si alguna '
  'contradice al registro (migración 327).';

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.hecho_tipo OWNER TO vigia_jobs;
    ALTER VIEW public.expediente_hechos OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.hecho_tipo, public.expediente_hechos TO %I', r);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.refrescar_hecho_documento() RETURNS integer
LANGUAGE plpgsql SET work_mem = '128MB' SET statement_timeout = '900s' SET search_path = public, pg_temp AS $$
DECLARE v_n int;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('refrescar_hecho_documento')) THEN
    RETURN 0;
  END IF;

  -- La lectura vigente de cada proceso y clase (la primera versión; la segunda lectura, «-2», sirve para comprobar).
  CREATE TEMP TABLE _hd_l ON COMMIT DROP AS
  SELECT DISTINCT ON (d.ocid, d.clase) d.ocid, d.clase, d.version, d.salida, d.modelo, d.leido_at,
         (SELECT z.salida FROM documento_lectura z WHERE z.ocid = d.ocid AND z.clase = d.clase AND z.version = d.version || '-2' AND z.estado = 'ok') AS salida2
    FROM documento_lectura d
   WHERE d.estado = 'ok' AND d.version !~ '-2$' AND jsonb_typeof(d.salida) = 'object'
   ORDER BY d.ocid, d.clase, d.leido_at DESC;
  CREATE INDEX ON _hd_l (ocid);
  ANALYZE _hd_l;

  -- Lo que el registro dice de cada proceso leído: el referencial, lo adjudicado y cuántos postores.
  CREATE TEMP TABLE _hd_r ON COMMIT DROP AS
  SELECT c.ocid, NULLIF(c.cuantia_referencial, 0) AS referencial, c.fecha_buena_pro,
         (SELECT array_agg(a.monto_adjudicado) FROM conosce_adjudicaciones a WHERE a.codigo_convocatoria = c.codigo AND a.monto_adjudicado > 0) AS adjudicados,
         (SELECT count(DISTINCT p.ruc_postor)::int FROM conosce_postores p WHERE p.codigo_convocatoria = c.codigo) AS postores
    FROM convocatorias c WHERE c.ocid IN (SELECT ocid FROM _hd_l);
  CREATE INDEX ON _hd_r (ocid);
  ANALYZE _hd_r;

  DELETE FROM hecho_documento;

  -- El valor referencial, según las bases y según el acta: se mide contra el del registro.
  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, contra, modelo, leido_at)
  SELECT l.ocid, 'valor_referencial', l.clase, l.version, v.vr,
         CASE WHEN r.referencial IS NULL THEN 'sin_verificar'
              WHEN abs(v.vr - r.referencial) <= 0.005 * r.referencial THEN 'registro' ELSE 'contradice_registro' END,
         r.referencial, l.modelo, l.leido_at
    FROM _hd_l l LEFT JOIN _hd_r r ON r.ocid = l.ocid
   CROSS JOIN LATERAL (SELECT _hecho_num(l.salida->'valor_referencial') AS vr) v
   WHERE l.clase IN ('bases', 'buena_pro') AND v.vr > 0;

  -- La experiencia que se exige al postor: la cita copiada de las bases tiene que traer el monto.
  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, cita, verificado, contra, modelo, leido_at)
  SELECT l.ocid, 'experiencia_exigida_monto', l.clase, l.version, e.monto, NULLIF(left(e.cita, 600), ''),
         CASE WHEN regexp_replace(e.cita, '[^0-9]', '', 'g') LIKE '%' || trunc(e.monto)::text || '%' THEN 'cita'
              WHEN e.monto2 IS NOT NULL AND abs(e.monto - e.monto2) <= 0.01 * e.monto THEN 'dos_lecturas' ELSE 'sin_verificar' END,
         r.referencial, l.modelo, l.leido_at
    FROM _hd_l l LEFT JOIN _hd_r r ON r.ocid = l.ocid
   CROSS JOIN LATERAL (SELECT _hecho_num(l.salida->'experiencia_postor'->'monto_minimo') AS monto,
                              _hecho_num(l.salida2->'experiencia_postor'->'monto_minimo') AS monto2,
                              COALESCE(l.salida->'experiencia_postor'->>'cita', '') AS cita) e
   WHERE l.clase = 'bases' AND e.monto > 0;

  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, modelo, leido_at)
  SELECT l.ocid, 'experiencia_exigida_anios', l.clase, l.version, _hecho_num(l.salida->'experiencia_postor'->'anios'), 'sin_verificar', l.modelo, l.leido_at
    FROM _hd_l l WHERE l.clase = 'bases' AND _hecho_num(l.salida->'experiencia_postor'->'anios') > 0;

  -- El plazo, según las bases y según el contrato: si los dos documentos dicen lo mismo, se comprobó entre ellos.
  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, contra, modelo, leido_at)
  SELECT l.ocid, 'plazo_dias', l.clase, l.version, p.plazo,
         CASE WHEN o.plazo IS NOT NULL AND o.plazo = p.plazo THEN 'dos_lecturas' ELSE 'sin_verificar' END, o.plazo, l.modelo, l.leido_at
    FROM _hd_l l
   CROSS JOIN LATERAL (SELECT _hecho_num(l.salida->'plazo_dias') AS plazo) p
    LEFT JOIN LATERAL (SELECT _hecho_num(x.salida->'plazo_dias') AS plazo FROM _hd_l x
                        WHERE x.ocid = l.ocid AND x.clase = CASE l.clase WHEN 'bases' THEN 'contrato' ELSE 'bases' END) o ON true
   WHERE l.clase IN ('bases', 'contrato') AND p.plazo > 0;

  -- El contrato: su monto contra lo adjudicado en CONOSCE (un ítem o el total); su fecha contra la de la buena pro.
  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, contra, modelo, leido_at)
  SELECT l.ocid, 'monto_contratado', l.clase, l.version, m.monto,
         CASE WHEN r.adjudicados IS NULL THEN 'sin_verificar'
              WHEN EXISTS (SELECT 1 FROM unnest(r.adjudicados) v WHERE abs(m.monto - v) <= 0.005 * v)
                   OR abs(m.monto - t.total) <= 0.005 * t.total THEN 'registro' ELSE 'contradice_registro' END,
         t.total, l.modelo, l.leido_at
    FROM _hd_l l LEFT JOIN _hd_r r ON r.ocid = l.ocid
   CROSS JOIN LATERAL (SELECT _hecho_num(l.salida->'monto_contratado') AS monto) m
    LEFT JOIN LATERAL (SELECT sum(v) AS total FROM unnest(r.adjudicados) v) t ON true
   WHERE l.clase = 'contrato' AND m.monto > 0 AND COALESCE(l.salida->>'es_contrato', 'true') <> 'false';

  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_fecha, verificado, modelo, leido_at)
  SELECT l.ocid, 'fecha_suscripcion', l.clase, l.version, f.fecha,
         CASE WHEN r.fecha_buena_pro IS NULL THEN 'sin_verificar'
              WHEN f.fecha >= r.fecha_buena_pro AND f.fecha <= r.fecha_buena_pro + 365 THEN 'registro' ELSE 'contradice_registro' END,
         l.modelo, l.leido_at
    FROM _hd_l l LEFT JOIN _hd_r r ON r.ocid = l.ocid
   CROSS JOIN LATERAL (SELECT _hecho_fecha(l.salida->>'fecha_suscripcion') AS fecha) f
   WHERE l.clase = 'contrato' AND f.fecha IS NOT NULL AND COALESCE(l.salida->>'es_contrato', 'true') <> 'false';

  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, modelo, leido_at)
  SELECT l.ocid, x.tipo, l.clase, l.version, x.v, 'sin_verificar', l.modelo, l.leido_at
    FROM _hd_l l
   CROSS JOIN LATERAL (VALUES ('adelanto_directo_pct', _hecho_num(l.salida->'adelanto_directo_pct')),
                              ('penalidad_mora_tope_pct', _hecho_num(l.salida->'penalidad_mora_tope_pct'))) AS x(tipo, v)
   WHERE l.clase = 'contrato' AND x.v > 0 AND COALESCE(l.salida->>'es_contrato', 'true') <> 'false';

  -- El archivo publicado como contrato que el lector dice que es de otra compra.
  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, modelo, leido_at)
  SELECT l.ocid, 'contrato_de_otro_proceso', l.clase, l.version, 1, 'sin_verificar', l.modelo, l.leido_at
    FROM _hd_l l WHERE l.clase = 'contrato' AND l.salida->>'es_contrato' = 'false';

  -- El acta: cuántos postores, contra los que registra CONOSCE.
  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, contra, modelo, leido_at)
  SELECT l.ocid, 'postores', l.clase, l.version, n.n,
         CASE WHEN COALESCE(r.postores, 0) = 0 THEN 'sin_verificar' WHEN r.postores = n.n THEN 'registro' ELSE 'contradice_registro' END,
         r.postores, l.modelo, l.leido_at
    FROM _hd_l l LEFT JOIN _hd_r r ON r.ocid = l.ocid
   CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(l.salida->'postores') = 'array' THEN jsonb_array_length(l.salida->'postores') END AS n) n
   WHERE l.clase = 'buena_pro' AND n.n > 0;

  -- El pliego: cuántas consultas y observaciones; si hay segunda lectura, tiene que dar la misma cuenta.
  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, contra, modelo, leido_at)
  SELECT l.ocid, 'consultas', l.clase, l.version, _hecho_num(l.salida->'n_consultas'),
         CASE WHEN _hecho_num(l.salida2->'n_consultas') = _hecho_num(l.salida->'n_consultas') THEN 'dos_lecturas' ELSE 'sin_verificar' END,
         _hecho_num(l.salida2->'n_consultas'), l.modelo, l.leido_at
    FROM _hd_l l WHERE l.clase = 'consultas' AND _hecho_num(l.salida->'n_consultas') > 0;

  -- Lo que el lector trajo con su CITA (`salida.citas`, lecturas desde el 2026-11-16): si la frase copiada del documento
  -- trae el valor, el dato queda comprobado. Es la vía para lo que no tiene registro contra qué medirse (plazo, adelanto,
  -- penalidad, o un referencial que el registro no trae).
  UPDATE hecho_documento h SET verificado = 'cita', cita = left(x.cita, 600)
    FROM (SELECT l.ocid, l.clase, k.key AS tipo, k.value AS cita
            FROM _hd_l l, jsonb_each_text(CASE WHEN jsonb_typeof(l.salida->'citas') = 'object' THEN l.salida->'citas' ELSE '{}'::jsonb END) k
           WHERE k.value <> '') x
   WHERE x.ocid = h.ocid AND x.clase = h.clase AND x.tipo = h.tipo AND h.verificado = 'sin_verificar' AND h.valor_num IS NOT NULL
     AND regexp_replace(x.cita, '[^0-9]', '', 'g') LIKE '%' || trunc(h.valor_num)::text || '%';

  -- ── Lo leído SIN modelo (migraciones 325-326) ──────────────────────────────────────────────────────────────────────────
  -- El registro de cada proceso que tiene reportes del SEACE leídos: contra qué se miden.
  CREATE TEMP TABLE _hd_p ON COMMIT DROP AS
  SELECT c.ocid, NULLIF(c.cuantia_referencial, 0) AS referencial,
         (SELECT count(DISTINCT a.n_item)::int FROM conosce_adjudicaciones a WHERE a.codigo_convocatoria = c.codigo) AS items_reg,
         (SELECT sum(a.monto_adjudicado) FROM conosce_adjudicaciones a WHERE a.codigo_convocatoria = c.codigo AND a.monto_adjudicado > 0) AS adjudicado_reg,
         (SELECT count(DISTINCT p.ruc_postor)::int FROM conosce_postores p WHERE p.codigo_convocatoria = c.codigo) AS postores_reg
    FROM convocatorias c WHERE c.ocid IN (SELECT ocid FROM proceso_item);
  CREATE INDEX ON _hd_p (ocid);
  ANALYZE _hd_p;

  -- La cuantía: la suma de los ítems del reporte de otorgamiento (sólo en soles y si todos traen su cuantía). Se mide
  -- contra el registro cuando el reporte trae todos los ítems del proceso; si trae menos, no hay con qué comparar la suma.
  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, contra, modelo, leido_at)
  SELECT x.ocid, 'valor_referencial', 'reporte_otorgamiento', 'p1', x.cuantia,
         CASE WHEN r.referencial IS NULL THEN 'plantilla'
              WHEN abs(x.cuantia - r.referencial) <= 0.005 * r.referencial THEN 'registro'
              WHEN r.items_reg IS DISTINCT FROM x.items THEN 'plantilla' ELSE 'contradice_registro' END,
         r.referencial, 'plantilla', x.leido
    FROM (SELECT i.ocid, sum(i.cuantia) AS cuantia, count(*)::int AS items, max(i.actualizado_at) AS leido,
                 count(*) FILTER (WHERE i.cuantia IS NULL OR i.moneda IS DISTINCT FROM 'PEN') AS sin_cuantia
            FROM proceso_item i WHERE 'reporte_otorgamiento' = ANY (i.fuentes) GROUP BY i.ocid) x
    LEFT JOIN _hd_p r ON r.ocid = x.ocid
   WHERE x.sin_cuantia = 0 AND x.cuantia > 0;

  -- Lo adjudicado, cuántos ítems y cuántos quedaron desiertos, según el reporte de otorgamiento.
  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, contra, modelo, leido_at)
  SELECT x.ocid, 'monto_adjudicado', 'reporte_otorgamiento', 'p1', x.monto,
         CASE WHEN r.adjudicado_reg IS NULL THEN 'plantilla'
              WHEN abs(x.monto - r.adjudicado_reg) <= 0.005 * r.adjudicado_reg THEN 'registro'
              WHEN r.items_reg IS DISTINCT FROM x.items THEN 'plantilla' ELSE 'contradice_registro' END,
         r.adjudicado_reg, 'plantilla', x.leido
    FROM (SELECT i.ocid, sum(i.monto_adjudicado) AS monto, count(*)::int AS items, max(i.actualizado_at) AS leido,
                 count(*) FILTER (WHERE i.moneda IS DISTINCT FROM 'PEN') AS otra_moneda
            FROM proceso_item i WHERE 'reporte_otorgamiento' = ANY (i.fuentes) GROUP BY i.ocid) x
    LEFT JOIN _hd_p r ON r.ocid = x.ocid
   WHERE x.otra_moneda = 0 AND x.monto > 0;

  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, contra, modelo, leido_at)
  SELECT x.ocid, v.tipo, 'reporte_otorgamiento', 'p1', v.n, 'plantilla', NULL, 'plantilla', x.leido
    FROM (SELECT i.ocid, count(*)::int AS items, count(*) FILTER (WHERE i.resultado = 'desierto')::int AS desiertos,
                 max(i.actualizado_at) AS leido
            FROM proceso_item i WHERE 'reporte_otorgamiento' = ANY (i.fuentes) GROUP BY i.ocid) x
   CROSS JOIN LATERAL (VALUES ('items', x.items), ('items_desiertos', x.desiertos)) AS v(tipo, n)
   WHERE v.tipo = 'items' AND x.items > 1 OR v.tipo = 'items_desiertos' AND x.desiertos > 0;

  -- Cuántos presentaron oferta (reporte de presentación) y a cuántos se admitió y calificó (reporte de evaluación). El
  -- reporte es del propio SEACE: si no coincide con CONOSCE no se marca como contradicción (CONOSCE identifica a los
  -- consorcios con otro código).
  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, contra, modelo, leido_at)
  SELECT x.ocid, 'ofertas_presentadas', 'reporte_presentacion', 'p1', x.n,
         CASE WHEN r.postores_reg = x.n THEN 'registro' ELSE 'plantilla' END, NULLIF(r.postores_reg, 0), 'plantilla', now()
    FROM (SELECT ocid, count(DISTINCT nombre_plano)::int AS n FROM proceso_postor
           WHERE 'reporte_presentacion' = ANY (fuentes) GROUP BY ocid) x
    LEFT JOIN _hd_p r ON r.ocid = x.ocid;

  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, contra, modelo, leido_at)
  SELECT x.ocid, v.tipo, 'reporte_evaluacion', 'p1', v.n, 'plantilla', x.evaluados, 'plantilla', now()
    FROM (SELECT ocid, count(DISTINCT nombre_plano)::int AS evaluados,
                 count(DISTINCT nombre_plano) FILTER (WHERE admitida)::int AS admitidos,
                 count(DISTINCT nombre_plano) FILTER (WHERE calificada)::int AS calificados
            FROM proceso_postor WHERE 'reporte_evaluacion' = ANY (fuentes) GROUP BY ocid) x
   CROSS JOIN LATERAL (VALUES ('postores_admitidos', x.admitidos), ('postores_calificados', x.calificados)) AS v(tipo, n);

  -- El acta de no formulación: nadie consultó ni observó las bases.
  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, verificado, modelo, leido_at, sha256, pagina)
  SELECT DISTINCT ON (p.ocid) p.ocid, 'sin_consultas', 'acta_no_formulacion', l.version, 1, 'plantilla', 'plantilla', l.leido_at,
         p.sha256, p.pag_ini
    FROM pieza_lectura l JOIN documento_pieza p ON p.id = l.pieza_id
   WHERE l.lector = 'acta_no_formulacion' AND l.estado = 'ok'
   ORDER BY p.ocid, l.leido_at DESC;

  -- Las bases leídas por secciones (lector/secciones.py): primero las integradas y, de ellas, la lectura más reciente.
  CREATE TEMP TABLE _hd_b ON COMMIT DROP AS
  SELECT p.ocid, p.sha256, l.version, l.salida, l.leido_at,
         row_number() OVER (PARTITION BY p.ocid ORDER BY (p.tipo_documento = 'bases_integradas') DESC, l.leido_at DESC, p.id DESC) AS orden
    FROM pieza_lectura l JOIN documento_pieza p ON p.id = l.pieza_id
   WHERE l.lector = 'bases_secciones' AND l.estado = 'ok' AND jsonb_typeof(l.salida) = 'object';
  CREATE INDEX ON _hd_b (ocid);
  ANALYZE _hd_b;

  -- La cuantía, o que la entidad decidió no darla a conocer (numeral 53.4 del Reglamento de la Ley 32069). Sale sólo del
  -- apartado de la cuantía del Capítulo I de la sección específica, con su página y su cita.
  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, cita, verificado, contra, modelo, leido_at, sha256, pagina)
  SELECT DISTINCT ON (b.ocid) b.ocid,
         CASE WHEN b.salida->'cuantia'->>'reservada' = 'true' THEN 'cuantia_reservada' ELSE 'valor_referencial' END,
         'bases_secciones', b.version,
         CASE WHEN b.salida->'cuantia'->>'reservada' = 'true' THEN 1 ELSE _hecho_num(b.salida->'cuantia'->'valor') END,
         NULLIF(left(b.salida->'cuantia'->>'cita', 600), ''),
         CASE WHEN b.salida->'cuantia'->>'reservada' = 'true' OR r.referencial IS NULL THEN 'cita'
              WHEN abs(_hecho_num(b.salida->'cuantia'->'valor') - r.referencial) <= 0.005 * r.referencial THEN 'registro'
              ELSE 'contradice_registro' END,
         r.referencial, 'plantilla', b.leido_at, b.sha256, (_hecho_num(b.salida->'cuantia'->'pagina'))::int
    FROM _hd_b b LEFT JOIN (SELECT ocid, NULLIF(cuantia_referencial, 0) AS referencial FROM convocatorias) r ON r.ocid = b.ocid
   WHERE jsonb_typeof(b.salida->'cuantia') = 'object'
     AND (b.salida->'cuantia'->>'reservada' = 'true'
          OR (_hecho_num(b.salida->'cuantia'->'valor') > 0 AND COALESCE(b.salida->'cuantia'->>'moneda', 'PEN') = 'PEN'))
   ORDER BY b.ocid, b.orden;

  -- La experiencia que se EXIGE al postor (requisito de calificación): en monto o en veces la cuantía.
  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, cita, verificado, contra, modelo, leido_at, sha256, pagina)
  SELECT DISTINCT ON (b.ocid, x.tipo) b.ocid, x.tipo, 'bases_secciones', b.version, x.valor, NULLIF(left(e->>'cita', 600), ''), 'cita',
         r.referencial, 'plantilla', b.leido_at, b.sha256, (_hecho_num(e->'pagina'))::int
    FROM _hd_b b
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.salida->'experiencia_exigida') = 'array'
                                                THEN b.salida->'experiencia_exigida' ELSE '[]'::jsonb END) WITH ORDINALITY AS t(e, n)
   CROSS JOIN LATERAL (SELECT CASE WHEN _hecho_num(e->'monto') > 0 THEN 'experiencia_exigida_monto'
                                   WHEN _hecho_num(e->'veces') > 0 THEN 'experiencia_exigida_veces' END AS tipo,
                              COALESCE(NULLIF(_hecho_num(e->'monto'), 0), _hecho_num(e->'veces')) AS valor) x
    LEFT JOIN (SELECT ocid, NULLIF(cuantia_referencial, 0) AS referencial FROM convocatorias) r ON r.ocid = b.ocid
   WHERE x.tipo IS NOT NULL AND x.valor > 0
   ORDER BY b.ocid, x.tipo, b.orden, t.n;

  -- La experiencia ADICIONAL que da puntaje (factor de evaluación): el monto más alto. No es un requisito ni la cuantía.
  INSERT INTO hecho_documento (ocid, tipo, clase, version, valor_num, cita, verificado, contra, modelo, leido_at, sha256, pagina)
  SELECT DISTINCT ON (b.ocid) b.ocid, 'experiencia_adicional_monto', 'bases_secciones', b.version, _hecho_num(e->'monto'),
         NULLIF(left(e->>'cita', 600), ''), 'cita', r.referencial, 'plantilla', b.leido_at, b.sha256, (_hecho_num(e->'pagina'))::int
    FROM _hd_b b
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.salida->'experiencia_adicional') = 'array'
                                                THEN b.salida->'experiencia_adicional' ELSE '[]'::jsonb END) AS t(e)
    LEFT JOIN (SELECT ocid, NULLIF(cuantia_referencial, 0) AS referencial FROM convocatorias) r ON r.ocid = b.ocid
   WHERE _hecho_num(e->'monto') > 0
   ORDER BY b.ocid, b.orden, _hecho_num(e->'monto') DESC;

  SELECT count(*) INTO v_n FROM hecho_documento;
  ANALYZE hecho_documento;
  RETURN v_n;
END $$;
ALTER FUNCTION public.refrescar_hecho_documento() OWNER TO vigia_jobs;
