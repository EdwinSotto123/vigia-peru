import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Un grupo de cifras chicas, cada una con su denominador y su unidad.
 *
 * Reemplaza el patrón que estaba repartido por todo el producto:
 *
 *   "33 leídos de 45 financiados · 19 con señal · 4 en revisión humana"
 *
 * Tres datos distintos pegados con un punto medio. El punto medio no es
 * puntuación: no marca pausa, no marca jerarquía, no dice qué relación hay
 * entre lo que separa. Es una raya que se puso porque no se resolvió el
 * layout, y obliga a leer la línea entera para sacar un solo número.
 *
 * Acá cada cifra es su propio elemento. Lo que las separa es espacio y
 * contraste tipográfico —número en mono oscuro, unidad en mute—, que es lo
 * que de verdad separa cosas en una interfaz. Cuando no caben en una línea,
 * bajan; con un punto medio quedaban partidas por la mitad.
 *
 * Ninguna cifra viaja sin denominador si lo tiene: "33 de 45" dice algo,
 * "33" no dice nada.
 */

export interface Cifra {
  /** El número. Si es 0 y `ocultarEnCero`, la cifra no se dibuja. */
  n: number;
  /** Denominador. Se muestra como "n de total". */
  de?: number;
  /** Qué son. Va en mute, después del número. */
  texto: ReactNode;
  /** Matiz completo al pasar el puntero, sin gastar renglón. */
  titulo?: string;
  /** Clase del punto de color, cuando la cifra es un tramo de una barra apilada. */
  punto?: string;
  /** No dibujar cuando `n` es 0. Por defecto sí se dibuja: un cero informa. */
  ocultarEnCero?: boolean;
}

const fmt = (n: number) => n.toLocaleString("es-PE");

const TAM = {
  sm: "text-[11px]",
  md: "text-[12px]",
  lg: "text-[13px]",
} as const;

export function Cifras({
  items,
  className,
  tam = "md",
  as: Tag = "ul",
}: {
  items: Cifra[];
  className?: string;
  tam?: keyof typeof TAM;
  /**
   * `ul` por defecto; `div`/`span` cuando el padre ya es una lista o un
   * elemento en línea, donde un `ul` anidado sería HTML inválido.
   */
  as?: "ul" | "div" | "span";
}) {
  const visibles = items.filter((c) => !(c.ocultarEnCero && c.n === 0));
  if (visibles.length === 0) return null;
  const Item = Tag === "ul" ? "li" : "span";
  return (
    <Tag className={cn("flex flex-wrap items-baseline gap-x-5 gap-y-1 leading-snug", TAM[tam], className)}>
      {visibles.map((c, i) => (
        <Item key={i} className="inline-flex items-baseline gap-1.5 text-mute" title={c.titulo}>
          {c.punto && (
            <span className={cn("h-2 w-2 shrink-0 self-center rounded-full", c.punto)} aria-hidden />
          )}
          <span className="font-mono font-semibold tabular-nums text-ink">{fmt(c.n)}</span>
          {c.de != null && (
            <span className="font-mono tabular-nums text-mute">
              de {fmt(c.de)}
            </span>
          )}
          <span>{c.texto}</span>
        </Item>
      ))}
    </Tag>
  );
}
