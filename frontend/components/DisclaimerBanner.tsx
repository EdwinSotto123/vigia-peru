import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DisclaimerBannerProps {
  className?: string;
}

/**
 * La postura editorial de Vigía, donde hay señales, entidades o personas cerca.
 * Es una nota en reposo: borde y fondo suave, sin sombra (DESIGN_SYSTEM.md §5).
 * Habla de "señales", la palabra del producto; "bandera roja" sonaba a veredicto.
 */
export function DisclaimerBanner({ className }: DisclaimerBannerProps) {
  return (
    <div className={cn("flex items-start gap-3 rounded-2xl border border-line bg-paperSoft px-4 py-3 text-sm leading-relaxed text-inkSoft", className)}>
      <Info size={16} className="mt-0.5 shrink-0 text-granate" aria-hidden />
      <p className="text-pretty">
        <strong className="font-semibold text-ink">Vigía Perú no acusa a nadie.</strong>{" "}
        Las señales que ves aquí salen del cruce automático de datos públicos. Cada una debe verificarla un
        periodista, un fiscal o la Contraloría antes de sacar cualquier conclusión.
      </p>
    </div>
  );
}
