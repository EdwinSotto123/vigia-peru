-- 380: «ola de personas nuevas al cierre de una gestión»: los gobiernos locales y regionales que, entre la elección y el
-- cambio de mando, dieron órdenes a muchas más personas naturales NUEVAS para la entidad que un año antes.
--
-- Por qué: una gestión que se va puede pagar favores de campaña con órdenes de servicio a personas que nunca habían
-- trabajado para la entidad. La historia de cada entidad ya marca el «cierre de gestión» por el número de órdenes
-- (api/lib/historia.ts); esto mira a QUIÉN: personas sin ninguna orden de la entidad desde 2018 antes del periodo.
--
-- Guardas (medido el 2026-11-18 sobre el cierre de 2022): sin ellas el ranking lo llenaban entidades que en el año base
-- no publicaban órdenes a personas (Tacna, Chorrillos: 0 personas en 2021). Por eso:
--   · el año base tiene órdenes a personas los tres meses y al menos 20 personas;
--   · el periodo tiene órdenes los tres meses;
--   · 20 personas nuevas o más, y al menos el triple de las nuevas del año base (con un piso de 5);
--   · y al menos 1,5 veces las nuevas de las mismas fechas un año DESPUÉS, con la gestión nueva (si esos meses tienen
--     datos): sin esto salían sobre todo las UGEL, cuyo año base (2021) fue de clases a distancia.
-- Alta: cinco veces o más y 50 personas nuevas o más; media: lo demás que pasa las guardas.
--
-- Sólo cuentas por entidad: ninguna persona sale con nombre ni RUC. Para ver las órdenes: /ordenes/ventana y la lista de
-- órdenes del periodo (personas con un apellido tapado).
--
-- No sirve todavía para 2026: en 2026 publican sus órdenes en CONOSCE cada vez menos entidades (ver DATOS_Y_SENALES.md,
-- 17.3); la función es por elección para repetirla cuando los datos estén completos.

DROP TABLE IF EXISTS cierre_gestion_personas;
CREATE TABLE cierre_gestion_personas (
  eleccion            date    NOT NULL,   -- el día de la elección
  cambio              date    NOT NULL,   -- el día en que asume la gestión nueva
  entidad_ruc         text    NOT NULL,
  personas            int     NOT NULL,   -- personas naturales (RUC 10) con órdenes en el periodo
  personas_nuevas     int     NOT NULL,   -- de ellas, sin órdenes de la entidad desde 2018 antes del periodo
  ordenes_nuevas      int     NOT NULL,
  monto_nuevas        numeric NOT NULL,   -- en soles, sin montos dudosos
  personas_base       int     NOT NULL,   -- lo mismo, las mismas fechas un año antes
  personas_nuevas_base int    NOT NULL,
  personas_nuevas_despues int,              -- las mismas fechas un año después (NULL: sin datos esos meses)
  severidad           text    NOT NULL,
  calculado_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (eleccion, entidad_ruc)
);
GRANT SELECT ON cierre_gestion_personas TO vigia_api, vigia_api_admin;
COMMENT ON TABLE cierre_gestion_personas IS 'Gobiernos locales y regionales con una ola de personas naturales nuevas (órdenes) entre la elección y el cambio de mando, frente al año anterior. Migración 380.';

CREATE OR REPLACE FUNCTION refrescar_cierre_gestion_personas(p_eleccion date, p_cambio date) RETURNS integer
LANGUAGE plpgsql SET work_mem = '128MB' AS $$
DECLARE
  v_d  date := p_eleccion + 1;           -- desde el día siguiente a la elección
  v_h  date := p_cambio - 1;             -- hasta el día anterior al cambio
  v_bd date := (v_d - interval '1 year')::date;
  v_bh date := (v_h - interval '1 year')::date;
  v_ad date := (v_d + interval '1 year')::date;
  v_ah date := (v_h + interval '1 year')::date;
  n int;
