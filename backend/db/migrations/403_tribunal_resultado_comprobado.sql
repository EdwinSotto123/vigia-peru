-- 403 · El resultado de cada apelación, comprobado sin modelo (migración 402).
--
-- El modelo lee el resultado; el código lo compara con el primer punto de la parte resolutiva tal como está escrito
-- (backend/lector/tribunal.resultado_de_texto). En la primera tanda, una resolución que dice «Declarar la nulidad de
-- oficio…» salió leída como «fundado». Si las dos lecturas no coinciden, el resultado queda en disputa: la API no lo
-- publica (muestra la cita literal del resolutivo, sin calificarla).
ALTER TABLE tribunal_resolucion ADD COLUMN IF NOT EXISTS resultado_regla text;
ALTER TABLE tribunal_resolucion ADD COLUMN IF NOT EXISTS resultado_ok boolean NOT NULL DEFAULT false;
