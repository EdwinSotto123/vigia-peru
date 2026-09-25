import { ArrowRight } from "lucide-react";
import { MIN_CONTRATOS } from "@/lib/financiamiento";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";

/**
 * La ÚNICA invitación a financiar de /app/aliados y de la ficha de un aliado, al pie.
 * Antes cada página armaba la suya (dos copias del mismo bloque con el mínimo escrito
 * a mano); el mínimo sale ahora de `MIN_CONTRATOS`, el mismo CHECK que exige el API.
 *
 * Es un momento de marca (DESIGN_SYSTEM.md §3.8): granate profundo, texto papel, el
 * maíz como acento y el botón `oscuro` (papel con texto granate). `sobre-oscuro` pasa
 * el anillo de foco a maíz.
 */
export function InvitacionFinanciar({ className = "" }: { className?: string }) {
  return (
    <section
      aria-labelledby="invitacion-financiar"
      className={`sobre-oscuro flex flex-wrap items-center justify-between gap-x-6 gap-y-4 rounded-2xl bg-granate-deep px-5 py-6 text-paper sm:px-7 ${className}`}
    >
      <div className="max-w-[60ch]">
        <h2 id="invitacion-financiar" className="font-display text-lg font-bold leading-snug text-balance">
          Financia la lectura de los contratos de tu zona
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-paper/80 text-pretty">
          Desde <span className="font-semibold text-maiz">{MIN_CONTRATOS} contratos</span>, con tu nombre o sin él. Se
          cuenta en contratos leídos, nunca en soles.
        </p>
      </div>
      <EnlaceAccion variante="oscuro" href="/app/financiar" className="shrink-0">
        Elegir una zona <ArrowRight size={14} aria-hidden />
      </EnlaceAccion>
    </section>
  );
}
