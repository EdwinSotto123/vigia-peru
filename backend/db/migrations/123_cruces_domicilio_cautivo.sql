-- 123 · Dos banderas nuevas del contrato: "mismo domicilio que otro postor" y "proveedor cautivo".
--
-- Cruces del contrato (cruces_proveedor), funciones separadas como unico_postor/socio_en_entidad: corren en el pipeline
-- (comun.ts) después de refrescar_cruces y antes de casos_cruce_base, y sobreviven a la reconstrucción.
--
-- (Se evaluó una "puerta giratoria ampliada" —socio = autoridad electa— pero YA la cubre el cruce `autoridad`
--  (migración 115); y "socio contratado en OTRA entidad" es señal débil/ruidosa. Por eso sólo van estas dos.)
--
-- 1) domicilio_compartido: el ganador comparte su DOMICILIO FISCAL de la SUNAT con OTRO postor del mismo proceso (OCDS
--    tender.tenderers): posible competencia aparente o empresas vinculadas. Se excluyen domicilios únicos y los muy
--    poblados (>5 empresas: centros de oficinas), para no inflar. alta si en la dirección hay exactamente 2 empresas
--    (más sospechoso), media si 3-5. Sólo procesos ≥ 8 UIT (44,000).
-- 2) proveedor_cautivo: la empresa recibe la gran mayoría de lo que le compra el Estado de UNA sola entidad (≥90% alta...
--    en realidad media; 75-90% baja): dependencia fuerte. Distinto de recurrente_dominante (ese mide la parte del gasto
--    DE LA ENTIDAD; cautivo mide la parte del ingreso DEL PROVEEDOR). Con piso (total ≥ 200k y ≥ 3 procesos) para que no
--    entre la empresa de un solo contrato. Se pega a cada contrato que la empresa le ganó a esa entidad dominante.

-- ── 1) Mismo domicilio que otro postor ──
CREATE OR REPLACE FUNCTION refrescar_cruce_domicilio_compartido() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  DELETE FROM cruces_proveedor WHERE tipo = 'domicilio_compartido';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  -- Eficiencia: se parte de los GANADORES que ya tienen domicilio compartido (un subconjunto chico) y sólo para SUS
  -- procesos se abren los postores del OCDS; abrir los tenderers de los 750k procesos sería inviable.
  WITH dom AS (
    SELECT domicilio_fiscal, count(*) AS n_empresas
      FROM empresas WHERE ruc LIKE '20%' AND domicilio_fiscal IS NOT NULL AND length(domicilio_fiscal) > 12
      GROUP BY 1 HAVING count(*) BETWEEN 2 AND 5
  ), emp AS (
    SELECT e.ruc, e.domicilio_fiscal, d.n_empresas
      FROM empresas e JOIN dom d ON d.domicilio_fiscal = e.domicilio_fiscal WHERE e.ruc LIKE '20%'
  ), win AS (
    SELECT a.codigo_convocatoria AS codigo, a.ruc_proveedor AS ruc, ew.domicilio_fiscal, ew.n_empresas,
           max(a.fecha_buenapro) AS f,
           sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS monto
      FROM conosce_adjudicaciones a
      JOIN emp ew ON ew.ruc = a.ruc_proveedor
     GROUP BY 1, 2, 3, 4
  ), cv AS (
    SELECT DISTINCT ON (c.codigo) c.codigo, c.ocid, c.ocds_payload
      FROM convocatorias c
     WHERE c.ocid NOT LIKE 'ocds-vigia-%' AND c.codigo IN (SELECT codigo FROM win)
       AND jsonb_typeof(c.ocds_payload->'tender'->'tenderers') = 'array'
     ORDER BY c.codigo, c.ocid
  ), hit AS (
    SELECT cv.ocid, w.ruc, w.n_empresas, w.f, w.monto,
           (SELECT count(DISTINCT regexp_replace(t->>'id', '^PE-RUC-', ''))
              FROM jsonb_array_elements(cv.ocds_payload->'tender'->'tenderers') t
              JOIN emp e2 ON e2.ruc = regexp_replace(t->>'id', '^PE-RUC-', '')
             WHERE e2.domicilio_fiscal = w.domicilio_fiscal AND e2.ruc <> w.ruc) AS otros
      FROM win w JOIN cv ON cv.codigo = w.codigo
     WHERE w.f IS NOT NULL AND w.monto >= 44000
  )
  SELECT 'domicilio_compartido', hit.ruc, hit.ocid,
         CASE WHEN hit.n_empresas = 2 THEN 'alta' ELSE 'media' END,
         hit.f, hit.monto,
         jsonb_build_object('empresas_en_domicilio', hit.n_empresas, 'otros_postores', hit.otros),
         'sunat', 'https://e-consultaruc.sunat.gob.pe/'
    FROM hit WHERE hit.otros > 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_cruce_domicilio_compartido() OWNER TO vigia_jobs;

