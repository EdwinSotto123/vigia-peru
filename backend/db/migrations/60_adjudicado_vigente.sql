-- 60 · Monto adjudicado VIGENTE por proceso, y las alertas con ese monto.
--
-- El OCDS trae a veces varias adjudicaciones sobre los mismos ítems: la buena pro original y la que la reemplazó, o
-- todas las de los calificados. El análisis guardaba en `alertas.monto_adjudicado` la suma de todas, y las listas
-- (Señales, Entidades, Inicio) mostraban, p. ej., 1228396 en S/ 3,8 M cuando se contrató por S/ 2,28 M. La ficha del
-- contrato ya aplicaba la regla (backend/api/src/routes/contratos_detalle.ts, `adjudicacionesVigentes`); esta
-- migración la lleva a la base para que todo lo demás diga lo mismo.
--
-- Regla, por adjudicación x de un proceso (K = proveedores que CONOSCE registra para el proceso):
--   · si no se pisa con otra (ítems distintos): vigente;
--   · si su proveedor está en K: vigente (si K tiene a varios en el mismo ítem, es un reparto y quedan todos);
--   · si nadie de su grupo está en K: es un reparto (todas vigentes) cuando juntas no pasan el referencial de esos
--     ítems + 10 %; si lo pasan, son alternativas y queda la primera del registro.
--
--   adjudicado_vigente   (ocid, monto, n_vigentes, n_reemplazadas): sólo procesos con alguna adjudicación reemplazada.
--   alertas.monto_adjudicado_ocds   el monto que había guardado el análisis (se conserva la primera vez que se corrige).
--
-- `refrescar_adjudicado_vigente()` rehace la tabla y corrige las alertas; corre en `refrescar_casos_cruce()`.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/60_adjudicado_vigente.sql

CREATE TABLE IF NOT EXISTS adjudicado_vigente (
  ocid            TEXT PRIMARY KEY,
  monto           NUMERIC(18, 2) NOT NULL,
  n_vigentes      INT NOT NULL,
  n_reemplazadas  INT NOT NULL
);
ALTER TABLE adjudicado_vigente OWNER TO vigia_jobs;
GRANT SELECT ON adjudicado_vigente TO vigia_api;

ALTER TABLE alertas ADD COLUMN IF NOT EXISTS monto_adjudicado_ocds NUMERIC(18, 2);
COMMENT ON COLUMN alertas.monto_adjudicado_ocds IS
  'Monto adjudicado que guardó el análisis (suma de todas las adjudicaciones del OCDS), antes de corregirlo a las vigentes (migración 60).';

-- SECURITY DEFINER (dueño: el de `alertas`): el UPDATE dispara los triggers de derivados de `alertas`, que escriben en
-- tablas a las que vigia_jobs (quien llama, desde vigia-scrapers) no tiene acceso. La función sólo hace esto.
CREATE OR REPLACE FUNCTION refrescar_adjudicado_vigente() RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n INT;
BEGIN
  DROP TABLE IF EXISTS _av_aw;
  CREATE TEMP TABLE _av_aw ON COMMIT DROP AS
    SELECT c.ocid, c.codigo, a.pos, regexp_replace(a.aw->'suppliers'->0->>'id', '^PE-RUC-', '') AS ruc,
           COALESCE((a.aw->'value'->>'amount')::numeric, 0) AS monto,
           ARRAY(SELECT i->>'id' FROM jsonb_array_elements(COALESCE(a.aw->'items', '[]'::jsonb)) i) AS items
    FROM convocatorias c, jsonb_array_elements(c.ocds_payload->'awards') WITH ORDINALITY AS a(aw, pos)
    WHERE c.ocid NOT LIKE 'ocds-vigia-%' AND jsonb_array_length(COALESCE(c.ocds_payload->'awards', '[]'::jsonb)) > 1;
  CREATE INDEX ON _av_aw (ocid);
  ANALYZE _av_aw;

  DELETE FROM adjudicado_vigente;
  INSERT INTO adjudicado_vigente (ocid, monto, n_vigentes, n_reemplazadas)
  SELECT ocid, sum(monto) FILTER (WHERE vigente), count(*) FILTER (WHERE vigente), count(*) FILTER (WHERE NOT vigente)
  FROM (
    SELECT x.ocid, x.monto,
           CASE
             WHEN g.n_conflictos = 0 THEN true
             WHEN x.ruc IN (SELECT k.ruc_proveedor FROM conosce_adjudicaciones k WHERE k.codigo_convocatoria = x.codigo) THEN true
             WHEN g.alguno_en_k THEN false
             WHEN g.ref > 0 AND g.suma <= g.ref * 1.1 THEN true
             ELSE x.pos = g.primera
           END AS vigente
    FROM _av_aw x
    CROSS JOIN LATERAL (
      -- El grupo de x: x y las adjudicaciones del mismo proceso que comparten algún ítem con ella.
      SELECT count(*) FILTER (WHERE y.pos <> x.pos) AS n_conflictos,
             bool_or(y.ruc IN (SELECT k.ruc_proveedor FROM conosce_adjudicaciones k WHERE k.codigo_convocatoria = x.codigo)) AS alguno_en_k,
             sum(y.monto) AS suma, min(y.pos) AS primera,
             (SELECT COALESCE(sum((ti->'totalValue'->>'amount')::numeric), 0)
                FROM convocatorias c, jsonb_array_elements(COALESCE(c.ocds_payload->'tender'->'items', '[]'::jsonb)) ti
               WHERE c.ocid = x.ocid AND ti->>'id' = ANY (SELECT unnest(y2.items) FROM _av_aw y2 WHERE y2.ocid = x.ocid AND (y2.pos = x.pos OR y2.items && x.items))) AS ref
      FROM _av_aw y WHERE y.ocid = x.ocid AND (y.pos = x.pos OR y.items && x.items)
    ) g
  ) v
  GROUP BY ocid
  HAVING count(*) FILTER (WHERE NOT vigente) > 0;
  ANALYZE adjudicado_vigente;

  -- Las alertas de esos procesos, con el monto vigente (se guarda el original la primera vez).
  UPDATE alertas a
     SET monto_adjudicado_ocds = COALESCE(a.monto_adjudicado_ocds, a.monto_adjudicado),
         monto_adjudicado = av.monto
    FROM adjudicado_vigente av
   WHERE ocid_corto(av.ocid) = ocid_corto(a.ocid) AND a.monto_adjudicado IS DISTINCT FROM av.monto;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION refrescar_adjudicado_vigente() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refrescar_adjudicado_vigente() TO vigia_jobs;

-- El envoltorio de la migración 59, con este refresco también.
CREATE OR REPLACE FUNCTION refrescar_casos_cruce() RETURNS INT
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refrescar_contrato_partido();
  PERFORM refrescar_cruce_otro_postor();
  PERFORM refrescar_adjudicado_vigente();
  RETURN refrescar_casos_cruce_base();
END $$;
ALTER FUNCTION refrescar_casos_cruce() OWNER TO vigia_jobs;

SELECT refrescar_adjudicado_vigente() AS alertas_corregidas;
