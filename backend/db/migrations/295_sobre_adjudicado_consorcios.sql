-- contrato_sobre_adjudicado: los que ganó un consorcio van a sus integrantes (2026-11-15).
--
-- La 294 sólo marcaba al ganador con RUC 20: de 5 contratos confirmados por las dos fuentes quedó 1 bandera, porque 3 los
-- ganó un consorcio (CONOSCE lo registra con un código de 7 dígitos) y 1 una persona natural. Ahora la bandera va a cada
-- empresa integrante del consorcio (conosce_consorcios), con el nombre del consorcio en el detalle. La persona natural
-- sigue sin marcarse.

CREATE OR REPLACE FUNCTION refrescar_cruce_contrato_sobre_adjudicado() RETURNS integer
LANGUAGE plpgsql SET work_mem = '64MB' SET statement_timeout = '300s' AS $$
DECLARE v_filas int;
BEGIN
  DROP TABLE IF EXISTS _csa;
  CREATE TEMP TABLE _csa ON COMMIT DROP AS
    SELECT d.ocid, c.codigo, c.fecha_convocatoria AS fecha, c.cuantia_referencial AS referencial,
           NULLIF(regexp_replace(d.salida->>'monto_contratado', '[^0-9.]', '', 'g'), '')::numeric AS monto
      FROM documento_lectura d JOIN convocatorias c ON c.ocid = d.ocid
     WHERE d.clase = 'contrato' AND d.estado = 'ok' AND (d.salida->>'es_contrato') IS DISTINCT FROM 'false';
  DELETE FROM _csa WHERE monto IS NULL OR monto <= 0;
  CREATE INDEX ON _csa (codigo);
  ANALYZE _csa;

  DROP TABLE IF EXISTS _csa_adj;
  CREATE TEMP TABLE _csa_adj ON COMMIT DROP AS
    SELECT k.ocid, sum(a.monto_adjudicado) AS adj, min(a.ruc_proveedor) AS ruc, count(DISTINCT a.ruc_proveedor) AS ganadores
      FROM _csa k JOIN conosce_adjudicaciones a ON a.codigo_convocatoria::text = k.codigo
     WHERE a.monto_adjudicado > 0 AND a.moneda ~* 'sol'
     GROUP BY k.ocid;
  ANALYZE _csa_adj;

  DELETE FROM cruces_proveedor WHERE tipo = 'contrato_sobre_adjudicado';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT 'contrato_sobre_adjudicado', g.ruc, k.ocid, CASE WHEN k.monto >= 1.5 * a.adj THEN 'alta' ELSE 'media' END, k.fecha, k.monto,
         jsonb_build_object('monto_contrato', round(k.monto, 2), 'adjudicado', round(a.adj, 2), 'adjudicado_ocds', round(o.total, 2),
                            'diff_pct', round(100 * (k.monto / a.adj - 1)), 'de_mas', round(k.monto - a.adj, 2), 'referencial', round(k.referencial, 2),
                            'igual_al_referencial', COALESCE(abs(k.monto - k.referencial) <= 0.01 * k.referencial, false),
                            'consorcio', g.consorcio, 'norma', 'El contrato se celebra por el monto de la oferta ganadora'),
         'documento_lectura', 'https://contratacionesabiertas.oece.gob.pe/'
    FROM _csa k
    JOIN _csa_adj a ON a.ocid = k.ocid AND a.ganadores = 1
    -- A quién va la bandera: a la empresa que ganó o, si ganó un consorcio (CONOSCE lo da con un código propio), a cada
    -- integrante que sea empresa. Una persona natural no se marca nunca.
    JOIN LATERAL (
      SELECT a.ruc AS ruc, NULL::text AS consorcio WHERE a.ruc ~ '^20[0-9]{9}$'
      UNION
      SELECT q.ruc_miembro, max(q.consorcio) FROM conosce_consorcios q
       WHERE q.ruc_consorcio = a.ruc AND q.ruc_miembro ~ '^20[0-9]{9}$' AND a.ruc !~ '^(10|20)[0-9]{9}$' GROUP BY 1
    ) g ON TRUE
    JOIN convocatorias c ON c.ocid = k.ocid
    JOIN LATERAL (SELECT sum((w->'value'->>'amount')::numeric) AS total, count(*) AS n
                    FROM jsonb_array_elements(COALESCE(c.ocds_payload->'awards', '[]'::jsonb)) w
                   WHERE COALESCE(w->>'status', 'active') NOT IN ('cancelled', 'unsuccessful')) o ON o.n = 1
   WHERE k.monto >= 1.25 * a.adj AND k.monto <= 3 * a.adj          -- más de 3 veces suele ser un error de lectura
     AND k.monto >= 1.25 * o.total;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas;
END $$;
ALTER FUNCTION refrescar_cruce_contrato_sobre_adjudicado() OWNER TO vigia_jobs;

SET statement_timeout = '180s';
SELECT refrescar_cruce_contrato_sobre_adjudicado() AS contratos_sobre_adjudicado;
RESET statement_timeout;
