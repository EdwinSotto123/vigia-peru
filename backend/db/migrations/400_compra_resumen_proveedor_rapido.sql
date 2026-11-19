-- 400 · El resumen de compras por proveedor (356) a la mitad del tiempo, y siempre igual.
--
-- Medido el 2026-11-19 en las tres empresas con más órdenes: 2,0-2,4 s cada una → 0,85-1,1 s, mismo resultado. Tres
-- cambios, los mismos en la consulta en vivo de la API (sqlResumenProveedor, routes/compras.ts), que debe seguir igual:
--   1. el DISTINCT ON ordena sólo las columnas que usa (con o.* eran 75 mil filas de 516 bytes en la más grande);
--   2. los vínculos de compra se leen por proveedor (índice de la migración 399), no los 1,56 millones;
--   3. desempate fijo: una misma orden que aparece en dos archivos del mismo mes con distinto tipo de contratación se
--      contaba unas veces como «catálogo» y otras como «directa» (los totales cuadraban; el reparto cambiaba entre dos
--      consultas seguidas). Ahora gana el tipo en orden alfabético y, a igual tipo, el monto mayor, en todas las consultas.
--
-- Cómo aplicarla: después de la 399. Luego SELECT refrescar_compra_resumen_proveedor() (o esperar la próxima carga).

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
          FROM (SELECT DISTINCT ON (o.entidad_ruc, o.orden, o.fecha_emision)
                       o.entidad_ruc, o.orden, o.fecha_emision, o.tipo_contratacion, o.monto, o.monto_dudoso, o.moneda
                  FROM conosce_ordenes o
                 WHERE o.ruc_contratista = r.ruc
                   AND o.moneda IS NOT NULL AND o.estado IS DISTINCT FROM 'Anulada' AND (o.monto > 0 OR o.monto_dudoso IS NOT NULL)
                   AND o.fecha_emision >= DATE '2018-01-01' AND o.fecha_emision <= current_date + 31 AND o.entidad_ruc ~ '^[0-9]{11}$'
                 ORDER BY o.entidad_ruc, o.orden, o.fecha_emision, o.anio DESC, o.mes DESC, o.tipo_contratacion, o.monto DESC) o
         WHERE NOT EXISTS (SELECT 1 FROM compra_vinculo v
                            WHERE v.proveedor_ruc = r.ruc AND v.entidad_ruc = o.entidad_ruc AND v.orden = o.orden AND v.fecha_emision = o.fecha_emision)
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
