-- La misma persona gana en la misma entidad con OTRA empresa (cruce `mismo_dueno`, 2026-11-15).
--
-- La concentración de un proveedor se mide por RUC (`recurrente`, `proveedor_cautivo`). Pero una persona puede repartir
-- sus ventas a una entidad entre varias razones sociales: cada una queda bajo el radar, no llega a los topes que obligan
-- a un procedimiento mayor y, si una es sancionada, sigue otra. `socio_comun` sólo mira a dos postores del MISMO proceso;
-- esto mira procesos distintos de la misma entidad.
--
-- Red: rnp_conformacion_juridica, sólo SOCIOS (accionistas o titulares) de las dos empresas, por documento, y sólo
-- personas socias de 2 a 6 empresas. Con directores y representantes salían los grupos empresariales conocidos
-- (laboratorios, navieras), que comparten directorio: 10 613 cruces, demasiado ruido. Ganadores: conosce_adjudicaciones.
--
--   alta   la otra empresa del mismo dueño ganó en la misma entidad un objeto PARECIDO (trigramas ≥ 0,45) con 90 días o
--          menos de diferencia: el mismo negocio repartido entre dos razones sociales;
--   media  objeto parecido con hasta 12 meses de diferencia.
-- Sin objeto parecido no se marca. Una bandera por contrato (el socio que une a más empresas).
--
-- Medido antes de escribirla: 4 913 pares (entidad, ganador) con una empresa hermana que también ganó ahí desde 2023,
-- de 1 824 personas en 908 entidades. Un grupo familiar legítimo también sale: es un hecho para mirar, no una falta.

