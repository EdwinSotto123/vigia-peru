-- 363 · El resultado de las candidaturas que se cargaron sin él, cuando el JNE publique los electos.
--
-- Las 86 mil candidaturas de las Elecciones Regionales y Municipales de 2026 están con `resultado` NULL (pendiente,
-- migración 362): el JNE todavía no publica sus electos. Cuando lo haga, llegarán a `jne_autoridades` por la carga de
-- siempre (jne_infogob, el XLS «Autoridades electas» de la PNDA), con su proceso («ERM2026»).
--
-- jne_marcar_resultados(proceso, año, fuente):
--   1. electo: la candidatura cuyo nombre, cargo y departamento calzan con una autoridad de ese proceso;
--   2. no_electo: las demás candidaturas de un ámbito y cargo (el distrito, la provincia o la región) SÓLO si todas las
--      autoridades de ese ámbito y cargo calzaron con alguien. Si a un distrito le falta calzar un regidor (un nombre
--      escrito distinto), sus candidatos a regidor siguen pendientes: decir «no ganó» de quien sí ganó es peor que callar.
-- No hace nada si el proceso trae menos de `p_minimo` autoridades (un archivo a medias).
--
-- Probada el 2026-11-18 contra 2022, que ya tiene los dos datos: ver el comentario al final.
-- La llama jne_infogob al terminar (si existe). Devuelve lo que hizo; con p_aplicar = false, sólo cuenta.

CREATE OR REPLACE FUNCTION public.jne_marcar_resultados(p_proceso text, p_anio int, p_fuente text, p_aplicar boolean DEFAULT false, p_minimo int DEFAULT 5000)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_aut int; v_calzan int; v_electos int; v_no int; v_pend int; v_cand int;
BEGIN
  CREATE TEMP TABLE _jr_a ON COMMIT DROP AS
    SELECT a.id, a.nombre_norm AS nombre, mef_norm(a.cargo) AS cargo, mef_norm(COALESCE(a.departamento, '')) AS dep,
           mef_norm(COALESCE(a.provincia, '')) AS prov, mef_norm(COALESCE(a.distrito, '')) AS dist
      FROM jne_autoridades a
     -- Sin los reemplazos: quien asumió después (un accesitario, el regidor que sigue en la lista) no «ganó la elección».
     WHERE a.proceso = p_proceso AND COALESCE(a.nombre_norm, '') <> '' AND NOT COALESCE(a.es_reemplazo, false);
  SELECT count(*) INTO v_aut FROM _jr_a;
  IF v_aut < p_minimo THEN
    RETURN jsonb_build_object('proceso', p_proceso, 'autoridades', v_aut, 'hecho', false, 'motivo', 'menos autoridades que el mínimo: los electos aún no están publicados');
  END IF;
  CREATE INDEX ON _jr_a (nombre, dep); ANALYZE _jr_a;
  CREATE TEMP TABLE _jr_c ON COMMIT DROP AS
    SELECT c.id, c.nombre, mef_norm(c.cargo) AS cargo, mef_norm(COALESCE(c.region, '')) AS dep, mef_norm(COALESCE(c.provincia, '')) AS prov,
           mef_norm(COALESCE(c.distrito, '')) AS dist, c.resultado
      FROM jne_candidaturas c WHERE c."año" = p_anio AND c.fuente = p_fuente;
  CREATE INDEX ON _jr_c (nombre, dep); ANALYZE _jr_c;
  SELECT count(*) INTO v_cand FROM _jr_c;
  -- 1. Quién ganó: mismo nombre, mismo cargo, mismo departamento.
  CREATE TEMP TABLE _jr_e ON COMMIT DROP AS
    SELECT DISTINCT ON (a.id) a.id AS autoridad, c.id AS candidatura
      FROM _jr_a a JOIN _jr_c c ON c.nombre = a.nombre AND c.dep = a.dep AND c.cargo = a.cargo
     ORDER BY a.id, (c.prov = a.prov AND c.dist = a.dist) DESC, c.id;
  SELECT count(*) INTO v_calzan FROM _jr_e;
  -- 2. Los ámbitos y cargos en que TODAS las autoridades calzaron: ahí el resto no ganó.
  CREATE TEMP TABLE _jr_ok ON COMMIT DROP AS
    SELECT a.cargo, a.dep, a.prov, a.dist FROM _jr_a a LEFT JOIN _jr_e e ON e.autoridad = a.id
     GROUP BY 1, 2, 3, 4 HAVING count(*) = count(e.autoridad);
  SELECT count(DISTINCT e.candidatura) INTO v_electos FROM _jr_e e;
  SELECT count(*) INTO v_no FROM _jr_c c
   WHERE NOT EXISTS (SELECT 1 FROM _jr_e e WHERE e.candidatura = c.id)
     AND EXISTS (SELECT 1 FROM _jr_ok k WHERE k.cargo = c.cargo AND k.dep = c.dep AND k.prov = c.prov AND k.dist = c.dist);
  v_pend := v_cand - v_electos - v_no;
  IF p_aplicar THEN
    UPDATE jne_candidaturas j SET resultado = 'electo'
      FROM _jr_e e WHERE j.id = e.candidatura AND j.resultado IS DISTINCT FROM 'electo';
    UPDATE jne_candidaturas j SET resultado = 'no_electo'
      FROM _jr_c c
     WHERE j.id = c.id AND j.resultado IS NULL
       AND NOT EXISTS (SELECT 1 FROM _jr_e e WHERE e.candidatura = c.id)
       AND EXISTS (SELECT 1 FROM _jr_ok k WHERE k.cargo = c.cargo AND k.dep = c.dep AND k.prov = c.prov AND k.dist = c.dist);
  END IF;
  RETURN jsonb_build_object('proceso', p_proceso, 'autoridades', v_aut, 'autoridades_que_calzan', v_calzan, 'candidaturas', v_cand,
                            'electo', v_electos, 'no_electo', v_no, 'siguen_pendientes', v_pend, 'hecho', p_aplicar);
END $$;
ALTER FUNCTION public.jne_marcar_resultados(text, int, text, boolean, int) OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION public.jne_marcar_resultados(text, int, text, boolean, int) FROM PUBLIC;

-- Prueba del 2026-11-18, en seco, contra 2022 (jne_marcar_resultados('ERM2022', 2022, 'JNE_PNDA')), que ya trae su resultado:
--   dice «electo» de 12 233 candidaturas: 12 096 lo son en la tabla y 137 figuran «no_electo» (la fuente de 2022 está
--     incompleta, por ejemplo en las segundas vueltas regionales);
--   dice «no_electo» de 57 602: 56 944 coinciden; de las 658 que la tabla da por electas, casi todas dejaron el cargo
--     después (la lista de 2022 que hay hoy es la de autoridades VIGENTES, con 565 reemplazos; con el archivo de electos
--     recién proclamados eso no pasa);
--   deja pendientes 5 093, por un nombre que no calzó en su distrito.
