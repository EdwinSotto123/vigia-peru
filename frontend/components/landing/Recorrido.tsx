"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

/**
 * El orden de la portada, dicho en voz alta (2026-11-14: «no veo un orden claro»). Las cinco secciones ya contaban una
 * historia, pero nada lo señalaba: cada una abría con un titular suelto. Ahora la historia tiene pasos con nombre, una
 * barra que los lista y dice en cuál estás, y cada sección abre con su número.
 */
export const PASOS = [
  { id: "escala", nombre: "El problema", frase: "Miles de contratos que nadie lee" },
  { id: "partidos", nombre: "Tu región", frase: "Quién gobierna y cuánto contrata" },
  { id: "casos", nombre: "Lo que encontró", frase: "Casos reales, de principio a fin" },
  { id: "como", nombre: "Cómo trabaja", frase: "Qué revisa y de dónde sale" },
  { id: "denunciar", nombre: "Súmate", frase: "Aporta, denuncia o investiga" },
] as const;

export type IdPaso = (typeof PASOS)[number]["id"];

/** La etiqueta que abre cada sección: su número en la historia y su nombre corto. */
export function EtiquetaPaso({ id, oscuro = false, className }: { id: IdPaso; oscuro?: boolean; className?: string }) {
  const i = PASOS.findIndex((p) => p.id === id);
  if (i < 0) return null;
  return (
    <p className={clsx("mb-3 flex items-center gap-2 text-meta font-semibold", oscuro ? "text-paper/80" : "text-inkSoft", className)}>
      <span
        aria-hidden
        className={clsx(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-meta font-bold tabular-nums",
          oscuro ? "bg-maiz text-ink" : "bg-granate text-paper",
        )}
      >
        {i + 1}
      </span>
      <span className={oscuro ? "text-paper" : "text-ink"}>{PASOS[i].nombre}</span>
      <span className={clsx("font-normal", oscuro ? "text-paper/60" : "text-mute")}>
        Paso {i + 1} de {PASOS.length}
      </span>
    </p>
  );
}

/**
 * La barra del recorrido: va justo debajo de la primera pantalla y se queda pegada bajo la cabecera. Lista los pasos
 * que existen en la página (una sección que no se dibujó no aparece) y marca el que está a la vista.
 */
export function IndiceRecorrido() {
  const [presentes, setPresentes] = useState<IdPaso[]>(PASOS.map((p) => p.id));
  const [activo, setActivo] = useState<IdPaso | null>(null);
  const fila = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const nodos = PASOS.map((p) => document.getElementById(p.id)).filter((n): n is HTMLElement => n != null);
    setPresentes(nodos.map((n) => n.id as IdPaso));
    if (typeof IntersectionObserver === "undefined" || nodos.length === 0) return;
    // «A la vista» es la sección que cruza la franja de lectura, un poco debajo de la cabecera y de esta barra.
    const io = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) if (e.isIntersecting) setActivo(e.target.id as IdPaso);
      },
      { rootMargin: "-140px 0px -70% 0px" },
    );
    nodos.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);

  // En el celular la fila se desliza: el paso activo queda siempre visible.
  useEffect(() => {
    if (!activo) return;
    const item = fila.current?.querySelector<HTMLElement>(`[data-paso="${activo}"]`);
    const caja = fila.current;
    if (!item || !caja) return;
    const izq = item.offsetLeft - 16;
    if (izq < caja.scrollLeft || item.offsetLeft + item.offsetWidth > caja.scrollLeft + caja.clientWidth) {
      caja.scrollTo({ left: izq, behavior: "smooth" });
    }
  }, [activo]);

  const pasos = PASOS.filter((p) => presentes.includes(p.id));
  if (pasos.length < 2) return null;
  const indiceActivo = pasos.findIndex((p) => p.id === activo);

  return (
    <nav aria-label="Recorrido de la portada" className="sticky top-16 z-30 border-y border-line bg-paper/95 backdrop-blur">
      <div className="container-page flex items-center gap-3">
        <p className="hidden shrink-0 text-meta font-semibold text-inkSoft lg:block">El recorrido</p>
        <ol ref={fila} className="-mx-4 flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto px-4 py-2 [scrollbar-width:none] sm:mx-0 sm:px-0 lg:justify-between [&::-webkit-scrollbar]:hidden">
          {pasos.map((p, i) => {
            const esActivo = p.id === activo;
            const hecho = indiceActivo > i;
            return (
              <li key={p.id} data-paso={p.id} className="shrink-0 lg:min-w-0 lg:flex-1">
                <a
                  href={`#${p.id}`}
                  aria-current={esActivo ? "step" : undefined}
                  onClick={(e) => {
                    // La sección llega debajo de la cabecera Y de esta barra: sin esto su título quedaba tapado.
                    const destino = document.getElementById(p.id);
                    if (!destino) return;
                    e.preventDefault();
                    const barra = e.currentTarget.closest("nav");
                    const meta = () => destino.getBoundingClientRect().top - ((barra?.getBoundingClientRect().bottom ?? 130) + 8);
                    const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                    window.scrollTo({ top: window.scrollY + meta(), behavior: suave ? "smooth" : "auto" });
                    setActivo(p.id);
                    history.replaceState(null, "", `#${p.id}`);
                    // Las secciones de arriba crecen al cargar (el mapa): si el destino se movió, se corrige al llegar.
                    for (const ms of [900, 1700]) {
                      window.setTimeout(() => {
                        if (Math.abs(meta()) > 24) window.scrollTo({ top: window.scrollY + meta(), behavior: "auto" });
                        setActivo(p.id);
                      }, ms);
                    }
                  }}
                  className={clsx(
                    "flex min-h-11 items-center gap-2 rounded-xl px-2.5 py-1.5 transition-colors",
                    esActivo ? "bg-paperDeep" : "hover:bg-paperSoft",
                  )}
                >
                  <span
                    aria-hidden
                    className={clsx(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-meta font-bold tabular-nums",
                      esActivo ? "border-granate bg-granate text-paper" : hecho ? "border-granate text-granate" : "border-line text-inkSoft",
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={clsx("block whitespace-nowrap text-dato font-semibold", esActivo ? "text-ink" : "text-inkSoft")}>{p.nombre}</span>
                    <span className="hidden truncate text-meta text-mute xl:block">{p.frase}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
