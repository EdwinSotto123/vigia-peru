-- Vigía Perú · Migración 27 — Banderas sin duplicados exactos ──────────────────────────────
--
-- Producción llegó a tener 12 filas duplicadas en `banderas` (misma alerta_id, regla y
-- evidencia): dos corridas/agentes insertaban la misma bandera. Los duplicados ya se borraron
-- a mano (2026-09-23) y el agente ahora inserta con `INSERT … WHERE NOT EXISTS … ON CONFLICT DO
-- NOTHING` (backend/agent/tools/persistence/shared.py · _insert_bandera). Este índice cierra la
-- puerta en la base: una bandera = (alerta_id, regla, md5(evidencia)). md5 porque la evidencia
-- es texto libre (hasta 500 caracteres en el agente, sin tope en otras rutas) y NULL cuenta
-- igual que '' — la MISMA expresión que usa el NOT EXISTS del agente.
--
-- Idempotente: si en esta base quedara algún duplicado (entorno local, restauración de un
-- backup viejo), se conserva la fila más antigua (menor id) antes de crear el índice; si no
-- hay duplicados, el DELETE no toca nada.
--
-- Nota de bloqueo: CREATE INDEX (no CONCURRENTLY: apply_all.py corre cada archivo en una
-- transacción) toma SHARE sobre `banderas` — bloquea escrituras, no lecturas — durante lo que
-- tarda en indexar una tabla de pocos miles de filas. Aplicar fuera de una corrida del agente.

DELETE FROM banderas b
 USING banderas d
 WHERE d.alerta_id = b.alerta_id
   AND d.regla = b.regla
   AND md5(coalesce(d.evidencia::text, '')) = md5(coalesce(b.evidencia::text, ''))
   AND d.id < b.id;

CREATE UNIQUE INDEX IF NOT EXISTS banderas_alerta_regla_evidencia_uniq
  ON banderas (alerta_id, regla, md5(coalesce(evidencia::text, '')));

COMMENT ON INDEX banderas_alerta_regla_evidencia_uniq IS
  'Una bandera por (alerta, regla, evidencia). Las inserciones usan ON CONFLICT DO NOTHING (migración 27).';
