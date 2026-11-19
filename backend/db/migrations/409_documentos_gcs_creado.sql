-- 409 · Los documentos bajados en los últimos 7 días, desde un índice.
--
-- El tablero de procesamientos (GET /procesamientos/resumen, DOCUMENTOS_SQL) cuenta los documentos bajados en la última
-- semana. Sin índice por `creado_at` la base recorría documentos_gcs entera (6 459 páginas de disco) para quedarse con
-- ~3 mil filas: 532 ms de media, 27 veces en 33 minutos (la memoria de 5 min es por instancia del Worker). Medido el
-- 2026-11-19. Con `ocid` incluido, el conteo de contratos sale del índice sin tocar la tabla.
--
-- Cómo aplicarla: sola (CONCURRENTLY, fuera de una transacción).

CREATE INDEX CONCURRENTLY IF NOT EXISTS documentos_gcs_creado ON documentos_gcs (creado_at) INCLUDE (ocid);
