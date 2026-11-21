import Link from "next/link";
import { numero } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";

/**
 * Las sanciones firmes por año de emisión, como barras que filtran (2026-11-21; antes eran pastillas «2025 714»): de
 * izquierda a derecha en el tiempo, el alto es la cifra, y tocar un año filtra la lista (tocarlo otra vez lo quita). La
 * cifra va escrita sobre cada barra: no hay que adivinarla por el alto. Es todo el registro, no lo filtrado (lo dice el
 * título). En el celular se desliza de lado, empezando por los años recientes. Server-safe.
 */
export function BarrasAnio({
  porAnio,
  activo,
  enlace,
}: {
  porAnio: { anio: number; n: number }[];
  activo: number | null;
  enlace: (anio: number | undefined) => string;
}) {
  // Del más reciente al más antiguo en el HTML y `flex-row-reverse` en pantalla: se ve de izquierda a derecha en el
  // tiempo y, en el celular, donde las barras no entran, el deslizamiento arranca en los años recientes.
  const anios = [...porAnio].sort((a, b) => b.anio - a.anio);
  const max = Math.max(1, ...anios.map((a) => a.n));
  return (
    <nav aria-label="Sanciones por año de emisión" className="mt-5 rounded-2xl border border-line bg-paper px-4 pb-3 pt-3.5 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-bloque font-bold leading-snug text-ink">Sanciones por año de emisión, en todo el registro</h2>
        {activo != null ? (
          <Link href={enlace(undefined)} prefetch={false} className="text-meta font-semibold text-granate underline-offset-4 hover:underline">
            Ver todos los años
          </Link>
        ) : (
          <span className="text-meta text-mute">Toca un año para ver sólo ese</span>
        )}
      </div>
      <ul className="-mx-1 mt-3 flex flex-row-reverse items-end gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {anios.map((a) => {
          const es = activo === a.anio;
          const alto = Math.max(4, Math.round((a.n / max) * 96));
          return (
            <li key={a.anio} className="min-w-11 flex-1">
              <Link
                href={enlace(es ? undefined : a.anio)}
                prefetch={false}
                aria-current={es ? "true" : undefined}
                aria-label={`${a.anio}: ${numero(a.n)} ${a.n === 1 ? "sanción" : "sanciones"}${es ? " (quitar el filtro)" : ""}`}
                className="group flex flex-col items-center gap-1 rounded-lg px-0.5 pt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
              >
                <span className={cn("text-rotulo tabular-nums", es ? "font-bold text-ink" : "text-inkSoft group-hover:text-ink")}>{numero(a.n)}</span>
                <span
                  aria-hidden
                  className={cn(
                    "w-full rounded-t-md transition-colors duration-rapido",
                    es ? "bg-granate" : activo != null ? "bg-ink/15 group-hover:bg-granate/60" : "bg-granate/45 group-hover:bg-granate/80",
                  )}
                  style={{ height: alto }}
                />
                <span className={cn("text-rotulo tabular-nums", es ? "font-bold text-ink" : "text-mute group-hover:text-ink")}>{a.anio}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
