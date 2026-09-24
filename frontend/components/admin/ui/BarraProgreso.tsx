import { cn } from "@/lib/utils";
import { TONO, type Tone } from "./tono";

/**
 * Barra de avance con role="progressbar". Recibe `valor`/`total` (calcula el %)
 * o `pct` directo. `etiqueta` es lo que oye un lector de pantalla.
 */
export function BarraProgreso({
  valor,
  total,
  pct: pctDirecto,
  tono = "ok",
  etiqueta,
  alto = "md",
  className,
}: {
  valor?: number;
  total?: number;
  pct?: number;
  tono?: Tone;
  etiqueta: string;
  alto?: "sm" | "md" | "lg";
  className?: string;
}) {
  const p = pctDirecto ?? (total ? ((valor ?? 0) / total) * 100 : 0);
  const acotado = Math.max(0, Math.min(100, p));
  return (
    <div
      role="progressbar"
      aria-label={etiqueta}
      aria-valuenow={Math.round(acotado)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("w-full overflow-hidden rounded-full bg-paperDeep", { sm: "h-1.5", md: "h-2", lg: "h-3" }[alto], className)}
    >
      {/* Un mínimo visible cuando hay algo: 0,3 % no debe verse igual que nada. */}
      <div className={cn("h-full rounded-full", TONO[tono].barra)} style={{ width: `${acotado > 0 ? Math.max(acotado, 1.5) : 0}%` }} />
    </div>
  );
}
