-- 365 · Quiénes dejaron de figurar en la conformación jurídica de un proveedor antes de nuestra primera carga del RNP.
--
-- rnp_conformacion_juridica nació de una foto de mayo de 2026: quien había salido de una empresa antes de esa fecha no
-- está en la tabla, y la ficha de la empresa no puede decir «fue socio hasta tal mes». Desde la migración 360 la carga
-- mensual (cargar_rnp.py) sí guarda las salidas (`baja_corte`), pero sólo de mayo de 2026 en adelante.
--
-- El OECE conserva las 65 versiones mensuales del archivo desde noviembre de 2021 (backend/scripts/rnp_historia.py las
-- recorre). Medido el 2026-11-18: 266 285 vínculos dejaron de figurar en algún corte, pero 219 049 «salen» en el corte
-- de noviembre de 2022, que es un cambio de formato del archivo y no una salida real. Sólo se cargan las salidas de
-- diciembre de 2022 en adelante (unas 40 mil), y sólo las que no están hoy en la tabla principal.
--
-- Tabla APARTE a propósito: las señales que leen rnp_conformacion_juridica (cruces, grupos de proveedores, mismo dueño,
-- socio de inhabilitada) no cambian. Por ahora sólo se muestra en la ficha de la empresa, junto a quienes hoy figuran.
-- Una señal que use a los ex socios (por ejemplo, quien sale de una empresa poco antes de asumir un cargo en la entidad
-- que le compra) se hace después, a propósito y en observación.
--
-- Privacidad: trae el documento de cada persona. Sólo la API (migración 353: una tabla con datos de personas no se abre
-- a los agentes ni a vigia_ab); la API nunca publica el documento y tapa un apellido como en los socios de hoy.

CREATE TABLE IF NOT EXISTS rnp_exsocio (
  ruc_empresa           TEXT NOT NULL,
  tipo_documento        TEXT,
  numero_documento      TEXT NOT NULL,
  nombre                TEXT,                 -- normalizado, como rnp_conformacion_juridica.nombre
  nombre_original       TEXT,
  tipo_rol              TEXT NOT NULL,        -- SOCIO_ACCIONISTA_TITULAR | REPRESENTANTE_LEGAL | ORGANO_ADMINISTRACION
  fecha_inicio_vigencia DATE,                 -- desde cuándo figuraba, según el RNP
  forma_societaria      TEXT,
  primer_corte          DATE,                 -- primera versión mensual en que aparece (la historia empieza en 2021-11)
  ultimo_corte          DATE,                 -- última versión en que aparece
  baja_corte            DATE NOT NULL,        -- primera versión en que ya no figura
  PRIMARY KEY (ruc_empresa, numero_documento, tipo_rol, baja_corte)
);
CREATE INDEX IF NOT EXISTS rnp_exsocio_doc ON rnp_exsocio (numero_documento);

DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.rnp_exsocio OWNER TO vigia_jobs;
  END IF;
  REVOKE ALL ON public.rnp_exsocio FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['vigia_api', 'vigia_api_admin', 'dev_api', 'dev_api_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON public.rnp_exsocio TO %I', r);
    END IF;
  END LOOP;
END $$;
