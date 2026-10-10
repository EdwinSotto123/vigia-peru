import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Un aviso fijo y visible: lo que "por partido" significa y no significa. Server-safe, sin estado.
 * `tono="neutro"` es el aviso de cautela (una señal no es una acusación); el de siempre explica el método.
 */
export function Aviso({ children, tono = "lima", className }: { children: React.ReactNode; tono?: "lima" | "neutro"; className?: string }) {
  return (
    <p
      role="note"
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[14px] leading-snug text-ink",
        tono === "lima" ? "border-granate/30 bg-granate-50" : "border-line bg-paperSoft text-inkSoft",
        className,
      )}
    >
      <Info size={16} className="mt-0.5 shrink-0 text-granate" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
