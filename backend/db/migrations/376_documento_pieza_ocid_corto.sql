-- 376: índice de documento_pieza por ocid_corto(ocid).
--
-- La ficha de cada contrato lee la lectura más reciente de cada lector de sus piezas (lib/fichasPiezas.ts) con
-- `ocid_corto(p.ocid) = ocid_corto($1)` (el OCID llega con o sin sufijo). documento_pieza sólo tenía índice por `ocid`
-- entero: recorría sus 146 mil filas cada vez (485 ms medidos el 2026-11-18; 55 llamadas en 20 minutos). Las demás
-- tablas que se buscan así (alertas, convocatorias, documentos_gcs, procesamientos) ya tenían el suyo.
--
-- CONCURRENTLY: fuera de una transacción (aplicar sola, sin BEGIN).
CREATE INDEX CONCURRENTLY IF NOT EXISTS documento_pieza_ocid_corto ON documento_pieza (ocid_corto(ocid));
