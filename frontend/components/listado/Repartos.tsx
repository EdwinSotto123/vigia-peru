import type { ReactNode } from "react";
import { ChevronDown, PieChart } from "lucide-react";
import { cn } from "@/lib/utils";
import { BarraPartes, type ParteBarra } from "@/components/inicio/BarraPartes";
import { numero } from "@/lib/formato";

/**
 * El panorama de una lista, sobre su tabla: cómo se reparte lo que hay (por tipo, por riesgo, por antecedentes), cada
 * reparto en su columna con su barra segmentada y su leyenda, y cada parte de la leyenda como enlace a la lista ya
 * filtrada. Es el mismo patrón que la barra de «Partidos y gobiernos»: antes de leer 25 filas se ve el conjunto.
 *
 * En escritorio, una caja con hasta tres columnas separadas por una raya. En el celular va plegado en una línea («Cómo
 * se reparten»), para que la primera fila de la lista no baje una pantalla. Sin estado: sirve en el servidor.
 *
 * Cada hijo es un `RepartoInicio` (severidad) o un `RepartoPartes` (categorías con los colores de serie).
 */
export function Repartos({ titulo = "Cómo se reparten", children, className }: { titulo?: string; children: ReactNode; className?: string }) {
  const columnas = "grid gap-px bg-line md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0 [&>*]:bg-paper [&>*]:px-4 [&>*]:py-3.5";
  return (
    <>
      <section aria-label={titulo} className={cn("hidden overflow-hidden rounded-xl border border-line md:block", className)}>
        <div className={columnas}>{children}</div>
      </section>
      <details className={cn("group/reparto overflow-hidden rounded-xl border border-line bg-paper md:hidden", className)}>
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3.5 text-dato font-semibold text-ink [&::-webkit-details-marker]:hidden">
          <PieChart size={16} className="shrink-0 text-granate" aria-hidden />
          <span className="min-w-0 flex-1">{titulo}</span>
          <ChevronDown size={16} className="shrink-0 text-mute transition-transform duration-rapido group-open/reparto:rotate-180" aria-hidden />
        </summary>
        <div className={cn(columnas, "border-t border-line")}>{children}</div>
      </details>
    </>
  );
}

/** Un reparto por categorías (tipo de compra, nivel de gobierno): título, de cuántos es, barra y leyenda con enlaces. */
export function RepartoPartes({ titulo, de, partes, etiqueta }: { titulo: string; de?: string; partes: ParteBarra[]; etiqueta?: string }) {
  const total = partes.reduce((s, p) => s + p.n, 0);
  if (total <= 0) return null;
  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-meta font-semibold text-ink">{titulo}</p>
        <p className="text-rotulo tabular-nums text-mute">{de ?? `de ${numero(total)}`}</p>
      </div>
      <BarraPartes leyenda="en-linea" etiqueta={etiqueta ?? titulo} partes={partes} />
    </div>
  );
}
