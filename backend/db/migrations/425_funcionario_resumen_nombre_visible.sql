-- 425 · La ficha de una persona con cargo público avisa cuántas otras «se ven igual» (lib/funcionarios.ts, parecidosA):
-- mismo apellido paterno y mismos nombres. Sin índice era un recorrido entero de funcionario_resumen (1,15 M filas,
-- 78 mil páginas): 3,5 s en frío, 5 s en pg_stat_statements el 2026-11-19. Con el índice, unas pocas páginas.
-- La tabla se rehace con DELETE + INSERT (refrescar_funcionario_resumen, migración 357): el índice queda.

CREATE INDEX IF NOT EXISTS funcionario_resumen_paterno_nombres ON funcionario_resumen (paterno, nombres);
ANALYZE funcionario_resumen;
