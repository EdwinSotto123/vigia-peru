import type { ReactNode } from "react";
import { Info } from "lucide-react";

/**
 * Aviso de sección vacía DENTRO del informe: dice por qué no hay nada, en vez de dejar la
 * pestaña en blanco. No es `EstadoVacio` a propósito: ese patrón trae la llamita, y el
 * informe es evidencia (DESIGN_SYSTEM.md §2.3 y §6): la llamita no va junto a una entidad,
 * un proveedor o una señal. La llamita queda para los estados de la página entera
 * (cargando, no encontrado, error).
 */
export function AvisoSeccion({ titulo, children, icono }: { titulo: string; children?: ReactNode; icono?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-line bg-paperSoft p-5">
      <span className="mt-0.5 shrink-0 text-mute">{icono ?? <Info size={16} aria-hidden />}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{titulo}</p>
        {children && <div className="mt-1 max-w-[68ch] text-[13px] leading-relaxed text-inkSoft text-pretty">{children}</div>}
      </div>
    </div>
  );
}
