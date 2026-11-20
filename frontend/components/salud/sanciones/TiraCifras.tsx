import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CifraTira {
  Icono: LucideIcon;
  valor: string;
  etiqueta: string;
  detalle?: string;
}

/**
 * Varias cifras de una misma fuente en una franja: cada una con su ícono, el número y qué es; la fuente y su fecha, una
 * sola vez al pie (todas salen de ella). Dos por fila en el celular, todas en una desde lg. Server-safe.
 */
export function TiraCifras({ items, etiqueta, pie, className }: { items: CifraTira[]; etiqueta: string; pie: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-line bg-paper", className)}>
      <dl aria-label={etiqueta} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((x, i) => (
          <div
            key={x.etiqueta}
            className={cn(
              "min-w-0 border-line px-4 py-3.5",
              i % 2 === 1 && "border-l sm:border-l-0",
              i >= 2 && "border-t sm:border-t-0",
              i % 3 !== 0 && "sm:border-l lg:border-l-0",
              i >= 3 && "sm:border-t lg:border-t-0",
              i > 0 && "lg:border-l",
              items.length % 2 === 1 && i === items.length - 1 && "col-span-2 sm:col-span-1",
            )}
          >
            <dt className="flex items-center gap-1.5 text-meta leading-snug text-inkSoft">
              <x.Icono size={15} aria-hidden className="shrink-0 text-granate" />
              <span className="min-w-0">{x.etiqueta}</span>
            </dt>
            <dd className="mt-1 font-display text-seccion font-bold leading-tight tabular-nums text-ink">{x.valor}</dd>
            {x.detalle && <dd className="mt-0.5 text-rotulo leading-snug text-mute">{x.detalle}</dd>}
          </div>
        ))}
      </dl>
      <div className="border-t border-line bg-paperSoft px-4 py-2.5">{pie}</div>
    </div>
  );
}
