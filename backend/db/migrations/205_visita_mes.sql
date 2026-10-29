-- 205 · Las visitas de cada entidad mes a mes, precalculadas, para la Historia.
--
-- El usuario: en la Historia de la entidad faltaban las VISITAS. La línea las contaba en vivo (todas las visitas de la
-- entidad agrupadas por mes) y en las entidades grandes la consulta pasaba los 10 s del rol de la API: el renglón
-- «Visitas que recibió» desaparecía sin aviso. Ahora sale de entidad_visita_mes, con lo que sirve para cruzarlo con lo
-- demás: cuántas fueron de empresas, cuántas a quien decide las compras y cuántas empresas distintas (RUC 20) se
-- reconocen ese mes (por su gente en el RNP o por su nombre).
--
-- Quién decide sale de entidad_visita_area (migración 188: el área y el cargo de quien recibe, con su marca de decisor),
-- sin volver a evaluar visita_decisor() en 10,8 M visitas.
--
-- Cómo aplicarla: después de la 188 y la 197. Luego SELECT refrescar_visita_mes() (~5 min en PROD); la corren las cargas
-- de visitas después de refrescar_visitas_entidad.

CREATE TABLE IF NOT EXISTS entidad_visita_mes (
  entidad_ruc TEXT NOT NULL,
  mes         DATE NOT NULL,
  visitas     INT NOT NULL,
  privadas    INT NOT NULL,   -- de empresas y organizaciones privadas
  decisores   INT NOT NULL,   -- a quien decide las compras (titular, gerencia, administración, logística, un comité)
  empresas    INT NOT NULL,   -- empresas (RUC 20) que se reconocen en las visitas de ese mes
  PRIMARY KEY (entidad_ruc, mes)
);
ALTER TABLE entidad_visita_mes OWNER TO vigia_jobs;
GRANT SELECT ON entidad_visita_mes TO vigia_api, vigia_api_admin;

CREATE OR REPLACE FUNCTION refrescar_visita_mes() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n INT;
  t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refrescar_visita_mes'));
  SET LOCAL work_mem = '256MB';

  CREATE TEMP TABLE _vmd ON COMMIT DROP AS
    SELECT entidad_ruc, area, cargo FROM entidad_visita_area WHERE decisor;
  CREATE INDEX ON _vmd (entidad_ruc, area, cargo);
  ANALYZE _vmd;

  CREATE TEMP TABLE _vm ON COMMIT DROP AS
    SELECT r.ruc AS entidad_ruc, date_trunc('month', v.fecha_visita)::date AS mes, count(*) AS visitas,
           count(*) FILTER (WHERE v.tipo_entidad_visitante = 'privada') AS privadas,
           count(d.entidad_ruc) AS decisores
      FROM visitas_entidades v
      JOIN visita_entidad_ruc r ON r.entidad_visitada = v.entidad_visitada
      LEFT JOIN _vmd d ON d.entidad_ruc = r.ruc
                      AND d.area = COALESCE(NULLIF(btrim(v.funcionario_area), ''), 'Sin área en el registro')
                      AND d.cargo = COALESCE(btrim(v.funcionario_cargo), '')
     WHERE v.fecha_visita IS NOT NULL
     GROUP BY 1, 2;
  RAISE NOTICE 'visita_mes: visitas (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  CREATE TEMP TABLE _vme ON COMMIT DROP AS
    SELECT r.ruc AS entidad_ruc, date_trunc('month', v.fecha_visita)::date AS mes, count(DISTINCT ev.ruc) AS empresas
      FROM empresa_visita ev
      JOIN visitas_entidades v ON v.id = ev.visita_id
      JOIN visita_entidad_ruc r ON r.entidad_visitada = v.entidad_visitada
     WHERE ev.ruc ~ '^20\d{9}$' AND v.fecha_visita IS NOT NULL
     GROUP BY 1, 2;
  RAISE NOTICE 'visita_mes: empresas (% s)', round(extract(epoch FROM clock_timestamp() - t0));

  DELETE FROM entidad_visita_mes;
  INSERT INTO entidad_visita_mes (entidad_ruc, mes, visitas, privadas, decisores, empresas)
  SELECT m.entidad_ruc, m.mes, m.visitas, m.privadas, m.decisores, COALESCE(e.empresas, 0)
    FROM _vm m LEFT JOIN _vme e ON e.entidad_ruc = m.entidad_ruc AND e.mes = m.mes;
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE entidad_visita_mes;
  RAISE NOTICE 'visita_mes: % filas (% s)', n, round(extract(epoch FROM clock_timestamp() - t0));
  RETURN n;
END $$;
ALTER FUNCTION refrescar_visita_mes() OWNER TO vigia_jobs;
REVOKE EXECUTE ON FUNCTION refrescar_visita_mes() FROM PUBLIC;
GRANT SELECT ON entidad_visita_area, empresa_visita, visitas_entidades, visita_entidad_ruc TO vigia_jobs;
