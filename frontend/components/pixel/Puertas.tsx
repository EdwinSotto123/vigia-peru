import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Las puertas de una portada de Gobserva (2026-11-21, como las de gobserva.cloud): una por cada cosa que alguien viene a
 * hacer, dicha en primera persona («Acabo de egresar», «Quiero verificar a mi médico»), con su gente de píxeles parada en
 * el mismo suelo, lo que encuentra adentro y adónde lleva. Las puertas comparten una sola placa, separadas por filetes
 * (la calle), no son tarjetas sueltas. En el celular cada puerta es una fila (la gente a la izquierda) para que entren
 * varias en una pantalla. Al pasar o enfocar, la gente salta (`.px-salta`, quieta con movimiento reducido).
 * La gente es decorativa: el texto de la puerta lo dice todo. Server-safe.
 */
export interface Puerta {
  /** La escena de píxeles: una persona (con `className="px-salta"`) y, si hace falta, lo que la acompaña. */
  gente: ReactNode;
  /** Lo que viene a hacer, en primera persona. */
  necesidad: string;
  /** Lo que encuentra adentro (puede llevar una cifra en negrita). */
  que: ReactNode;
  /** La acción del enlace: «Ver esas plazas». */
  accion: string;
  href: string;
}

// 2: cuatro puertas en dos filas (Salud dentro de la app, con la barra lateral: cuatro en fila no entran).
const COLUMNAS: Record<2 | 3 | 4, string> = {
  2: "sm:grid-cols-2",
  3: "md:grid-cols-3",
  4: "sm:grid-cols-2 xl:grid-cols-4",
};

export function Puertas({ puertas, columnas = 3, etiqueta, className }: { puertas: Puerta[]; columnas?: 2 | 3 | 4; etiqueta: string; className?: string }) {
  return (
    <ul aria-label={etiqueta} className={cn("grid gap-px overflow-hidden rounded-3xl border border-line bg-line", COLUMNAS[columnas], className)}>
      {puertas.map((p) => (
        <li key={p.href} className="min-w-0 bg-paper">
          <Link
            href={p.href}
            prefetch={false}
            className={cn(
              "group grid h-full grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-4 p-4 transition-colors duration-rapido hover:bg-paperSoft",
              "focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate",
              columnas === 3 ? "md:flex md:flex-col md:p-6" : "sm:flex sm:flex-col sm:p-6",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "flex h-24 items-end justify-center gap-2 border-b-[6px] border-dashed border-[rgb(var(--px-linea)/0.25)]",
                columnas === 3 ? "md:h-28 md:w-full md:justify-start md:gap-3 md:px-1" : "sm:h-28 sm:w-full sm:justify-start sm:gap-3 sm:px-1",
              )}
            >
              {p.gente}
            </span>
            <span className={cn("flex min-w-0 flex-col self-stretch", columnas === 3 ? "md:mt-5 md:flex-1" : "sm:mt-5 sm:flex-1")}>
              <span className="text-balance font-display text-bloque font-bold leading-snug text-ink sm:text-seccion">{p.necesidad}</span>
              <span className="mt-1.5 text-pretty text-dato leading-relaxed text-inkSoft">
                {p.que}
              </span>
              <span className="mt-3 inline-flex items-center gap-1 whitespace-nowrap text-dato font-semibold text-granate md:mt-auto md:pt-4">
                {p.accion}
                <ArrowRight size={15} aria-hidden className="transition-transform duration-rapido group-hover:translate-x-0.5" />
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
