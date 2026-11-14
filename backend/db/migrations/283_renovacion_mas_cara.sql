-- Renovaciones de un servicio que salieron más caras (cruce `renovacion_mas_cara`, 2026-11-14).
--
-- Con el costo mensual de cada servicio (migraciones 280 y 282) se puede ver, sin leer un solo documento más, cuándo una
-- entidad volvió a contratar el MISMO servicio y pagó bastante más por mes. Medido en PROD: 1 419 renovaciones
-- comparables desde 2022; en 247 el costo mensual subió 30 % o más (140, 60 % o más); en 75 el proveedor es el mismo.
--
-- Qué cuenta como renovación (las mismas guardas del agente, tools/market/costo_mensual.py, medidas una por una):
--   · misma entidad y objeto casi igual (similitud de trigramas ≥ 0,65);
--   · servicio continuo: los dos contratos duran 150 días o más y sus plazos son del mismo orden (hasta 3 veces);
--   · el anterior ya había corrido el 60 % de su plazo (si no, son contratos simultáneos de otra sede);
--   · no es un servicio por obra o proyecto (supervisión, expediente técnico, mantenimiento de un camino);
--   · la subida va de 30 % a 300 % (más que eso es otro alcance).
-- Es un indicio: el servicio pudo crecer (más sedes, más personal). Alta con 60 % o más y objeto casi idéntico (≥ 0,8).

