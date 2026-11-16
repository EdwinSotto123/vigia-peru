-- La copia de un documento por su dirección de origen en el SEACE (GET /documentos/copia, 2026-11-16).
--
-- Las banderas leídas de un documento enlazan a la descarga del SEACE, que falla a menudo (502). La ruta nueva busca la
-- copia guardada por `url_origen`: sin índice recorría las 127 mil filas de documentos_gcs en cada clic.

CREATE INDEX IF NOT EXISTS documentos_gcs_origen_idx ON documentos_gcs (url_origen) WHERE borrado_at IS NULL;
