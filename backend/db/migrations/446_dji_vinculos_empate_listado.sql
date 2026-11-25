-- 446: los familiares leídos de un PDF de DJI, a nombre de quien declaró como lo escribe el listado (2026-11-25).
--
-- procesar_dji.py guardaba el declarante con mayúsculas y espacios (`_norm`), pero el listado de la Contraloría
-- (dji_funcionarios.nombre_norm) y todos los cruces usan `mef_norm` (sin tildes ni signos). «MUÑOZ» no empataba con
-- «MUNOZ»: 10,400 declarantes de dji_vinculos no tenían ficha, y 6,352 personas del listado aparecían sin familiares
-- aunque su PDF estaba leído (medido el 2026-11-25). procesar_dji.py ya guarda la forma de mef_norm; esto arregla lo
-- guardado antes.
--
-- empatar_dji_declarantes() reasigna, SIEMPRE dentro de la misma entidad (RUC) y sólo si hay UNA persona del listado:
--   tildes     el mismo nombre en mef_norm
--   una_letra  el mismo número de palabras y trigramas >= 0.8 sobre el nombre entero (si no hubo empate por tildes)
-- Si la persona ya tenía ese familiar a su nombre en esa entidad (PDF leído dos veces), la fila repetida se borra.
-- Cada cambio queda en dji_vinculos_reempate (para deshacerlo: UPDATE … SET declarante_norm = antes). Idempotente: lo
-- ya reasignado empata con el listado y no vuelve a entrar. Después: refrescar_funcionario_familiar(), los pasos de
-- señal de la DJI (orquestar_dji.py: PASOS_SENAL) y refrescar_funcionario_dji_estado().

CREATE TABLE IF NOT EXISTS public.dji_vinculos_reempate (
  entidad_ruc  text NOT NULL,
  antes        text NOT NULL,
  despues      text NOT NULL,
  regla        text NOT NULL,
  filas        int NOT NULL,
  hecho_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.dji_vinculos_reempate IS
  'Declarantes de dji_vinculos reasignados al nombre del listado (migración 446): antes, después, regla y filas.';

CREATE OR REPLACE FUNCTION public.empatar_dji_declarantes(aplicar boolean DEFAULT false)
RETURNS TABLE (regla text, declarantes int, filas bigint, personas_nuevas int)
LANGUAGE plpgsql SET work_mem = '256MB' AS $$
BEGIN
  CREATE TEMP TABLE _eds ON COMMIT DROP AS
    SELECT v.entidad_ruc, v.declarante_norm, count(*)::int AS n, mef_norm(v.declarante_norm) AS m
      FROM dji_vinculos v
     WHERE v.entidad_ruc IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dji_funcionarios f WHERE f.nombre_norm = v.declarante_norm)
     GROUP BY 1, 2;
  CREATE TEMP TABLE _edl ON COMMIT DROP AS
    SELECT DISTINCT r.ruc, d.nombre_norm FROM dji_funcionarios d JOIN dji_entidad_ruc r ON r.entidad = d.entidad
     WHERE d.nombre_norm <> '' AND r.ruc IN (SELECT DISTINCT entidad_ruc FROM _eds);
  CREATE INDEX ON _edl (ruc, nombre_norm); ANALYZE _edl;
  CREATE TEMP TABLE _edm ON COMMIT DROP AS
    WITH a AS (SELECT s.entidad_ruc, s.declarante_norm, min(l.nombre_norm) AS destino, count(*) AS c
                 FROM _eds s JOIN _edl l ON l.ruc = s.entidad_ruc AND l.nombre_norm = s.m GROUP BY 1, 2),
         b AS (SELECT s.entidad_ruc, s.declarante_norm, min(l.nombre_norm) AS destino, count(*) AS c
                 FROM _eds s JOIN _edl l ON l.ruc = s.entidad_ruc
                  AND array_length(string_to_array(l.nombre_norm, ' '), 1) = array_length(string_to_array(s.m, ' '), 1)
                  AND similarity(l.nombre_norm, s.m) >= 0.8
                GROUP BY 1, 2)
    SELECT s.entidad_ruc, s.declarante_norm AS antes, s.n,
           CASE WHEN a.c = 1 THEN 'tildes' ELSE 'una_letra' END AS regla,
           CASE WHEN a.c = 1 THEN a.destino ELSE b.destino END AS despues
      FROM _eds s LEFT JOIN a USING (entidad_ruc, declarante_norm) LEFT JOIN b USING (entidad_ruc, declarante_norm)
     WHERE a.c = 1 OR (a.c IS NULL AND b.c = 1);

  RETURN QUERY
    SELECT m.regla, count(*)::int, sum(m.n)::bigint,
           (count(DISTINCT m.despues) FILTER (WHERE NOT EXISTS (SELECT 1 FROM dji_vinculos w WHERE w.declarante_norm = m.despues)))::int
      FROM _edm m GROUP BY 1 ORDER BY 1;

  IF aplicar THEN
    INSERT INTO dji_vinculos_reempate (entidad_ruc, antes, despues, regla, filas) SELECT entidad_ruc, antes, despues, regla, n FROM _edm;
    DELETE FROM dji_vinculos v USING _edm m
     WHERE v.entidad_ruc = m.entidad_ruc AND v.declarante_norm = m.antes
       AND EXISTS (SELECT 1 FROM dji_vinculos w
                    WHERE w.entidad_ruc = m.entidad_ruc AND w.declarante_norm = m.despues AND w.pariente_doc = v.pariente_doc);
    UPDATE dji_vinculos v SET declarante_norm = m.despues
      FROM _edm m WHERE v.entidad_ruc = m.entidad_ruc AND v.declarante_norm = m.antes;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.dji_vinculos_reempate OWNER TO vigia_jobs;
    ALTER FUNCTION public.empatar_dji_declarantes(boolean) OWNER TO vigia_jobs;
  END IF;
  REVOKE ALL ON public.dji_vinculos_reempate FROM PUBLIC;
END $$;
REVOKE EXECUTE ON FUNCTION public.empatar_dji_declarantes(boolean) FROM PUBLIC;
