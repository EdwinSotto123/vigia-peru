-- 373: desde cuándo existe una empresa = la fecha MÁS ANTIGUA entre su inscripción en el RUC y su inicio de actividades.
--
-- `empresas.fecha_alta_ruc` guardaba el «inicio de actividades» de la Consulta RUC de la SUNAT, que cambia cuando la
-- empresa reinicia actividades. La fecha de inscripción se guardaba aparte (metadata->>'fecha_inscripcion') y nadie la
-- usaba. Medido el 2026-11-18: 9 998 empresas tenían órdenes del Estado ANTES de su «alta» (mediana: 1 674 días antes); en
-- 1 695 la inscripción era más de un año anterior. Las señales «recién fundada» (cruces) y «empresa recién creada con
-- órdenes directas» (migración 355) leen esa fecha: 764 de los 13 122 casos de la segunda (33 de señal alta) eran dudosos.
--
-- 1. La fecha más antigua de las dos (lo de metadata queda igual, con las dos).
UPDATE empresas e
   SET fecha_alta_ruc = (e.metadata->>'fecha_inscripcion')::date
 WHERE e.metadata->>'fecha_inscripcion' ~ '^\d{4}-\d{2}-\d{2}$'
   AND (e.fecha_alta_ruc IS NULL OR (e.metadata->>'fecha_inscripcion')::date < e.fecha_alta_ruc);

-- 2. «Empresa recién creada con órdenes directas»: además, fuera la empresa que ya le vendía al Estado antes de esa fecha
--    (la fecha no es la de su fundación: un RUC reactivado o reinscrito), como ya hacía la recién fundada desde la
--    migración 212. `primera` de empresa_resumen es su primera venta al Estado (buena pro u orden).
CREATE OR REPLACE FUNCTION refrescar_empresa_recien_creada_ordenes(p_desde date DEFAULT DATE '2019-01-01') RETURNS integer
LANGUAGE plpgsql SET work_mem = '256MB' AS $$
DECLARE n int;
BEGIN
  CREATE TEMP TABLE _rce ON COMMIT DROP AS
    SELECT r.ruc, r.nombre, r.fecha_alta
      FROM empresa_resumen r
     WHERE r.fecha_alta >= p_desde AND r.ruc ~ '^20\d{9}$'
       AND r.nombre !~* '(CONSORCIO|CONSORCIADO|ASOCIACION EN PARTICIPACION|UNION TEMPORAL)'
       AND (r.primera IS NULL OR r.primera >= r.fecha_alta);
  CREATE UNIQUE INDEX ON _rce (ruc); ANALYZE _rce;
  CREATE TEMP TABLE _rco ON COMMIT DROP AS
    SELECT o.entidad_ruc, e.ruc, e.nombre, e.fecha_alta, min(o.fecha_emision) AS primera,
           (count(DISTINCT o.orden) FILTER (WHERE o.fecha_emision <= e.fecha_alta + 365))::int AS ordenes_1a,
           COALESCE(sum(o.monto) FILTER (WHERE o.fecha_emision <= e.fecha_alta + 365), 0) AS monto_1a,
           count(DISTINCT o.orden)::int AS ordenes, sum(o.monto) AS monto
      FROM _rce e JOIN conosce_ordenes o ON o.ruc_contratista = e.ruc
     WHERE o.fecha_emision >= e.fecha_alta AND o.fecha_emision <= current_date
       AND o.estado IS DISTINCT FROM 'Anulada' AND o.moneda = 'Nuevos Soles' AND o.monto > 0 AND o.monto_dudoso IS NULL
       AND (o.tipo_contratacion ILIKE 'Contrataciones hasta%' OR o.tipo_contratacion ILIKE 'Otras contrataciones sin proceso%')
     GROUP BY 1, 2, 3, 4
    HAVING min(o.fecha_emision) - e.fecha_alta <= 90;
  CREATE INDEX ON _rco (ruc); ANALYZE _rco;
  CREATE TEMP TABLE _rct ON COMMIT DROP AS
    SELECT a.ruc, sum(a.monto) AS total FROM empresa_orden_anual a WHERE a.ruc IN (SELECT DISTINCT ruc FROM _rco) GROUP BY 1;
  CREATE UNIQUE INDEX ON _rct (ruc); ANALYZE _rct;

  DELETE FROM empresa_recien_creada_ordenes;
  INSERT INTO empresa_recien_creada_ordenes (entidad_ruc, ruc_empresa, empresa, fecha_alta, primera_orden, dias, ordenes_1a, monto_1a, ordenes, monto,
                                             parte_entidad, severidad)
  SELECT x.entidad_ruc, x.ruc, x.nombre, x.fecha_alta, x.primera, x.dias, x.ordenes_1a, x.monto_1a, x.ordenes, x.monto, x.parte,
         CASE WHEN x.dias <= 30 AND x.monto_1a >= 100000 AND COALESCE(x.parte, 0) >= 0.8 THEN 'alta'
              WHEN (x.dias <= 60 AND x.monto_1a >= 50000) OR COALESCE(x.parte, 0) >= 0.8 THEN 'media'
              ELSE 'baja' END
    FROM (SELECT o.*, (o.primera - o.fecha_alta)::int AS dias, LEAST(1, round(o.monto / NULLIF(t.total, 0), 4)) AS parte
            FROM _rco o LEFT JOIN _rct t ON t.ruc = o.ruc
           WHERE o.monto_1a >= 30000) x;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE empresa_recien_creada_ordenes;
  RETURN n;
END $$;

-- 3. Después (a mano, en este orden): refrescar_empresas() y refrescar_empresa_recien_creada_ordenes(). La recién fundada
--    (cruces) y los casos de cruce los rehace la cadena de cruces del día siguiente.
