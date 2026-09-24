-- Vigía Perú · Migración 28 — Índices para las lecturas de la API ─────────────────────────────
--
-- Medido con EXPLAIN (ANALYZE, BUFFERS) sobre la base de producción (2026-09-24; Cloud SQL
-- db-custom-1-3840, 1 vCPU: las consultas "en paralelo" de un endpoint compiten por esa CPU).
--
-- 1 · convocatorias (ocid_corto(ocid)). Alertas, procesamientos, pedidos y documentos guardan el
--     OCID corto y se unen con convocatorias por ocid_corto(). Las otras tablas ya tienen su índice
--     de expresión (alertas y procesamientos desde la 12, pedidos_descarga desde la 15,
--     documentos_gcs desde la 19); convocatorias no, y cada unión la recorre entera (~18 k filas):
--       · GET /admin/revision (HEAD_SQL, admin_revision.ts): Seq Scan de convocatorias = 45 ms de
--         los 60 ms de la consulta → ~0.1 ms (19 búsquedas por índice, ~6 µs cada una, como la PK).
--       · marcar_pedidos_listos() (migración 15) y backend/batch/descargar.py: lo mismo por pedido.
--       · /buscar y cualquier consulta nueva que una por ocid_corto().
--     (/contratos/:ocid, /contratos?q=<código> y /admin/pedidos ya no lo necesitan: buscan por PK con
--     OCID_CANDIDATOS de backend/api/src/lib/db.ts — 35 ms → 2 ms, 39 ms → 5 ms.)
--
-- 2 · convocatorias (created_at). "Ingresados hoy" (/financiamiento/estado) y "últimas 24 h"
--     (/financiamiento/procesamientos/resumen) cuentan un rango de created_at recorriendo la tabla:
--     11–12 ms cada uno → < 1 ms con un Index Only Scan del rango (las rutas ya lo piden como rango).
--
-- Cómo aplicarla: A MANO con psql (apply_all.py llega sólo hasta la 21), FUERA de una transacción:
-- CREATE INDEX CONCURRENTLY no puede ir dentro de BEGIN/COMMIT. Nada de `psql -1` /
-- `--single-transaction` ni envolverla en un bloque:
--     psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/28_indices_lectura.sql
-- CONCURRENTLY no bloquea las escrituras (la ingesta nocturna sigue); igual conviene correrla fuera
-- del lote nocturno, porque espera a que terminen las transacciones que ya estaban abiertas.
--
-- lock_timeout: si algo tiene tomada `convocatorias` más de 5 s, falla en vez de quedar en cola
-- (y de hacer esperar detrás a las lecturas de la API). Se reintenta más tarde.
--
-- Después, comprobar que los dos índices quedaron VÁLIDOS (un CONCURRENTLY que falla o se corta deja
-- el índice INVALID: existe, se mantiene en cada escritura, pero el planificador no lo usa, y
-- IF NOT EXISTS no lo rehace):
--     SELECT c.relname, i.indisvalid, i.indisready
--       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
--      WHERE c.relname IN ('convocatorias_ocid_corto_idx', 'convocatorias_created_idx');
-- Si alguno sale con indisvalid = false: DROP INDEX CONCURRENTLY <nombre>; y volver a correr el archivo.

SET lock_timeout = '5s';

CREATE INDEX CONCURRENTLY IF NOT EXISTS convocatorias_ocid_corto_idx ON convocatorias (ocid_corto(ocid));

CREATE INDEX CONCURRENTLY IF NOT EXISTS convocatorias_created_idx ON convocatorias (created_at);

-- Estadísticas de la expresión ocid_corto(ocid) para que el planificador estime bien las uniones.
ANALYZE convocatorias;
