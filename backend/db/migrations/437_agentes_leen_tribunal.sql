-- 437 · Los agentes leen lo que resolvió el Tribunal sobre el proceso que analizan.
--
-- backend/agent/tools/lecturas.py (2026-11-20) suma al contexto del analista legal las resoluciones del Tribunal unidas al
-- proceso: resultado comprobado, motivo, cita, empresas con su papel. El rol de los agentes no tenía permiso sobre esas
-- tablas (sin él, la herramienta sigue sin el Tribunal). Sólo lectura, y de la vista con RUC 20, no de tribunal_parte.

GRANT SELECT ON tribunal_resolucion, tribunal_proceso, tribunal_parte_empresa TO vigia_agentes;
GRANT EXECUTE ON FUNCTION tribunal_corrigio(tribunal_resolucion) TO vigia_agentes;
