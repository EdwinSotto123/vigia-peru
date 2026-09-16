-- Vigía Perú · Migración 21: montos de la alerta (lote 1 · T8 / T13) ──────────
--
--  · alertas.monto_adjudicado guardaba el VALOR REFERENCIAL (convocatorias.cuantia_referencial):
--    741 750 en vez de 734 010 (1225030), 1 100 900 en vez de 920 000 (1225416). Desde ahora
--    monto_adjudicado = contracts[].value > awards[].value > oferta ganadora del acta > referencial,
--    y el referencial vive aparte en `monto_referencial` (tools/persistence.py::_montos_alerta).
--  · Backfill: para las alertas existentes, monto_referencial ← cuantía de la convocatoria y
--    monto_adjudicado ← awards/contracts del ocds_payload cuando existen.
--  · T13: las columnas que persistence.py creaba con `ALTER TABLE … IF NOT EXISTS` en cada
--    persist (ACCESS EXCLUSIVE → espera detrás de cualquier lectura y bloquea al resto) se
--    garantizan aquí una sola vez; el código ya no ejecuta ALTER.

ALTER TABLE alertas ADD COLUMN IF NOT EXISTS monto_referencial NUMERIC;
ALTER TABLE alertas ADD COLUMN IF NOT EXISTS analisis_full JSONB;
ALTER TABLE alertas ADD COLUMN IF NOT EXISTS dictamen_markdown TEXT;
ALTER TABLE alertas ADD COLUMN IF NOT EXISTS analizado_en TIMESTAMPTZ;
ALTER TABLE banderas ADD COLUMN IF NOT EXISTS verificacion JSONB;

COMMENT ON COLUMN alertas.monto_adjudicado IS
  'Monto adjudicado/contratado: contracts[].value > awards[].value > oferta ganadora (acta) > referencial (persistence._montos_alerta).';
COMMENT ON COLUMN alertas.monto_referencial IS
  'Valor referencial / cuantía publicada (tender.value). Separado de monto_adjudicado desde la migración 21.';

-- Backfill idempotente (solo filas sin monto_referencial).
UPDATE alertas a
   SET monto_referencial = c.cuantia_referencial
  FROM convocatorias c
 WHERE ocid_corto(c.ocid) = ocid_corto(a.ocid)
   AND a.monto_referencial IS NULL
   AND c.cuantia_referencial IS NOT NULL;

WITH m AS (
  SELECT ocid_corto(c.ocid) AS ocid_c,
         NULLIF((SELECT SUM((x->'value'->>'amount')::numeric)
                   FROM jsonb_array_elements(COALESCE(c.ocds_payload->'contracts', '[]'::jsonb)) x
                  WHERE (x->'value'->>'amount') ~ '^[0-9.]+$'), 0) AS contratado,
         NULLIF((SELECT SUM((x->'value'->>'amount')::numeric)
                   FROM jsonb_array_elements(COALESCE(c.ocds_payload->'awards', '[]'::jsonb)) x
                  WHERE (x->'value'->>'amount') ~ '^[0-9.]+$'), 0) AS adjudicado
    FROM convocatorias c
   WHERE jsonb_typeof(c.ocds_payload) = 'object'
)
UPDATE alertas a
   SET monto_adjudicado = COALESCE(m.contratado, m.adjudicado)
  FROM m
 WHERE m.ocid_c = ocid_corto(a.ocid)
   AND COALESCE(m.contratado, m.adjudicado) IS NOT NULL
   AND (a.monto_adjudicado IS NULL OR a.monto_adjudicado = a.monto_referencial
        OR a.monto_adjudicado <> COALESCE(m.contratado, m.adjudicado));