CREATE OR REPLACE FUNCTION refrescar_cruce_mismo_dueno() RETURNS integer
LANGUAGE plpgsql SET work_mem = '128MB' SET statement_timeout = '300s' AS $$
DECLARE v_filas int;
BEGIN
  DROP TABLE IF EXISTS _md_g;
  CREATE TEMP TABLE _md_g ON COMMIT DROP AS
    SELECT a.entidad_ruc, a.codigo_convocatoria::text AS codigo, a.ruc_proveedor AS ruc, min(a.fecha_buenapro) AS fecha,
           sum(a.monto_adjudicado) AS monto, lower(left(max(a.descripcion_proceso), 300)) AS objeto
      FROM conosce_adjudicaciones a
     WHERE a.anio >= 2023 AND a.ruc_proveedor ~ '^20[0-9]{9}$' AND a.monto_adjudicado > 0 AND a.fecha_buenapro IS NOT NULL AND a.entidad_ruc IS NOT NULL
     GROUP BY 1, 2, 3;
  CREATE INDEX ON _md_g (entidad_ruc, ruc);
  ANALYZE _md_g;

  DROP TABLE IF EXISTS _md_rp;
  CREATE TEMP TABLE _md_rp ON COMMIT DROP AS
    SELECT r.ruc_empresa AS ruc, r.numero_documento AS doc,
           -- Una sucesión figura con dos nombres completos («SUCESION … REPRESENTADA POR …»): no se guarda.
           CASE WHEN max(r.nombre) ~* 'SUCESI|REPRESENTAD|VIUDA DE|HEREDER|INDIVISA' THEN 'Sucesión (nombre reservado)' ELSE max(r.nombre) END AS nombre, string_agg(DISTINCT r.tipo_rol, ', ' ORDER BY r.tipo_rol) AS rol
      FROM rnp_conformacion_juridica r
     WHERE r.tipo_documento LIKE 'DOC. NACIONAL%' AND r.tipo_rol = 'SOCIO_ACCIONISTA_TITULAR'
       AND r.numero_documento IN (SELECT numero_documento FROM rnp_conformacion_juridica
                                   WHERE tipo_documento LIKE 'DOC. NACIONAL%' AND tipo_rol = 'SOCIO_ACCIONISTA_TITULAR'
                                   GROUP BY 1 HAVING count(DISTINCT ruc_empresa) BETWEEN 2 AND 6)
       AND r.ruc_empresa IN (SELECT ruc FROM _md_g)
     GROUP BY 1, 2;
  CREATE INDEX ON _md_rp (doc);
  CREATE INDEX ON _md_rp (ruc);
  ANALYZE _md_rp;

  -- Primero las empresas hermanas por entidad (unas 8 000 filas) y sólo después sus adjudicaciones. Cruzar de frente las
  -- adjudicaciones de cada entidad entre sí, sin estadísticas de las tablas temporales, llenó el disco temporal de
  -- producción el 2026-11-15: por eso el ANALYZE de cada tabla y este orden.
  DROP TABLE IF EXISTS _md_h;
  CREATE TEMP TABLE _md_h ON COMMIT DROP AS
    SELECT a.entidad_ruc, a.ruc, pb.ruc AS otra, pa.doc, pa.nombre, pa.rol
      FROM (SELECT DISTINCT entidad_ruc, ruc FROM _md_g) a
      JOIN _md_rp pa ON pa.ruc = a.ruc
      JOIN _md_rp pb ON pb.doc = pa.doc AND pb.ruc <> a.ruc
     WHERE EXISTS (SELECT 1 FROM _md_g b WHERE b.entidad_ruc = a.entidad_ruc AND b.ruc = pb.ruc);
  CREATE INDEX ON _md_h (entidad_ruc, ruc);
  ANALYZE _md_h;

  -- Cada adjudicación con las de sus empresas hermanas en la misma entidad, a 24 meses o menos.
  DROP TABLE IF EXISTS _md_par;
  CREATE TEMP TABLE _md_par ON COMMIT DROP AS
    SELECT a.entidad_ruc, a.codigo, a.ruc, a.fecha, a.monto, h.doc, h.nombre, h.rol,
           b.ruc AS otra, b.codigo AS otro_codigo, b.fecha AS otra_fecha, b.monto AS otro_monto,
           (abs(b.fecha - a.fecha) <= 365 AND similarity(a.objeto, b.objeto) >= 0.45) AS parecido,
           (abs(b.fecha - a.fecha) <= 90 AND similarity(a.objeto, b.objeto) >= 0.45) AS seguido
      FROM _md_h h
      JOIN _md_g a ON a.entidad_ruc = h.entidad_ruc AND a.ruc = h.ruc
      JOIN _md_g b ON b.entidad_ruc = h.entidad_ruc AND b.ruc = h.otra AND abs(b.fecha - a.fecha) <= 730 AND b.codigo <> a.codigo;
  CREATE INDEX ON _md_par (entidad_ruc, codigo, ruc, doc);
  ANALYZE _md_par;

  -- Por adjudicación y persona: cada empresa hermana con lo que ganó ahí (una fila de _md_par es ya un proceso distinto).
  DROP TABLE IF EXISTS _md_otra;
  CREATE TEMP TABLE _md_otra ON COMMIT DROP AS
    SELECT p.entidad_ruc, p.codigo, p.ruc, p.doc, p.otra, count(*) AS n, sum(p.otro_monto) AS m,
           row_number() OVER (PARTITION BY p.entidad_ruc, p.codigo, p.ruc, p.doc ORDER BY sum(p.otro_monto) DESC) AS puesto
      FROM _md_par p GROUP BY 1, 2, 3, 4, 5;

  DELETE FROM cruces_proveedor WHERE tipo = 'mismo_dueno';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, persona_doc, persona_nombre, persona_rol, detalle, fuente, fuente_url)
  SELECT DISTINCT ON (c.ocid, x.ruc) 'mismo_dueno', x.ruc, c.ocid, CASE WHEN x.seguidos > 0 THEN 'alta' ELSE 'media' END, x.fecha, x.monto, x.doc, x.nombre, x.rol,
         jsonb_build_object('otras_empresas', o.otras, 'n_otras', x.n_otras, 'procesos_de_las_otras', x.procesos, 'monto_de_las_otras', round(x.monto_otras, 2),
                            'objeto_parecido', x.parecidos > 0, 'dias_de_diferencia', abs(x.fecha_parecido - x.fecha),
                            'ocid_parecido', CASE WHEN x.parecidos > 0 THEN (SELECT c2.ocid FROM convocatorias c2 WHERE c2.codigo::text = x.codigo_parecido LIMIT 1) END,
                            'fecha_parecido', CASE WHEN x.parecidos > 0 THEN to_char(x.fecha_parecido, 'YYYY-MM-DD') END, 'meses', 24),
         'rnp_conformacion_juridica', 'https://www.datosabiertos.gob.pe/'
    FROM (
      SELECT p.entidad_ruc, p.codigo, p.ruc, p.doc, max(p.nombre) AS nombre, max(p.rol) AS rol, max(p.fecha) AS fecha, max(p.monto) AS monto,
             count(DISTINCT p.otra) AS n_otras, count(*) AS procesos, sum(p.otro_monto) AS monto_otras,
             count(*) FILTER (WHERE p.parecido) AS parecidos, count(*) FILTER (WHERE p.seguido) AS seguidos,
             (array_agg(p.otro_codigo ORDER BY p.parecido DESC, abs(p.otra_fecha - p.fecha)))[1] AS codigo_parecido,
             (array_agg(p.otra_fecha ORDER BY p.parecido DESC, abs(p.otra_fecha - p.fecha)))[1] AS fecha_parecido
        FROM _md_par p
       GROUP BY p.entidad_ruc, p.codigo, p.ruc, p.doc
    ) x
    JOIN (SELECT t.entidad_ruc, t.codigo, t.ruc, t.doc,
                 jsonb_agg(jsonb_build_object('ruc', t.otra, 'nombre', e.razon_social, 'procesos', t.n, 'monto', round(t.m, 2)) ORDER BY t.puesto) AS otras
            FROM _md_otra t LEFT JOIN empresas e ON e.ruc = t.otra WHERE t.puesto <= 5 GROUP BY 1, 2, 3, 4) o
      ON o.entidad_ruc = x.entidad_ruc AND o.codigo = x.codigo AND o.ruc = x.ruc AND o.doc = x.doc
    JOIN convocatorias c ON c.codigo::text = x.codigo
   WHERE x.parecidos > 0
   ORDER BY c.ocid, x.ruc, x.seguidos DESC, x.n_otras DESC, x.monto_otras DESC;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas;
END $$;
ALTER FUNCTION refrescar_cruce_mismo_dueno() OWNER TO vigia_jobs;

-- Con el plan correcto tarda segundos: si pasa de 3 minutos, algo anda mal y se corta antes de llenar el disco temporal.
SET statement_timeout = '180s';
SELECT refrescar_cruce_mismo_dueno() AS mismo_dueno;
RESET statement_timeout;
