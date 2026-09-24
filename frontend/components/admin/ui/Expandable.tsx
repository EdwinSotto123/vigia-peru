import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Bloque plegable nativo (<details>/<summary>): teclado, Enter/Espacio y lector
 * de pantalla sin una línea de JS, y funciona desde un server component.
 *
 *  · `caja`  — tarjeta con borde; el resumen es la cabecera clickeable.
 *  · `linea` — enlace discreto "Ver detalle técnico ▾" dentro de un texto o una fila.
 *
 * Se pueden anidar: la flecha gira con SU `<details>` (selector
 * `details[open]>summary`), no con el de afuera.
 */
export function Expandable({
  resumen,
  meta,
  abierto,
  variante = "caja",
  className,
  children,
}: {
  resumen: React.ReactNode;
  meta?: React.ReactNode;
  abierto?: boolean;
  variante?: "caja" | "linea";
  className?: string;
  children: React.ReactNode;
}) {
  const flecha = (
    <ChevronDown size={variante === "caja" ? 16 : 13} className="shrink-0 text-inkSoft transition-transform duration-rapido [details[open]>summary_&]:rotate-180" aria-hidden />
  );
  if (variante === "linea")
    return (
      <details open={abierto} className={cn("text-[12px]", className)}>
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-inkSoft hover:text-ink [&::-webkit-details-marker]:hidden">
          {resumen}
          {flecha}
        </summary>
        <div className="mt-2">{children}</div>
      </details>
    );
  return (
    <details open={abierto} className={cn("rounded-2xl border border-line bg-paper", className)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 hover:bg-paperSoft sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 text-sm font-semibold text-ink">{resumen}</span>
        <span className="flex shrink-0 items-center gap-2 text-[12px] text-mute">
          {meta}
          {flecha}
        </span>
      </summary>
      <div className="border-t border-line px-4 py-3 sm:px-5">{children}</div>
    </details>
  );
}
