-- 122 · Dos banderas nuevas del contrato: "único postor" y "socio del proveedor contratado por la entidad".
--
-- Ambas son cruces del contrato (cruces_proveedor), funciones separadas como otro_postor/recien_fundada: corren en el
-- pipeline (comun.ts) después de refrescar_cruces y antes de casos_cruce_base, y sobreviven a la reconstrucción.
--
-- 1) unico_postor: el proceso tuvo UN SOLO postor (OCDS tender.tenderers = 1): sin competencia real, posible
--    direccionamiento. Intensidad: alta si además se adjudicó pegado al valor referencial (≥98%, el "adj≈referencial"
--    que suelto era ruido —44% de procesos— pero combinado con único postor sí pesa) o si pasa S/ 1 M; si no, media.
--    Sólo procesos ≥ 8 UIT (S/ 44,000).
-- 2) socio_en_entidad (puerta giratoria): un socio o representante del ganador (RNP) es, además, una persona CONTRATADA
--    por la MISMA entidad que le dio el contrato (locador/CAS, persona_entidad). Conflicto de interés directo → alta.
--    Es una persona natural: se guarda su documento (la API lo vuelve ref) y su nombre (la API le tapa un apellido).

-- ── 1) Único postor ──
CREATE OR REPLACE FUNCTION refrescar_cruce_unico_postor() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  DELETE FROM cruces_proveedor WHERE tipo = 'unico_postor';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  WITH uno AS (
    SELECT DISTINCT ON (c.codigo) c.codigo, c.ocid
      FROM convocatorias c
     WHERE c.ocid NOT LIKE 'ocds-vigia-%'
       AND jsonb_typeof(c.ocds_payload->'tender'->'tenderers') = 'array'
       AND jsonb_array_length(c.ocds_payload->'tender'->'tenderers') = 1
     ORDER BY c.codigo, c.ocid
  ), g AS (
    SELECT a.codigo_convocatoria AS codigo, a.ruc_proveedor AS ruc, max(a.fecha_buenapro) AS f,
           sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS adj,
           sum(a.monto_referencial) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS ref
      FROM conosce_adjudicaciones a WHERE a.ruc_proveedor ~ '^20[0-9]{9}$'
     GROUP BY 1, 2
  )
  SELECT 'unico_postor', g.ruc, uno.ocid,
         CASE WHEN g.adj >= g.ref * 0.98 OR g.adj >= 1000000 THEN 'alta' ELSE 'media' END,
         g.f, g.adj,
         jsonb_build_object('postores', 1, 'adjudicado', g.adj, 'referencial', g.ref,
                            'razon', round(g.adj / NULLIF(g.ref, 0), 4), 'al_tope', (g.adj >= g.ref * 0.98)),
         'oece_ocds', 'https://contratacionesabiertas.oece.gob.pe/'
    FROM g JOIN uno ON uno.codigo = g.codigo
   WHERE g.f IS NOT NULL AND g.adj >= 44000;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_cruce_unico_postor() OWNER TO vigia_jobs;

-- ── 2) Socio del proveedor contratado por la entidad (puerta giratoria) ──
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
           sum(pe.monto) AS monto_persona, sum(pe.ordenes) AS ordenes_persona
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
         'socio_en_entidad', c.ruc, c.ocid, 'alta', c.f, c.monto,
         v.doc, v.nombre, v.rol,
         jsonb_build_object('entidad', v.entidad, 'servicio', v.servicio,
                            'ordenes_persona', v.ordenes_persona, 'monto_persona', round(COALESCE(v.monto_persona, 0), 2)),
         'persona_entidad', 'https://www.gob.pe/'
    FROM c JOIN vinculo v ON v.ruc = c.ruc AND v.entidad_ruc = c.entidad_ruc
   WHERE c.f IS NOT NULL
   ORDER BY c.ocid, c.ruc, v.monto_persona DESC NULLS LAST;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_cruce_socio_en_entidad() OWNER TO vigia_jobs;
