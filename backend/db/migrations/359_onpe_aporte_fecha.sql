-- 359 · Siete aportes de campaña con el año mal tecleado en el portal de la ONPE.
--
-- Revisión de fuentes del 2026-11-17: onpe_aportantes tenía fechas de los años 217, 1021, 1919, 2002 (en un informe anual
-- de 2022), 2003 y 2916. Son erratas del portal Claridad, pero ponían el primer aporte de un partido siglos atrás
-- (partido_politico.aporte_desde) y desordenaban cualquier línea de tiempo.
--
-- La misma regla que desde hoy aplica el cargador (fechaAporteCreible, onpe_claridad.ts): si el proceso dice su año
-- («IFA2017», «EG2021») y la fecha se aleja más de 3 años, vale el año del proceso con el mismo día y mes; sin año en el
-- proceso, una fecha fuera de 2000 a hoy se quita (queda el monto y el aportante, sin fecha).
UPDATE onpe_aportantes a
   SET fecha_aporte = make_date(substring(a.proceso from '([0-9]{4})$')::int, extract(month FROM a.fecha_aporte)::int, extract(day FROM a.fecha_aporte)::int),
       "año" = substring(a.proceso from '([0-9]{4})$')::int
 WHERE a.fecha_aporte IS NOT NULL AND a.proceso ~ '[0-9]{4}$'
   AND abs(extract(year FROM a.fecha_aporte)::int - substring(a.proceso from '([0-9]{4})$')::int) > 3
   -- Un 29 de febrero sólo si el año del proceso es bisiesto.
   AND NOT (extract(month FROM a.fecha_aporte) = 2 AND extract(day FROM a.fecha_aporte) = 29
            AND substring(a.proceso from '([0-9]{4})$')::int % 4 <> 0);

UPDATE onpe_aportantes a
   SET fecha_aporte = NULL, "año" = NULL
 WHERE a.fecha_aporte IS NOT NULL
   AND (extract(year FROM a.fecha_aporte) < 2000 OR a.fecha_aporte > current_date + 366);
