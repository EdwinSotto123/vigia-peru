-- 356 · El resumen de compras de las empresas con muchas órdenes, precalculado.
--
-- La cabecera y los filtros de «Ventas al Estado» de una empresa (GET /compras?proveedor=) se calculaban en vivo en cada
-- visita: es la consulta que más tiempo total gasta la API (pg_stat_statements, 2026-11-17: 40 mil llamadas, 0,7 a 0,9 s
-- de media y hasta 24 s en un proveedor grande, que recorre todas sus órdenes). Las entidades ya lo tienen precalculado
-- (compra_resumen, migración 240).
--
-- Sólo para las empresas con 500 órdenes o más (2 116 empresas, 4 millones de órdenes): son las que tardan. Las demás
-- siguen en vivo, que les toma milisegundos. La consulta es la misma de la API (sqlResumenProveedor en
-- backend/api/src/routes/compras.ts): si una cambia, la otra también.
--
-- Corre después de cada carga de órdenes (cadena de conosce_ordenes). La API usa la fila precalculada si existe.

CREATE TABLE IF NOT EXISTS compra_resumen_proveedor (
  ruc      TEXT NOT NULL,
  clase    TEXT NOT NULL,          -- proceso | catalogo | menor | directa | pago
  anio     INT  NOT NULL,          -- 0: proceso sin fecha de buena pro
  compras  INT  NOT NULL,
  monto    NUMERIC(18, 2) NOT NULL,
  PRIMARY KEY (ruc, clase, anio)
);

CREATE OR REPLACE FUNCTION refrescar_compra_resumen_proveedor(p_minimo int DEFAULT 500) RETURNS integer
LANGUAGE plpgsql SET work_mem = '128MB' AS $$
DECLARE r record; n int := 0;
BEGIN
  CREATE TEMP TABLE _crp (ruc text, clase text, anio int, compras int, monto numeric) ON COMMIT DROP;
  FOR r IN SELECT e.ruc FROM empresa_resumen e WHERE COALESCE(e.ord_n, 0) >= p_minimo AND e.ruc ~ '^20\d{9}$' LOOP
    INSERT INTO _crp (ruc, clase, anio, compras, monto)
    SELECT r.ruc, x.clase, x.anio, count(*)::int, COALESCE(sum(x.monto), 0) FROM (
        SELECT clase_orden(o.tipo_contratacion) AS clase, extract(year FROM o.fecha_emision)::int AS anio,
               CASE WHEN o.monto_dudoso IS NULL AND o.moneda = 'Nuevos Soles' THEN o.monto END AS monto
          FROM (SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision) o.*
                  FROM conosce_ordenes o
                 WHERE o.ruc_contratista = r.ruc
                   AND o.moneda IS NOT NULL AND o.estado IS DISTINCT FROM 'Anulada' AND (o.monto > 0 OR o.monto_dudoso IS NOT NULL)
                   AND o.fecha_emision >= DATE '2018-01-01' AND o.fecha_emision <= current_date + 31 AND o.entidad_ruc ~ '^[0-9]{11}$'
                 ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC) o
         WHERE NOT EXISTS (SELECT 1 FROM compra_vinculo v WHERE v.entidad_ruc = o.entidad_ruc AND v.orden = o.orden AND v.fecha_emision = o.fecha_emision)
        UNION ALL
        SELECT 'catalogo', extract(year FROM p.fecha_publicacion)::int,
               CASE WHEN p.estado NOT IN ('ORDEN DE COMPRA NULA', 'RECHAZADA') THEN p.total END
          FROM perucompras_orden p WHERE p.proveedor_ruc = r.ruc
        UNION ALL
        SELECT 'menor', extract(year FROM m.fecha_suscripcion)::int, m.monto FROM seace_menores m WHERE m.proveedor_ruc = r.ruc AND m.monto > 0
        UNION ALL
        SELECT 'proceso', COALESCE(extract(year FROM max(a.fecha_buenapro))::int, 0),
               sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('PEN', 'Soles', 'SOLES', 'Nuevos Soles'))
          FROM (SELECT * FROM conosce_adjudicaciones WHERE ruc_proveedor = r.ruc
                UNION ALL
                SELECT * FROM conosce_adjudicaciones
                 WHERE ruc_proveedor IN (SELECT ruc_consorcio FROM conosce_consorcios WHERE ruc_miembro = r.ruc)
                   AND ruc_proveedor !~ '^(10|20)[0-9]{9}$') a
         GROUP BY a.codigo_convocatoria, a.entidad_ruc
      ) x WHERE x.anio IS NOT NULL GROUP BY 2, 3;
    n := n + 1;
  END LOOP;
  DELETE FROM compra_resumen_proveedor;
  INSERT INTO compra_resumen_proveedor (ruc, clase, anio, compras, monto) SELECT ruc, clase, anio, compras, monto FROM _crp;
  ANALYZE compra_resumen_proveedor;
  RETURN n;
END $$;

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.compra_resumen_proveedor OWNER TO vigia_jobs;
    ALTER FUNCTION public.refrescar_compra_resumen_proveedor(int) OWNER TO vigia_jobs;
  END IF;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'dev_api', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.compra_resumen_proveedor TO %I', r);
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION refrescar_compra_resumen_proveedor(int) FROM PUBLIC;
