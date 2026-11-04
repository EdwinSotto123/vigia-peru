-- 242 · Los tramos de visitas de empresas (migración 241), rápidos
--
-- En producción el primer tramo pasaba de 4 min leyendo disco: el planificador estima que el filtro
-- `ruc_empresa::text ~ '^20…'` deja ~577 filas del RNP (son 1,4 millones) y arma un ciclo anidado que, por cada una,
-- busca sus visitas en el índice por documento: 1,4 millones de búsquedas sueltas en cada tramo. La función original
-- (migración 112) no lo sufría porque copiaba esos documentos a una tabla temporal con ANALYZE.
-- Aquí preparar() deja esa copia en empresa_rnp_doc (con sus estadísticas) y cada tramo se cruza con ella por hash.

CREATE TABLE IF NOT EXISTS empresa_rnp_doc (
  doc      text NOT NULL,
  ruc      text NOT NULL,
  tipo_rol text
);
CREATE INDEX IF NOT EXISTS empresa_rnp_doc_doc ON empresa_rnp_doc (doc);

CREATE OR REPLACE FUNCTION refrescar_empresa_visitas_preparar() RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_empresa_visitas'));
  SET LOCAL work_mem = '256MB';

  -- Su gente en el RNP con un DNI (8 cifras): socios, representantes y directivos de empresas con RUC 20.
  TRUNCATE empresa_rnp_doc;
  INSERT INTO empresa_rnp_doc (doc, ruc, tipo_rol)
  SELECT DISTINCT numero_documento, ruc_empresa::text, tipo_rol
    FROM rnp_conformacion_juridica
   WHERE ruc_empresa::text ~ '^20\d{9}$' AND length(numero_documento) = 8;
  ANALYZE empresa_rnp_doc;

  TRUNCATE empresa_cliente_nombre;
  INSERT INTO empresa_cliente_nombre (ruc, entidad_ruc, ent_n)
  SELECT ruc, entidad_ruc, max(ent_n)
    FROM (SELECT COALESCE(m.ruc_miembro, a.ruc_proveedor) AS ruc, a.entidad_ruc, mef_norm(a.entidad) AS ent_n
            FROM conosce_adjudicaciones a
            LEFT JOIN (SELECT DISTINCT ruc_consorcio, ruc_miembro FROM conosce_consorcios WHERE ruc_miembro ~ '^20\d{9}$') m
              ON m.ruc_consorcio = a.ruc_proveedor AND a.ruc_proveedor !~ '^(10|20)\d{9}$'
           WHERE COALESCE(m.ruc_miembro, a.ruc_proveedor) ~ '^20\d{9}$' AND a.entidad_ruc IS NOT NULL
          UNION ALL
          SELECT ruc, entidad_ruc, mef_norm(entidad) FROM empresa_orden_anual WHERE entidad_ruc IS NOT NULL) x
   GROUP BY ruc, entidad_ruc
  HAVING max(ent_n) IS NOT NULL;
  ANALYZE empresa_cliente_nombre;

  TRUNCATE empresa_nombre_unico;
  INSERT INTO empresa_nombre_unico (k, ruc)
  SELECT k, min(ruc)
    FROM (SELECT razon_norm(nombre) AS k, ruc FROM empresa_resumen WHERE nombre IS DISTINCT FROM ruc
          UNION ALL
          SELECT razon_norm(razon_social_de(e.razon_social)), e.ruc::text
            FROM empresas e
           WHERE e.ruc ~ '^20\d{9}$' AND razon_social_de(e.razon_social) IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM empresa_resumen r WHERE r.ruc = e.ruc::text)) z
   WHERE length(k) >= 6
   GROUP BY k HAVING count(DISTINCT ruc) = 1;
  ANALYZE empresa_nombre_unico;

  SELECT jsonb_build_object('desde', COALESCE(min(id), 0), 'hasta', COALESCE(max(id), 0) + 1,
                            'documentos', (SELECT count(*) FROM empresa_rnp_doc),
                            'clientes', (SELECT count(*) FROM empresa_cliente_nombre),
                            'nombres', (SELECT count(*) FROM empresa_nombre_unico))
    INTO r FROM visitas_entidades;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION refrescar_empresa_visitas_tramo(p_desde bigint, p_hasta bigint) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_empresa_visitas'));
  SET LOCAL work_mem = '256MB';
  -- Las visitas del tramo primero (un recorrido por la llave), y después los cruces por hash.
  CREATE TEMP TABLE _vt ON COMMIT DROP AS
    SELECT id, numero_documento, entidad_visitada, entidad_visitante, tipo_entidad_visitante
      FROM visitas_entidades WHERE id >= p_desde AND id < p_hasta;
  ANALYZE _vt;
  CREATE TEMP TABLE _ev ON COMMIT DROP AS
    SELECT DISTINCT ON (ruc, visita_id) ruc, visita_id, via, claves
      FROM (SELECT r.ruc, v.id AS visita_id,
                   CASE r.tipo_rol WHEN 'SOCIO_ACCIONISTA_TITULAR' THEN 'socio' WHEN 'REPRESENTANTE_LEGAL' THEN 'representante' ELSE 'directivo' END AS via,
                   CASE r.tipo_rol WHEN 'REPRESENTANTE_LEGAL' THEN 0 WHEN 'SOCIO_ACCIONISTA_TITULAR' THEN 1 ELSE 2 END AS p,
                   entidad_visita_claves(v.entidad_visitada) AS claves
              FROM _vt v JOIN empresa_rnp_doc r ON r.doc = v.numero_documento
             WHERE length(v.numero_documento) = 8
            UNION ALL
            SELECT u.ruc, v.id, 'nombre', 3, entidad_visita_claves(v.entidad_visitada)
              FROM _vt v
              JOIN empresa_nombre_unico u ON u.k = razon_norm(v.entidad_visitante)
             WHERE v.tipo_entidad_visitante = 'privada') x
     ORDER BY ruc, visita_id, p;
  DELETE FROM empresa_visita WHERE visita_id >= p_desde AND visita_id < p_hasta;
  INSERT INTO empresa_visita (ruc, visita_id, via, entidad_ruc)
  SELECT v.ruc, v.visita_id, v.via,
         (SELECT c.entidad_ruc FROM empresa_cliente_nombre c WHERE c.ruc = v.ruc AND c.ent_n = ANY (v.claves) LIMIT 1)
    FROM _ev v;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE empresa_rnp_doc OWNER TO vigia_jobs;
    ALTER FUNCTION refrescar_empresa_visitas_preparar() OWNER TO vigia_jobs;
    ALTER FUNCTION refrescar_empresa_visitas_tramo(bigint, bigint) OWNER TO vigia_jobs;
  END IF;
END $$;
