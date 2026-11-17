-- 345 · Las dos consultas públicas más caras de pg_stat_statements (2026-11-17), arregladas.
--
-- 1. dji_nepotismo_pares(): usaba lo precalculado (dji_nepotismo_pares_hecho, migración 235) sólo si tenía menos de 2
--    días, pero la cadena que lo rehace es la de las órdenes, SEMANAL (los domingos). Cinco días de cada siete se
--    recalculaba en vivo: 2 551 + 384 llamadas a ~8 s de media (unas 6,5 horas de base en la medición). Vale ahora 9
--    días: los datos que cruza (DJI y órdenes) también cambian una vez por semana.
-- 2. La página de estado de las fuentes lee max(dataset_fecha) de inversion_mef (269 mil filas, 738 MB) y
--    max(cargado_at) de sunat_padron (2,4 M filas): recorrían las tablas enteras, de 5 a 7,6 s cada vez. Índices.

CREATE OR REPLACE FUNCTION public.dji_nepotismo_pares()
 RETURNS TABLE(entidad text, declarante text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Lo ya calculado mientras sea de los últimos 9 días (lo rehace la cadena semanal de órdenes); si no, en vivo, como antes:
  -- un refresco que se dejó de correr no deja la lista con datos viejos.
  IF EXISTS (SELECT 1 FROM dji_nepotismo_pares_estado WHERE calculado_at > now() - interval '9 days') THEN
    RETURN QUERY SELECT h.entidad, h.declarante FROM dji_nepotismo_pares_hecho h;
  ELSE
    RETURN QUERY
      SELECT DISTINCT v.entidad_ruc, v.declarante_norm
        FROM dji_vinculos v
       WHERE v.declarante_norm IS NOT NULL AND length(v.pariente_doc) = 8
         AND EXISTS (SELECT 1 FROM persona_orden_anual po
                      WHERE po.entidad_ruc = v.entidad_ruc AND po.ruc BETWEEN '10' || v.pariente_doc || '0' AND '10' || v.pariente_doc || '9');
  END IF;
END $function$;

CREATE INDEX IF NOT EXISTS inversion_mef_dataset_fecha ON inversion_mef (dataset_fecha);
CREATE INDEX IF NOT EXISTS sunat_padron_cargado_at ON sunat_padron (cargado_at);
