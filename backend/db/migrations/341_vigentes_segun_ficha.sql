-- 341 · «Sanción vigente» de hoy según la ficha del proveedor en el OECE (migración 337).
--
-- La vista osce_sancionados_vigentes (la usan la regla `proveedor_sancionado_osce` de los agentes, la API y los cruces)
-- toma el estado de los datos abiertos de sancionados, que no reflejan las sustituciones del Tribunal: A & G INDUSTRIES
-- seguía «inhabilitada de por vida» por una definitiva de 2016 sustituida en 2025 (2026-2409-58). Ahora queda fuera la
-- sanción que la ficha del OECE, consultada en los últimos 60 días, ya no lista (sustituida, reducida o anulada), da por no
-- vigente o le pone un fin ya pasado. Sin ficha consultada, todo sigue como antes.

CREATE OR REPLACE VIEW osce_sancionados_vigentes AS
SELECT s.*
FROM osce_sancionados s
WHERE UPPER(COALESCE(s.estado, 'VIGENTE')) = 'VIGENTE'
  AND (
        s.tipo = 'definitivo'                                                   -- inhabilitación de por vida
     OR (s.tipo = 'temporal'  AND s.fecha_hasta IS NOT NULL AND s.fecha_hasta >= CURRENT_DATE)
     OR (s.tipo = 'multa'     AND (s.fecha_hasta IS NULL OR s.fecha_hasta >= CURRENT_DATE))
  )
  AND NOT EXISTS (
        SELECT 1 FROM sancion_segun_ficha f
         WHERE f.ruc = s.ruc AND f.resolucion = s.resolucion AND f.consultado_at > now() - interval '60 days'
           AND (f.estado_ficha IN ('no_figura', 'no_vigente') OR (f.fin_ficha IS NOT NULL AND f.fin_ficha < CURRENT_DATE)));
