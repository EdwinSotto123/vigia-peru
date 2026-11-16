-- 302 · Las personas que cada informe de control de la Contraloría comprende, con su responsabilidad PRESUNTA (2026-11-16).
--
-- Pedido del dueño: «en los documentos de la Contraloría colocan nombres completos de personas … ¿esos documentos los
-- analizamos para extraer cosas como implicados, motivos?». El buscador de informes (el mismo de la migración 90) trae en
-- el campo `Text` de cada informe, por cada funcionario comprendido, su DNI, su nombre (apellidos y nombres) y los tipos
-- de responsabilidad que el informe le señala:
--   «DNI : <8 cifras> APELLIDOS NOMBRES RESPONSABILIDAD : ADMINISTRATIVO ENTIDAD PENAL DNI : …».
-- Hasta hoy el cargador descartaba ese campo (sólo guardaba cuántos eran). Medido el 2026-11-16 en las 15 páginas: 14 154
-- informes, 84 387 personas (= la suma de TotalFuncionarios, informe por informe), 55 018 DNI distintos; 28 personas
-- vienen con un documento que no es de 8 cifras (22 de 9, que serían carnés de extranjería, 5 de 6 o 7 y una sin número).
--
-- Es responsabilidad PRESUNTA: la Contraloría la identifica y la deriva (al Ministerio Público, a la entidad o a su
-- procedimiento sancionador). No es una condena ni una sanción firme. Toda pantalla que la use debe decirlo.
--
--   informe_control_persona   con el documento: SÓLO para cruzar (refrescos de vigia_jobs). Ni la API, ni el panel, ni el
--                             MCP ni los agentes la leen (como dji_vinculos, migraciones 170, 213 y 214); sus lecturas se
--                             auditan con pgaudit (rds_pgaudit, migración 213).
--   informe_control_implicado vista SIN documento (código, orden, nombre, responsabilidades) para las rutas de informes de
--                             la API: el nombre sale con un apellido tapado por publicar() (lib/privacidad.ts).
--
-- La carga: python backend/scripts/cargar_contraloria_informes.py --entorno prod --personas (desde una PC en el Perú). Nada
-- de esto pasa por disco ni por R2.
-- Idempotente.

CREATE TABLE IF NOT EXISTS informe_control_persona (
  codigo            TEXT     NOT NULL REFERENCES informes_control (codigo) ON DELETE CASCADE,
  orden             SMALLINT NOT NULL CHECK (orden > 0),   -- su lugar en la lista del buscador (1…n)
  doc               TEXT,                                  -- DNI (8 cifras) como lo publica; otro número tal cual; NULL sin número
  nombre            TEXT     NOT NULL,                     -- como lo publica la Contraloría: apellidos y nombres
  responsabilidades TEXT[]   NOT NULL DEFAULT '{}',        -- penal, civil, administrativa_entidad, administrativa_pas, administrativa
  cargado_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (codigo, orden)
);
COMMENT ON TABLE informe_control_persona IS
  'Personas comprendidas en cada informe de control de la Contraloría, con su responsabilidad PRESUNTA (no es condena). '
  'Lleva el DNI: sólo para cruzar, nunca se publica (ni API, ni MCP, ni agentes). Lo público es la vista informe_control_implicado. '
  'Carga: backend/scripts/cargar_contraloria_informes.py --personas (migración 302).';
COMMENT ON COLUMN informe_control_persona.responsabilidades IS
  'Lo que el informe le señala a la persona, con los nombres de informes_control.responsabilidades: penal, civil, '
  'administrativa_entidad (la procesa la entidad), administrativa_pas (procedimiento sancionador de la Contraloría), '
  'administrativa (sin detalle). Presunta.';
CREATE INDEX IF NOT EXISTS informe_control_persona_doc ON informe_control_persona (doc) WHERE doc IS NOT NULL;
ALTER TABLE informe_control_persona OWNER TO vigia_jobs;

-- Lo que la API puede leer: sin el documento. Contrato con las rutas de informes (nombre y columnas fijos).
CREATE OR REPLACE VIEW informe_control_implicado AS
  SELECT codigo, orden, nombre, responsabilidades FROM informe_control_persona;
COMMENT ON VIEW informe_control_implicado IS
  'Las personas de cada informe de control SIN documento (responsabilidad PRESUNTA, no es condena). La API la lee y tapa un '
  'apellido con publicar() (migración 302).';
-- Corre con los permisos de su dueño (vigia_jobs, dueño de la tabla): quien lee la vista no necesita leer la tabla.
ALTER VIEW informe_control_implicado OWNER TO vigia_jobs;

-- Permisos. Los privilegios por defecto (37, 43, 44) dan SELECT a la API y escritura a vigia_agentes en toda tabla y vista
-- nueva; en una vista simple, escribir en ella escribe en la tabla. Se le quita todo a todos los que no son su dueño, y se
-- da sólo lo que hace falta.
REVOKE ALL ON informe_control_persona, informe_control_implicado FROM PUBLIC;
DO $$
DECLARE v text;
BEGIN
  FOR v IN SELECT DISTINCT pg_get_userbyid(a.grantee)
             FROM pg_class c, aclexplode(c.relacl) a
            WHERE c.oid IN ('public.informe_control_persona'::regclass, 'public.informe_control_implicado'::regclass)
              AND a.grantee <> 0 AND a.grantee <> c.relowner AND pg_get_userbyid(a.grantee) <> 'postgres' LOOP
    EXECUTE format('REVOKE ALL ON public.informe_control_persona, public.informe_control_implicado FROM %I', v);
  END LOOP;
  -- La vista: sólo la API (pública y del panel; en DEV, sus roles dev_*).
  FOREACH v IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'dev_api', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v) THEN
      EXECUTE format('GRANT SELECT ON public.informe_control_implicado TO %I', v);
    END IF;
  END LOOP;
  -- Las lecturas de la tabla con documentos se auditan como las demás (migración 213). Leer la vista también la lee.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rds_pgaudit') THEN
    GRANT SELECT ON public.informe_control_persona TO rds_pgaudit;
  END IF;
END $$;
