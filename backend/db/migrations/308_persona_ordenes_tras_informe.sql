-- 308 · Señal de personas `ordenes_tras_informe`: quien un informe de control de la Contraloría comprende (por su DNI),
-- con responsabilidad PRESUNTA, recibe órdenes de servicio como persona natural (RUC 10) de la MISMA entidad del informe
-- DESPUÉS de emitido (2026-11-16).
--
-- La migración 302 guarda a los funcionarios comprendidos en cada informe (informe_control_persona, con su DNI); la 303
-- los cruza con la gente de las empresas que ganan. Aquí, con los locadores: la entidad sobre la que la Contraloría
-- señaló responsabilidad a una persona le sigue dando (o le empieza a dar) órdenes de servicio después del informe.
--
-- Quién: el par persona × entidad de persona_entidad (RUC 10 = '10' + DNI + un dígito), la entidad del informe
-- (informes_control.entidad_ruc) y el nombre que publica CONOSCE coincidiendo con el del informe en dos palabras o más
-- (palabras_de_nombre, migración 303: un DNI mal escrito no une a dos personas). Las órdenes son las de la ficha de la
-- persona (persona_orden_anual: órdenes de servicio en soles, no anuladas, cada una una vez), contadas desde el día
-- siguiente a la emisión: los años siguientes por persona_orden_anual y el año del informe orden por orden.
--
--   alta   la responsabilidad que le señala el informe es penal y la primera orden después de él llegó dentro del año;
--   media  penal (con la primera orden más tarde) o civil;
--   baja   sólo administrativa.
-- Una señal por persona y entidad: la del informe más grave (y, entre iguales, el más reciente); el detalle cuenta los
-- demás.
--
-- Es responsabilidad PRESUNTA: la Contraloría la identifica y la deriva; no es una condena ni impide contratar. Es un
-- indicio para revisar, no una acusación.
--
-- Privacidad: el detalle no lleva documento ni nombres (el informe por su código y número, sus fechas y cifras); la persona
-- va por su persona_codigo y la API le tapa un apellido. La primera orden, por su número y su monto, sin su descripción
-- (puede traer el nombre).
--
-- Medido en PROD antes de escribirla (la misma lógica en CTE de sólo lectura): 3 965 señales de 3 892 personas en 826
-- entidades; 921 altas, 1 964 medias y 1 080 bajas; 21 608 órdenes por S/ 199,7 millones después del informe; 1 669 ya
-- tenían órdenes de esa entidad antes del informe; 696 figuran en más de un informe de la misma entidad.

