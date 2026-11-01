import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** Preguntas frecuentes en acordeón (details/summary: sin JavaScript, accesible). Server-safe. */
export function Faq({ preguntas, id = "preguntas", titulo = "Preguntas frecuentes" }: { preguntas: { p: string; r: ReactNode }[]; id?: string; titulo?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="scroll-mt-20">
      <h2 id={`${id}-t`} className="font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">
        {titulo}
      </h2>
      <div className="mt-5 divide-y divide-line rounded-2xl border border-line bg-paper">
        {preguntas.map((x) => (
          <details key={x.p} className="group px-4 sm:px-5">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-cuerpo font-semibold text-ink [&::-webkit-details-marker]:hidden">
              {x.p}
              <ChevronDown size={18} aria-hidden className="shrink-0 text-mute transition-transform duration-rapido group-open:rotate-180" />
            </summary>
            <div className="max-w-[72ch] pb-4 text-dato leading-relaxed text-inkSoft">{x.r}</div>
          </details>
        ))}
      </div>
    </section>
  );
}
