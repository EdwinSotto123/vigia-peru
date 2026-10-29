/**
 * Paginación de GET /financiamiento/recientes: la cinta de "Últimos aportes" pide 20 (el valor de
 * siempre) y la página con todos los aportes pide de a 25. Un tope de 100 por pedido. `q` busca en el
 * nombre público del aliado, el código del comprobante y la zona, la entidad o el partido del aporte. `semilla=no` deja
 * fuera el capital semilla de Vigía Perú (pasarela 'institucional'): la cinta del podio muestra a quienes se suman; la
 * lista de todos los aportes, todo.
 */

import { z } from "zod";

export const RecientesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  q: z.string().trim().min(2).max(80).optional(),
  semilla: z.enum(["no"]).optional(),
});

export type RecientesParams = z.infer<typeof RecientesQuery>;

/** Los parámetros de la URL, o null si alguno no es válido (la ruta responde 400). */
export function leerRecientes(params: Record<string, string>): RecientesParams | null {
  const r = RecientesQuery.safeParse(params);
  return r.success ? r.data : null;
}
