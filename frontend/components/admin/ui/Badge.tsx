import { cn } from "@/lib/utils";
import { TONO, type Tone } from "./tono";

/** Etiqueta de estado con los colores de su tono; `punto` antepone el punto del mismo tono. */
export function Badge({
  tono = "neutral",
  punto,
  title,
  className,
  children,
}: {
  tono?: Tone;
  punto?: boolean;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium leading-4", TONO[tono].badge, className)}>
      {punto && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONO[tono].punto)} aria-hidden />}
      {children}
    </span>
  );
}

/** Punto suelto de un tono (leyendas, filas de lista). */
export function Punto({ tono = "neutral", className }: { tono?: Tone; className?: string }) {
  return <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", TONO[tono].punto, className)} aria-hidden />;
}
