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
 */
export function Acordeon({ items }: { items: PreguntaFAQ[] }) {
  const [abiertas, setAbiertas] = useState<Set<string>>(() => new Set(items.length ? [items[0].slug] : []));
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
    <div className="surface divide-y divide-line p-0">
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
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition-colors duration-rapido hover:bg-paperSoft"
              >
                <span className="font-serif text-lg font-semibold text-ink">{item.q}</span>
                <ChevronDown
                  size={20}
                  aria-hidden
                  className={cn("shrink-0 text-mute transition-transform duration-normal ease-salida", abierta && "rotate-180")}
                />
              </button>
            </h2>
            <div id={panelId} hidden={!abierta} className="px-6 pb-5 text-[15px] leading-relaxed text-inkSoft">
              {item.a}
            </div>
          </div>
        );
      })}
    </div>
  );
}
