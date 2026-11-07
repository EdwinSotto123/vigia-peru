import "server-only";
import muestra from "./datos/muestra.json";
import { crearFuenteDemo, type Muestra } from "./fuente-demo.ts";
import type { FuenteLicitaciones } from "./fuente-tipo.ts";

export type { FuenteLicitaciones } from "./fuente-tipo.ts";

/**
 * La fuente de datos de la app, elegida en un solo lugar. En esta etapa es la de demostración: una muestra real tomada de
 * nuestra API (docs/PLAN.md). El adaptador en vivo (`gobserva`) entra aquí, con LICITACIONES_FUENTE, sin tocar la UI.
 */
let fuente: FuenteLicitaciones | null = null;

export function getFuente(): FuenteLicitaciones {
  fuente ??= crearFuenteDemo(muestra as Muestra);
  return fuente;
}
