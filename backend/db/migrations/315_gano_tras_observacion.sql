-- 315 · «La entidad le volvió a adjudicar después de un informe de control sobre otro proceso suyo» (2026-11-16).
--
-- La 313 ata cada observación de un informe de control al contrato que nombra. Esa bandera mira hacia atrás: dice lo que
-- la Contraloría encontró en ESE proceso. Ésta mira hacia adelante, que es lo que sirve a quien revisa compras de hoy:
-- cuando un proveedor gana en una entidad DESPUÉS de emitido un informe de control que observó otro proceso que él mismo
-- había ganado ahí, el contrato nuevo lleva la bandera `gano_tras_observacion`, con el informe y el proceso observado.
--
--   refrescar_cruce_gano_tras_observacion()   lee las banderas `observado_por_contraloria` (corre después de la 313) y
--                                             las adjudicaciones de CONOSCE desde 2018, solas o dentro de un consorcio.
--
--   alta   el proceso anterior tiene la bandera en alta (el informe señala responsabilidad penal presunta y la
--          observación es de selección, ejecución o pagos) y la buena pro nueva es de los dos años siguientes al informe;
--   media  esa misma bandera pero más antigua, o el proceso anterior la tiene en media;
--   baja   el proceso anterior la tiene en baja (sólo responsabilidad administrativa).
-- Si hay varios procesos observados antes, va primero el más grave y, entre iguales, el del informe más reciente; el
-- detalle dice cuántos son. El propio proceso observado no se marca.
--
-- Medido en PROD antes de escribirla (CTE de sólo lectura, con 12 mil observaciones leídas de 18 mil): 696 banderas en
-- 613 contratos ganados con RUC propio (158 pares de proveedor y entidad) y 339 en 321 contratos ganados en consorcio;
-- 424 dentro de los dos años de un informe con la bandera en alta; 279 de 2026.
--
-- La responsabilidad que identifica un informe es PRESUNTA y recae en funcionarios y servidores: el informe NO sanciona
-- al proveedor ni le impide contratar. Es un hecho para revisar (¿la entidad corrigió lo observado antes de volver a
-- contratarlo?), no una acusación. El detalle no lleva textos de observaciones, ni nombres ni documentos de personas.

SET lock_timeout = '10s';

