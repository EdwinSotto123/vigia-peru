import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Odometro } from "@/components/gobserva/portada/Odometro";
import { RuedaAlVer } from "@/components/gobserva/portada/RuedaAlVer";
import { Pixel } from "@/components/pixel/Pixel";
import type { NombreSprite } from "@/components/pixel/sprites";
import { cn } from "@/lib/utils";

export interface Puesto {
  sprite: NombreSprite;
  titulo: string;
  texto: ReactNode;
  /** La cifra de hoy, si la hay: «603» y lo que cuenta. */
  cifra?: { texto: string; que: ReactNode } | null;
  accion: string;
  href: string;
  /** La primera: sobre la banda oscura. */
  oscura?: boolean;
}

/**
 * «Todo en una sola cuenta» de la portada de Licitaciones (2026-11-22): lo que trae la suscripción en cinco puestos, cada
 * uno con su píxel, una frase, su cifra de hoy (rueda al aparecer) y adónde lleva. En el celular, una fila que se desliza
 * con el dedo (antes una tarjeta grande y una lista apiladas: 1,300 px); en lg, una rejilla de tres; desde xl, los cinco en
 * fila. Cada puesto es un enlace con la mira (`gs-mira`): las esquinas se cierran sobre él al pasar, enfocar o tocar.
 * Server-safe.
 */
export function TodoEnUnaCuenta({ puestos, className }: { puestos: Puesto[]; className?: string }) {
  return (
    <ul
      className={cn(
        "-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden",
        "lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-4 lg:overflow-visible lg:px-0 lg:pb-0 xl:grid-cols-5 xl:gap-3",
        className,
      )}
    >
      {puestos.map((p) => (
        <li key={p.titulo} className={cn("w-[78%] max-w-[20rem] shrink-0 snap-start lg:w-auto lg:max-w-none", p.oscura && "lg:row-span-2 xl:row-span-1")}>
          <Link
            href={p.href}
            prefetch={false}
            className={cn(
              "gs-mira group flex h-full min-w-0 flex-col rounded-3xl border p-5 transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 sm:p-6",
              p.oscura
                ? "sobre-oscuro border-paper/10 bg-ink text-paper focus-visible:ring-paper/60"
                : "border-line bg-paper hover:bg-paperSoft focus-visible:ring-granate",
            )}
          >
            <span aria-hidden className={cn("flex h-14 items-end", p.oscura && "lg:h-24 xl:h-14")}>
              <Pixel nombre={p.sprite} escala={p.oscura ? 3 : p.sprite === "obra" ? 1.75 : 2.5} acento="accion" className="px-salta" />
            </span>
            <span className={cn("mt-4 font-display text-bloque font-bold leading-snug", p.oscura ? "text-paper lg:text-seccion xl:text-bloque" : "text-ink")}>{p.titulo}</span>
            <span className={cn("mt-1.5 text-pretty text-dato leading-relaxed", p.oscura ? "text-paper/80" : "text-inkSoft")}>{p.texto}</span>
            {p.cifra && (
              <span className={cn("mt-4 flex flex-wrap items-baseline gap-x-2", p.oscura ? "text-paper" : "text-ink")}>
                <RuedaAlVer>
                  <Odometro texto={p.cifra.texto} className={cn("font-display font-bold leading-none tracking-tight", p.oscura ? "text-cifra lg:text-portada xl:text-cifra" : "text-cifra")} />
                </RuedaAlVer>
                <span className={cn("text-meta font-semibold", p.oscura ? "text-paper/80" : "text-inkSoft")}>{p.cifra.que}</span>
              </span>
            )}
            <span className={cn("mt-auto inline-flex items-center gap-1.5 pt-5 text-dato font-semibold", p.oscura ? "text-maiz" : "text-granate")}>
              {p.accion}
              <ArrowRight size={16} aria-hidden className="transition-transform duration-rapido group-hover:translate-x-1" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
