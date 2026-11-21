import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Un paso de «Cómo funciona» de la portada de Gobserva Obras con su escena de píxeles: el `Paso` de
 * components/gobserva-obras/Piezas.tsx (el número en su círculo, el título con su ícono y una frase; en escritorio en fila
 * y unidos por una línea, en el celular uno bajo otro) con una viñeta sobre su suelo encima del título. La viñeta es
 * decorativa (aria-hidden). Server-safe.
 */
export function PasoIlustrado({
  n,
  Icono,
  titulo,
  texto,
  ilustracion,
  ultimo = false,
}: {
  n: number;
  Icono: LucideIcon;
  titulo: string;
  texto: string;
  /** Los sprites (components/pixel/Pixel), parados sobre el suelo de la viñeta. */
  ilustracion: ReactNode;
  ultimo?: boolean;
}) {
  return (
    <li className="relative flex min-w-0 gap-4 md:flex-col md:gap-0">
      {!ultimo && <span aria-hidden className="absolute left-14 top-[22px] hidden h-px bg-line md:-right-5 md:block" />}
      <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-granate font-display text-bloque font-bold text-paper">
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-1.5 md:mt-4 md:pt-0">
        <div aria-hidden className="mb-4 flex h-40 select-none items-end justify-center overflow-hidden rounded-2xl border border-line bg-paperSoft px-4 pt-3">
          <div className="flex w-full items-end justify-center gap-4 border-b-[5px] border-dashed border-[rgb(var(--px-linea)/0.25)]">{ilustracion}</div>
        </div>
        <h3 className="flex items-center gap-2 font-display text-bloque font-bold leading-tight text-ink">
          <span className="sr-only">Paso {n}: </span>
          <Icono size={18} aria-hidden className="shrink-0 text-granate" />
          {titulo}
        </h3>
        <p className="mt-1.5 max-w-[42ch] text-dato leading-relaxed text-inkSoft">{texto}</p>
      </div>
    </li>
  );
}
