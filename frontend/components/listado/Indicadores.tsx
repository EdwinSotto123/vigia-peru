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
  franja,
}: {
  items: Indicador[];
  /** Una barra debajo de las cifras: cómo se reparten (con `marca` en cada cifra). */
  pie?: ReactNode;
  className?: string;
  /** Dos por fila en todos los anchos: para una columna angosta. */
  apilado?: boolean;
  /** Una franja baja en vez de tarjetas: las cifras de cabecera de una lista (entidades, empresas, contratos). */
  franja?: boolean;
}) {
  return <CifrasEnFila items={items} pie={pie} className={className} apilado={apilado} franja={franja} />;
}

/** Las mismas tarjetas mientras llegan los datos: números en esqueleto, nunca un 0 provisional. */
export function IndicadoresSkeleton({ n = 4, className, franja }: { n?: number; className?: string; franja?: boolean }) {
  return <CifrasEnFilaSkeleton n={n} className={className} franja={franja} />;
}
