-- 438 · El rol de las Lambdas de evaluación (vigia_ab, sólo lectura) también lee el Tribunal, como vigia_agentes (437):
-- sin él, la prueba de una imagen nueva no ve las resoluciones y mide otra cosa que producción.

GRANT SELECT ON tribunal_resolucion, tribunal_proceso, tribunal_parte_empresa TO vigia_ab;
GRANT EXECUTE ON FUNCTION tribunal_corrigio(tribunal_resolucion) TO vigia_ab;
