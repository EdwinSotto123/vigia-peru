"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Lado = "arriba" | "abajo";

/**
 * Posicionamiento compartido de tooltip y popover.
 *
 * Los dos usan el atributo `popover` nativo, que sube el elemento al top
 * layer. Eso importa acá más de lo normal: este producto pone tooltips
 * dentro de celdas de tabla con scroll, de paneles con `overflow-hidden` y
 * del SVG del mapa. Un `absolute` tradicional se recorta en los tres casos,
 * y un `fixed` se rompe igual si algún ancestro tiene `transform` (las
 * tarjetas con `hover:-translate-y-0.5` lo tienen). El top layer no.
 *
 * Posición calculada en JS y no con CSS anchor positioning porque anchor
 * todavía es solo Chromium; esto funciona en todos lados.
 */
function usarFlotante(abierto: boolean) {
  const anclaRef = useRef<HTMLElement>(null);
  const flotanteRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; lado: Lado } | null>(null);

  const colocar = useCallback(() => {
    const ancla = anclaRef.current;
    const flot = flotanteRef.current;
    if (!ancla || !flot) return;
    const a = ancla.getBoundingClientRect();
    const f = flot.getBoundingClientRect();
    const margen = 8;

    // Arriba por defecto; abajo si no entra. Se mide contra el viewport, que
    // es el marco real del top layer.
    const cabeArriba = a.top - f.height - margen > 0;
    const lado: Lado = cabeArriba ? "arriba" : "abajo";
    const top = cabeArriba ? a.top - f.height - margen : a.bottom + margen;

    // Centrado sobre el ancla, pero sin salirse por ningún borde.
    let left = a.left + a.width / 2 - f.width / 2;
    left = Math.max(margen, Math.min(left, window.innerWidth - f.width - margen));

    setPos({ top, left, lado });
  }, []);

  useLayoutEffect(() => {
    if (!abierto) return setPos(null);
    colocar();
  }, [abierto, colocar]);

  useEffect(() => {
    if (!abierto) return;
    const onMover = () => colocar();
    // `capture` para enterarse también del scroll de contenedores internos.
    window.addEventListener("scroll", onMover, true);
    window.addEventListener("resize", onMover);
    return () => {
      window.removeEventListener("scroll", onMover, true);
      window.removeEventListener("resize", onMover);
    };
  }, [abierto, colocar]);

  return { anclaRef, flotanteRef, pos };
}

/** Sube el nodo al top layer si el navegador soporta el atributo `popover`. */
function usarTopLayer(ref: React.RefObject<HTMLDivElement>, abierto: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.showPopover !== "function") return;
    try {
      if (abierto && !el.matches(":popover-open")) el.showPopover();
      if (!abierto && el.matches(":popover-open")) el.hidePopover();
    } catch {
      // Un showPopover() sobre un nodo todavía no conectado tira; en ese caso
      // el elemento sigue siendo un `fixed` normal, que es el degradado correcto.
    }
  }, [abierto, ref]);
}

/**
 * Tooltip. Solo para aclarar una etiqueta o una abreviatura — nunca para
 * información que el usuario necesita para decidir: no existe en touch y se
 * pierde con teclado si es el único camino. Lo que haga falta de verdad va
 * inline o en un `Popover`.
 */
export function Tooltip({
  texto,
  children,
  className,
}: {
  texto: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const id = useId();
  const { anclaRef, flotanteRef, pos } = usarFlotante(abierto);
  usarTopLayer(flotanteRef, abierto);

  return (
    <>
      <span
        ref={anclaRef as React.RefObject<HTMLSpanElement>}
        tabIndex={0}
        aria-describedby={abierto ? id : undefined}
        onMouseEnter={() => setAbierto(true)}
        onMouseLeave={() => setAbierto(false)}
        onFocus={() => setAbierto(true)}
        onBlur={() => setAbierto(false)}
        className={cn("inline-flex cursor-help items-center underline decoration-dotted decoration-from-font", className)}
      >
        {children}
      </span>
      <div
        ref={flotanteRef}
        id={id}
        role="tooltip"
        popover="manual"
        style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
        className={cn(
          "pointer-events-none fixed z-overlay m-0 max-w-[16rem] rounded-xl border border-line bg-ink px-2.5 py-1.5 text-[12px] leading-snug text-paper shadow-pop",
          "transition-opacity duration-rapido ease-salida",
          abierto && pos ? "opacity-100" : "opacity-0",
        )}
      >
        {texto}
      </div>
    </>
  );
}

/**
 * Popover: contenido real, con foco, que se abre por clic y se cierra con
 * Escape o clic afuera. Es el escalón entre el tooltip (una línea) y el
 * `Panel` (el expediente completo).
 */
export function Popover({
  trigger,
  titulo,
  children,
  className,
  anchoClase = "w-72",
}: {
  trigger: React.ReactNode;
  titulo?: string;
  children: React.ReactNode;
  className?: string;
  anchoClase?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const id = useId();
  const { anclaRef, flotanteRef, pos } = usarFlotante(abierto);
  usarTopLayer(flotanteRef, abierto);

  useEffect(() => {
    if (!abierto) return;
    const onTecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAbierto(false);
        (anclaRef.current as HTMLElement | null)?.focus();
      }
    };
    const onClic = (e: MouseEvent) => {
      const t = e.target as Node;
      if (flotanteRef.current?.contains(t) || anclaRef.current?.contains(t)) return;
      setAbierto(false);
    };
    document.addEventListener("keydown", onTecla);
    // En el siguiente tick, si no el propio clic que abre lo cierra.
    const t = window.setTimeout(() => document.addEventListener("mousedown", onClic), 0);
    return () => {
      document.removeEventListener("keydown", onTecla);
      document.removeEventListener("mousedown", onClic);
      window.clearTimeout(t);
    };
  }, [abierto, anclaRef, flotanteRef]);

  return (
    <>
      <button
        type="button"
        ref={anclaRef as React.RefObject<HTMLButtonElement>}
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-controls={abierto ? id : undefined}
        className={cn("inline-flex items-center", className)}
      >
        {trigger}
      </button>
      <div
        ref={flotanteRef}
        id={id}
        role="dialog"
        aria-label={titulo}
        popover="manual"
        style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
        className={cn(
          "fixed z-overlay m-0 overflow-hidden rounded-2xl border border-line bg-paper p-0 text-ink shadow-pop",
          "transition-all duration-rapido ease-salida",
          anchoClase,
          abierto && pos ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        {titulo && (
          <div className="border-b border-line bg-paperSoft px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-mute">
            {titulo}
          </div>
        )}
        <div className="px-3 py-2.5 text-[13px] leading-relaxed">{children}</div>
      </div>
    </>
  );
}
