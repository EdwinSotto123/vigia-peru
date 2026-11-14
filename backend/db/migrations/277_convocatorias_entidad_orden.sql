-- La lista de contratos de una entidad (medio millón de llamadas de la API en 25 días) pide los 25 o 50 más recientes:
-- con sólo el índice por entidad, la base traía TODAS sus filas del disco y las ordenaba (una entidad mediana, mil
-- lecturas sueltas en frío). Este índice ya trae el orden de la lista: se leen sólo las filas de la página.
CREATE INDEX IF NOT EXISTS convocatorias_entidad_orden
    ON convocatorias (entidad_ruc, (COALESCE(fecha_convocatoria, '-infinity'::date)) DESC, created_at DESC, ocid DESC);
ANALYZE convocatorias;
