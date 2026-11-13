import type { ReactNode } from "react";
import { BookOpen, Database, Lightbulb } from "lucide-react";

/**
 * La guía de una pestaña: qué muestra, de dónde sale el dato y cómo leerlo, en una franja de tres celdas al abrirla
 * (pedido del usuario del 2026-11-13 sobre la ficha del contrato: «no se explica qué es cada una»). Va arriba del
 * contenido, una sola vez por pestaña: la pasa `Pestana.guia` y la dibuja `Pestanas`. Cada celda es una o dos oraciones;
 * lo largo va en la pestaña o en su ⓘ. Server-safe.
 */
export interface Guia {
  /** Qué hay en la pestaña, en palabras de cualquiera. */
  que: ReactNode;
  /** El registro oficial o el documento de donde sale. */
  fuente?: ReactNode;
  /** Qué mirar primero y qué sería raro. */
  leer?: ReactNode;
}

const CELDAS: { clave: keyof Guia; rotulo: string; Icono: typeof BookOpen }[] = [
  { clave: "que", rotulo: "Qué es", Icono: BookOpen },
  { clave: "fuente", rotulo: "De dónde sale", Icono: Database },
  { clave: "leer", rotulo: "Cómo leerlo", Icono: Lightbulb },
];

export function GuiaPestana({ guia }: { guia: Guia }) {
  const celdas = CELDAS.filter((c) => guia[c.clave] != null);
  return (
    <aside aria-label="Qué muestra esta pestaña" className="mb-5 overflow-hidden rounded-xl border border-line">
      <dl className={celdas.length === 3 ? "grid gap-px bg-line md:grid-cols-3" : "grid gap-px bg-line md:grid-cols-2"}>
        {celdas.map(({ clave, rotulo, Icono }) => (
          <div key={clave} className="flex min-w-0 gap-2.5 bg-paperSoft px-3.5 py-2.5">
            <Icono size={15} className="mt-0.5 shrink-0 text-granate" aria-hidden />
            <div className="min-w-0">
              <dt className="text-rotulo font-semibold uppercase tracking-wide text-mute">{rotulo}</dt>
              <dd className="mt-0.5 text-meta leading-snug text-inkSoft text-pretty">{guia[clave]}</dd>
            </div>
          </div>
        ))}
      </dl>
    </aside>
  );
}
