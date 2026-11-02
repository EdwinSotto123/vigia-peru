"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { rutaEn } from "@/lib/gobserva";
import { cn } from "@/lib/utils";

export interface EnlaceProducto {
  /** Ruta dentro del producto ("/plazas"): se le pone la base. */
  ruta: string;
  etiqueta: string;
}

/**
 * El camino que ve el navegador, recién al montar: en el servidor la ruta es la reescrita («/empleo/plazas») y en el
 * subdominio el navegador ve «/plazas». Antes de montar no se marca ningún enlace, así el HTML del servidor y el primer
 * render del navegador coinciden.
 */
function useCaminoActual(): string | null {
  const pathname = usePathname();
  const [camino, setCamino] = useState<string | null>(null);
  useEffect(() => setCamino(window.location.pathname), [pathname]);
  return camino;
}

function esActual(camino: string | null, href: string): boolean {
  if (!camino || href.includes("#")) return false;
  return camino === href || camino.startsWith(`${href}/`);
}

/** El menú de la cabecera en la computadora, con la sección en que estás marcada. */
export function MenuProducto({ base, menu, titulo }: { base: string; menu: EnlaceProducto[]; titulo: string }) {
  const camino = useCaminoActual();
  return (
    <nav aria-label={`Secciones de ${titulo}`} className="hidden min-w-0 flex-1 items-center justify-center gap-1 md:flex">
      {menu.map((m) => {
        const href = rutaEn(base, m.ruta);
        const actual = esActual(camino, href);
        return (
          <Link
            key={m.ruta}
            href={href}
            aria-current={actual ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-full px-3 py-2 text-dato transition-colors duration-rapido hover:bg-granate-50 hover:text-ink",
              actual ? "bg-granate-50 font-semibold text-ink" : "font-medium text-inkSoft",
            )}
          >
            {m.etiqueta}
          </Link>
        );
      })}
    </nav>
  );
}

const useEfectoDeMedida = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Clases literales (Tailwind sólo genera lo que ve escrito entero): difumina el borde por donde quedan más secciones,
// como la franja de pestañas (components/patrones/Pestanas.tsx).
const MASCARA: Record<string, string> = {
  "true-true": "[mask-image:linear-gradient(to_right,transparent,black_2rem,black_calc(100%-2rem),transparent)]",
  "true-false": "[mask-image:linear-gradient(to_right,transparent,black_2rem)]",
  "false-true": "[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]",
  "false-false": "",
};

/**
 * El menú en el celular: una fila que se desliza, con la acción principal primero. El borde se difumina por donde
 * quedan secciones fuera de la pantalla y la sección en que estás queda a la vista.
 *
 * Cuelga de la cabecera pegada (fuera de su alto: MarcoProducto deja su espacio arriba de la página) y se esconde al
 * bajar, para leer con 44 px más de pantalla; vuelve apenas subes. Como no cambia el alto de la cabecera, la página no
 * salta al esconderse.
 */
export function RielProducto({ base, menu, accion, titulo }: { base: string; menu: EnlaceProducto[]; accion: EnlaceProducto; titulo: string }) {
  const camino = useCaminoActual();
  const [oculto, setOculto] = useState(false);
  useEffect(() => {
    let ultimo = window.scrollY;
    let pendiente = false;
    const alMover = () => {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(() => {
        pendiente = false;
        const y = window.scrollY;
        if (y < 64) setOculto(false);
        else if (y > ultimo + 8) setOculto(true);
        else if (y < ultimo - 8) setOculto(false);
        else return; // movimiento chico: no cambia nada ni se toma como nuevo punto de partida
        ultimo = y;
      });
    };
    window.addEventListener("scroll", alMover, { passive: true });
    return () => window.removeEventListener("scroll", alMover);
  }, []);
  const riel = useRef<HTMLDivElement>(null);
  const [desborde, setDesborde] = useState({ izq: false, der: false });
  const medir = useCallback(() => {
    const r = riel.current;
    if (!r) return;
    const izq = r.scrollLeft > 2;
    const der = r.scrollLeft + r.clientWidth < r.scrollWidth - 2;
    setDesborde((d) => (d.izq === izq && d.der === der ? d : { izq, der }));
  }, []);
  useEffect(() => {
    const r = riel.current;
    if (!r) return;
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(r);
    return () => ro.disconnect();
  }, [medir]);
  // La sección actual, a la vista dentro de la fila (sin mover la página: nada de scrollIntoView).
  useEfectoDeMedida(() => {
    const r = riel.current;
    const a = r?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!r || !a) return;
    const margen = 32;
    if (a.offsetLeft + a.offsetWidth + margen > r.scrollLeft + r.clientWidth) r.scrollLeft = a.offsetLeft + a.offsetWidth + margen - r.clientWidth;
    medir();
  }, [camino, medir]);

  return (
    <nav
      aria-label={`Secciones de ${titulo}`}
      className={cn(
        "absolute inset-x-0 top-full h-11 border-y border-line bg-paper/95 backdrop-blur-xl transition-[opacity,transform,visibility] duration-rapido md:hidden",
        oculto && "pointer-events-none invisible -translate-y-1 opacity-0",
      )}
    >
      <div
        ref={riel}
        onScroll={medir}
        className={cn(
          "container-page flex h-full items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          MASCARA[`${desborde.izq}-${desborde.der}`],
        )}
      >
        <Link
          href={rutaEn(base, accion.ruta)}
          className="inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-full bg-granate px-3.5 text-meta font-semibold text-paper hover:bg-granate-deep"
        >
          {accion.etiqueta}
        </Link>
        {menu.map((m) => {
          const href = rutaEn(base, m.ruta);
          const actual = esActual(camino, href);
          return (
            <Link
              key={m.ruta}
              href={href}
              aria-current={actual ? "page" : undefined}
              className={cn(
                "inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-meta hover:bg-granate-50 hover:text-ink",
                actual ? "bg-granate-50 font-semibold text-ink" : "font-medium text-inkSoft",
              )}
            >
              {m.etiqueta}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
