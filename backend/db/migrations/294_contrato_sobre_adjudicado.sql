-- El contrato se firmó por MÁS de lo adjudicado (cruce `contrato_sobre_adjudicado`, 2026-11-15).
--
-- El contrato se celebra por el monto de la oferta ganadora. Los lectores ya extraen el monto de cada contrato
-- (documento_lectura, clase «contrato») y hay dos registros oficiales de la buena pro: CONOSCE y el OCDS del proceso.
-- De 9 074 contratos con los tres datos, 7 superan en 25 % o más lo adjudicado según CONOSCE; dos eran procesos de
-- varios ítems en que CONOSCE traía uno solo. Por eso se exige que las DOS fuentes den un adjudicado menor, un solo
-- ganador y que el OCDS no registre otra adjudicación. Quedan 5; en 3 el contrato coincide con el valor referencial
-- aunque la buena pro fue por menos.
--
-- Es un indicio para abrir el contrato: el monto sale de una lectura automática y puede incluir prestaciones que la
-- buena pro registró aparte.

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
  SELECT 'contrato_sobre_adjudicado', a.ruc, k.ocid, CASE WHEN k.monto >= 1.5 * a.adj THEN 'alta' ELSE 'media' END, k.fecha, k.monto,
         jsonb_build_object('monto_contrato', round(k.monto, 2), 'adjudicado', round(a.adj, 2), 'adjudicado_ocds', round(o.total, 2),
                            'diff_pct', round(100 * (k.monto / a.adj - 1)), 'de_mas', round(k.monto - a.adj, 2), 'referencial', round(k.referencial, 2),
                            'igual_al_referencial', COALESCE(abs(k.monto - k.referencial) <= 0.01 * k.referencial, false),
                            'norma', 'El contrato se celebra por el monto de la oferta ganadora'),
         'documento_lectura', 'https://contratacionesabiertas.oece.gob.pe/'
    FROM _csa k
    JOIN _csa_adj a ON a.ocid = k.ocid AND a.ganadores = 1 AND a.ruc ~ '^20[0-9]{9}$'
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

-- Con el plan correcto tarda segundos: si pasa de 3 minutos se corta.
SET statement_timeout = '180s';
SELECT refrescar_cruce_contrato_sobre_adjudicado() AS contratos_sobre_adjudicado;
RESET statement_timeout;