CREATE TABLE IF NOT EXISTS servicio_renovacion (
  ocid                   TEXT PRIMARY KEY,
  ocid_anterior          TEXT NOT NULL,
  entidad_ruc            TEXT NOT NULL,
  entidad                TEXT,
  objeto                 TEXT,
  objeto_anterior        TEXT,
  fecha                  DATE,
  fecha_anterior         DATE,
  monto                  NUMERIC,
  monto_anterior         NUMERIC,
  plazo_dias             INT,
  plazo_anterior         INT,
  costo_mensual          NUMERIC NOT NULL,
  costo_mensual_anterior NUMERIC NOT NULL,
  diff_pct               NUMERIC(7, 1) NOT NULL,
  similitud              NUMERIC(4, 2) NOT NULL,
  exceso                 NUMERIC,          -- (costo mensual − el anterior) × meses de este contrato
  proveedor_ruc          TEXT,             -- sólo RUC 20
  proveedor_anterior_ruc TEXT,
  mismo_proveedor        BOOLEAN,
  refrescado_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS servicio_renovacion_entidad ON servicio_renovacion (entidad_ruc);
CREATE INDEX IF NOT EXISTS servicio_renovacion_orden ON servicio_renovacion (diff_pct DESC);

CREATE OR REPLACE FUNCTION refrescar_cruce_renovacion_cara() RETURNS integer
LANGUAGE plpgsql SET work_mem = '128MB' AS $$
DECLARE v_filas int;
        v_proy CONSTANT text := 'supervisi[oó]n|expediente\s+t[eé]cnico|consultor[ií]a\s+de\s+obra|elaboraci[oó]n\s+de(l)?\s+(estudio|perfil|expediente)|mantenimiento\s+(peri[oó]dico|rutinario)';
BEGIN
  DELETE FROM servicio_renovacion;
  INSERT INTO servicio_renovacion (ocid, ocid_anterior, entidad_ruc, entidad, objeto, objeto_anterior, fecha, fecha_anterior, monto, monto_anterior,
                                   plazo_dias, plazo_anterior, costo_mensual, costo_mensual_anterior, diff_pct, similitud, exceso,
                                   proveedor_ruc, proveedor_anterior_ruc, mismo_proveedor)
  SELECT a.ocid, p.ocid, a.entidad_ruc, a.entidad, a.objeto, p.objeto, a.fecha, p.fecha, a.monto, p.monto, a.plazo_dias, p.plazo_dias,
         a.costo_mensual, p.costo_mensual, round((a.costo_mensual - p.costo_mensual) / p.costo_mensual * 100, 1), round(p.sim::numeric, 2),
         round((a.costo_mensual - p.costo_mensual) * (a.plazo_dias / 30.0), 2), a.proveedor_ruc, p.proveedor_ruc,
         CASE WHEN a.proveedor_ruc IS NOT NULL AND p.proveedor_ruc IS NOT NULL THEN a.proveedor_ruc = p.proveedor_ruc END
    FROM servicio_costo_mensual a
    JOIN LATERAL (
      SELECT s.ocid, s.costo_mensual, s.plazo_dias, s.fecha, s.objeto, s.monto, s.proveedor_ruc, similarity(s.objeto_norm, a.objeto_norm) AS sim
        FROM servicio_costo_mensual s
       WHERE s.ocid <> a.ocid AND s.entidad_ruc = a.entidad_ruc AND similarity(s.objeto_norm, a.objeto_norm) >= 0.65
         AND s.fecha >= a.fecha - make_interval(months => 48) AND s.fecha < a.fecha
       ORDER BY s.fecha DESC LIMIT 1) p ON TRUE
   WHERE a.entidad_ruc IS NOT NULL AND p.costo_mensual > 0
     AND (a.costo_mensual - p.costo_mensual) / p.costo_mensual * 100 BETWEEN 30 AND 300
     AND a.plazo_dias >= 150 AND p.plazo_dias >= 150 AND greatest(a.plazo_dias, p.plazo_dias) <= 3 * least(a.plazo_dias, p.plazo_dias)
     AND (a.fecha - p.fecha) >= 0.6 * p.plazo_dias
     AND a.objeto !~* v_proy AND p.objeto !~* v_proy;
  GET DIAGNOSTICS v_filas = ROW_COUNT;

  -- El cruce va en el contrato nuevo, a nombre de quien lo ganó (sólo empresas).
  DELETE FROM cruces_proveedor WHERE tipo = 'renovacion_mas_cara';
  INSERT INTO cruces_proveedor (tipo, ruc_empresa, ocid, severidad, fecha, monto, detalle, fuente, fuente_url)
  SELECT 'renovacion_mas_cara', r.proveedor_ruc, r.ocid, CASE WHEN r.diff_pct >= 60 AND r.similitud >= 0.8 THEN 'alta' ELSE 'media' END,
         r.fecha, r.monto,
         jsonb_build_object('costo_mensual', round(r.costo_mensual, 2), 'costo_mensual_anterior', round(r.costo_mensual_anterior, 2), 'diff_pct', r.diff_pct,
                            'plazo_dias', r.plazo_dias, 'plazo_anterior', r.plazo_anterior, 'monto_anterior', r.monto_anterior,
                            'ocid_anterior', r.ocid_anterior, 'fecha_anterior', to_char(r.fecha_anterior, 'YYYY-MM-DD'),
                            'objeto_anterior', left(r.objeto_anterior, 200), 'similitud', r.similitud, 'exceso', r.exceso,
                            'mismo_proveedor', r.mismo_proveedor),
         'servicio_costo_mensual', 'https://contratacionesabiertas.oece.gob.pe/'
    FROM servicio_renovacion r
   WHERE r.proveedor_ruc ~ '^20[0-9]{9}$' AND EXISTS (SELECT 1 FROM convocatorias c WHERE c.ocid = r.ocid);
  RETURN v_filas;
END $$;
ALTER FUNCTION refrescar_cruce_renovacion_cara() OWNER TO vigia_jobs;
ALTER TABLE servicio_renovacion OWNER TO vigia_jobs;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'vigia_mcp', 'vigia_agentes', 'vigia_ab'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.servicio_renovacion TO %I', r);
    END IF;
  END LOOP;
END $$;

SELECT refrescar_cruce_renovacion_cara() AS renovaciones_mas_caras;
