import type { ReactNode } from "react";
import { ChevronDown, Mail } from "lucide-react";
import { CORREO_GOBSERVA } from "@/lib/gobserva";

/**
 * Preguntas frecuentes en acordeón (details/summary: sin JavaScript, accesible). Desde lg, el título y el contacto a la
 * izquierda (fijos al bajar) y las preguntas a la derecha, con una medida de lectura; en el celular, uno sobre otro.
 * La usan Licitaciones y Obras. Server-safe.
 */
export function Faq({ preguntas, id = "preguntas", titulo = "Preguntas frecuentes" }: { preguntas: { p: string; r: ReactNode }[]; id?: string; titulo?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="grid scroll-mt-20 gap-5 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.6fr)] lg:gap-10">
      <div className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <h2 id={`${id}-t`} className="text-balance font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">
          {titulo}
        </h2>
        <p className="mt-3 flex items-start gap-2 text-dato leading-snug text-inkSoft">
          <Mail size={16} aria-hidden className="mt-0.5 shrink-0 text-granate" />
          <span>
            ¿Otra pregunta? Escríbenos a{" "}
            <a href={`mailto:${CORREO_GOBSERVA}`} className="font-semibold text-granate underline-offset-2 hover:underline">
              {CORREO_GOBSERVA}
            </a>
            .
          </span>
        </p>
      </div>
      <div className="min-w-0 divide-y divide-line rounded-2xl border border-line bg-paper">
        {preguntas.map((x) => (
          <details key={x.p} className="group px-4 sm:px-5">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-cuerpo font-semibold text-ink transition-colors duration-rapido hover:text-granate [&::-webkit-details-marker]:hidden">
              {x.p}
              <ChevronDown size={18} aria-hidden className="shrink-0 text-mute transition-transform duration-rapido group-open:rotate-180" />
            </summary>
            <div className="max-w-[68ch] pb-4 text-dato leading-relaxed text-inkSoft">{x.r}</div>
          </details>
        ))}
      </div>
    </section>
  );
}
