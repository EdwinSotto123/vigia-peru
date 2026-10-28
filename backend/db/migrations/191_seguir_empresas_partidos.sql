-- 191: «Seguir» empresas y partidos (fase 6 del plan del 2026-10-27).
--
-- La cuenta seguía zonas y entidades (migración 26). Ahora también empresas, sólo RUC 20 (una persona natural no tiene
-- ficha de empresa y no se sigue), y partidos, por su clave de organización política (la de /app/partidos/<clave>). Lo
-- que alguien sigue es privado de su cuenta; «Mi impacto» le muestra lo nuevo de cada cosa (GET /cuentas/me/impacto).
--
-- Permisos: vigia_api escribe `usuarios` por COLUMNA (migración 37); sin estos GRANT el UPDATE falla con 42501.
-- Índices nuevos en casos_cruce: por proveedor (lo nuevo de una empresa seguida; había por entidad y por ocid) y por
-- fecha de la buena pro (la ventana de los últimos días y su último día con datos, aquí y en GET /novedades: sin él,
-- cada consulta recorría la tabla entera). Idempotente: se puede correr dos veces.

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS empresas_seguidas TEXT[] NOT NULL DEFAULT '{}';   -- RUC 20
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS partidos_seguidos TEXT[] NOT NULL DEFAULT '{}';   -- org_clave

-- La API ya lo valida; la base lo asegura: sólo RUC 20 y claves de partido, y a lo sumo 300 de cada uno.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_empresas_seguidas_ruc20') THEN
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_empresas_seguidas_ruc20
      CHECK (array_to_string(empresas_seguidas, ',') ~ '^(20[0-9]{9}(,20[0-9]{9})*)?$' AND cardinality(empresas_seguidas) <= 300);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_partidos_seguidos_clave') THEN
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_partidos_seguidos_clave
      CHECK (array_to_string(partidos_seguidos, ',') ~ '^([a-z0-9-]{1,80}(,[a-z0-9-]{1,80})*)?$' AND cardinality(partidos_seguidos) <= 300);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS usuarios_empresas_idx ON usuarios USING GIN (empresas_seguidas);
CREATE INDEX IF NOT EXISTS usuarios_partidos_idx ON usuarios USING GIN (partidos_seguidos);

GRANT SELECT (empresas_seguidas, partidos_seguidos), INSERT (empresas_seguidas, partidos_seguidos),
      UPDATE (empresas_seguidas, partidos_seguidos) ON usuarios TO vigia_api;

CREATE INDEX IF NOT EXISTS casos_cruce_ruc ON casos_cruce (ruc, fecha_buena_pro DESC);
CREATE INDEX IF NOT EXISTS casos_cruce_fecha ON casos_cruce (fecha_buena_pro DESC, severidad);
