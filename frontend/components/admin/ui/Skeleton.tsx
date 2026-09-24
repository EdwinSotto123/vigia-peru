import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Esqueletos con la forma del contenido que viene (no spinners): la grilla de
 * KPI, una tabla, un panel. Cada grupo anuncia "Cargando…" una sola vez a los
 * lectores de pantalla; los bloques son aria-hidden. Nunca arrancan con
 * opacity 0: se ven desde el primer pintado del servidor.
 */

export { Skeleton as SkeletonBloque };

function Cargando({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div role="status" className={className}>
      <span className="sr-only">Cargando…</span>
      {children}
    </div>
  );
}

/** Imita una StatGrid de `n` tarjetas. */
export function SkeletonStats({ n = 4, className }: { n?: number; className?: string }) {
  return (
    <Cargando className={cn("grid grid-cols-2 gap-2 sm:gap-3", n >= 5 ? "sm:grid-cols-3 xl:grid-cols-5" : n === 3 ? "sm:grid-cols-3" : "lg:grid-cols-4", className)}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="rounded-2xl border border-line bg-paper p-3 sm:p-4" aria-hidden>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2.5 h-7 w-16" />
          <Skeleton className="mt-2 h-2.5 w-28" />
        </div>
      ))}
    </Cargando>
  );
}

/** Filas de tabla: en escritorio columnas; en el teléfono, bloques apilados como los de DataTable. */
export function SkeletonFilas({ filas = 5, columnas = 5 }: { filas?: number; columnas?: number }) {
  return (
    <Cargando>
      <div className="divide-y divide-line" aria-hidden>
        {Array.from({ length: filas }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-4">
            <div className="md:w-[30%]">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-1.5 h-3 w-full max-w-[220px]" />
            </div>
            {Array.from({ length: Math.max(0, columnas - 1) }, (_, j) => (
              <Skeleton key={j} className={cn("h-3", j % 2 ? "w-16" : "w-24", j > 1 && "hidden md:block")} />
            ))}
          </div>
        ))}
      </div>
    </Cargando>
  );
}

/** Una tabla entera dentro de su caja, con la franja de encabezados. */
export function SkeletonTabla({ filas = 5, columnas = 5, className }: { filas?: number; columnas?: number; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-line bg-paper", className)}>
      <div className="hidden gap-4 border-b border-line px-4 py-3 md:flex" aria-hidden>
        {Array.from({ length: columnas }, (_, j) => (
          <Skeleton key={j} className={cn("h-2.5", j === 0 ? "w-[28%]" : "w-16")} />
        ))}
      </div>
      <SkeletonFilas filas={filas} columnas={columnas} />
    </div>
  );
}

/** Un panel con título y `lineas` de texto. */
export function SkeletonPanel({ lineas = 3, className }: { lineas?: number; className?: string }) {
  return (
    <Cargando className={cn("rounded-2xl border border-line bg-paper p-4 sm:p-5", className)}>
      <div aria-hidden>
        <Skeleton className="h-3.5 w-40" />
        {Array.from({ length: lineas }, (_, i) => (
          <Skeleton key={i} className={cn("mt-3 h-3", i === lineas - 1 ? "w-2/3" : "w-full")} />
        ))}
      </div>
    </Cargando>
  );
}
