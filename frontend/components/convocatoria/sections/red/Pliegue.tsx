import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Lo que se lee a pedido dentro de un capítulo (el detalle persona por persona, quién firma en la entidad, lo que
 * escribió el agente): una fila con su título, cuántos hay y una línea de qué trae; al abrirla, el contenido debajo,
 * sin otra caja alrededor (las secciones de adentro ya traen la suya). Nativo (`<details>`): sin JS y con teclado.
 */
export function Pliegue({
  titulo,
  detalle,
  cuenta,
  icono,
  abierto = false,
  children,
  className,
}: {
  titulo: string;
  detalle?: ReactNode;
  cuenta?: number | null;
  icono?: ReactNode;
  abierto?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={cn("group", className)} open={abierto || undefined}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-xl border border-line bg-paper px-3.5 py-2.5 [.tarjeta_&]:border-transparent [.tarjeta_&]:bg-paperSoft transition-colors duration-rapido hover:border-paperEdge hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate group-open:border-paperEdge [&::-webkit-details-marker]:hidden">
        {icono && <span className="shrink-0 text-mute" aria-hidden>{icono}</span>}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 text-dato font-semibold text-ink">
            {titulo}
            {cuenta != null && cuenta > 0 && <span className="rounded-full bg-paperDeep px-1.5 font-mono text-rotulo tabular-nums text-inkSoft">{cuenta}</span>}
          </span>
          {detalle && <span className="mt-0.5 block text-meta leading-snug text-mute">{detalle}</span>}
        </span>
        <ChevronRight size={16} className="shrink-0 text-mute transition-transform duration-rapido group-open:rotate-90" aria-hidden />
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
