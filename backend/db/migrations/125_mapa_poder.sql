-- 125 · Mapa de poder: captura por partido y por entidad (indicios para revisión, nunca acusación).
--
-- Para cada entidad ELECTA con gobierno vigente (municipios y gobiernos regionales, periodo que cubre hoy), cruza quién
-- la gobierna (entidad_gobierno_amplia × jne_autoridades, la misma lógica validada de refrescar_cruces, migración 124) con
-- la CAPTURA: cuántos de sus contratos ganaron empresas que financiaron a ese partido (partido_gobernante), que le vendieron
-- a su campaña (vendio_gobernante) o que tienen un socio contratado por la MISMA entidad (socio_en_entidad, puerta
-- giratoria). Deja dos tablas: poder_entidad (una fila por entidad gobernada) y poder_partido (una por partido). La captura
-- se lee de casos_cruce (ya deduplicada, con monto y tipos por ocid×ruc). Son HECHOS agregados, para mirar; no prueban nada.

CREATE OR REPLACE FUNCTION refrescar_poder() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  -- 1) Entidad -> partido que la gobierna hoy (alcalde distrital/provincial o gobernador regional vigente).
  DROP TABLE IF EXISTS _gob;
  CREATE TEMP TABLE _gob ON COMMIT DROP AS
    SELECT DISTINCT ON (ega.ruc) ega.ruc AS entidad_ruc, ega.nivel, ega.ubigeo,
           j.organizacion_politica AS partido, j.cargo AS cargo_gob, j.nombre AS autoridad,
           j.departamento, j.provincia, j.distrito, j.periodo_inicio, j.periodo_fin
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
    WHERE k.entidad_ruc IN (SELECT entidad_ruc FROM _gob)
      AND k.tipos && ARRAY['partido_gobernante', 'vendio_gobernante', 'socio_en_entidad']
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
