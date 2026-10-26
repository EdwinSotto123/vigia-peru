import type { ReactNode } from "react";
import { DatosClave, type DatoClave } from "./Detalle";

/**
 * Una tarjeta de datos con subtítulo: agrupa un bloque de «Sus datos» (identidad SUNAT, su gente, con el Estado…) en una
 * subsección clara, en vez de un volcado plano de filas. Con `items` pinta un `DatosClave`; con `children`, lo que se le
 * pase. Pensada para ir en una rejilla de 2 columnas (`grid gap-4 lg:grid-cols-2`). Server-safe.
 */
export function TarjetaDatos({
  titulo,
  items,
  children,
  className,
}: {
  titulo?: string;
  items?: DatoClave[];
  children?: ReactNode;
  className?: string;
}) {
  return (
    <article className={`space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5${className ? ` ${className}` : ""}`}>
      {titulo && <h4 className="text-rotulo font-semibold uppercase tracking-wide text-mute">{titulo}</h4>}
      {items ? <DatosClave items={items} /> : children}
    </article>
  );
}