BEGIN
  CREATE TEMP TABLE _cgp_o ON COMMIT DROP AS
    SELECT o.entidad_ruc AS e, o.ruc_contratista AS p, (CASE WHEN o.fecha_emision < v_d THEN -1 WHEN o.fecha_emision > v_h THEN 1 ELSE 0 END) AS periodo,
           count(DISTINCT (o.orden, o.fecha_emision))::int AS ordenes,
           COALESCE(sum(o.monto) FILTER (WHERE o.moneda = 'Nuevos Soles' AND o.monto_dudoso IS NULL), 0) AS monto,
           count(DISTINCT date_trunc('month', o.fecha_emision))::int AS meses
      FROM conosce_ordenes o
      JOIN (SELECT DISTINCT ruc FROM entidad_gobierno_amplia WHERE nivel IN ('distrital', 'provincial', 'regional')) g ON g.ruc = o.entidad_ruc
     WHERE o.ruc_contratista ~ '^10[0-9]{9}$' AND o.estado IS DISTINCT FROM 'Anulada' AND (o.monto > 0 OR o.monto_dudoso IS NOT NULL)
       AND ((o.fecha_emision BETWEEN v_d AND v_h) OR (o.fecha_emision BETWEEN v_bd AND v_bh) OR (o.fecha_emision BETWEEN v_ad AND v_ah))
     GROUP BY 1, 2, 3;
  ANALYZE _cgp_o;
  -- Nueva: sin ninguna orden de esa entidad desde 2018 antes del comienzo de su periodo (índice entidad, proveedor, fecha).
  CREATE TEMP TABLE _cgp_n ON COMMIT DROP AS
    SELECT x.*, NOT EXISTS (SELECT 1 FROM conosce_ordenes q WHERE q.entidad_ruc = x.e AND q.ruc_contratista = x.p
                               AND q.fecha_emision >= DATE '2018-01-01'
                               AND q.fecha_emision < CASE x.periodo WHEN -1 THEN v_bd WHEN 1 THEN v_ad ELSE v_d END) AS nueva
      FROM _cgp_o x;
  -- Los meses con órdenes a personas de cada entidad en cada periodo (de todas sus personas).
  CREATE TEMP TABLE _cgp_m ON COMMIT DROP AS
    SELECT o.entidad_ruc AS e, (CASE WHEN o.fecha_emision < v_d THEN -1 WHEN o.fecha_emision > v_h THEN 1 ELSE 0 END) AS periodo,
           count(DISTINCT date_trunc('month', o.fecha_emision))::int AS meses
      FROM conosce_ordenes o
     WHERE o.entidad_ruc IN (SELECT DISTINCT e FROM _cgp_o) AND o.ruc_contratista ~ '^10[0-9]{9}$'
       AND ((o.fecha_emision BETWEEN v_d AND v_h) OR (o.fecha_emision BETWEEN v_bd AND v_bh) OR (o.fecha_emision BETWEEN v_ad AND v_ah))
     GROUP BY 1, 2;

  DELETE FROM cierre_gestion_personas WHERE eleccion = p_eleccion;
  INSERT INTO cierre_gestion_personas (eleccion, cambio, entidad_ruc, personas, personas_nuevas, ordenes_nuevas, monto_nuevas,
                                       personas_base, personas_nuevas_base, personas_nuevas_despues, severidad)
  SELECT p_eleccion, p_cambio, a.e, a.personas, a.nuevas, a.ordenes_nuevas, a.monto_nuevas, b.personas, b.nuevas,
         CASE WHEN md.meses >= 3 THEN COALESCE(d.nuevas, 0) END,
         CASE WHEN a.nuevas >= 5 * GREATEST(b.nuevas, 5) AND a.nuevas >= 50 THEN 'alta' ELSE 'media' END
    FROM (SELECT e, count(*)::int AS personas, (count(*) FILTER (WHERE nueva))::int AS nuevas,
                 COALESCE(sum(ordenes) FILTER (WHERE nueva), 0)::int AS ordenes_nuevas, COALESCE(sum(monto) FILTER (WHERE nueva), 0) AS monto_nuevas
            FROM _cgp_n WHERE periodo = 0 GROUP BY e) a
    JOIN (SELECT e, count(*)::int AS personas, (count(*) FILTER (WHERE nueva))::int AS nuevas FROM _cgp_n WHERE periodo = -1 GROUP BY e) b ON b.e = a.e
    LEFT JOIN (SELECT e, (count(*) FILTER (WHERE nueva))::int AS nuevas FROM _cgp_n WHERE periodo = 1 GROUP BY e) d ON d.e = a.e
    JOIN _cgp_m ma ON ma.e = a.e AND ma.periodo = 0
    JOIN _cgp_m mb ON mb.e = a.e AND mb.periodo = -1
    LEFT JOIN _cgp_m md ON md.e = a.e AND md.periodo = 1
   WHERE ma.meses >= 3 AND mb.meses >= 3 AND b.personas >= 20
     AND a.nuevas >= 20 AND a.nuevas >= 3 * GREATEST(b.nuevas, 5)
     AND (md.meses IS NULL OR md.meses < 3 OR a.nuevas >= 1.5 * COALESCE(d.nuevas, 0));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
COMMENT ON FUNCTION refrescar_cierre_gestion_personas(date, date) IS 'Rehace cierre_gestion_personas para una elección (p. ej. 2022-10-02, 2023-01-01). Migración 380.';
