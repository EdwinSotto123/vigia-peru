import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Vacío compuesto: un ícono, qué significa que no haya nada y cómo se llena.
 * `compacto` para dentro de tablas y paneles. `icono` es un nodo (no un
 * componente) para poder usarlo también desde un server component.
 */
export function EmptyState({
  titulo,
  descripcion,
  icono,
  accion,
  compacto,
  className,
}: {
  titulo: string;
  descripcion?: React.ReactNode;
  icono?: React.ReactNode;
  accion?: React.ReactNode;
  compacto?: boolean;
  className?: string;
}) {
  return (
    // Una franja de una o dos líneas: ícono, qué pasa y qué hacer. Nunca una caja alta con aire alrededor.
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", compacto ? "px-4 py-3" : "px-4 py-4 sm:px-5", className)}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-paperDeep text-inkSoft" aria-hidden>
        {icono ?? <Inbox size={16} />}
      </span>
      <div className="min-w-0 flex-1 basis-60">
        <p className="text-sm font-semibold leading-snug text-ink">{titulo}</p>
        {descripcion && <p className="mt-0.5 text-[13px] leading-snug text-mute">{descripcion}</p>}
      </div>
      {accion && <div className="flex flex-wrap gap-2">{accion}</div>}
    </div>
  );
}
