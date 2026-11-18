-- 385: la ficha del contrato lee la competencia de los reportes del SEACE (proceso_postor) por ocid_corto, como las piezas
-- (migr. 376): sin índice era un recorrido de las 48 mil filas por ficha (214 ms; ocid_corto se evalúa por fila).
CREATE INDEX CONCURRENTLY IF NOT EXISTS proceso_postor_ocid_corto ON proceso_postor (ocid_corto(ocid));
