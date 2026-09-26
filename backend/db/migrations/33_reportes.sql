-- Vigía Perú · Migración 33 — reportes_indexados: DDL fuera del request e ID por secuencia ─────────
--
-- Auditoría técnica 2026-09-25, hallazgo A15.
--   · POST /reportes ejecuta en CADA denuncia un CREATE TABLE IF NOT EXISTS + ALTER TABLE
--     (backend/api/src/routes/reportes.ts:160-196). El ALTER toma ACCESS EXCLUSIVE sobre la tabla
--     aunque no cambie nada: cada denuncia bloquea un instante todas las lecturas de /reportes.
--   · El ID es 'RPT-[ENT-]AAAA-' + 4 dígitos al azar (1000-9999): con ~112 reportes al año la
--     probabilidad de colisión llega al 50 %, el INSERT choca con la PK y la denuncia se pierde (500).
--
-- Qué hace:
--   1. La misma DDL que hoy corre en el request, copiada tal cual (idempotente). Después de esta
--      migración la API ya no la necesita.
--   2. Secuencia reportes_codigo_seq + next_codigo_reporte(modo) → 'RPT-2026-00001' o
--      'RPT-ENT-2026-00001' (mismo formato, 5 dígitos como next_codigo_contribucion()). Nunca choca
--      con un ID viejo de 4 dígitos (distinto largo); la API igual reintenta ante unique_violation.
--   3. Índice (fecha DESC, created_at DESC) = el ORDER BY de GET /reportes (la 34 borra el viejo
--      idx_reportes_fecha, que queda como prefijo redundante).
--
-- Uso desde la API:  INSERT INTO reportes_indexados (id, …) VALUES (next_codigo_reporte($1), …) RETURNING id
--   ($1 = 'obra' | 'entidad'; cualquier otro valor se trata como 'obra', igual que el default de zod).
--
-- Cómo verificar:
--     SELECT next_codigo_reporte('obra'), next_codigo_reporte('entidad');   -- (en una transacción con ROLLBACK
--                                                                            --  la secuencia avanza igual: es normal)
--     EXPLAIN SELECT id FROM reportes_indexados ORDER BY fecha DESC, created_at DESC LIMIT 100;
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/33_reportes.sql
-- Tabla chica: el ALTER toma el bloqueo exclusivo un instante (lock_timeout 5 s) y el índice va
-- CONCURRENTLY igual, por costumbre.

\set ON_ERROR_STOP on
SET lock_timeout = '5s';

BEGIN;

-- 1 · DDL de reportes.ts:163-193, sin cambios.
CREATE TABLE IF NOT EXISTS reportes_indexados (
  id TEXT PRIMARY KEY, categoria TEXT NOT NULL, descripcion TEXT NOT NULL,
  foto_url TEXT, region TEXT, ubicacion_geo GEOGRAPHY(POINT, 4326),
  direccion_texto TEXT, ruc_entidad TEXT, contacto_email TEXT,
  confirmado BOOL DEFAULT FALSE, confirmaciones INT DEFAULT 1,
  convergencia_id TEXT, fecha DATE DEFAULT CURRENT_DATE,
  moderacion_estado TEXT DEFAULT 'pendiente',
  modo TEXT DEFAULT 'obra',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE reportes_indexados
   ALTER COLUMN ubicacion_geo DROP NOT NULL,
   ADD COLUMN IF NOT EXISTS direccion_texto TEXT,
   ADD COLUMN IF NOT EXISTS ruc_entidad TEXT,
   ADD COLUMN IF NOT EXISTS contacto_email TEXT,
   ADD COLUMN IF NOT EXISTS modo TEXT DEFAULT 'obra',
   ADD COLUMN IF NOT EXISTS media_urls JSONB DEFAULT '[]'::jsonb,
   ADD COLUMN IF NOT EXISTS provincia TEXT,
   ADD COLUMN IF NOT EXISTS distrito TEXT,
   ADD COLUMN IF NOT EXISTS monto_estimado NUMERIC,
   ADD COLUMN IF NOT EXISTS periodo_desde DATE,
   ADD COLUMN IF NOT EXISTS periodo_hasta DATE,
   ADD COLUMN IF NOT EXISTS personas_involucradas TEXT,
   ADD COLUMN IF NOT EXISTS enlaces_externos JSONB DEFAULT '[]'::jsonb,
   ADD COLUMN IF NOT EXISTS contacto_nombre TEXT,
   ADD COLUMN IF NOT EXISTS contacto_telefono TEXT,
   ADD COLUMN IF NOT EXISTS anonimo BOOL DEFAULT TRUE;

-- 2 · Código público por secuencia.
CREATE SEQUENCE IF NOT EXISTS reportes_codigo_seq;

CREATE OR REPLACE FUNCTION next_codigo_reporte(modo TEXT) RETURNS TEXT
LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT 'RPT-' || CASE WHEN modo = 'entidad' THEN 'ENT-' ELSE '' END
         || to_char(now(), 'YYYY') || '-' || lpad(nextval('reportes_codigo_seq')::text, 5, '0')
$$;
COMMENT ON FUNCTION next_codigo_reporte(TEXT) IS
  'ID público de una denuncia: RPT-AAAA-NNNNN (obra) o RPT-ENT-AAAA-NNNNN (entidad). Migración 33.';

COMMIT;

-- 3 · Orden de GET /reportes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS reportes_fecha_created_idx
  ON reportes_indexados (fecha DESC, created_at DESC);
