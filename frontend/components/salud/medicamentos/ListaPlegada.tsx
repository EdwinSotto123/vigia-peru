import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Las primeras `n` filas de una lista y el resto plegado detrás de «Ver las N … más» (2026-11-22, el usuario: «mejora la
 * UX/UI de todo… esta mierda es texto plano»): la ficha de un medicamento con muchas alertas medía 11,000 px en el
 * celular, una pared de alertas. No se esconde nada: el resto está en la página (un <details>, funciona sin JavaScript)
 * y se abre con un toque. `items` son los <li> con su `key`; `claseLista` es la del <ul> de las dos partes.
 * Server-safe (`mas` es una función: sólo desde el servidor).
 */
export function ListaPlegada({
  items,
  n,
  mas,
  claseLista,
  className,
}: {
  items: ReactNode[];
  n: number;
  mas: (resto: number) => string;
  claseLista?: string;
  className?: string;
}) {
  const primeras = items.slice(0, n);
  const resto = items.slice(n);
  return (
    <div className={className}>
      <ul className={claseLista}>{primeras}</ul>
      {resto.length > 0 && (
        <details className="group/plegada border-t border-line">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-1.5 px-5 py-2.5 text-dato font-semibold text-granate transition-colors duration-rapido hover:bg-ink/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate [&::-webkit-details-marker]:hidden">
            <span className="group-open/plegada:hidden">{mas(resto.length)}</span>
            <span className="hidden group-open/plegada:inline">Mostrar menos</span>
            <ChevronDown size={16} aria-hidden className={cn("transition-transform duration-rapido group-open/plegada:rotate-180")} />
          </summary>
          <ul className={cn("border-t border-line", claseLista)}>{resto}</ul>
        </details>
      )}
    </div>
  );
}