CREATE OR REPLACE FUNCTION refrescar_cruce_gano_tras_observacion() RETURNS integer
LANGUAGE plpgsql SET work_mem = '64MB' SET statement_timeout = '600s' AS $$
DECLARE v_filas int;
BEGIN
  -- 1. Los procesos observados de cada proveedor en cada entidad, con la fecha de su informe.
  DROP TABLE IF EXISTS _gto_o;
  CREATE TEMP TABLE _gto_o ON COMMIT DROP AS
    SELECT c.ruc_empresa AS ruc, btrim(cv.entidad_ruc::text) AS entidad, c.ocid, cv.codigo::text AS convocatoria,
           (c.detalle ->> 'emision')::date AS emision, c.detalle,
           CASE c.severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END AS rango
      FROM cruces_proveedor c
      JOIN convocatorias cv ON cv.ocid = c.ocid
     WHERE c.tipo = 'observado_por_contraloria' AND (c.detalle ->> 'emision') ~ '^\d{4}-\d{2}-\d{2}$';
  CREATE INDEX ON _gto_o (ruc, entidad);
  ANALYZE _gto_o;

  DROP TABLE IF EXISTS _gto_p;
  CREATE TEMP TABLE _gto_p ON COMMIT DROP AS
    SELECT ruc, entidad, min(emision) AS emision FROM _gto_o GROUP BY 1, 2;
  ANALYZE _gto_p;

  -- 2. Lo que esa misma entidad le adjudicó después del primer informe, solo o dentro de un consorcio.
  DROP TABLE IF EXISTS _gto_g;
  CREATE TEMP TABLE _gto_g ON COMMIT DROP AS
    SELECT a.codigo_convocatoria::text AS codigo, p.ruc, p.entidad, NULL::text AS consorcio, min(a.fecha_buenapro) AS fecha,
           sum(a.monto_adjudicado) AS monto
      FROM _gto_p p
      JOIN conosce_adjudicaciones a ON a.ruc_proveedor = p.ruc AND a.entidad_ruc = p.entidad
     WHERE a.anio >= 2018 AND a.fecha_buenapro > p.emision AND a.monto_adjudicado > 0
     GROUP BY 1, 2, 3
    UNION ALL
    SELECT a.codigo_convocatoria::text, p.ruc, p.entidad, max(q.consorcio), min(a.fecha_buenapro), sum(a.monto_adjudicado)
      FROM _gto_p p
      JOIN conosce_consorcios q ON q.ruc_miembro = p.ruc AND q.ruc_consorcio !~ '^(10|20)[0-9]{9}$'
      JOIN conosce_adjudicaciones a ON a.ruc_proveedor = q.ruc_consorcio AND a.entidad_ruc = p.entidad
     WHERE a.anio >= 2018 AND a.fecha_buenapro > p.emision AND a.monto_adjudicado > 0
     GROUP BY 1, 2, 3;
  CREATE INDEX ON _gto_g (ruc, entidad);
  ANALYZE _gto_g;

  -- 3. Cada buena pro nueva con el proceso observado ANTES (informe anterior a la buena pro), el más grave primero.
  DELETE FROM cruces_proveedor WHERE tipo = 'gano_tras_observacion';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (c.ocid, g.ruc) 'gano_tras_observacion', g.ruc, c.ocid,
         CASE WHEN k.rango = 0 AND g.fecha - k.emision <= 730 THEN 'alta' WHEN k.rango <= 1 THEN 'media' ELSE 'baja' END,
         g.fecha, g.monto,
         jsonb_build_object(
           'informe_codigo', k.det ->> 'informe_codigo', 'informe_numero', k.det ->> 'informe_numero', 'informe_titulo', k.det ->> 'informe_titulo',
           'informe_entidad', k.det ->> 'informe_entidad', 'informe_entidad_ruc', k.det ->> 'informe_entidad_ruc',
           'emision', to_char(k.emision, 'YYYY-MM-DD'), 'responsabilidades', k.det -> 'responsabilidades', 'url_resumen', k.det ->> 'url_resumen',
           'observacion_n', (k.det ->> 'observacion_n')::int, 'tema', k.det ->> 'tema',
           'perjuicio', (k.det ->> 'perjuicio')::numeric, 'moneda', k.det ->> 'moneda',
           -- El proceso que la Contraloría observó y que este proveedor había ganado en la misma entidad.
           'proceso_observado', k.ocid, 'proceso_observado_nomenclatura', k.det ->> 'nomenclatura', 'via_observado', k.det ->> 'via',
           'dias_despues', g.fecha - k.emision, 'n_procesos_observados', k.n_obs, 'consorcio', g.consorcio),
         'informes_control', coalesce(k.det ->> 'url_resumen', 'https://appbp.contraloria.gob.pe/BuscadorCGR/Informes/Avanzada.html')
    FROM _gto_g g
    JOIN convocatorias c ON c.codigo::text = g.codigo
    JOIN LATERAL (
      SELECT (array_agg(o.detalle ORDER BY o.rango, o.emision DESC, o.ocid))[1] AS det,
             (array_agg(o.ocid ORDER BY o.rango, o.emision DESC, o.ocid))[1] AS ocid,
             (array_agg(o.emision ORDER BY o.rango, o.emision DESC, o.ocid))[1] AS emision,
             min(o.rango) AS rango, count(DISTINCT o.ocid)::int AS n_obs
        FROM _gto_o o
       WHERE o.ruc = g.ruc AND o.entidad = g.entidad AND o.emision < g.fecha AND o.convocatoria <> g.codigo
    ) k ON k.n_obs > 0
   -- El propio proceso observado no: su bandera es la de la 313.
   WHERE NOT EXISTS (SELECT 1 FROM _gto_o x WHERE x.ocid = c.ocid)
   ORDER BY c.ocid, g.ruc, (g.consorcio IS NULL) DESC;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas;
END $$;
ALTER FUNCTION refrescar_cruce_gano_tras_observacion() OWNER TO vigia_jobs;

-- Sólo se crea la función: la bandera se escribe cuando la API y la web ya conocen el tipo (el refresco de cruces del
-- Worker, comun.ts, y el paso `atar` del script de fichas).
