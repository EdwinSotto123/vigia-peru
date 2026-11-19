-- 398 · Revisión a mano de los indicadores en observación: el paso que la 329 pedía y no tenía dónde hacerse.
--
-- La 329 dejó los indicadores nuevos «en observación» (se muestran con su evidencia y no puntúan) hasta medir su precisión
-- con una muestra revisada. No había dónde revisarla: ninguno podía graduarse. Esta tabla guarda el veredicto de una
-- persona del equipo sobre cada caso (un contrato y una empresa de un indicador), y el panel (/admin/senales) arma la
-- muestra, cuenta y calcula la precisión:
--   · acierta: el hecho que describe el indicador es cierto y merece que un investigador lo mire;
--   · no_acierta: el dato está mal (lectura equivocada, homónimo, fecha) o el hecho es normal y no dice nada;
--   · dudoso: no se puede saber sin más documentos (no entra en la precisión).
-- Graduar un indicador (sacarlo de senal_en_observacion, sólo un administrador y con 40 casos decididos o más) lo hace
-- puntuar en el siguiente refresco; volver a ponerlo lo devuelve a observación. Las dos cosas quedan en la bitácora.

CREATE TABLE IF NOT EXISTS senal_revision (
  tipo          text NOT NULL,
  ocid          text NOT NULL,
  ruc_empresa   text NOT NULL,
  veredicto     text NOT NULL CHECK (veredicto IN ('acierta', 'no_acierta', 'dudoso')),
  nota          text CHECK (nota IS NULL OR length(nota) <= 1000),
  severidad     text,
  revisado_por  text NOT NULL,
  revisado_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tipo, ocid, ruc_empresa)
);
CREATE INDEX IF NOT EXISTS senal_revision_tipo ON senal_revision (tipo, veredicto);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_jobs') THEN
    ALTER TABLE public.senal_revision OWNER TO vigia_jobs;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vigia_api_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.senal_revision TO vigia_api_admin;
    -- Graduar (DELETE) o volver a observación (INSERT): sólo desde el panel de un administrador.
    GRANT SELECT, INSERT, DELETE ON public.senal_en_observacion TO vigia_api_admin;
    GRANT SELECT ON public.senal_tasa_base, public.cruces_proveedor TO vigia_api_admin;
  END IF;
END $$;
