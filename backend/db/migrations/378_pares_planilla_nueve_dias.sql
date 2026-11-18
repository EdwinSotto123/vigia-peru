-- 378: dji_nepotismo_pares_planilla() usa los pares precalculados si tienen menos de 9 días, como dji_nepotismo_pares()
-- desde la migración 345.
--
-- La 312 la escribió con «2 días» y el refresco de los pares es semanal: cinco de cada siete días recalculaba en vivo
-- (19,5 s, pg_stat_statements del 2026-11-18, ruta de la planilla con el filtro «declaró a un pariente locador»). Sólo
-- cambia el plazo; el resto es la definición vigente en producción ese día.

CREATE OR REPLACE FUNCTION public.dji_nepotismo_pares_planilla()
 RETURNS TABLE(entidad text, declarante text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM dji_nepotismo_pares_estado e WHERE e.calculado_at > now() - interval '9 days') THEN
    RETURN QUERY SELECT h.entidad, h.declarante FROM dji_nepotismo_pares_hecho h WHERE NOT h.reservado;
  ELSE
    RETURN QUERY
      SELECT v.entidad_ruc, v.declarante_norm
        FROM dji_vinculos v
       WHERE v.declarante_norm IS NOT NULL AND length(v.pariente_doc) = 8
         AND EXISTS (SELECT 1 FROM persona_orden_anual po
                      WHERE po.entidad_ruc = v.entidad_ruc AND po.ruc BETWEEN '10' || v.pariente_doc || '0' AND '10' || v.pariente_doc || '9')
       GROUP BY v.entidad_ruc, v.declarante_norm
      HAVING NOT bool_and(NOT parentesco_inverso_publicable(v.parentesco)
                          AND (v.pariente_doc IN (SELECT a.dni FROM jne_autoridades a WHERE a.dni IS NOT NULL)
                               OR v.pariente_doc IN (SELECT c.numero_documento FROM jne_candidaturas c
                                                      WHERE c.resultado = 'electo' AND c.numero_documento IS NOT NULL)));
  END IF;
END $function$;
