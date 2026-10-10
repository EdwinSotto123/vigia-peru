import { cn } from "@/lib/utils";

/**
 * Anillo de progreso (SVG, sin estado): `pct` de 0 a 100. Con poco avance se dibuja un arco mínimo para
 * que se vea que hay algo, nunca para exagerar la cifra: el número real va al lado.
 */
export function AnilloProgreso({ pct, tamano = 56, className }: { pct: number; tamano?: number; className?: string }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  const visible = p > 0 ? Math.max(p, 2.5) : 0;
  return (
    <svg viewBox="0 0 56 56" width={tamano} height={tamano} aria-hidden className={cn("shrink-0 -rotate-90", className)}>
      <circle cx="28" cy="28" r={r} fill="none" strokeWidth="6" className="stroke-paperDeep" />
      <circle
        cx="28" cy="28" r={r} fill="none" strokeWidth="6" strokeLinecap="round"
        className="stroke-granate"
        strokeDasharray={`${(circ * visible) / 100} ${circ}`}
      />
    </svg>
  );
}
