"use client";

import { Children, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type TouchEvent } from "react";
import { cn } from "@/lib/utils";

export interface PestanaViva {
  /** Lo que dice la pestaña: corto («Para ti», «El aviso»). */
  titulo: ReactNode;
  /** Un ícono o un píxel chico delante del título. */
  icono?: ReactNode;
}

/**
 * Pestañas para acortar una portada (2026-11-22, el usuario: «portadas más cortas», «que llame a usarlo»): en vez de
 * apilar tres o cuatro bloques con su maqueta, uno a la vista y los demás a un toque.
 *
 * - Debajo de la pestaña abierta corre una franja de píxeles (como la de la navegación) que se desliza hasta la que
 *   tocas; el panel nuevo entra desde el lado hacia el que fuiste.
 * - En el celular se cambia también deslizando el panel con el dedo.
 * - Con `auto` (ms) avanzan solas mientras se ven, y la franja se llena mientras espera: se ve que hay más. Se detienen
 *   para siempre apenas tocas algo, si no se ven o con movimiento reducido.
 * - Teclado: flechas, Inicio y Fin. Todos los paneles vienen del servidor (los cerrados con `hidden`).
 *
 * Los paneles son los hijos, en el orden de `pestanas`. Server Components pueden pasarlos (son nodos, no funciones).
 */
export function PestanasVivas({
  etiqueta,
  pestanas,
  children,
  auto,
  oscuro = false,
  className,
  claseLista,
}: {
  etiqueta: string;
  pestanas: PestanaViva[];
  children: ReactNode;
  auto?: number;
  /** Sobre una banda oscura (`sobre-oscuro`). */
  oscuro?: boolean;
  className?: string;
  claseLista?: string;
}) {
  const paneles = Children.toArray(children);
  const n = Math.min(pestanas.length, paneles.length);
  const base = useId().replace(/:/g, "");
  const [abierta, setAbierta] = useState(0);
  const [dir, setDir] = useState<"izq" | "der" | null>(null);
  const [solo, setSolo] = useState(Boolean(auto));
  const [ciclo, setCiclo] = useState(0);
  const lista = useRef<HTMLDivElement>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const botones = useRef<(HTMLButtonElement | null)[]>([]);
  const [franja, setFranja] = useState<{ x: number; w: number } | null>(null);
  const toque = useRef<{ x: number; y: number } | null>(null);

  const ir = useCallback(
    (i: number, porUsuario: boolean) => {
      const j = ((i % n) + n) % n;
      if (porUsuario) setSolo(false);
      setDir(j > abierta || (j === 0 && abierta === n - 1 && !porUsuario) ? "der" : "izq");
      setAbierta(j);
      setCiclo((c) => c + 1);
    },
    [abierta, n],
  );

  // La franja: mide la pestaña abierta (al cambiar, al cambiar de tamaño) y la lleva a la vista dentro de la fila.
  useEffect(() => {
    const medir = () => {
      const b = botones.current[abierta];
      const l = lista.current;
      if (!b || !l) return;
      setFranja({ x: b.offsetLeft, w: b.offsetWidth });
      const izq = b.offsetLeft - 16;
      const der = b.offsetLeft + b.offsetWidth + 16 - l.clientWidth;
      if (l.scrollLeft > izq) l.scrollTo({ left: izq, behavior: "smooth" });
      else if (l.scrollLeft < der) l.scrollTo({ left: der, behavior: "smooth" });
    };
    medir();
    const ro = new ResizeObserver(medir);
    if (lista.current) ro.observe(lista.current);
    return () => ro.disconnect();
  }, [abierta]);

  // Avanzar solas: sólo mientras se ven, con la pestaña del navegador al frente y sin movimiento reducido.
  useEffect(() => {
    if (!solo || !auto) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSolo(false);
      return;
    }
    let visible = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const programar = () => {
      clearTimeout(t);
      if (visible && document.visibilityState === "visible") t = setTimeout(() => ir(abierta + 1, false), auto);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      programar();
    }, { threshold: 0.4 });
    if (raiz.current) io.observe(raiz.current);
    document.addEventListener("visibilitychange", programar);
    return () => {
      clearTimeout(t);
      io.disconnect();
      document.removeEventListener("visibilitychange", programar);
    };
  }, [solo, auto, abierta, ir]);

  const teclas = (e: KeyboardEvent<HTMLButtonElement>) => {
    const destino = e.key === "ArrowRight" ? abierta + 1 : e.key === "ArrowLeft" ? abierta - 1 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (destino == null) return;
    e.preventDefault();
    const j = ((destino % n) + n) % n;
    ir(j, true);
    botones.current[j]?.focus();
  };

  const alTocar = (e: TouchEvent) => {
    const t = e.touches[0];
    toque.current = { x: t.clientX, y: t.clientY };
  };
  const alSoltar = (e: TouchEvent) => {
    const ini = toque.current;
    toque.current = null;
    if (!ini) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - ini.x;
    const dy = t.clientY - ini.y;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    ir(abierta + (dx < 0 ? 1 : -1), true);
  };

  return (
    <div ref={raiz} className={cn("min-w-0", className)} onPointerDownCapture={() => solo && setSolo(false)}>
      <div className="relative">
        <div
          ref={lista}
          role="tablist"
          aria-label={etiqueta}
          className={cn(
            "relative flex gap-1 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            oscuro ? "border-b border-paper/15" : "border-b border-line",
            claseLista,
          )}
        >
          {/* recorte: pestañas y paneles van de a pares: n es el menor de los dos, no se esconde nada */}
          {pestanas.slice(0, n).map((p, i) => {
            const activa = i === abierta;
            return (
              <button
                key={i}
                ref={(el) => {
                  botones.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${base}-t${i}`}
                aria-selected={activa}
                aria-controls={`${base}-p${i}`}
                tabIndex={activa ? 0 : -1}
                onClick={() => ir(i, true)}
                onKeyDown={teclas}
                className={cn(
                  "inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-dato font-semibold transition-colors duration-rapido",
                  "focus-visible:outline-none focus-visible:ring-2",
                  oscuro
                    ? cn("focus-visible:ring-paper/60", activa ? "text-paper" : "text-paper/60 hover:bg-paper/[0.06] hover:text-paper")
                    : cn("focus-visible:ring-granate", activa ? "text-ink" : "text-mute hover:bg-ink/[0.04] hover:text-ink"),
                )}
              >
                {p.icono}
                {p.titulo}
              </button>
            );
          })}
          {franja && (
            <span
              aria-hidden
              className={cn("gs-pestana-franja", oscuro && "gs-pestana-franja-oscura")}
              style={{ transform: `translateX(${franja.x}px)`, width: franja.w }}
            >
              {solo && auto ? <span key={ciclo} className="gs-pestana-espera" style={{ animationDuration: `${auto}ms` }} /> : null}
            </span>
          )}
        </div>
      </div>
      <div onTouchStart={alTocar} onTouchEnd={alSoltar}>
        {/* recorte: pestañas y paneles van de a pares: n es el menor de los dos, no se esconde nada */}
        {paneles.slice(0, n).map((panel, i) => (
          <div
            key={i === abierta ? `a${ciclo}` : `c${i}`}
            role="tabpanel"
            id={`${base}-p${i}`}
            aria-labelledby={`${base}-t${i}`}
            hidden={i !== abierta}
            tabIndex={0}
            className={cn("pt-5 focus-visible:outline-none", i === abierta && dir && (dir === "der" ? "gs-panel-der" : "gs-panel-izq"))}
          >
            {panel}
          </div>
        ))}
      </div>
    </div>
  );
}
