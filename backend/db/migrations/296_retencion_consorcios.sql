-- retencion_sobre_tope: también los integrantes de un consorcio (2026-11-15).
--
-- La 291 sólo miraba al ganador con RUC 20. Cuando gana un consorcio (CONOSCE lo da con un código propio), la condición
-- de micro o pequeña empresa es de cada integrante: ahora se marca a cada empresa integrante a la que el Estado le
-- adjudicó, por su cuenta, más de 1 700 UIT en cada uno de los dos años anteriores. El detalle dice qué consorcio.

CREATE OR REPLACE FUNCTION refrescar_cruce_retencion_sobre_tope() RETURNS integer
LANGUAGE plpgsql SET work_mem = '128MB' AS $$
DECLARE v_filas int;
BEGIN
  DELETE FROM cruces_proveedor WHERE tipo = 'retencion_sobre_tope';
  WITH ret AS (
    SELECT d.ocid, c.codigo, c.categoria, c.fecha_convocatoria AS fecha,
           NULLIF(regexp_replace(d.salida->>'monto_contratado', '[^0-9.]', '', 'g'), '')::numeric AS monto
      FROM documento_lectura d JOIN convocatorias c ON c.ocid = d.ocid
     WHERE d.clase = 'contrato' AND d.estado = 'ok' AND d.salida->'garantia_fiel_cumplimiento'->>'tipo' = 'retencion'
       AND c.fecha_convocatoria >= DATE '2025-04-22'            -- el artículo 114 rige desde la Ley 32069
  ), sobre AS (
    SELECT r.*, CASE WHEN r.categoria = 'works' THEN 5000000 ELSE 480000 END AS tope
      FROM ret r
     WHERE (r.categoria IN ('goods', 'services') AND r.monto > 480000) OR (r.categoria = 'works' AND r.monto > 5000000)
  ), uno AS (            -- un solo ganador: una empresa o un consorcio (CONOSCE lo registra con un código propio)
    SELECT s.*, g.ruc AS ganador
      FROM sobre s JOIN LATERAL (
        SELECT min(a.ruc_proveedor) AS ruc, count(DISTINCT a.ruc_proveedor) AS n
          FROM conosce_adjudicaciones a WHERE a.codigo_convocatoria::text = s.codigo::text AND a.monto_adjudicado > 0) g ON g.n = 1
  ), gan AS (            -- a quién se le mira si puede ser MYPE: a la empresa o a CADA integrante del consorcio (la condición es de cada uno)
    SELECT u.ocid, u.codigo, u.categoria, u.fecha, u.monto, u.tope, u.ganador AS ruc, NULL::text AS consorcio FROM uno u WHERE u.ganador ~ '^20[0-9]{9}$'
    UNION
    SELECT u.ocid, u.codigo, u.categoria, u.fecha, u.monto, u.tope, q.ruc_miembro, max(q.consorcio)
      FROM uno u JOIN conosce_consorcios q ON q.ruc_consorcio = u.ganador
     WHERE u.ganador !~ '^(10|20)[0-9]{9}$' AND q.ruc_miembro ~ '^20[0-9]{9}$'
     GROUP BY 1, 2, 3, 4, 5, 6, 7
  ), adj AS (
    SELECT a.ruc_proveedor AS ruc, a.anio, sum(a.monto_adjudicado) AS total
      FROM conosce_adjudicaciones a
     WHERE a.ruc_proveedor IN (SELECT ruc FROM gan) AND a.anio >= 2023 AND a.moneda ~* 'sol'
     GROUP BY 1, 2
  ), uit(anio, valor) AS (VALUES (2023, 4950), (2024, 5150), (2025, 5350), (2026, 5500), (2027, 5500))
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT 'retencion_sobre_tope', g.ruc, g.ocid,
         -- Grave cuando lo adjudicado dobla el techo de la pequeña empresa los dos años, o el contrato es 5 veces el tope.
         CASE WHEN (a1.total > 3400 * u1.valor AND a2.total > 3400 * u2.valor) OR g.monto > 5 * g.tope THEN 'alta' ELSE 'media' END,
         g.fecha, g.monto,
         jsonb_build_object('monto_contrato', round(g.monto, 2), 'tope', g.tope, 'categoria', g.categoria,
                            'anio_1', a1.anio, 'adjudicado_anio_1', round(a1.total, 2), 'anio_2', a2.anio, 'adjudicado_anio_2', round(a2.total, 2),
                            'techo_pequena_anio_1', 1700 * u1.valor, 'techo_pequena_anio_2', 1700 * u2.valor,
                            'consorcio', g.consorcio, 'norma', 'Art. 114 Reglamento D.S. 009-2025-EF — retención de pago'),
         'documento_lectura', 'https://contratacionesabiertas.oece.gob.pe/'
    FROM gan g
    JOIN adj a1 ON a1.ruc = g.ruc AND a1.anio = extract(year FROM g.fecha)::int - 1
    JOIN adj a2 ON a2.ruc = g.ruc AND a2.anio = extract(year FROM g.fecha)::int - 2
    JOIN uit u1 ON u1.anio = a1.anio
    JOIN uit u2 ON u2.anio = a2.anio
   WHERE a1.total > 1700 * u1.valor AND a2.total > 1700 * u2.valor;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas;
END $$;
ALTER FUNCTION refrescar_cruce_retencion_sobre_tope() OWNER TO vigia_jobs;
ALTER FUNCTION refrescar_cruce_retencion_sobre_tope() SET statement_timeout = '300s';

SET statement_timeout = '180s';
SELECT refrescar_cruce_retencion_sobre_tope() AS retenciones_sobre_tope;
RESET statement_timeout;
