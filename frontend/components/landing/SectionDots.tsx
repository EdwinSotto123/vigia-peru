"use client";

import { useEffect, useState } from "react";

/** Secciones candidatas del landing (en orden). Solo se renderizan las que
 *  realmente existen en el DOM, así el rail nunca queda desfasado. */
const SECTIONS = [
  { id: "inicio", label: "Inicio" },
  { id: "como", label: "Cómo funciona" },
  { id: "historia", label: "Historia" },
  { id: "impacto", label: "Por qué importa" },
  { id: "detecta", label: "Detecta" },
  { id: "problema", label: "Problema" },
  { id: "plataforma", label: "Plataforma" },
  { id: "organizacion", label: "Quiénes somos" },
];

export function SectionDots() {
  const [active, setActive] = useState<string>("inicio");
  const [present, setPresent] = useState<string[]>([]);

  useEffect(() => {
    const found = SECTIONS.filter((s) => document.getElementById(s.id)).map((s) => s.id);
    setPresent(found);
    if (found.length < 2) return;

    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive((e.target as HTMLElement).id);
        });
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    found.forEach((id) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  if (present.length < 2) return null;

  return (
    <nav
      aria-label="Secciones de la página"
      className="fixed right-4 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-center gap-3.5 lg:flex"
    >
      {SECTIONS.filter((s) => present.includes(s.id)).map((s) => {
        const on = active === s.id;
        return (
          <a key={s.id} href={`#${s.id}`} className="group relative flex items-center" aria-label={s.label}>
            <span
              className={
                "block rounded-full shadow-[0_0_0_1px_rgba(27,22,17,0.12)] transition-all duration-300 " +
                (on ? "h-2.5 w-2.5 bg-clay" : "h-2 w-2 bg-clay/35 group-hover:bg-clay/70")
              }
            />
            <span className="pointer-events-none absolute right-6 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-paper opacity-0 shadow-card transition-opacity duration-200 group-hover:opacity-100">
              {s.label}
            </span>
          </a>
        );
      })}
    </nav>
  );
}