CREATE OR REPLACE FUNCTION refrescar_persona_informe_control() RETURNS integer
LANGUAGE plpgsql SET work_mem = '256MB' SET statement_timeout = '1800s' AS $$
DECLARE n int := 0;
BEGIN
  -- El mismo cerrojo que refrescar_personas_senales y las demás: todas escriben persona_senal y el resumen de persona_entidad.
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_personas'));

  DROP TABLE IF EXISTS _pic_antes;
  CREATE TEMP TABLE _pic_antes ON COMMIT DROP AS SELECT DISTINCT entidad_ruc, ruc FROM persona_senal WHERE tipo = 'ordenes_tras_informe';
  DELETE FROM persona_senal WHERE tipo = 'ordenes_tras_informe';

  -- 1. Cada persona con DNI de cada informe con entidad: lo que el informe le señala y las palabras de su nombre.
  DROP TABLE IF EXISTS _pic_i;
  CREATE TEMP TABLE _pic_i ON COMMIT DROP AS
    SELECT p.doc, p.codigo AS informe, palabras_de_nombre(max(p.nombre)) AS palabras, array_agg(DISTINCT r.x ORDER BY r.x) AS resp,
           ic.numero, ic.titulo, ic.entidad_ruc::text AS entidad_ruc, ic.fecha_emision AS emision, coalesce(ic.url_resumen, ic.url_pdf) AS url
      FROM informe_control_persona p
      JOIN informes_control ic ON ic.codigo = p.codigo
      CROSS JOIN LATERAL unnest(p.responsabilidades) r(x)
     WHERE p.doc ~ '^[0-9]{8}$' AND ic.fecha_emision IS NOT NULL AND ic.entidad_ruc IS NOT NULL
     GROUP BY p.doc, p.codigo, ic.numero, ic.titulo, ic.entidad_ruc, ic.fecha_emision, ic.url_resumen, ic.url_pdf;
  ANALYZE _pic_i;

  -- 2. Su par persona × entidad: la MISMA entidad del informe, por la llave de persona_entidad (el RUC 10 lleva el DNI),
  --    con órdenes después de la emisión y el mismo nombre en las dos fuentes.
  DROP TABLE IF EXISTS _pic_par;
  CREATE TEMP TABLE _pic_par ON COMMIT DROP AS
    SELECT pe.entidad_ruc, pe.ruc, pe.primera AS primera_en_entidad, i.informe, i.numero, i.titulo, i.emision, i.resp, i.url,
           extract(year FROM i.emision)::int AS y
      FROM _pic_i i
      JOIN persona_entidad pe ON pe.entidad_ruc = i.entidad_ruc AND pe.ruc BETWEEN '10' || i.doc || '0' AND '10' || i.doc || '9'
     WHERE pe.ultima > i.emision
       AND (SELECT count(*) FROM unnest(palabras_de_nombre(pe.nombre)) w WHERE w = ANY (i.palabras)) >= 2;
  ANALYZE _pic_par;

  -- 3. Lo que recibió después de emitido cada informe: los años siguientes, de persona_orden_anual; y si el mismo año del
  --    informe tuvo órdenes después de la emisión, ésas orden por orden (el mismo filtro que persona_orden_anual).
  DROP TABLE IF EXISTS _pic_o;
  CREATE TEMP TABLE _pic_o ON COMMIT DROP AS
    SELECT par.*, coalesce(a.n, 0) + coalesce(m.n, 0) AS ordenes, coalesce(a.monto, 0) + coalesce(m.monto, 0) AS monto,
           least(m.primera, a.primera) AS primera, greatest(m.ultima, a.ultima) AS ultima
      FROM _pic_par par
      CROSS JOIN LATERAL (
        SELECT sum(po.ordenes) FILTER (WHERE po.anio > par.y) AS n, sum(po.monto) FILTER (WHERE po.anio > par.y) AS monto,
               min(po.primera) FILTER (WHERE po.anio > par.y) AS primera, max(po.ultima) FILTER (WHERE po.anio > par.y) AS ultima,
               coalesce(bool_or(po.anio = par.y AND po.ultima > par.emision), false) AS en_el_anio
          FROM persona_orden_anual po
         WHERE po.entidad_ruc = par.entidad_ruc AND po.ruc = par.ruc AND po.anio >= par.y) a
      -- `a.en_el_anio` dentro de la subconsulta: sin órdenes ese año después del informe ni se mira conosce_ordenes.
      CROSS JOIN LATERAL (
        SELECT count(*) AS n, sum(d.monto) AS monto, min(d.fecha_emision) AS primera, max(d.fecha_emision) AS ultima
          FROM (SELECT DISTINCT ON (c.orden, c.fecha_emision) c.fecha_emision, c.monto
                  FROM conosce_ordenes c
                 WHERE a.en_el_anio AND c.entidad_ruc = par.entidad_ruc AND c.ruc_contratista = par.ruc
                   AND c.fecha_emision > par.emision AND c.fecha_emision < make_date(par.y + 1, 1, 1)
                   AND c.tipo_orden = 'Orden de Servicio' AND c.estado IS DISTINCT FROM 'Anulada' AND c.moneda = 'Nuevos Soles' AND c.monto > 0
                 ORDER BY c.orden, c.fecha_emision, c.anio DESC, c.mes DESC) d) m
     WHERE coalesce(a.n, 0) + m.n > 0;
  ANALYZE _pic_o;

  -- 4. Una señal por persona y entidad, con el informe más grave primero.
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT x.entidad_ruc, x.ruc, 'ordenes_tras_informe',
         CASE x.rango WHEN 0 THEN 'alta' WHEN 1 THEN 'media' WHEN 2 THEN 'media' ELSE 'baja' END,
         jsonb_build_object(
           'informe_codigo', x.informes->0->>'codigo', 'informe_numero', x.informes->0->>'numero', 'informe_titulo', x.titulo,
           'emision', x.informes->0->>'emision', 'responsabilidades', x.informes->0->'responsabilidades',
           'url_resumen', x.informes->0->>'url_resumen',
           'ordenes_despues', (x.informes->0->>'ordenes')::int, 'monto_despues', (x.informes->0->>'monto')::numeric,
           'primera_orden', x.informes->0->>'primera', 'ultima_orden', x.informes->0->>'ultima',
           'dias_hasta_primera', (x.informes->0->>'dias')::int,
           -- La primera orden después del informe, por su número y su monto (sin la descripción: puede traer el nombre).
           'primera_orden_detalle', (SELECT jsonb_build_object('numero', o.nro_orden, 'monto', o.monto)
                                       FROM conosce_ordenes o
                                      WHERE o.entidad_ruc = x.entidad_ruc AND o.ruc_contratista = x.ruc
                                        AND o.fecha_emision = (x.informes->0->>'primera')::date
                                        AND o.tipo_orden = 'Orden de Servicio' AND o.estado IS DISTINCT FROM 'Anulada'
                                        AND o.moneda = 'Nuevos Soles' AND o.monto > 0
                                      ORDER BY o.monto DESC, o.orden LIMIT 1),
           'ya_tenia_ordenes', x.primera_en_entidad < (x.informes->0->>'emision')::date,
           -- Los demás informes de la misma entidad en que figura (hasta 4), cada uno con lo que recibió después de él.
           'n_informes', x.n_informes,
           'otros_informes', (SELECT jsonb_agg(e ORDER BY k) FROM jsonb_array_elements(x.informes) WITH ORDINALITY t(e, k) WHERE k BETWEEN 2 AND 5)),
         'informes_control', coalesce(x.informes->0->>'url_resumen', 'https://appbp.contraloria.gob.pe/BuscadorCGR/Informes/Avanzada.html')
    FROM (
      SELECT o.entidad_ruc, o.ruc, min(o.primera_en_entidad) AS primera_en_entidad, count(*) AS n_informes, min(o.rango) AS rango,
             (array_agg(o.titulo ORDER BY o.rango, o.emision DESC, o.informe))[1] AS titulo,
             jsonb_agg(jsonb_build_object('codigo', o.informe, 'numero', o.numero, 'emision', to_char(o.emision, 'YYYY-MM-DD'),
                                          'responsabilidades', to_jsonb(o.resp), 'url_resumen', o.url,
                                          'ordenes', o.ordenes, 'monto', round(o.monto, 2),
                                          'primera', to_char(o.primera, 'YYYY-MM-DD'), 'ultima', to_char(o.ultima, 'YYYY-MM-DD'),
                                          'dias', o.primera - o.emision)
                       ORDER BY o.rango, o.emision DESC, o.informe) AS informes
        FROM (SELECT _pic_o.*,
                     CASE WHEN 'penal' = ANY (resp) AND primera - emision <= 365 THEN 0
                          WHEN 'penal' = ANY (resp) THEN 1
                          WHEN 'civil' = ANY (resp) THEN 2
                          ELSE 3 END AS rango
                FROM _pic_o) o
       GROUP BY o.entidad_ruc, o.ruc
    ) x;
  GET DIAGNOSTICS n = ROW_COUNT;

  -- 5. El resumen de cada par tocado (antes y después), desde persona_senal (como refrescar_socio_proveedor_locador, 181).
  INSERT INTO _pic_antes SELECT DISTINCT entidad_ruc, ruc FROM persona_senal WHERE tipo = 'ordenes_tras_informe';
  DROP TABLE IF EXISTS _pic_pares;
  CREATE TEMP TABLE _pic_pares ON COMMIT DROP AS SELECT DISTINCT entidad_ruc, ruc FROM _pic_antes;
  UPDATE persona_entidad pe SET tipos = '{}', senales = '[]', n_senales = 0, sev = 0
    FROM _pic_pares p WHERE pe.entidad_ruc = p.entidad_ruc AND pe.ruc = p.ruc;
  UPDATE persona_entidad pe
     SET tipos = s.tipos, senales = s.senales, n_senales = s.n, sev = s.sev
    FROM (SELECT ps.entidad_ruc, ps.ruc, array_agg(ps.tipo ORDER BY ps.tipo) AS tipos, count(*)::int AS n,
                 max(CASE ps.severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END)::smallint AS sev,
                 jsonb_agg(jsonb_build_object('tipo', ps.tipo, 'severidad', ps.severidad)
                           ORDER BY CASE ps.severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, ps.tipo) AS senales
            FROM persona_senal ps JOIN _pic_pares p ON p.entidad_ruc = ps.entidad_ruc AND p.ruc = ps.ruc
           GROUP BY ps.entidad_ruc, ps.ruc) s
   WHERE pe.entidad_ruc = s.entidad_ruc AND pe.ruc = s.ruc;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_persona_informe_control() OWNER TO vigia_jobs;
-- Lee informe_control_persona (con DNI): sólo la corre su dueño (los Workers de órdenes y de planilla, y los scripts como
-- vigia_jobs o postgres).
REVOKE ALL ON FUNCTION refrescar_persona_informe_control() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_agentes') THEN
    REVOKE ALL ON FUNCTION refrescar_persona_informe_control() FROM vigia_agentes;
  END IF;
END $$;

-- La primera vez y el resumen de las listas (porSenal de cada alcance). En PROD, con la caché fría, la misma lógica en CTE
-- tardó 2 minutos (7 s en caliente); la micro de DEV es varias veces más lenta. Si pasa de 30 minutos algo anda mal.
SET statement_timeout = '1800s';
SELECT refrescar_persona_informe_control() AS ordenes_tras_informe;
SELECT refrescar_personas_resumen() AS personas_resumen;
RESET statement_timeout;
