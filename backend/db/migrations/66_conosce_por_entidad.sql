-- 66 · Índice para la historia de procesos de una entidad (GET /entidades/:ruc/procesos).
--
-- La ficha de una entidad listaba sólo los contratos de la base de Vigía (casi todos de 2026: el Ejército, 331) y su
-- cifra decía "contratos en el SEACE". CONOSCE trae sus procesos adjudicados desde 2018 (el Ejército, 8 608): la ficha
-- los muestra en su pestaña "Procesos desde 2018", agrupando conosce_adjudicaciones por proceso para esa entidad. Sin
-- este índice, cada pedido recorría las 547 mil filas.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/66_conosce_por_entidad.sql

CREATE INDEX IF NOT EXISTS conosce_adj_entidad ON conosce_adjudicaciones (entidad_ruc, fecha_convocatoria DESC);
