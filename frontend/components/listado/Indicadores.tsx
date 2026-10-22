import type { ReactNode } from "react";
import { CifrasEnFila, CifrasEnFilaSkeleton, type Cifra } from "@/components/ui/CifrasEnFila";

/**
 * Las cifras de cabecera de una vista (DESIGN_SYSTEM.md §14.1): 1 a 4 tarjetas iguales, cada una con
 * lo que ES arriba, el número grande y su contexto (denominador, fuente, fecha) en tercer nivel.
 *
 * Dibuja `CifrasEnFila` (ver ahí la historia: cajas casi vacías, después una franja con la etiqueta
 * al lado del número que se partía en cuatro renglones, ahora tarjetas apiladas de ancho parejo).
 * La API no cambió: todas las llamadas siguen igual.
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
  /** Dos por fila en todos los anchos: para una columna angosta. */
  apilado?: boolean;
}) {
  return <CifrasEnFila items={items} pie={pie} className={className} apilado={apilado} />;
}

/** Las mismas tarjetas mientras llegan los datos: números en esqueleto, nunca un 0 provisional. */
export function IndicadoresSkeleton({ n = 4, className }: { n?: number; className?: string }) {
  return <CifrasEnFilaSkeleton n={n} className={className} />;
}
