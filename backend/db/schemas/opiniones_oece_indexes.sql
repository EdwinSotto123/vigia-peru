-- Índices del corpus estructurado OECE.
CREATE INDEX IF NOT EXISTS idx_opin_norma           ON opiniones_oece_estructurado (norma);
CREATE INDEX IF NOT EXISTS idx_opin_art_ley         ON opiniones_oece_estructurado (articulo_ley);
CREATE INDEX IF NOT EXISTS idx_opin_art_reglamento  ON opiniones_oece_estructurado (articulo_reglamento);
CREATE INDEX IF NOT EXISTS idx_opin_num_opinion     ON opiniones_oece_estructurado (num_opinion);
CREATE INDEX IF NOT EXISTS idx_opin_ano             ON opiniones_oece_estructurado (ano DESC);
ANALYZE opiniones_oece_estructurado;
