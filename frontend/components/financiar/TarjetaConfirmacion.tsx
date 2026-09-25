import type { ReactNode } from "react";
import { FranjaTextil, Llamita } from "@/components/marca";
import { cn } from "@/lib/utils";

/**
 * El momento de confirmación de la conversión (DESIGN_SYSTEM.md §2.3 y §14): la
 * franja textil de 8 px en el tope de la tarjeta y la llamita que le habla a quien
 * acaba de financiar. Es la ÚNICA llamita de la pantalla cuando aparece: por eso
 * vive sólo en los estados finales del formulario (aporte recibido, lote procesado)
 * y en los que no dejan avanzar (zona sin contratos, aportes cerrados).
 *
 * La llamita nunca va junto a una señal, una entidad o una persona: acá acompaña
 * un trámite, no un resultado. `aria-live` porque aparece en lugar del formulario.
 */
export function TarjetaConfirmacion({
  titulo,
  children,
  acciones,
  pie,
  franja = true,
  className,
}: {
  titulo: ReactNode;
  /** Qué pasó y qué sigue, en palabras. */
  children?: ReactNode;
  /** Enlaces o botones ya armados (nunca funciones desde un server component). */
  acciones?: ReactNode;
  /** Letra chica al pie: "hacer otro aporte", el código a guardar. */
  pie?: ReactNode;
  /** Sin franja cuando la pantalla ya tiene una (la franja es una por pantalla). */
  franja?: boolean;
  className?: string;
}) {
  return (
    <div aria-live="polite" className={cn("overflow-hidden rounded-2xl border border-line bg-paper", className)}>
      {franja && <FranjaTextil alto={8} />}
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-3.5">
          <Llamita className="mt-0.5 w-9 text-granate" />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl font-bold leading-snug text-ink text-balance">{titulo}</h2>
            {children && <div className="mt-2 text-sm leading-relaxed text-inkSoft text-pretty">{children}</div>}
          </div>
        </div>
        {acciones && <div className="mt-5 flex flex-wrap items-center gap-2">{acciones}</div>}
        {pie && <div className="mt-4 text-[12px] leading-relaxed text-mute">{pie}</div>}
      </div>
    </div>
  );
}
