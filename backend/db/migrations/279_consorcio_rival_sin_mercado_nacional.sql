-- Socios de consorcio que compiten (migración 278): fuera de la bandera los mercados nacionales de pocas empresas.
--
-- Al mirar los pares en PROD, los primeros eran aseguradoras (cuatro o cinco en todo el país): se asocian en un
-- consorcio para una póliza grande y compiten en las demás, en más de cien entidades. Eso es la forma del mercado, no
-- un reparto. 9 de los 288 pares coinciden en más de 20 entidades y cargaban 1 388 de los 3 133 procesos. Esos pares
-- quedan en `consorcio_rival` con `amplio = true`, para quien investiga, pero ya no ponen la bandera en el contrato.
ALTER TABLE consorcio_rival ADD COLUMN IF NOT EXISTS amplio BOOLEAN GENERATED ALWAYS AS (entidades > 20) STORED;

CREATE OR REPLACE FUNCTION refrescar_cruce_consorcio_rival() RETURNS integer
LANGUAGE plpgsql SET work_mem = '128MB' AS $$
DECLARE v_filas int;
BEGIN
  CREATE TEMP TABLE _cp ON COMMIT DROP AS
    SELECT codigo_convocatoria::text AS codigo, ruc_postor AS ruc, max(postor) AS nombre, max(fecha_convocatoria) AS fecha
      FROM conosce_postores WHERE ruc_postor ~ '^20[0-9]{9}$' AND anio >= 2018 GROUP BY 1, 2;
  CREATE INDEX ON _cp (ruc);
  CREATE INDEX ON _cp (codigo);
  CREATE TEMP TABLE _cn ON COMMIT DROP AS SELECT codigo, count(*) AS postores FROM _cp GROUP BY 1;
  CREATE INDEX ON _cn (codigo);
  CREATE TEMP TABLE _cs ON COMMIT DROP AS
    WITH m AS (SELECT DISTINCT ruc_consorcio, ruc_miembro FROM conosce_consorcios WHERE ruc_miembro ~ '^20[0-9]{9}$')
    SELECT a.ruc_miembro AS a, b.ruc_miembro AS b, count(DISTINCT a.ruc_consorcio) AS consorcios
      FROM m a JOIN m b ON b.ruc_consorcio = a.ruc_consorcio AND a.ruc_miembro < b.ruc_miembro GROUP BY 1, 2;
  -- Cada proceso de pocos postores en que las dos postularon por separado y ganó exactamente una.
  CREATE TEMP TABLE _cx ON COMMIT DROP AS
    SELECT s.a, s.b, s.consorcios, pa.codigo, n.postores, r.entidad_ruc, r.monto, pa.fecha, pa.nombre AS nombre_a, pb.nombre AS nombre_b,
           (s.a = ANY (r.rucs)) AS gano_a
      FROM _cs s JOIN _cp pa ON pa.ruc = s.a JOIN _cp pb ON pb.ruc = s.b AND pb.codigo = pa.codigo
      JOIN _cn n ON n.codigo = pa.codigo JOIN conosce_proceso_resumen r ON r.codigo = pa.codigo
     WHERE n.postores BETWEEN 2 AND 4 AND r.rucs IS NOT NULL AND (s.a = ANY (r.rucs)) <> (s.b = ANY (r.rucs));

  DELETE FROM consorcio_rival;
  INSERT INTO consorcio_rival (ruc_a, ruc_b, nombre_a, nombre_b, consorcios, rivales, solas, gano_a, gano_b, entidades, desde, hasta)
  SELECT x.a, x.b, COALESCE(ea.nombre, max(x.nombre_a)), COALESCE(eb.nombre, max(x.nombre_b)), max(x.consorcios), count(*),
         count(*) FILTER (WHERE x.postores = 2), count(*) FILTER (WHERE x.gano_a), count(*) FILTER (WHERE NOT x.gano_a),
         count(DISTINCT x.entidad_ruc), min(x.fecha), max(x.fecha)
    FROM _cx x LEFT JOIN empresa_resumen ea ON ea.ruc = x.a LEFT JOIN empresa_resumen eb ON eb.ruc = x.b
   GROUP BY x.a, x.b, ea.nombre, eb.nombre HAVING count(*) >= 3;

  DELETE FROM cruces_proveedor WHERE tipo = 'consorcio_rival';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (g.ganador, cv.ocid) 'consorcio_rival', g.ganador, cv.ocid,
         CASE WHEN g.postores = 2 THEN 'alta' ELSE 'media' END, g.fecha, g.monto,
         jsonb_build_object('rival', g.rival, 'ruc_rival', g.ruc_rival, 'consorcios_juntas', g.consorcios, 'veces_rivales', g.rivales,
                            'gano_esta', g.gano_esta, 'gano_la_rival', g.gano_rival, 'entidades', g.entidades,
                            'postores_del_proceso', g.postores, 'solas_las_dos', g.postores = 2),
         'conosce_consorcios', 'https://conosce.osce.gob.pe/buscador/'
    FROM (SELECT CASE WHEN x.gano_a THEN x.a ELSE x.b END AS ganador, CASE WHEN x.gano_a THEN x.b ELSE x.a END AS ruc_rival,
                 CASE WHEN x.gano_a THEN c.nombre_b ELSE c.nombre_a END AS rival, x.codigo, x.entidad_ruc, x.postores, x.fecha, x.monto,
                 c.consorcios, c.rivales, c.entidades, CASE WHEN x.gano_a THEN c.gano_a ELSE c.gano_b END AS gano_esta,
                 CASE WHEN x.gano_a THEN c.gano_b ELSE c.gano_a END AS gano_rival
            FROM _cx x JOIN consorcio_rival c ON c.ruc_a = x.a AND c.ruc_b = x.b
           WHERE NOT c.amplio) g   -- un mercado nacional de pocas empresas no es un reparto local
    JOIN (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
           WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid) cv ON cv.codigo = g.codigo AND cv.entidad_ruc = g.entidad_ruc
   ORDER BY g.ganador, cv.ocid, g.rivales DESC;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas;
END $$;
ALTER FUNCTION refrescar_cruce_consorcio_rival() OWNER TO vigia_jobs;

SELECT refrescar_cruce_consorcio_rival() AS cruces_consorcio_rival;
