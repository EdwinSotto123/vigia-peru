-- 199 · La empresa de cada visita, por la visita (índice que faltaba).
--
-- /visitas/entidad/:ruc pide, para cada una de las 1,000 visitas de su lista, la empresa a la que se atribuye
-- (`SELECT ev.ruc FROM empresa_visita ev WHERE ev.visita_id = v.id LIMIT 1`). empresa_visita sólo tenía su llave
-- (ruc, visita_id): cada búsqueda por la visita recorría la tabla entera. Con las visitas de la plataforma nacional
-- (empresa_visita pasó a ~3 M de filas) la pestaña Visitas del MIMP no respondía en 120 s y la API daba 500.
-- La tabla se rehace con DELETE/INSERT (refrescar_empresas): el índice se queda.

CREATE INDEX IF NOT EXISTS empresa_visita_visita ON empresa_visita (visita_id);
ANALYZE empresa_visita;
