import { CheckCircle2, Clock, RotateCw } from "lucide-react";
import { ESTADO_PROC, type EstadoProc } from "@/lib/auditoria";

/**
 * Píldora de estado de un procesamiento. El estado nunca se comunica solo por
 * color: cada uno lleva texto y un icono distinto (punto pulsante = procesando).
 */
export function EstadoPill({ estado, size = "sm" }: { estado: EstadoProc; size?: "sm" | "md" }) {
  const { label, cls } = ESTADO_PROC[estado];
  const dims = size === "md" ? "px-3 py-1 text-xs" : "px-2 py-0.5 text-[11px]";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${dims} ${cls}`} role="status">
      {estado === "procesando" && (
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber" />
        </span>
      )}
      {estado === "encolado" && <Clock size={11} aria-hidden />}
      {estado === "procesado" && <CheckCircle2 size={11} aria-hidden />}
      {estado === "error" && <RotateCw size={11} className="animate-spin [animation-duration:3s]" aria-hidden />}
      {label}
    </span>
  );
}
