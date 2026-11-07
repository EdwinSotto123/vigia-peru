import type { FiltrosBandeja } from "./filtros.ts";
import type { DetalleOportunidad, ResultadoBandeja } from "./tipos.ts";

/**
 * La interfaz que la UI usa para leer datos (docs/PLAN.md, «Contrato de datos»). Hoy la cumple el adaptador de
 * demostración (fuente-demo.ts); mañana, uno que lea la API en vivo. Cambiar de adaptador no toca la UI.
 */
export interface FuenteLicitaciones {
  nombre: "demo" | "gobserva";
  /** La fecha de la muestra (demo) o null (en vivo). */
  tomada: string | null;
  /** Cuántos procesos trae la muestra (demo) o null (en vivo). */
  registros: number | null;
  /** Filtra, ordena, pagina y cuenta las facetas. */
  buscar(f: FiltrosBandeja): Promise<ResultadoBandeja>;
  oportunidad(id: string): Promise<DetalleOportunidad | null>;
}
