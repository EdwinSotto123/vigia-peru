-- 85 · Gastos de campaña: el total de cada organización, no el de toda la elección.
--
-- `total_op` de ONPE Claridad (consultaProveedor.totalGasto) es el mismo número en todas las filas de un proceso: la
-- suma de lo que declararon TODAS las organizaciones (ERM 2022: S/ 126,974,791 para las 132). La evidencia de "le
-- vendió a una campaña" lo mostraba como "gasto total de la campaña" y la parte del gasto salía mal. Ahora la API suma
-- lo de la organización (proceso + organización), con este índice para que sea inmediato.
--
-- Cómo aplicarla: psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/85_gasto_campana_por_organizacion.sql

CREATE INDEX IF NOT EXISTS onpe_gastos_proveedores_org ON onpe_gastos_proveedores (proceso, organizacion);
COMMENT ON COLUMN onpe_gastos_proveedores.total_op IS
  'Total declarado por TODAS las organizaciones en el proceso (ONPE lo repite en cada fila); el de una organización es sum(monto) por proceso y organización';
