-- 342 · Índice por nombre en planilla_salida.
--
-- La ficha de una persona con cargo público (GET /personas/cargo/:codigo) busca su planilla de hoy (planilla_persona, con
-- índice) y las entidades en que ya no figura (planilla_salida, SIN índice: recorría las ~212 mil filas). Con la base
-- cargada, esa parte no respondía en sus 8 s y la ficha decía «No figura en ninguna planilla» bajo una cabecera «En
-- planilla hoy» (reporte del usuario, 2026-11-17).
CREATE INDEX IF NOT EXISTS planilla_salida_nombre_norm ON planilla_salida (nombre_norm);
