-- 395 · «Socio del ganador contratado por la entidad»: pesa según cuán cerca estuvo de la buena pro.
--
-- `socio_en_entidad` (migración 122) marcaba «alta» todo proceso en que un socio o representante del ganador (RNP) tuvo
-- órdenes de servicio de la misma entidad, en cualquier año: 13 165 procesos, el 3,1 % de los adjudicados. Medido el
-- 2026-11-18, la buena pro cayó dentro de sus órdenes (± 6 meses) en 5 050; a menos de dos años en 3 817; y más lejos en
-- 4 298 (1 584 contratos mucho antes de su primera orden, 2 714 mucho después de la última). Un locador de 2017 cuya
-- empresa gana en 2025 no es el mismo conflicto que uno que cobraba de la entidad mientras ella evaluaba a su empresa.
-- Ahora: alta a la vez, media a menos de dos años, baja más lejos o sin fechas. El detalle trae `primera_orden`,
-- `ultima_orden` y `cuando` (a_la_vez | cerca | lejos | sin_fechas). De varias personas, la más cercana a la buena pro.
--
-- La función es la de la 122 con eso; nada más cambia.
-- Cómo aplicarla: SELECT refrescar_cruce_socio_en_entidad(), dedup_cruces_proveedor(), refrescar_casos_cruce_base().

CREATE OR REPLACE FUNCTION refrescar_cruce_socio_en_entidad() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  DELETE FROM cruces_proveedor WHERE tipo = 'socio_en_entidad';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  WITH vinculo AS (
    -- Socio/representante de una empresa que ADEMÁS es contratado por una entidad (por DNI = dígitos 3-10 del RUC 10).
    SELECT rcj.ruc_empresa AS ruc, pe.entidad_ruc, rcj.numero_documento AS doc,
           max(rcj.nombre) AS nombre, max(rcj.tipo_rol) AS rol,
           max(pe.servicio) AS servicio, max(pe.entidad) AS entidad,
           sum(pe.monto) AS monto_persona, sum(pe.ordenes) AS ordenes_persona,
           min(pe.primera) AS primera, max(pe.ultima) AS ultima
      FROM rnp_conformacion_juridica rcj
      JOIN persona_entidad pe ON substr(pe.ruc, 3, 8) = rcj.numero_documento
     WHERE rcj.numero_documento ~ '^[0-9]{8}$' AND rcj.ruc_empresa ~ '^20[0-9]{9}$'
     GROUP BY rcj.ruc_empresa, pe.entidad_ruc, rcj.numero_documento
  ), c AS (
    -- Cada contrato que esa empresa le ganó a esa entidad, con su ocid.
    SELECT cv.ocid, a.ruc_proveedor AS ruc, a.entidad_ruc, max(a.fecha_buenapro) AS f,
           sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS monto
      FROM conosce_adjudicaciones a
      JOIN (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
             WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid) cv
        ON cv.codigo = a.codigo_convocatoria AND cv.entidad_ruc = a.entidad_ruc
     WHERE a.ruc_proveedor ~ '^20[0-9]{9}$'
       AND (a.ruc_proveedor, a.entidad_ruc) IN (SELECT ruc, entidad_ruc FROM vinculo)
     GROUP BY cv.ocid, a.ruc_proveedor, a.entidad_ruc
  )
  SELECT DISTINCT ON (c.ocid, c.ruc)
         'socio_en_entidad', c.ruc, c.ocid,
         -- Migración 395: el peso depende de cuán cerca estuvo la buena pro de las órdenes de la persona en la entidad.
         CASE x.cuando WHEN 'a_la_vez' THEN 'alta' WHEN 'cerca' THEN 'media' ELSE 'baja' END, c.f, c.monto,
         v.doc, v.nombre, v.rol,
         jsonb_build_object('entidad', v.entidad, 'servicio', v.servicio,
                            'ordenes_persona', v.ordenes_persona, 'monto_persona', round(COALESCE(v.monto_persona, 0), 2),
                            'primera_orden', v.primera, 'ultima_orden', v.ultima, 'cuando', x.cuando),
         'persona_entidad', 'https://www.gob.pe/'
    FROM c JOIN vinculo v ON v.ruc = c.ruc AND v.entidad_ruc = c.entidad_ruc
    CROSS JOIN LATERAL (
      SELECT CASE WHEN v.primera IS NULL OR v.ultima IS NULL THEN 'sin_fechas'
                  WHEN c.f BETWEEN v.primera - 180 AND v.ultima + 180 THEN 'a_la_vez'
                  WHEN c.f BETWEEN v.primera - 730 AND v.ultima + 730 THEN 'cerca'
                  ELSE 'lejos' END AS cuando) x
   WHERE c.f IS NOT NULL
   -- De varias personas de la misma empresa, la que estaba más cerca de la buena pro; entre iguales, la que más cobró.
   ORDER BY c.ocid, c.ruc, CASE x.cuando WHEN 'a_la_vez' THEN 0 WHEN 'cerca' THEN 1 ELSE 2 END, v.monto_persona DESC NULLS LAST;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
