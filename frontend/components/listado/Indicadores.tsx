import type { ReactNode } from "react";
import { CifrasEnFila, CifrasEnFilaSkeleton, type Cifra } from "@/components/ui/CifrasEnFila";

/**
 * Las cifras de cabecera de una vista (DESIGN_SYSTEM.md §14.1): 1 a 4, cada una con el número
 * grande, lo que ES al lado y su contexto (denominador, fuente, fecha) en tercer nivel.
 *
 * Desde el refactor de densidad (octubre 2026) dibuja una FRANJA (`CifrasEnFila`, unos 48 px de
 * alto, filetes entre cifras) en vez de una cuadrícula de cajas de 270 x 110 px casi vacías. La API
 * no cambió: todas las llamadas siguen igual.
 *
 * Server-safe. `href` convierte la cifra en la entrada a su lista filtrada.
 */

export type Indicador = Cifra;

export function Indicadores({
  items,
  pie,
  className,
  apilado,
}: {
  items: Indicador[];
  /** Una barra debajo de las cifras: cómo se reparten (con `marca` en cada cifra). */
  pie?: ReactNode;
  className?: string;
  /** Número arriba y etiqueta debajo en todos los anchos: para una columna angosta. */
  apilado?: boolean;
}) {
  return <CifrasEnFila items={items} pie={pie} className={className} apilado={apilado} />;
}

/** La misma franja mientras llegan los datos: números en esqueleto, nunca un 0 provisional. */
export function IndicadoresSkeleton({ n = 4, className }: { n?: number; className?: string }) {
  return <CifrasEnFilaSkeleton n={n} className={className} />;
}
