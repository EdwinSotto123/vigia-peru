import { cn } from "@/lib/utils";

/**
 * Placeholder de carga con un barrido de brillo (usa `shimmerSweep`, definido en
 * tailwind.config pero sin un solo uso real hasta ahora — el resto del sitio usaba
 * `animate-pulse` genérico). Puro CSS, sin estado ni cliente: sirve igual en un
 * server o un client component.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-shimmerSweep rounded bg-gradient-to-r from-paperDeep via-paper to-paperDeep bg-[length:200%_100%]",
        className,
      )}
      aria-hidden
    />
  );
}
