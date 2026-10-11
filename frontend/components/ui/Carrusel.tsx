"use client";

import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Una fila de tarjetas que se desliza a los lados, sin librerías.
 *
 * Es una lista (`<ul>`) con `scroll-snap`: con el dedo o la rueda se desliza sola, y cada tarjeta
 * se detiene alineada. Encima agrega lo que el scroll nativo no da:
 *  - botones anterior y siguiente (44 px, con nombre accesible), que se deshabilitan en los extremos;
 *  - las flechas del teclado, Inicio y Fin, cuando la región tiene el foco;
 *  - un indicador de posición en texto ("3 de 8") y en puntos;
 *  - bordes que se difuminan para insinuar que hay más a los lados.
 *
 * Sin JavaScript sigue siendo una fila que se desliza con el scroll nativo. El movimiento suave
 * respeta `prefers-reduced-motion`.
 *
 * Las tarjetas llegan como `children`, que un server component puede armar sin pasar funciones.
 */

export function Carrusel({
  children,
  etiqueta,
  anchoTarjeta = "w-[78%] sm:w-[19rem]",
  className,
  oscuro = false,
  flechas = "abajo",
}: {
  children: ReactNode;
  /** Qué es la lista, para quien usa lector de pantalla ("Cifras del problema"). */
  etiqueta: string;
  /** Clases de ancho de cada tarjeta. */
  anchoTarjeta?: string;
  className?: string;
  /** En una banda oscura, los botones y los bordes se invierten. */
  oscuro?: boolean;
  /** "lateral": en pantalla ancha los botones van sobre los bordes y la fila de abajo desaparece (ahorra altura). */
  flechas?: "abajo" | "lateral";
}) {
  const tarjetas = Children.toArray(children);
  const total = tarjetas.length;
  const lista = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState(0);
  const [limite, setLimite] = useState({ inicio: true, fin: total <= 1 });

  /** Qué tarjeta está más a la izquierda, y si ya se llegó a un extremo. */
  const medir = useCallback(() => {
    const el = lista.current;
    if (!el) return;
    const hijos = Array.from(el.children) as HTMLElement[];
    const x = el.scrollLeft;
    let mejor = 0;
    let dist = Infinity;
    hijos.forEach((h, i) => {
      const d = Math.abs(h.offsetLeft - el.offsetLeft - x);
      if (d < dist) {
        dist = d;
        mejor = i;
      }
    });
    setPos(mejor);
    setLimite({ inicio: x <= 2, fin: x + el.clientWidth >= el.scrollWidth - 2 });
  }, []);

  useEffect(() => {
    const el = lista.current;
    if (!el) return;
    let raf = 0;
    const alMover = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(medir);
    };
    medir();
    el.addEventListener("scroll", alMover, { passive: true });
    window.addEventListener("resize", alMover);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", alMover);
      window.removeEventListener("resize", alMover);
    };
  }, [medir, total]);

  const irA = (i: number) => {
    const el = lista.current;
    const hijo = el?.children[Math.max(0, Math.min(total - 1, i))] as HTMLElement | undefined;
    if (!el || !hijo) return;
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: hijo.offsetLeft - el.offsetLeft, behavior: quieto ? "auto" : "smooth" });
  };

  /** Una "página": lo que cabe entero en pantalla, mínimo una tarjeta. */
  const salto = () => {
    const el = lista.current;
    const primero = el?.children[0] as HTMLElement | undefined;
    if (!el || !primero) return 1;
    return Math.max(1, Math.floor(el.clientWidth / (primero.offsetWidth + 12)));
  };

  const alTeclado = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") (e.preventDefault(), irA(pos + 1));
    else if (e.key === "ArrowLeft") (e.preventDefault(), irA(pos - 1));
    else if (e.key === "Home") (e.preventDefault(), irA(0));
    else if (e.key === "End") (e.preventDefault(), irA(total - 1));
  };

  const boton = cn(
    "inline-flex h-11 w-11 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-35",
    oscuro
      ? "border-paper/25 text-paper hover:border-maiz hover:text-maiz disabled:hover:border-paper/25 disabled:hover:text-paper"
      : "border-line bg-paper text-ink hover:border-granate hover:text-granate disabled:hover:border-line disabled:hover:text-ink",
  );

  if (total === 0) return null;
  const lateral = flechas === "lateral" && total > 1;
  const flotante = cn(
    boton,
    "absolute top-1/2 z-10 hidden -translate-y-1/2 shadow-lg lg:inline-flex",
    oscuro ? "bg-ink" : "bg-paper",
  );

  return (
    <div className={cn("relative", className)} role="group" aria-roledescription="carrusel" aria-label={etiqueta}>
      <ul
        ref={lista}
        tabIndex={0}
        onKeyDown={alTeclado}
        aria-label={`${etiqueta}. Usa las flechas del teclado para recorrerla.`}
        className="carrusel-lista -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4 pb-1 pt-1 outline-none focus-visible:ring-2 focus-visible:ring-granate motion-reduce:scroll-auto sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0"
      >
        {tarjetas.map((t, i) => (
          <li
            key={i}
            className={cn("min-w-0 shrink-0 snap-start scroll-ml-4 sm:scroll-ml-6 lg:scroll-ml-0", anchoTarjeta)}
            aria-label={`${i + 1} de ${total}`}
          >
            {t}
          </li>
        ))}
      </ul>

      {lateral && (
        <>
          <button type="button" className={cn(flotante, "-left-5")} aria-label="Anterior" disabled={limite.inicio} onClick={() => irA(pos - salto())}>
            <ChevronLeft size={18} aria-hidden />
          </button>
          <button type="button" className={cn(flotante, "-right-5")} aria-label="Siguiente" disabled={limite.fin} onClick={() => irA(pos + salto())}>
            <ChevronRight size={18} aria-hidden />
          </button>
        </>
      )}

      {total > 1 && (
        <div className={cn("mt-3 flex items-center justify-between gap-3", lateral && "lg:hidden")}>
          <p className={cn("text-[13px] tabular-nums", oscuro ? "text-paper/70" : "text-mute")} aria-hidden>
            {pos + 1} de {total}
          </p>
          <div className="flex items-center gap-1" aria-hidden>
            {tarjetas.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-normal",
                  i === pos ? (oscuro ? "w-5 bg-maiz" : "w-5 bg-granate") : oscuro ? "w-1.5 bg-paper/30" : "w-1.5 bg-paperEdge",
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className={boton} aria-label="Anterior" disabled={limite.inicio} onClick={() => irA(pos - salto())}>
              <ChevronLeft size={18} aria-hidden />
            </button>
            <button type="button" className={boton} aria-label="Siguiente" disabled={limite.fin} onClick={() => irA(pos + salto())}>
              <ChevronRight size={18} aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
