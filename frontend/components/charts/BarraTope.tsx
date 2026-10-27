import { porcentaje, soles } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * Un monto contra su tope, para «al borde del tope»: la barra llega hasta el monto, la franja del 95 % al 100 % va
 * sombreada y una raya marca el tope (el monto desde el cual la ley pide un proceso de selección). La escala empieza en
 * cero, para no exagerar lo cerca que quedó: lo dice el porcentaje, en texto. Server-safe.
 */
export function BarraTope({ monto, tope, desde = 0.95, className }: { monto: number; tope: number; desde?: number; className?: string }) {
  if (!(tope > 0) || !Number.isFinite(monto)) return null;
  const parte = Math.max(0, Math.min(1, monto / tope));
  const pct = porcentaje(parte * 100, { decimales: 1 });
  return (
    <figure className={cn("space-y-1.5", className)}>
      <div role="img" aria-label={`${soles(monto)}, el ${pct} del tope de ${soles(tope)}`} className="relative h-4">
        <span aria-hidden className="absolute inset-x-0 top-1.5 h-1 rounded-full bg-paperDeep" />
        <span
          aria-hidden
          className="absolute top-0 h-4 rounded-sm bg-amber-soft ring-1 ring-inset ring-amber/40"
          style={{ left: `${desde * 100}%`, width: `${(1 - desde) * 100}%` }}
        />
        <span aria-hidden className="absolute left-0 top-1.5 h-1 rounded-full bg-granate" style={{ width: `${parte * 100}%` }} />
        <span aria-hidden className="absolute -top-0.5 right-0 h-5 w-0.5 rounded-full bg-ink" />
      </div>
      <figcaption className="flex items-baseline justify-between gap-3 text-rotulo text-mute">
        <span className="font-mono tabular-nums">S/ 0</span>
        <span>
          Franja del {porcentaje(desde * 100)} al 100 %, y el tope: <span className="font-mono tabular-nums text-inkSoft">{soles(tope)}</span>
        </span>
      </figcaption>
    </figure>
  );
}