-- ── 2) Proveedor cautivo ──
CREATE OR REPLACE FUNCTION refrescar_cruce_proveedor_cautivo() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  DELETE FROM cruces_proveedor WHERE tipo = 'proveedor_cautivo';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  WITH pe AS (
    SELECT a.ruc_proveedor AS ruc, a.entidad_ruc, max(a.entidad) AS entidad,
           sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS m,
           count(DISTINCT a.codigo_convocatoria) AS proc
      FROM conosce_adjudicaciones a WHERE a.ruc_proveedor ~ '^20[0-9]{9}$'
     GROUP BY 1, 2
  ), tot AS (
    SELECT ruc, sum(m) AS total, sum(proc) AS procs FROM pe GROUP BY 1
  ), cautivo AS (
    -- La entidad dominante de la empresa, si concentra ≥75% de su ingreso del Estado (con piso para no contar a la de un
    -- solo contrato).
    SELECT DISTINCT ON (pe.ruc) pe.ruc, pe.entidad_ruc, pe.entidad, t.total, t.procs,
           round(pe.m / NULLIF(t.total, 0), 4) AS parte
      FROM pe JOIN tot t ON t.ruc = pe.ruc
     WHERE t.total >= 200000 AND t.procs >= 3
     ORDER BY pe.ruc, pe.m DESC
  ), c AS (
    SELECT cv.ocid, a.ruc_proveedor AS ruc, a.entidad_ruc, max(a.fecha_buenapro) AS f,
           sum(a.monto_adjudicado) FILTER (WHERE a.moneda IN ('Soles', 'Nuevos Soles')) AS monto
      FROM conosce_adjudicaciones a
      JOIN (SELECT DISTINCT ON (codigo, entidad_ruc) codigo, entidad_ruc, ocid FROM convocatorias
             WHERE ocid NOT LIKE 'ocds-vigia-%' ORDER BY codigo, entidad_ruc, ocid) cv
        ON cv.codigo = a.codigo_convocatoria AND cv.entidad_ruc = a.entidad_ruc
     WHERE a.ruc_proveedor ~ '^20[0-9]{9}$'
       AND (a.ruc_proveedor, a.entidad_ruc) IN (SELECT ruc, entidad_ruc FROM cautivo WHERE parte >= 0.75)
     GROUP BY cv.ocid, a.ruc_proveedor, a.entidad_ruc
  )
  SELECT 'proveedor_cautivo', c.ruc, c.ocid,
         CASE WHEN cv.parte >= 0.9 THEN 'media' ELSE 'baja' END,
         c.f, c.monto,
         jsonb_build_object('entidad', cv.entidad, 'parte', cv.parte, 'total_empresa', round(cv.total, 2), 'procesos', cv.procs),
         'conosce_adjudicaciones', 'https://conosce.osce.gob.pe/buscador/'
    FROM c JOIN cautivo cv ON cv.ruc = c.ruc AND cv.entidad_ruc = c.entidad_ruc
   WHERE c.f IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_cruce_proveedor_cautivo() OWNER TO vigia_jobs;
