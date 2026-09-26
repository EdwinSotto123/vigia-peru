-- 36_dispatcher.sql — cola del dispatcher sin ítems muertos (auditoría 2026-09-25, hallazgo A10).
--
-- Qué hace:
--   1. `reclamar_procesamientos()`: la re-encola por latido vencido (el worker murió o el job llegó a su
--      timeout) ya no deja el ítem `encolado` con intentos >= 3. El reclamo filtra `intentos < 3`, así que
--      ese ítem quedaba "en cola" para siempre en el tablero público. Ahora pasa a `error` con el motivo,
--      igual que un fallo normal del dispatcher con el último intento.
--   2. Cierra los que ya quedaron atascados así (una sola vez).
--
-- Por qué: con `--task-timeout 3600` y reclamos hasta el minuto 55, un análisis largo moría con el job y
-- se re-encolaba sin consumir intento; con 3 intentos ya gastados quedaba muerto sin aviso.
--
-- Verificación: `SELECT count(*) FROM procesamientos WHERE estado = 'encolado' AND intentos >= 3` → 0,
-- y el cuerpo nuevo con `SELECT prosrc FROM pg_proc WHERE proname = 'reclamar_procesamientos'`.
-- Idempotente (CREATE OR REPLACE y un UPDATE que no encuentra nada la segunda vez).

CREATE OR REPLACE FUNCTION reclamar_procesamientos(n INT, p_worker TEXT) RETURNS SETOF TEXT
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Latido vencido: con intentos disponibles vuelve a la cola; sin intentos, error visible.
  UPDATE procesamientos
     SET estado = CASE WHEN intentos >= 3 THEN 'error' ELSE 'encolado' END,
         worker = NULL,
         error = CASE WHEN intentos >= 3 THEN 'timeout sin latido: sin intentos restantes' ELSE 'timeout sin latido' END
   WHERE estado = 'procesando' AND latido_at < now() - interval '20 minutes';
  RETURN QUERY
  WITH c AS (
    SELECT ocid FROM procesamientos
     WHERE estado = 'encolado' AND intentos < 3
     ORDER BY encolado_at, ocid LIMIT n FOR UPDATE SKIP LOCKED)
  UPDATE procesamientos p SET estado = 'procesando', worker = p_worker, intentos = p.intentos + 1,
         iniciado_at = now(), latido_at = now(), fase_actual = 'started', fase_index = 0, error = NULL,
         fases = '{}'::jsonb, eventos = '[]'::jsonb
    FROM c WHERE p.ocid = c.ocid RETURNING p.ocid;
END $$;

-- Los que ya quedaron muertos: `encolado` sin intentos restantes nunca se vuelven a reclamar.
UPDATE procesamientos
   SET estado = 'error',
       error = COALESCE(NULLIF(error, ''), 'sin intentos restantes') || ' (cerrado por la migración 36)'
 WHERE estado = 'encolado' AND intentos >= 3;
