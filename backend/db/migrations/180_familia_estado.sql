-- 180 · «Familia en el Estado» (personas, baja): un funcionario de OTRA entidad, fuera de su gobierno, declaró a este
-- locador como pariente en su Declaración Jurada de Intereses (por el DNI del pariente, dji_vinculos). Lo de la misma
-- entidad es «nepotismo» (migración 137) y lo del mismo gobierno, «nepotismo_gobierno» (179): aquí va el resto, como dato
-- de contexto del perfil de la persona (fase 1A del plan del 2026-10-27). Medido en producción: 30,479 locadores.
--
-- refrescar_familia_estado(): paso aparte después de refrescar_senales_extra() en los Workers conosce_ordenes y
-- pte_personal, y después de cada ronda de la DJI. Rehace el tipo y parcha persona_entidad (como la 179).
-- Privacidad: del funcionario, su entidad, su cargo y su nombre (que la API reduce al primer apellido, y sólo si el
-- parentesco no destapa el apellido tapado de esta persona); del pariente (esta persona), nada que no esté en su ficha.
--
-- Cómo aplicarla: python infrastructure/dev/dev.py migrar backend/db/migrations/180_familia_estado.sql (DEV) y luego
-- SELECT refrescar_familia_estado(); SELECT refrescar_personas_resumen(); en producción, lo mismo con tunel_rds.

-- La planilla de una persona por su código de locador (el perfil y la ficha, «también en planilla»): sin índice, 13,5 s
-- recorriendo las 640 mil filas (medido 2026-10-27). En producción, CONCURRENTLY antes del resto.
CREATE INDEX IF NOT EXISTS planilla_persona_codigo ON planilla_persona (codigo) WHERE codigo IS NOT NULL;

CREATE OR REPLACE FUNCTION refrescar_familia_estado() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int := 0; t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_familia_estado'));
  SET LOCAL work_mem = '256MB';

  CREATE TEMP TABLE _fpar ON COMMIT DROP AS
    SELECT DISTINCT entidad_ruc, ruc FROM persona_senal WHERE tipo = 'familia_estado';
  DELETE FROM persona_senal WHERE tipo = 'familia_estado';

  -- Los vínculos con el documento del pariente y el funcionario que lo declaró (sin vínculos sin declarante).
  CREATE TEMP TABLE _fv ON COMMIT DROP AS
    SELECT DISTINCT v.pariente_doc, v.entidad_ruc AS ent_func, v.declarante_norm, v.parentesco, v.grado, v.codigo_ddjj
      FROM dji_vinculos v WHERE length(v.pariente_doc) = 8 AND v.declarante_norm IS NOT NULL;
  CREATE INDEX ON _fv (pariente_doc);

  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT pe.entidad_ruc, pe.ruc, 'familia_estado', 'baja',
         jsonb_build_object(
           'parientes', jsonb_agg(DISTINCT jsonb_build_object('entidad_ruc', v.ent_func, 'entidad', COALESCE(e.nombre, v.ent_func),
                                                              'declarante', v.declarante_norm, 'cargo', f.cargo,
                                                              'parentesco', v.parentesco, 'grado', v.grado)),
           'entidades', count(DISTINCT v.ent_func)),
         'dji_contraloria', 'https://appdji.contraloria.gob.pe/DJIC/'
    FROM persona_entidad pe
    JOIN _fv v ON v.pariente_doc = substr(pe.ruc, 3, 8) AND v.ent_func <> pe.entidad_ruc
    LEFT JOIN entidades e ON e.ruc::text = v.ent_func
    LEFT JOIN entidad_gobierno_amplia g1 ON g1.ruc = v.ent_func
    LEFT JOIN entidad_gobierno_amplia g2 ON g2.ruc = pe.entidad_ruc
    LEFT JOIN LATERAL (SELECT fc.cargo FROM dji_funcionarios fc WHERE fc.codigo_ddjj = v.codigo_ddjj AND fc.cargo IS NOT NULL
                        ORDER BY fc.fecha_inicio_cargo DESC NULLS LAST LIMIT 1) f ON true
   WHERE pe.ruc LIKE '10%'
     -- Lo del mismo gobierno ya es «nepotismo_gobierno».
     AND NOT (g1.nivel IS NOT NULL AND g1.nivel = g2.nivel AND g1.ubigeo = g2.ubigeo)
   GROUP BY pe.entidad_ruc, pe.ruc;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'familia en el Estado: % pares (% s)', n, round(extract(epoch FROM clock_timestamp() - t0));

  -- El resumen de cada par tocado (antes y después), desde persona_senal (como la 179).
  INSERT INTO _fpar SELECT DISTINCT entidad_ruc, ruc FROM persona_senal WHERE tipo = 'familia_estado';
  CREATE TEMP TABLE _fpar2 ON COMMIT DROP AS SELECT DISTINCT entidad_ruc, ruc FROM _fpar;
  UPDATE persona_entidad pe SET tipos = '{}', senales = '[]', n_senales = 0, sev = 0
    FROM _fpar2 p WHERE pe.entidad_ruc = p.entidad_ruc AND pe.ruc = p.ruc;
  UPDATE persona_entidad pe
     SET tipos = s.tipos, senales = s.senales, n_senales = s.n, sev = s.sev
    FROM (SELECT ps.entidad_ruc, ps.ruc, array_agg(ps.tipo ORDER BY ps.tipo) AS tipos, count(*)::int AS n,
                 max(CASE ps.severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END)::smallint AS sev,
                 jsonb_agg(jsonb_build_object('tipo', ps.tipo, 'severidad', ps.severidad)
                           ORDER BY CASE ps.severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, ps.tipo) AS senales
            FROM persona_senal ps JOIN _fpar2 p ON p.entidad_ruc = ps.entidad_ruc AND p.ruc = ps.ruc
           GROUP BY ps.entidad_ruc, ps.ruc) s
   WHERE pe.entidad_ruc = s.entidad_ruc AND pe.ruc = s.ruc;
  RAISE NOTICE 'familia en el Estado: persona_entidad al día (% s)', round(extract(epoch FROM clock_timestamp() - t0));
  RETURN n;
END $$;
ALTER FUNCTION refrescar_familia_estado() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_familia_estado() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refrescar_familia_estado() TO vigia_jobs;
