-- 11 · ubigeo directo en convocatorias (viene del buyer.address del OCDS) + campos de listado.
-- `ubigeo` es TEXT (no CHAR(6)) porque la PK de `zonas` es TEXT de 2/4/6 dígitos:
-- un departamento se guarda como '15', una provincia '1501', un distrito '150135'.
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS ubigeo TEXT REFERENCES zonas (ubigeo)
  CHECK (ubigeo IS NULL OR ubigeo ~ '^[0-9]{2}([0-9]{2}([0-9]{2})?)?$');
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS categoria TEXT;          -- goods | services | works
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS estado_tender TEXT;      -- tender.status tal cual
ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS fuente TEXT DEFAULT 'ocds_api';
CREATE INDEX IF NOT EXISTS convocatorias_ubigeo_idx ON convocatorias (ubigeo);
CREATE INDEX IF NOT EXISTS convocatorias_fecha_idx ON convocatorias (fecha_convocatoria DESC);

ALTER TABLE entidades ALTER COLUMN tipo DROP NOT NULL;   -- la ingesta liviana no siempre sabe el tipo

-- Prioridad: ubigeo propio de la convocatoria → ubigeo de la entidad → match por nombre (provincia, dpto).
-- El cast `::bpchar` (sin longitud, no rellena) conserva el tipo que la vista ya tenía
-- en 09; cambiarlo obligaría a DROP … CASCADE de cola_auditoria y zona_estado.
CREATE OR REPLACE VIEW convocatoria_zona AS
SELECT c.ocid, c.fecha_convocatoria,
       COALESCE(
         c.ubigeo::bpchar,
         NULLIF(e.ubigeo, ''),
         (SELECT z.ubigeo FROM zonas z
           WHERE z.nivel IN ('provincia','departamento')
             AND upper(unaccent(z.nombre)) = upper(unaccent(COALESCE(NULLIF(c.region,''), e.region, e.provincia, '')))
           ORDER BY CASE z.nivel WHEN 'provincia' THEN 0 ELSE 1 END
           LIMIT 1)
       ) AS ubigeo
FROM convocatorias c
LEFT JOIN entidades e ON e.ruc = c.entidad_ruc;
