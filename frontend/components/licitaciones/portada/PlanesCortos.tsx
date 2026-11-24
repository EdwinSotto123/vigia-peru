import Link from "next/link";
import { Clock3, Sparkles } from "lucide-react";
import type { Plan } from "@/components/gobserva/Planes";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { cn } from "@/lib/utils";

/**
 * Los planes en la portada de Licitaciones, cortos (2026-11-22): nombre, para quién, precio y la acción; lo que incluye
 * cada uno está en /planes, con la tabla para comparar. Las tarjetas completas medían 3,000 px en el celular y 1,350 en
 * la computadora; así es una fila que se desliza en el celular y una fila de cinco desde lg. Van sobre la banda oscura del
 * cierre, como placas translúcidas (la mira se ve clara); el recomendado lleva borde e insignia maíz. Mismos datos
 * (planesLicitaciones). Server-safe.
 */
export function PlanesCortos({ planes, className }: { planes: Plan[]; className?: string }) {
  return (
    <ol
      className={cn(
        "-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 pt-3 [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden",
        "lg:mx-0 lg:grid lg:grid-cols-5 lg:gap-3 lg:overflow-visible lg:px-0 lg:pb-0",
        className,
      )}
    >
      {planes.map((p) => (
        <li
          key={p.id}
          id={`plan-${p.id}`}
          className={cn(
            "gs-mira relative flex w-[62%] max-w-[15rem] shrink-0 snap-start scroll-mt-24 flex-col rounded-2xl border p-4 sm:p-5 lg:w-auto lg:max-w-none",
            p.destacado ? "border-maiz bg-paper/[0.1]" : "border-paper/15 bg-paper/[0.05]",
          )}
        >
          {p.destacado && (
            <span className="absolute -top-3 left-4 inline-flex items-center gap-1 rounded-full bg-maiz px-2.5 py-0.5 text-rotulo font-semibold text-sobreMaiz">
              <Sparkles size={12} aria-hidden /> Recomendado
            </span>
          )}
          <h3 className="font-display text-bloque font-bold leading-tight text-paper">{p.nombre}</h3>
          <p className="mt-1 text-meta leading-snug text-paper/70">{p.para}</p>
          {p.proximamente ? (
            <p className="mt-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-paper/[0.12] px-2.5 py-1 text-meta font-semibold text-paper/85">
                <Clock3 size={13} aria-hidden /> Próximamente
              </span>
            </p>
          ) : (
          <p className="mt-3 flex flex-wrap items-baseline gap-x-1.5">
            <span className="font-display text-cifra font-bold leading-none tracking-tight tabular-nums text-paper">{p.precio}</span>
            {p.periodo && <span className="text-meta text-paper/75">{p.periodo}</span>}
            {p.antes && (
              <span className="text-meta tabular-nums text-paper/55 line-through">
                <span className="sr-only">Antes </span>
                {p.antes}
              </span>
            )}
          </p>
          )}
          {p.nota && <p className="mt-1 text-pretty text-rotulo font-medium text-maiz">{p.nota}</p>}
          <span aria-hidden className="min-h-4 flex-1" />
          {!p.proximamente && (
            <Link href={p.accion.href} className={claseAccion(p.destacado ? "oscuro" : "contornoOscuro", "w-full text-center")}>
              {p.accion.etiqueta}
            </Link>
          )}
        </li>
      ))}
    </ol>
  );
}
