import { FlaskConical } from "lucide-react";
import { fechaHoraLima } from "@/lib/licitaciones-app/formato";

/**
 * Lo que se ve con datos de demostración lo dice arriba, sin esconderlo: de dónde sale la muestra, de cuándo es y dónde
 * queda lo que guardes. Desaparece con el adaptador en vivo (fuente.tomada === null).
 */
export function AvisoDemo({ tomada, total }: { tomada: string | null; total?: number }) {
  if (!tomada) return null;
  return (
    <p className="mb-4 flex items-start gap-2.5 rounded-xl border border-line bg-caja px-4 py-3 text-meta leading-relaxed text-inkSoft shadow-caja sm:mb-6">
      <FlaskConical size={16} aria-hidden className="mt-0.5 shrink-0 text-granate" />
      <span>
        <b className="font-semibold text-ink">Vista previa con datos de demostración.</b> Una muestra real de {total ? `${total} ` : ""}convocatorias de
        Gobserva tomada el {fechaHoraLima(tomada)}: la búsqueda, los filtros, el orden y la paginación funcionan sobre ella. Lo que sigas y anotes va a tu
        cuenta.
      </span>
    </p>
  );
}
