-- 210 · Una candidatura por persona y elección (JNE).
--
-- El usuario (2026-10-29), sobre «Su gente» de una empresa: «fue elegido y no elegido en el mismo proceso, ¿será que traemos
-- data que se sobreescribe?». No se sobrescribía: se duplicaba. load_jne_candidaturas.py lee de cada elección el archivo
-- «Candidatos» (todos los que postularon, como no_electo) y el de «Autoridades» (los que ganaron, como electo), y daba por
-- hecho que no se cruzan: quien ganó quedaba dos veces, «fue elegido» y «no fue elegido». En PROD (29-oct): 38,164 filas
-- no_electo con su gemela electo, de 37,010 personas, en todas las elecciones de 2014 a 2022.
--
-- Aquí, una fila por candidatura:
--   1. Gemelas (misma persona, año, cargo y lugar; el cargo de congresista y del Parlamento Andino se escribe distinto en
--      cada archivo y el lugar se compara con mef_norm): la fila electo se queda con el DNI que completó jne_infogob en la
--      otra y con su número en la lista; la no_electo se borra.
--   2. Quien postuló a un cargo del concejo municipal y figura como autoridad con otro del mismo concejo (postuló a regidor
--      y figura como alcalde, por sucesión): esa candidatura fue elegida. Queda la del archivo de candidatos (lo que postuló)
--      como electo y se borra la otra; el cargo que ejerce está en jne_autoridades.
-- El resultado sólo se muestra (la ficha de la persona, «Su gente», la historia de la empresa): ninguna señal lo usa para
-- decidir. Idempotente. Lo que ya armaron las fichas de personas (persona_senal, planilla) se rehace en su próximo refresco.
--
-- El cargador (backend/scripts/load_jne_candidaturas.py) ya no los duplica: unificar() hace lo mismo antes de insertar.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/210_jne_candidaturas_unicas.sql (o dev.py migrar).

SET lock_timeout = '60s';

BEGIN;

CREATE TEMP TABLE _jc ON COMMIT DROP AS
SELECT id, resultado, numero_documento AS doc, numero_lista, nombre, "año" AS anio,
       CASE WHEN cargo ~* 'PARLAMENTO ANDINO' THEN 'PARLAMENTO ANDINO'
            WHEN cargo ~* '^\s*CONGRESISTA' THEN 'CONGRESISTA'
            ELSE mef_norm(cargo) END AS cargo_k,
       mef_norm(region) AS reg, mef_norm(provincia) AS pro, mef_norm(distrito) AS dis
  FROM jne_candidaturas
 WHERE nombre IS NOT NULL AND "año" IS NOT NULL;
CREATE INDEX ON _jc (nombre, anio);
ANALYZE _jc;

-- 1. Gemelas: la no_electo que ya está como electo.
CREATE TEMP TABLE _gemelas ON COMMIT DROP AS
SELECT DISTINCT ON (n.id) n.id AS id_no, e.id AS id_si, n.doc AS doc_no, n.numero_lista AS lista_no
  FROM _jc n
  JOIN _jc e ON e.nombre = n.nombre AND e.anio = n.anio AND e.resultado = 'electo' AND n.resultado = 'no_electo'
            AND e.cargo_k = n.cargo_k
            AND (e.cargo_k IN ('CONGRESISTA', 'PARLAMENTO ANDINO') OR (e.reg = n.reg AND e.pro = n.pro AND e.dis = n.dis))
            AND (e.doc IS NULL OR n.doc IS NULL OR e.doc = n.doc)
 ORDER BY n.id, e.id;

UPDATE jne_candidaturas c
   SET numero_documento = COALESCE(c.numero_documento, g.doc_no),
       numero_lista = COALESCE(c.numero_lista, g.lista_no)
  FROM (SELECT DISTINCT ON (id_si) id_si, doc_no, lista_no FROM _gemelas ORDER BY id_si, (doc_no IS NULL), id_no) g
 WHERE c.id = g.id_si
   AND ((c.numero_documento IS NULL AND g.doc_no IS NOT NULL) OR (c.numero_lista IS NULL AND g.lista_no IS NOT NULL));

DELETE FROM jne_candidaturas c USING _gemelas g WHERE c.id = g.id_no;

-- 2. Mismo concejo, otro cargo: la candidatura (lo que postuló) fue elegida; la fila de autoridad sobra.
CREATE TEMP TABLE _concejo ON COMMIT DROP AS
SELECT DISTINCT ON (e.id) n.id AS id_no, e.id AS id_si, e.doc AS doc_si
  FROM _jc n
  JOIN _jc e ON e.nombre = n.nombre AND e.anio = n.anio AND e.resultado = 'electo' AND n.resultado = 'no_electo'
            AND e.cargo_k <> n.cargo_k
            AND e.cargo_k ~ '^(ALCALDE|REGIDOR)' AND n.cargo_k ~ '^(ALCALDE|REGIDOR|ACCESITARIO)'
            AND e.reg = n.reg AND e.pro = n.pro AND e.dis = n.dis
            AND (e.doc IS NULL OR n.doc IS NULL OR e.doc = n.doc)
 WHERE NOT EXISTS (SELECT 1 FROM _gemelas g WHERE g.id_no = n.id OR g.id_si = e.id)
 ORDER BY e.id, n.id;

UPDATE jne_candidaturas c
   SET resultado = 'electo', numero_documento = COALESCE(c.numero_documento, k.doc_si)
  FROM (SELECT DISTINCT ON (id_no) id_no, doc_si FROM _concejo ORDER BY id_no, (doc_si IS NULL), id_si) k
 WHERE c.id = k.id_no;

DELETE FROM jne_candidaturas c USING _concejo k WHERE c.id = k.id_si;

DO $$
DECLARE
  g INT := (SELECT count(*) FROM _gemelas);
  k INT := (SELECT count(*) FROM _concejo);
BEGIN
  RAISE NOTICE 'jne_candidaturas: % gemelas borradas, % candidaturas del concejo marcadas como elegidas', g, k;
END $$;

COMMIT;
