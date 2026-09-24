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
    <div className={cn("flex flex-col items-center text-center", compacto ? "px-4 py-8" : "px-6 py-12", className)}>
      <span className="grid h-10 w-10 place-items-center rounded-full bg-paperDeep text-inkSoft" aria-hidden>
        {icono ?? <Inbox size={18} />}
      </span>
      <p className="mt-3 text-sm font-semibold text-ink">{titulo}</p>
      {descripcion && <p className="mt-1 max-w-md text-[13px] leading-relaxed text-mute">{descripcion}</p>}
      {accion && <div className="mt-4 flex flex-wrap justify-center gap-2">{accion}</div>}
    </div>
  );
}
