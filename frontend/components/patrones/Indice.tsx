"use client";

import { useEffect, useState } from "react";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";

export interface EntradaIndice {
  /** El `id` de la `Seccion` a la que lleva. */
  id: string;
  etiqueta: string;
  conteo?: number | null;
}

/**
 * El índice de una ficha larga que se lee de arriba abajo (la de una entidad): enlaces a sus secciones, fijo
 * arriba al bajar, con la sección que está a la vista marcada. Se ve como las `Pestanas` pero no esconde nada:
 * todo está en la página y el índice sólo lleva. Los `sticky top-0` bajan solos bajo la barra del celular
 * (app/(dashboard)/layout.tsx).
 */
export function IndiceSecciones({ entradas, etiqueta }: { entradas: EntradaIndice[]; etiqueta: string }) {
  const [activa, setActiva] = useState(entradas[0]?.id);
  const ids = entradas.map((e) => e.id).join(",");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visibles = new Map<string, number>();
    // La sección "a la vista" es la que cruza la franja de arriba de la pantalla (debajo del índice).
    const obs = new IntersectionObserver(
      (cambios) => {
        for (const c of cambios) {
          if (c.isIntersecting) visibles.set(c.target.id, c.boundingClientRect.top);
          else visibles.delete(c.target.id);
        }
        const primera = [...visibles.entries()].sort((a, b) => a[1] - b[1])[0];
        if (primera) setActiva(primera[0]);
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    for (const id of ids.split(",")) {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [ids]);

  return (
    <nav
      aria-label={etiqueta}
      className="sticky top-0 z-barra -mx-4 border-b border-line bg-paper/95 px-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10"
    >
      <ul className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
        {entradas.map((e) => {
          const sel = e.id === activa;
          return (
            <li key={e.id} className="shrink-0">
              <a
                href={`#${e.id}`}
                onClick={() => setActiva(e.id)}
                aria-current={sel ? "location" : undefined}
                className={cn(
                  "relative -mb-px inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap border-b-2 px-3.5 text-[14px] font-medium transition-colors duration-rapido",
                  sel ? "border-granate text-granate" : "border-transparent text-inkSoft hover:border-line hover:text-ink",
                )}
              >
                {e.etiqueta}
                {e.conteo != null && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[12px] font-semibold tabular-nums",
                      sel ? "bg-granate-50 text-granate" : "bg-paperDeep text-mute",
                    )}
                  >
                    {numero(e.conteo)}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
