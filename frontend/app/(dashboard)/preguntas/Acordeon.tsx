"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PreguntaFAQ {
  slug: string;
  q: string;
  /** Nodo ya renderizado en el servidor (texto y links). Nunca una función. */
  a: React.ReactNode;
}

/**
 * Lista de preguntas con UNA sola fuente de verdad para qué está abierto.
 *
 * Antes cada pregunta calculaba `visible = open || forceOpen`, con `forceOpen`
 * atado al hash de la URL: la pregunta a la que llegabas por un enlace
 * (/preguntas#cuentas) no se podía cerrar, porque el hash seguía ahí. Ahora el
 * hash sólo ABRE (al montar y en cada `hashchange`) y después manda el usuario.
 *
 * Todas empiezan cerradas: la página se lee de un vistazo como una lista de
 * preguntas, y cada respuesta está a un clic (DESIGN_SYSTEM.md §10.7). Antes la
 * primera venía abierta y era el bloque de texto más largo de la vista.
 */
export function Acordeon({ items }: { items: PreguntaFAQ[] }) {
  const [abiertas, setAbiertas] = useState<Set<string>>(() => new Set());
  const slugs = items.map((i) => i.slug).join("|");

  useEffect(() => {
    const validos = new Set(slugs.split("|"));
    const abrirDesdeHash = () => {
      const slug = decodeURIComponent(window.location.hash.slice(1));
      if (!validos.has(slug)) return;
      setAbiertas((prev) => (prev.has(slug) ? prev : new Set(prev).add(slug)));
      // Abrir cambia el alto de lo de arriba: se vuelve a ubicar la pregunta ya abierta.
      requestAnimationFrame(() => document.getElementById(slug)?.scrollIntoView({ block: "start" }));
    };
    abrirDesdeHash();
    window.addEventListener("hashchange", abrirDesdeHash);
    return () => window.removeEventListener("hashchange", abrirDesdeHash);
  }, [slugs]);

  const alternar = (slug: string) =>
    setAbiertas((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  return (
    <div className="divide-y divide-line rounded-2xl border border-line bg-paper">
      {items.map((item) => {
        const abierta = abiertas.has(item.slug);
        const panelId = `respuesta-${item.slug}`;
        return (
          <div key={item.slug} id={item.slug} className="scroll-mt-20">
            <h2>
              <button
                type="button"
                onClick={() => alternar(item.slug)}
                aria-expanded={abierta}
                aria-controls={panelId}
                className="flex min-h-[48px] w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors duration-rapido hover:bg-paperSoft sm:px-5"
              >
                <span className="font-display text-[16px] font-semibold text-ink text-balance">{item.q}</span>
                <ChevronDown
                  size={20}
                  aria-hidden
                  className={cn("shrink-0 text-mute transition-transform duration-normal ease-salida", abierta && "rotate-180")}
                />
              </button>
            </h2>
            <div id={panelId} hidden={!abierta} className="max-w-[68ch] px-4 pb-4 text-[15px] leading-relaxed text-inkSoft text-pretty sm:px-5">
              {item.a}
            </div>
          </div>
        );
      })}
    </div>
  );
}
