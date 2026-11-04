-- 249 · La red de consultoría (backend/agent/tools/consultoria.py) busca en INFOBRAS todas las obras que supervisó un
-- consultor (`supervisor_ruc`) y las que ejecutó una empresa (`ejecutor_ruc`): sin índice, cada análisis recorre las
-- 191 mil obras (~3,6 s).
CREATE INDEX IF NOT EXISTS obra_infobras_supervisor_ruc ON obra_infobras (supervisor_ruc) WHERE supervisor_ruc IS NOT NULL;
CREATE INDEX IF NOT EXISTS obra_infobras_ejecutor_ruc ON obra_infobras (ejecutor_ruc) WHERE ejecutor_ruc IS NOT NULL;
