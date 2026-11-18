-- 388: para qué usa Vigía quien crea una cuenta (voluntario): periodista, investigador, control (Contraloría u OCI) o
-- ciudadano. Lo elige al pedir un informe para control sin cuenta (2026-11-18: el dueño pidió «¿eres periodista o
-- investigador? ¿o de Contraloría? regístrate», para no redactar informes con modelo a visitas anónimas). Sin correo ni
-- datos personales: la cuenta sigue siendo un nombre de usuario y una contraseña.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perfil_uso text;
DO $$ BEGIN
  ALTER TABLE usuarios ADD CONSTRAINT usuarios_perfil_uso_valido
    CHECK (perfil_uso IS NULL OR perfil_uso IN ('periodista', 'investigador', 'control', 'ciudadano'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
