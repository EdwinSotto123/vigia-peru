-- 362 · Quien postuló y todavía no tiene resultado no «perdió».
--
-- jne_candidaturas llegaba a 2022. Desde el 2026-11-18 trae las candidaturas de 2026 (backend/scripts/cargar_jne_2026.py):
-- las de las Elecciones Generales, con sus 208 electos, y las 86 mil de las Regionales y Municipales del 4 de octubre, cuyo
-- resultado el JNE todavía no publica en un formato que se pueda leer (`resultado` NULL).
--
-- refrescar_partido_politicos() (migración 301) convertía todo lo que no fuera «electo» en «no_electo», y la web lo
-- mostraba como «No ganó». Con esta migración:
--   · una candidatura del JNE sin resultado conserva el NULL (antes: «no_electo»);
--   · partido_politico.pendiente = tiene una candidatura del JNE sin resultado y no ganó ninguna otra elección.
-- La función es larga (39 mil caracteres): se parchan sus cinco líneas en la definición que está en la base, en vez de
-- copiarla entera. Si alguna no está tal cual, la migración se detiene sin tocar nada.

ALTER TABLE partido_politico ADD COLUMN IF NOT EXISTS pendiente BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN partido_politico.pendiente IS 'Postuló en una elección cuyo resultado aún no está cargado (candidatura del JNE sin resultado) y no ganó ninguna otra';

DO $mig$
DECLARE
  d text := pg_get_functiondef('public.refrescar_partido_politicos()'::regprocedure);
  cambios text[][] := ARRAY[
    ARRAY[$a$CASE WHEN h.que = 'onpe' THEN NULL WHEN h.electo THEN 'electo' ELSE 'no_electo' END AS resultado$a$,
          $b$CASE WHEN h.que = 'onpe' OR h.electo IS NULL THEN NULL WHEN h.electo THEN 'electo' ELSE 'no_electo' END AS resultado$b$],
    ARRAY[$a$count(*)::int AS n, COALESCE(bool_or(resultado = 'electo'), false) AS gano,$a$,
          $b$count(*)::int AS n, COALESCE(bool_or(resultado = 'electo'), false) AS gano,
           COALESCE(bool_or(resultado IS NULL AND fuente = 'JNE'), false) AS pendiente,$b$],
    ARRAY[$a$INSERT INTO partido_politico (org_clave, codigo, doc, tipo, nombre, publico, gano, candidato,$a$,
          $b$INSERT INTO partido_politico (org_clave, codigo, doc, tipo, nombre, publico, gano, pendiente, candidato,$b$],
    ARRAY[$a$SELECT y.org_clave, y.codigo, y.doc, y.tipo, y.nombre, y.publico, y.gano, y.candidato,$a$,
          $b$SELECT y.org_clave, y.codigo, y.doc, y.tipo, y.nombre, y.publico, y.gano, y.pendiente, y.candidato,$b$],
    ARRAY[$a$COALESCE(ca.gano, false) AS gano, p.candidato,$a$,
          $b$COALESCE(ca.gano, false) AS gano, (COALESCE(ca.pendiente, false) AND NOT COALESCE(ca.gano, false)) AS pendiente, p.candidato,$b$]
  ];
  i int;
BEGIN
  IF position('AS pendiente' IN d) > 0 THEN
    RAISE NOTICE 'refrescar_partido_politicos() ya distingue el resultado pendiente';
    RETURN;
  END IF;
  FOR i IN 1 .. array_length(cambios, 1) LOOP
    IF (length(d) - length(replace(d, cambios[i][1], ''))) / length(cambios[i][1]) <> 1 THEN
      RAISE EXCEPTION 'refrescar_partido_politicos() cambió: no encuentro una sola vez «%»', left(cambios[i][1], 70);
    END IF;
    d := replace(d, cambios[i][1], cambios[i][2]);
  END LOOP;
  EXECUTE d;
END $mig$;
