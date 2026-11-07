-- 265 · Guardar contratos menores (Gobserva Licitaciones, 2026-11-07).
--
-- El seguimiento (tablero y calendario de la cuenta) junta las licitaciones guardadas (tipo 'oportunidad', ref = ocid)
-- y los contratos menores en cotización (tipo 'menor', ref = id_prod6 de seace_cotizacion, migración 262), que cierran
-- en días y son los que más necesitan su fecha a la vista.

ALTER TABLE public.gobserva_guardados DROP CONSTRAINT IF EXISTS gobserva_guardados_tipo_check;
ALTER TABLE public.gobserva_guardados
  ADD CONSTRAINT gobserva_guardados_tipo_check CHECK (tipo IN ('plaza', 'oportunidad', 'proyecto', 'empresa', 'entidad', 'menor'));
