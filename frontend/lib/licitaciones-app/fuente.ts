import "server-only";
import muestra from "./datos/muestra.json";
import { crearFuenteDemo, type Muestra } from "./fuente-demo.ts";
import { crearFuenteGobserva } from "./fuente-gobserva";
import type { FuenteLicitaciones } from "./fuente-tipo.ts";

export type { FuenteLicitaciones } from "./fuente-tipo.ts";

/**
 * La fuente de datos de la app, elegida en un solo lugar (docs/PLAN.md): en producción, la API en vivo; en desarrollo
 * (sin API local), la muestra de demostración. LICITACIONES_FUENTE=demo|gobserva lo fuerza. La UI no cambia.
 */
let fuente: FuenteLicitaciones | null = null;

export function getFuente(): FuenteLicitaciones {
  const elegida = process.env.LICITACIONES_FUENTE ?? (process.env.NODE_ENV === "production" ? "gobserva" : "demo");
  fuente ??= elegida === "demo" ? crearFuenteDemo(muestra as Muestra) : crearFuenteGobserva();
  return fuente;
}
