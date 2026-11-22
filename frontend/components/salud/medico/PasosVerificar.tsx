import Link from "next/link";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { rutaEn } from "@/lib/gobserva";
import type { PasoVerificar } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";

/** El sitio de un paso, por su dirección: el CMP, SUNEDU o una página de este producto. */
function destino(url: string): { texto: string; externo: boolean } {
  if (url.startsWith("/")) return { texto: "Buscar el establecimiento", externo: false };
  if (/cmp\.org\.pe/i.test(url)) return { texto: "Abrir «Conoce a tu médico»", externo: true };
  if (/sunedu/i.test(url)) return { texto: "Abrir el registro de SUNEDU", externo: true };
  return { texto: "Abrir el sitio", externo: true };
}

/**
 * Los pasos para verificar a un médico, numerados (las palabras de la API: pasosVerificarMedico), cada uno con su enlace.
 * Una dirección relativa («/establecimientos») es de este producto y se arma con su base. Server-safe.
 */
export function PasosVerificar({ pasos, base, className }: { pasos: PasoVerificar[]; base: string; className?: string }) {
  return (
    <ol className={cn("space-y-5", className)}>
      {pasos.map((p, i) => {
        const d = destino(p.url);
        const clase =
          "mt-1 inline-flex min-h-11 items-center gap-1 rounded-lg text-dato font-semibold text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate sm:min-h-9";
        return (
          <li key={p.paso} className="flex gap-3.5">
            <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-granate font-mono text-dato font-bold text-paper">
              {i + 1}
            </span>
            <div className="min-w-0 pt-1">
              <p className="text-cuerpo font-semibold leading-snug text-ink">{p.paso}</p>
              <p className="mt-1 max-w-[68ch] text-pretty text-dato leading-relaxed text-inkSoft">{p.detalle}</p>
              {/* Un paso sin dirección no lleva enlace (el 2 se hace en la misma consulta del paso 1). */}
              {!p.url ? null : d.externo ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer" className={clase}>
                  {d.texto}
                  <ArrowUpRight size={14} aria-hidden />
                  <span className="sr-only"> (se abre en otra pestaña)</span>
                </a>
              ) : (
                <Link href={rutaEn(base, p.url)} prefetch={false} className={clase}>
                  {d.texto}
                  <ChevronRight size={14} aria-hidden />
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
