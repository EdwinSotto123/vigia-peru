-- 140 · Mapa de poder: la captura de un partido es la de SU gobierno (arregla la 125).
--
-- refrescar_poder() le atribuía al partido que gobierna hoy TODOS los contratos con indicio de la entidad, de cualquier
-- año: Pichari (gobernada por un partido desde 2023) sumaba contratos de 2018 a 2021, de otras gestiones. Los cruces
-- «financió / vendió al que gobierna» ya se calculan con el partido de entonces (migración 124); lo que faltaba era no
-- sumárselos al de ahora. Medido en producción el 2026-10-26: 4,791 de 12,194 contratos (39 %) eran de otra gestión.
-- Ahora _cap y el conteo de empresas por partido cuentan sólo lo CONVOCADO dentro del periodo vigente: la misma fecha
-- (convocatorias.fecha_convocatoria) con que filtra la lista de contratos (`desde`/`hasta`), así la cifra y la lista que
-- la muestra dicen lo mismo.
-- El inicio del periodo es el del periodo de gobierno del partido (4 años), no el de la autoridad de turno.
-- Después: SELECT refrescar_poder();

CREATE OR REPLACE FUNCTION refrescar_poder() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  -- 1) Entidad -> partido que la gobierna hoy (alcalde distrital/provincial o gobernador regional vigente).
  DROP TABLE IF EXISTS _gob;
  CREATE TEMP TABLE _gob ON COMMIT DROP AS
    SELECT DISTINCT ON (ega.ruc) ega.ruc AS entidad_ruc, ega.nivel, ega.ubigeo,
           j.organizacion_politica AS partido, j.cargo AS cargo_gob, j.nombre AS autoridad,
           j.departamento, j.provincia, j.distrito,
           -- El periodo del PARTIDO, no de la persona: un reemplazo a mitad de mandato (el teniente alcalde de la misma
           -- lista) trae su propia fecha de inicio (Lima: 14 oct. 2025) y la captura del partido empezaba ahí. El
           -- periodo de gobierno regional y municipal es de 4 años y termina el 31 de diciembre.
           make_date(extract(year FROM j.periodo_fin)::int - 3, 1, 1) AS periodo_inicio, j.periodo_fin
    FROM entidad_gobierno_amplia ega
    JOIN jne_autoridades j ON (
         (ega.nivel = 'distrital'  AND j.cargo = 'ALCALDE DISTRITAL'   AND j.ubigeo = ega.ubigeo)
      OR (ega.nivel = 'provincial' AND j.cargo = 'ALCALDE PROVINCIAL'  AND left(j.ubigeo, 4) = ega.ubigeo)
      OR (ega.nivel = 'regional'   AND j.cargo = 'GOBERNADOR REGIONAL' AND left(j.ubigeo, 2) = ega.ubigeo))
    WHERE j.organizacion_politica IS NOT NULL AND ega.como = 'entidades'
      AND j.periodo_fin >= current_date
    ORDER BY ega.ruc, j.periodo_inicio DESC;
  CREATE INDEX ON _gob (entidad_ruc);

  -- 2) Captura por entidad (desde casos_cruce: un ocid×ruc con su monto y tipos).
  DROP TABLE IF EXISTS _cap;
  CREATE TEMP TABLE _cap ON COMMIT DROP AS
    SELECT k.entidad_ruc,
           count(DISTINCT k.ocid)                                                        AS n_captura,
           COALESCE(sum(k.monto), 0)::numeric                                             AS monto_captura,
           count(DISTINCT k.ocid) FILTER (WHERE k.tipos @> ARRAY['partido_gobernante'])  AS n_financiaron,
           count(DISTINCT k.ocid) FILTER (WHERE k.tipos @> ARRAY['vendio_gobernante'])   AS n_vendieron,
           count(DISTINCT k.ocid) FILTER (WHERE k.tipos @> ARRAY['socio_en_entidad'])    AS n_socio,
           count(DISTINCT k.ruc)                                                         AS n_empresas
    FROM casos_cruce k
    -- Sólo lo convocado DURANTE el gobierno vigente: antes se le contaba al partido de hoy lo de gestiones anteriores
    -- (en producción, 4,791 de 12,194 contratos, el 39 %).
    JOIN _gob g ON g.entidad_ruc = k.entidad_ruc
    JOIN convocatorias cv ON cv.ocid = k.ocid
     AND cv.fecha_convocatoria >= g.periodo_inicio AND cv.fecha_convocatoria <= g.periodo_fin
    WHERE k.tipos && ARRAY['partido_gobernante', 'vendio_gobernante', 'socio_en_entidad']
    GROUP BY k.entidad_ruc;
  CREATE INDEX ON _cap (entidad_ruc);

  -- 3) poder_entidad: una fila por entidad gobernada, con su captura.
  DROP TABLE IF EXISTS poder_entidad;
  CREATE TABLE poder_entidad AS
    SELECT g.entidad_ruc, COALESCE(e.nombre, g.entidad_ruc) AS entidad, g.nivel,
           g.departamento, g.provincia, g.distrito, g.ubigeo,
           g.partido, g.cargo_gob, g.autoridad, g.periodo_inicio, g.periodo_fin,
           COALESCE(c.n_captura, 0)      AS n_captura,
           COALESCE(c.monto_captura, 0)  AS monto_captura,
           COALESCE(c.n_financiaron, 0)  AS n_financiaron,
           COALESCE(c.n_vendieron, 0)    AS n_vendieron,
           COALESCE(c.n_socio, 0)        AS n_socio,
           COALESCE(c.n_empresas, 0)     AS n_empresas
    FROM _gob g
    LEFT JOIN entidades e ON e.ruc = g.entidad_ruc
    LEFT JOIN _cap c ON c.entidad_ruc = g.entidad_ruc;
  ALTER TABLE poder_entidad ADD PRIMARY KEY (entidad_ruc);
  CREATE INDEX ON poder_entidad (partido);
  CREATE INDEX ON poder_entidad (n_captura DESC);

  -- 4) poder_partido: una fila por partido. n_empresas se cuenta DISTINTO a nivel partido (no se suma por entidad).
  DROP TABLE IF EXISTS poder_partido;
  CREATE TABLE poder_partido AS
    WITH emp AS (
      SELECT g.partido, count(DISTINCT k.ruc) AS n_empresas
      FROM _gob g
      JOIN casos_cruce k ON k.entidad_ruc = g.entidad_ruc
       AND k.tipos && ARRAY['partido_gobernante', 'vendio_gobernante', 'socio_en_entidad']
      JOIN convocatorias cv ON cv.ocid = k.ocid
       AND cv.fecha_convocatoria >= g.periodo_inicio AND cv.fecha_convocatoria <= g.periodo_fin
      GROUP BY g.partido)
    SELECT pe.partido,
           count(*)                                   AS n_entidades,
           count(DISTINCT pe.departamento)            AS n_departamentos,
           sum(pe.n_captura)                          AS n_captura,
           sum(pe.monto_captura)                      AS monto_captura,
           sum(pe.n_financiaron)                      AS n_financiaron,
           sum(pe.n_vendieron)                        AS n_vendieron,
           sum(pe.n_socio)                            AS n_socio,
           COALESCE(emp.n_empresas, 0)                AS n_empresas,
           count(*) FILTER (WHERE pe.n_captura > 0)   AS n_entidades_con_captura
    FROM poder_entidad pe
    LEFT JOIN emp ON emp.partido = pe.partido
    GROUP BY pe.partido, emp.n_empresas;
  ALTER TABLE poder_partido ADD PRIMARY KEY (partido);
  CREATE INDEX ON poder_partido (n_captura DESC);

  ANALYZE poder_entidad;
  ANALYZE poder_partido;
  SELECT count(*) INTO n FROM poder_entidad;
  RETURN n;
END $$;
ALTER FUNCTION refrescar_poder() OWNER TO vigia_jobs;
