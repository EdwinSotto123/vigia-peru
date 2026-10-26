-- Nepotismo como SEÑAL del sistema de banderas (no un cartel aparte): el pariente declarado en la DJI que es locador
-- (RUC-10) de su misma entidad pasa a vivir en `persona_senal` tipo 'nepotismo', igual que `inhabilitado` o
-- `apellidos_funcionario`. Así aparece como chip en la lista de personas, tarjeta en la ficha del locador (con la cita
-- orden por orden) y cuenta en el Inicio de la entidad, con el MISMO mecanismo que las demás señales (Carril B).
--
-- La ficha de la ENTIDAD, además, lista estas banderas desde la vista `dji_nepotismo` (cargo + nombre del funcionario +
-- qué pariente vende). Por eso aquí la vista gana una columna `cargo` (del declarante, vía dji_funcionarios).
--
-- PRIVACIDAD (crítico, igual que 134/136): el DNI y el nombre del pariente NUNCA salen por la API. La señal sólo expone
-- el HECHO (cargo del funcionario, parentesco, monto, órdenes). El locador (RUC-10) ya es público; su nombre va tapado
-- por publicar() como cualquier otro. El funcionario (cargo público, DJI pública) se nombra, pero el frontend muestra el
-- nombre PARCIAL (un apellido). Es un INDICIO para revisión humana, no una acusación: el impedimento (art. 30, Ley
-- 32069) depende del rol del declarante.

-- ── 1. La vista gana el cargo del declarante (de su declaración, por codigo_ddjj) ───────────────────────────────────
CREATE OR REPLACE VIEW dji_nepotismo AS
SELECT v.entidad_ruc,
       v.declarante_norm,
       (array_agg(fc.cargo ORDER BY fc.fecha_inicio_cargo DESC NULLS LAST) FILTER (WHERE fc.cargo IS NOT NULL))[1] AS cargo,
       v.grado,
       v.parentesco,
       p.ruc              AS proveedor_ruc,
       p.nombre           AS proveedor_nombre,
       sum(p.ordenes)::int   AS ordenes,
       sum(p.monto)::float   AS monto,
       min(p.anio)           AS desde,
       max(p.anio)           AS hasta
FROM dji_vinculos v
JOIN persona_orden_anual p
  ON p.entidad_ruc = v.entidad_ruc
 AND p.ruc LIKE '10%'
 AND substr(p.ruc, 3, 8) = v.pariente_doc
LEFT JOIN LATERAL (
  SELECT f.cargo, f.fecha_inicio_cargo
    FROM dji_funcionarios f
   WHERE f.codigo_ddjj = v.codigo_ddjj AND f.cargo IS NOT NULL
   LIMIT 5
) fc ON true
GROUP BY v.entidad_ruc, v.declarante_norm, v.grado, v.parentesco, p.ruc, p.nombre;

COMMENT ON VIEW dji_nepotismo IS
  'Cruce nepotismo: pariente declarado (DJI) = locador de su misma entidad, con el cargo del funcionario. Indicio, no acusación. API expone solo el agregado. Migración 136/137.';

GRANT SELECT ON dji_nepotismo TO vigia_api, vigia_api_admin, vigia_jobs;

-- ── 2. La señal 'nepotismo' en persona_senal (Carril B), autocontenida ──────────────────────────────────────────────
-- Se corre DESPUÉS de refrescar_personas_senales() (que borra y rehace toda la tabla): inserta las filas de nepotismo y
-- parcha el resumen persona_entidad de los pares afectados (para que el chip salga en la lista y cuente en el Inicio).
CREATE OR REPLACE FUNCTION refrescar_nepotismo_senal() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  DELETE FROM persona_senal WHERE tipo = 'nepotismo';

  -- Una señal por (entidad, locador): el/los funcionario(s) que lo declararon, con su cargo y el parentesco.
  INSERT INTO persona_senal (entidad_ruc, ruc, tipo, severidad, detalle, fuente, fuente_url)
  SELECT n.entidad_ruc, n.proveedor_ruc, 'nepotismo', 'alta',
         jsonb_build_object(
           'parientes', jsonb_agg(DISTINCT jsonb_build_object(
                          'declarante', n.declarante_norm, 'cargo', n.cargo, 'grado', n.grado, 'parentesco', n.parentesco)),
           'ordenes', max(n.ordenes), 'monto', max(n.monto), 'desde', min(n.desde), 'hasta', max(n.hasta)),
         'dji_contraloria', 'https://appdji.contraloria.gob.pe/DJIC/'
    FROM dji_nepotismo n
   GROUP BY n.entidad_ruc, n.proveedor_ruc;
  GET DIAGNOSTICS n = ROW_COUNT;

  -- Parchar el resumen de los pares que ahora tienen la señal (persona_entidad lo arma refrescar_personas_senales sin
  -- nepotismo; aquí recomputamos tipos/senales/n/sev de esos pares desde persona_senal).
  CREATE TEMP TABLE _np_pares ON COMMIT DROP AS
    SELECT DISTINCT entidad_ruc, ruc FROM persona_senal WHERE tipo = 'nepotismo';

  UPDATE persona_entidad pe
     SET tipos = s.tipos, senales = s.senales, n_senales = s.n, sev = s.sev
    FROM (
      SELECT ps.entidad_ruc, ps.ruc,
             array_agg(ps.tipo ORDER BY ps.tipo) AS tipos,
             count(*)::int AS n,
             max(CASE ps.severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END)::smallint AS sev,
             jsonb_agg(jsonb_build_object('tipo', ps.tipo, 'severidad', ps.severidad)
                       ORDER BY CASE ps.severidad WHEN 'alta' THEN 3 WHEN 'media' THEN 2 ELSE 1 END DESC, ps.tipo) AS senales
        FROM persona_senal ps
        JOIN _np_pares np ON np.entidad_ruc = ps.entidad_ruc AND np.ruc = ps.ruc
       GROUP BY ps.entidad_ruc, ps.ruc
    ) s
   WHERE pe.entidad_ruc = s.entidad_ruc AND pe.ruc = s.ruc;

  RAISE NOTICE 'nepotismo: % señales', n;
  RETURN n;
END $$;

ALTER FUNCTION refrescar_nepotismo_senal() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_nepotismo_senal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refrescar_nepotismo_senal() TO vigia_jobs;
