-- 221 · Sanciones del Tribunal sin duplicados, y vigentes aunque la fila no traiga estado.
--
-- La carga del 2026-09-16 (pnda_sancionados) metió 2,395 sanciones sin `estado`: los CSV de la PNDA no lo traen (el de
-- mayo salió de otra exportación, con estado). 2,376 ya estaban: la resolución venía con espacios sueltos
-- («1494-2008- TC-S3» en vez de «1494-2008-TC-S3»), así que la llave única (ruc, resolucion) no las reconoció y contaban
-- doble en las fichas. Y la vista osce_sancionados_vigentes, que exigía estado = 'VIGENTE', no veía las pocas nuevas: una
-- inhabilitación definitiva cargada así nunca marcaba al ganador.
--
--   1. Borra las filas sin estado cuya resolución, sin espacios, ya está cargada para el mismo RUC (la otra fila queda).
--   2. Deja las resoluciones sin espacios. El Worker inserta igual desde esta fecha (src/fuentes/pnda_sancionados.ts), así
--      que la llave única vuelve a reconocerlas.
--   3. La vista toma una fila sin estado como vigente si su tipo y sus fechas lo dicen (la definitiva, siempre). Un estado
--      explícito distinto de VIGENTE sigue mandando.
--
-- Los cruces (sancion_vigente y demás) se rehacen solos en la corrida diaria del OECE (refrescar_cruces).

-- Si una cadena de refrescos está leyendo la vista, mejor fallar y reintentar que dejar en cola a la API detrás del bloqueo.
SET lock_timeout = '10s';

-- 1. Duplicados por espacios. Entre dos filas sin estado gemelas queda la de id menor.
DELETE FROM osce_sancionados s
 WHERE s.estado IS NULL
   AND EXISTS (SELECT 1 FROM osce_sancionados o
                WHERE o.ruc = s.ruc AND o.id <> s.id
                  AND regexp_replace(o.resolucion, '\s+', '', 'g') = regexp_replace(s.resolucion, '\s+', '', 'g')
                  AND (o.estado IS NOT NULL OR o.id < s.id));

-- 2. Resoluciones sin espacios, una por (ruc, resolución) para no chocar con el índice único.
UPDATE osce_sancionados s
   SET resolucion = x.norma
  FROM (SELECT DISTINCT ON (ruc, regexp_replace(resolucion, '\s+', '', 'g'))
               id, regexp_replace(resolucion, '\s+', '', 'g') AS norma
          FROM osce_sancionados
         WHERE resolucion ~ '\s'
         ORDER BY ruc, regexp_replace(resolucion, '\s+', '', 'g'), id) x
 WHERE s.id = x.id
   AND NOT EXISTS (SELECT 1 FROM osce_sancionados o WHERE o.ruc = s.ruc AND o.resolucion = x.norma);

-- 3. Vigente por estado o, si no lo trae, por tipo y fechas.
CREATE OR REPLACE VIEW osce_sancionados_vigentes AS
SELECT *
FROM osce_sancionados
WHERE UPPER(COALESCE(estado, 'VIGENTE')) = 'VIGENTE'
  AND (
        tipo = 'definitivo'                                                 -- inhabilitación de por vida
     OR (tipo = 'temporal'  AND fecha_hasta IS NOT NULL AND fecha_hasta >= CURRENT_DATE)
     OR (tipo = 'multa'     AND (fecha_hasta IS NULL OR fecha_hasta >= CURRENT_DATE))
  );
