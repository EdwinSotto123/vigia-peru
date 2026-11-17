-- 346 · La lista de personas contratadas filtrada por departamento y señal (GET /personas?dep=&senal=), sin recorrer la
-- señal en todo el país.
--
-- pg_stat_statements (2026-11-17): la página y su conteo, 4,9 a 6,3 s de media (hasta 24 s en frío). El índice GIN de
-- `tipos` traía todas las filas del país con esa señal (61 mil para «socio_proveedor») y el departamento se filtraba
-- después, fila por fila en el disco (32 mil bloques). Con btree_gin, un solo índice GIN sobre (dep, tipos) acota a las
-- del departamento (9,6 mil): unas tres veces menos lecturas. CONCURRENTLY: la tabla se sigue leyendo mientras se arma.
--
-- Correr fuera de una transacción (psql -f sin --single-transaction).
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE INDEX CONCURRENTLY IF NOT EXISTS persona_entidad_dep_tipos ON persona_entidad USING gin (dep, tipos);
