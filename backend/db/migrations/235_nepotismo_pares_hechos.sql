-- 235: los pares del indicio de nepotismo, ya calculados (2026-11-02).
--
-- dji_nepotismo_pares() (migración 213) cruzaba en cada llamada todos los familiares declarados en la DJI con los
-- locadores (persona_orden_anual): 8 s de media y hasta 30 s en PROD (pg_stat_statements del 20-oct al 2-nov). La API la
-- guarda en la memoria de cada Worker diez minutos, así que cada Worker nuevo la pagaba entera: la lista de entidades
-- tardaba de 4.6 a 7.2 s en cada página o filtro nuevo (y la de planilla igual). Los datos sólo cambian cuando entran
-- órdenes nuevas o una ronda de la DJI, que ahora la recalculan (refrescar_dji_nepotismo_pares, en la carga de CONOSCE
-- del Worker de scrapers y en orquestar_dji.py). La función lee la tabla; sin cálculo todavía, lo hace en vivo como antes.
-- Igual que en 213: devuelve sólo la entidad y el nombre normalizado del funcionario (nunca el DNI del pariente) y las
-- tablas no se le dan a nadie; sólo las funciones.
--
-- DEV: bash infrastructure/deploy/dev.sh migrar backend/db/migrations/235_nepotismo_pares_hechos.sql
-- PROD: lo mismo por el túnel (tunel_rds).

CREATE TABLE IF NOT EXISTS dji_nepotismo_pares_hecho (
  entidad    text NOT NULL,
  declarante text NOT NULL,
  PRIMARY KEY (entidad, declarante)
);
CREATE TABLE IF NOT EXISTS dji_nepotismo_pares_estado (
  id           boolean PRIMARY KEY DEFAULT true CHECK (id),
  calculado_at timestamptz NOT NULL,
  pares        integer NOT NULL
);
REVOKE ALL ON dji_nepotismo_pares_hecho, dji_nepotismo_pares_estado FROM PUBLIC;

/** Recalcula los pares (en una transacción: quien lee ve los de antes hasta que termina). Devuelve cuántos son. */
CREATE OR REPLACE FUNCTION public.refrescar_dji_nepotismo_pares()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  DELETE FROM dji_nepotismo_pares_hecho;
  INSERT INTO dji_nepotismo_pares_hecho (entidad, declarante)
  SELECT DISTINCT v.entidad_ruc, v.declarante_norm
    FROM dji_vinculos v
   WHERE v.declarante_norm IS NOT NULL AND length(v.pariente_doc) = 8
     AND EXISTS (SELECT 1 FROM persona_orden_anual po
                  WHERE po.entidad_ruc = v.entidad_ruc AND po.ruc BETWEEN '10' || v.pariente_doc || '0' AND '10' || v.pariente_doc || '9');
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO dji_nepotismo_pares_estado (id, calculado_at, pares) VALUES (true, now(), n)
  ON CONFLICT (id) DO UPDATE SET calculado_at = EXCLUDED.calculado_at, pares = EXCLUDED.pares;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.dji_nepotismo_pares()
RETURNS TABLE (entidad text, declarante text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Lo ya calculado mientras sea de los últimos dos días (las cargas lo rehacen a diario); si no, en vivo, como antes:
  -- un refresco que se dejó de correr no deja la lista con datos viejos.
  IF EXISTS (SELECT 1 FROM dji_nepotismo_pares_estado WHERE calculado_at > now() - interval '2 days') THEN
    RETURN QUERY SELECT h.entidad, h.declarante FROM dji_nepotismo_pares_hecho h;
  ELSE
    RETURN QUERY
      SELECT DISTINCT v.entidad_ruc, v.declarante_norm
        FROM dji_vinculos v
       WHERE v.declarante_norm IS NOT NULL AND length(v.pariente_doc) = 8
         AND EXISTS (SELECT 1 FROM persona_orden_anual po
                      WHERE po.entidad_ruc = v.entidad_ruc AND po.ruc BETWEEN '10' || v.pariente_doc || '0' AND '10' || v.pariente_doc || '9');
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.refrescar_dji_nepotismo_pares() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    GRANT EXECUTE ON FUNCTION public.refrescar_dji_nepotismo_pares() TO vigia_jobs;
  END IF;
END $$;

-- El primer cálculo, ya.
SELECT refrescar_dji_nepotismo_pares();
