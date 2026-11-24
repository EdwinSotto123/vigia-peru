import Link from "next/link";
import { Check, Clock3 } from "lucide-react";
import type { Plan } from "@/components/gobserva/Planes";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { cn } from "@/lib/utils";

/**
 * Los planes en la portada de Gobserva Empleo, cortos (2026-11-22, «portadas más cortas»): cada plan con su precio, para
 * quién es y lo primero que incluye; la lista completa y lo que viene, en /planes (el enlace va en la cabecera). En el celular se deslizan en fila (las
 * tres tarjetas apiladas eran casi 2,000 px); desde md, en columnas. Al pasar por su botón, la mira cierra la tarjeta.
 * Server-safe.
 */
export function PlanesCortos({ planes, className }: { planes: Plan[]; className?: string }) {
  return (
    <div className={className}>
      <ul
        aria-label="Planes"
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 md:mx-0 md:grid md:snap-none md:grid-cols-3 md:gap-4 md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden"
      >
        {planes.map((p) => {
          return (
            <li
              key={p.id}
              className={cn(
                "gs-mira flex w-[84%] shrink-0 snap-start flex-col rounded-3xl border bg-paper p-5 sm:w-[60%] md:w-auto",
                p.destacado ? "border-granate shadow-[0_10px_30px_-18px_rgb(var(--granate)/0.7)]" : "border-line",
              )}
            >
              <p className="font-display text-bloque font-bold text-ink">{p.nombre}</p>
              <p className="mt-1 text-dato leading-snug text-inkSoft">{p.para}</p>
              {p.proximamente ? (
                <p className="mt-4">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-paperDeep px-3 py-1 text-dato font-semibold text-inkSoft">
                    <Clock3 size={14} aria-hidden /> Próximamente
                  </span>
                </p>
              ) : (
              <p className="mt-4 flex flex-wrap items-baseline gap-x-2">
                <span className="font-display text-cifra font-bold leading-none tracking-[-0.02em] text-ink">{p.precio}</span>
                {p.periodo && <span className="text-dato text-mute">{p.periodo}</span>}
                {p.antes && <s className="text-dato text-mute">{p.antes}</s>}
              </p>
              )}
              {p.nota && <p className="mt-1.5 text-meta font-semibold text-granate">{p.nota}</p>}
              <ul className="mt-4 space-y-2 border-t border-line pt-4">
                {/* recorte: en la portada, lo primero que incluye cada plan; todo, en /planes (enlace en la cabecera) */}
                {p.incluye.slice(0, 3).map((x) => (
                  <li key={x} className="flex items-start gap-2 text-dato leading-snug text-ink">
                    <Check size={15} strokeWidth={3} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                    <span>{x}</span>
                  </li>
                ))}
                {/* recorte: un plan «próximamente» no trae nada hoy; en la portada, lo primero que vendrá (todo, en /planes) */}
                {p.proximamente && (p.pronto ?? []).slice(0, 3).map((x) => (
                  <li key={x} className="flex items-start gap-2 text-dato leading-snug text-inkSoft">
                    <Clock3 size={15} aria-hidden className="mt-0.5 shrink-0 text-mute" />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
              {!p.proximamente && (
                <div className="mt-auto pt-5">
                  <Link href={p.accion.href} className={claseAccion(p.destacado ? "primario" : "secundario", "min-h-11 w-full")}>
                    {p.accion.etiqueta}
                  </Link>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
