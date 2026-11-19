-- 417 · El nepotismo por DJI de una entidad, precalculado.
--
-- La vista dji_nepotismo (migraciones 136-139) se calculaba en vivo en cada ficha: por cada pariente declarado en la DJI
-- de los funcionarios de la entidad, buscaba sus órdenes en persona_orden_anual. En una entidad grande son 95 691
-- parientes y 383 mil páginas: 2,1 s en caliente y hasta 10 s en frío (pg_stat_statements del 2026-11-19: 1 092
-- llamadas a 1 s de media). Toda la vista son 7 423 filas de 844 entidades y se calcula en ~9 s.
--
-- dji_nepotismo_mat la guarda; la API la lee (entidades.ts, planilla.ts). Las funciones de lote siguen con la vista en
-- vivo. Los datos cambian poco (la captura de DJI está parada desde el 29-10; las órdenes, cada semana): se refresca cada
-- día con pg_cron (06:20 UTC) sin bloquear lecturas. Además, politico_dji gana un índice por entidad (el chequeo de
-- «declarante electo» la recorría por cada caso: su clave empieza por el código).

CREATE MATERIALIZED VIEW IF NOT EXISTS dji_nepotismo_mat AS SELECT * FROM dji_nepotismo;
CREATE UNIQUE INDEX IF NOT EXISTS dji_nepotismo_mat_uidx ON dji_nepotismo_mat
    (entidad_ruc, declarante_norm, grado, parentesco, proveedor_ruc, proveedor_nombre) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS dji_nepotismo_mat_declarante ON dji_nepotismo_mat (declarante_norm, entidad_ruc);
GRANT SELECT ON dji_nepotismo_mat TO vigia_api, vigia_api_admin, vigia_jobs;
COMMENT ON MATERIALIZED VIEW dji_nepotismo_mat IS 'dji_nepotismo precalculada para la API (ficha de entidad y de planilla). pg_cron vigia-dji-nepotismo, cada día. Migración 417.';

CREATE INDEX IF NOT EXISTS politico_dji_entidad ON politico_dji (entidad_ruc, codigo);

SELECT cron.schedule('vigia-dji-nepotismo', '20 6 * * *', 'REFRESH MATERIALIZED VIEW CONCURRENTLY dji_nepotismo_mat');
