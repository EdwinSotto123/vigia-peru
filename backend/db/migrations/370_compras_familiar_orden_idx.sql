-- 370 · Índice para la bandera de la orden «familiar de quien trabaja en compras» (migraciones 364-369).
--
-- La lista de órdenes pregunta, por cada fila de la página, si esa orden (entidad, empresa, número y fecha) está entre
-- las ventas emitidas con la persona en el puesto; y el filtro por esa bandera parte de esas mismas filas.

CREATE INDEX IF NOT EXISTS funcionario_compras_familiar_venta_orden
  ON funcionario_compras_familiar_venta (entidad_ruc, empresa_ruc, orden, fecha)
  WHERE momento = 'en_puesto' AND tipo = 'orden' AND empresa_ruc <> '';
