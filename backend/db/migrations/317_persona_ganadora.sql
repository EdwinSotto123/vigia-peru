-- 317 · Las personas naturales que GANAN procesos de selección también tienen ficha (2026-11-16).
--
-- Pedido del dueño: «COSSIO JOSE CARLOS lo busco en contratos y en personas contratadas y parece que no tiene perfil;
-- debería tenerlo, sólo que ocultando su DNI». La ficha de una persona (/app/personas/<código>) se armaba sólo con sus
-- ÓRDENES de servicio. Quien gana procesos de selección como persona natural (un «tercero supervisor» por régimen
-- especial, un consultor) quedaba a medias: de 31 353 ganadores con RUC 10 en CONOSCE, 6 101 no tenían ficha (16 443
-- procesos, S/ 2 776 millones) y los otros 25 252 tenían una que no decía nada de lo que ganaron. El del pedido: una
-- orden de S/ 12 mil en su ficha y 11 procesos por S/ 142 mil que no figuraban.
--
--   persona_ganadora                 una fila por persona natural que ganó algún proceso (CONOSCE, con su RUC propio):
--                                    cuántos, cuánto, en cuántas entidades, desde y hasta cuándo, y la primera palabra de
--                                    su nombre (`ap1`) para encontrarla.
--   refrescar_persona_ganadora()     la rehace y le da a cada una su código de ficha (persona_codigo) si no lo tenía.
--
-- La API arma con esto la sección «Procesos que ganó» de la ficha (routes/personas.ts), enlaza al ganador desde el
-- contrato y permite buscar a una persona por su nombre VISIBLE (primer apellido y nombres; nunca por el apellido tapado:
-- la API descarta todo resultado en que una palabra buscada sólo coincida con lo que no se muestra).
--
-- Privacidad: como persona_entidad, guarda el RUC 10 y el nombre entero; nada de eso sale de la API sin publicar() (un
-- apellido tapado, el RUC como referencia). El código de la ficha es al azar: nunca el RUC ni el DNI.

SET lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS persona_ganadora (
  ruc        TEXT    PRIMARY KEY,
  nombre     TEXT    NOT NULL,
  ap1        TEXT    NOT NULL,          -- primera palabra del nombre, como mef_norm (para buscar por el primer apellido)
  procesos   INT     NOT NULL,
  monto      NUMERIC,
  entidades  INT     NOT NULL,
  primera    DATE,
  ultima     DATE
);
COMMENT ON TABLE persona_ganadora IS
  'Personas naturales (RUC 10) que ganaron algún proceso de selección según CONOSCE: cuántos, cuánto y en cuántas '
  'entidades. La rehace refrescar_persona_ganadora(), que además les da código de ficha. El nombre y el RUC sólo salen '
  'de la API por publicar().';
CREATE INDEX IF NOT EXISTS persona_ganadora_ap1 ON persona_ganadora (ap1);
ALTER TABLE persona_ganadora OWNER TO vigia_jobs;
REVOKE ALL ON persona_ganadora FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON persona_ganadora FROM %I', r);
    END IF;
  END LOOP;
  -- Sólo quien publica con publicar(): la API. Los agentes y el MCP no leen nombres con RUC 10 de aquí.
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON persona_ganadora TO %I', r);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION refrescar_persona_ganadora() RETURNS integer
LANGUAGE plpgsql SET work_mem = '64MB' SET statement_timeout = '600s' AS $$
DECLARE v_filas int;
BEGIN
  DROP TABLE IF EXISTS _pg_g;
  CREATE TEMP TABLE _pg_g ON COMMIT DROP AS
    SELECT a.ruc_proveedor AS ruc, max(a.proveedor) AS nombre, count(DISTINCT a.codigo_convocatoria)::int AS procesos,
           sum(a.monto_adjudicado) AS monto, count(DISTINCT a.entidad_ruc)::int AS entidades,
           min(a.fecha_buenapro) AS primera, max(a.fecha_buenapro) AS ultima
      FROM conosce_adjudicaciones a
     WHERE a.ruc_proveedor ~ '^10[0-9]{9}$' AND a.monto_adjudicado > 0 AND COALESCE(btrim(a.proveedor), '') <> ''
     GROUP BY a.ruc_proveedor;
  ANALYZE _pg_g;

  DELETE FROM persona_ganadora;
  INSERT INTO persona_ganadora (ruc, nombre, ap1, procesos, monto, entidades, primera, ultima)
  SELECT ruc, nombre, split_part(mef_norm(nombre), ' ', 1), procesos, monto, entidades, primera, ultima FROM _pg_g;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  ANALYZE persona_ganadora;

  -- Su código de ficha, si no lo tenía (al azar, como el de quien tiene órdenes).
  INSERT INTO persona_codigo (ruc) SELECT ruc FROM persona_ganadora ON CONFLICT (ruc) DO NOTHING;
  RETURN v_filas;
END $$;
ALTER FUNCTION refrescar_persona_ganadora() OWNER TO vigia_jobs;

SET statement_timeout = '600s';
SELECT refrescar_persona_ganadora() AS personas_que_ganaron;
RESET statement_timeout;
