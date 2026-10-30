-- 217: amarres de los aportes tras la auditoría de pagos del 2026-10-30.
--
-- 1) El comprobante público de un aporte mensual con tarjeta dice si el cobro sigue activo o se canceló (y ofrece
--    cancelarlo): el rol público lee sólo el id y el estado de su suscripción (routes/financiamiento.ts).
-- 2) Un archivo de comprobante (captura de Yape o Plin, constancia de transferencia) sirve para un solo aporte: antes la
--    misma captura podía adjuntarse a varios y el panel validarlos todos.
-- 3) Un número de operación de Yape, Plin o transferencia valida un solo aporte.
-- Los dos índices únicos se crean sólo si todavía no hay repetidos (si los hay, se avisa y se revisan a mano).
-- Idempotente.

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'dev_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT (id, estado) ON suscripciones_mp TO %I', r);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM contribuciones WHERE comprobante_url IS NOT NULL GROUP BY comprobante_url HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS contribuciones_comprobante_unico
      ON contribuciones (comprobante_url) WHERE comprobante_url IS NOT NULL;
  ELSE
    RAISE NOTICE '217: hay comprobantes repetidos; el índice contribuciones_comprobante_unico no se crea';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM contribuciones
     WHERE pasarela IN ('yape', 'plin', 'transferencia') AND pasarela_ref IS NOT NULL AND estado IN ('pagada', 'en_proceso', 'procesada')
     GROUP BY pasarela, pasarela_ref HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS contribuciones_ref_manual
      ON contribuciones (pasarela, pasarela_ref)
      WHERE pasarela IN ('yape', 'plin', 'transferencia') AND pasarela_ref IS NOT NULL AND estado IN ('pagada', 'en_proceso', 'procesada');
  ELSE
    RAISE NOTICE '217: hay operaciones repetidas; el índice contribuciones_ref_manual no se crea';
  END IF;
END $$;
