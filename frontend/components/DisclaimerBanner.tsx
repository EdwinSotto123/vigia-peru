import { Info } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { cn } from "@/lib/utils";

export interface DisclaimerBannerProps {
  className?: string;
}

/**
 * La postura editorial de Vigía, donde hay señales, entidades o personas cerca.
 * Aviso inevitable = una línea + ⓘ (DESIGN_SYSTEM.md §10.7): antes era una caja de
 * tres líneas encima del dato; lo que no cabe en la línea está a un clic.
 * Habla de "señales", la palabra del producto; "bandera roja" sonaba a veredicto.
 */
export function DisclaimerBanner({ className }: DisclaimerBannerProps) {
  return (
    <p className={cn("flex flex-wrap items-center gap-x-1.5 text-[13px] text-inkSoft", className)}>
      <Info size={14} className="shrink-0 text-granate" aria-hidden />
      <strong className="font-semibold text-ink">Vigía Perú no acusa a nadie:</strong>
      <span>las señales salen del cruce automático de datos públicos.</span>
      <Ayuda titulo="¿Quién saca conclusiones?">
        Cada señal debe verificarla un periodista, un fiscal o la Contraloría antes de sacar cualquier conclusión.
      </Ayuda>
    </p>
  );
}
