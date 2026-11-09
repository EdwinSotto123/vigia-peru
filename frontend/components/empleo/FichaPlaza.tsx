"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ClavePestana = "cumples" | "postular" | "bases" | "saber" | "sueldo" | "asistente";

export interface PestanaPlaza {
  clave: ClavePestana;
  titulo: string;
  /** Al lado del nombre: cuántos requisitos no cumples, cuántas bases, cuántas cosas que saber. */
  cuenta?: ReactNode;
  contenido: ReactNode;
}

/** Las anclas de antes (y las de adentro de cada pestaña) abren su pestaña: #saber, #que-hacer, #parecidas… */
const ANCLAS: Record<string, ClavePestana> = {
  cumples: "cumples",
  "tu-perfil": "cumples",
  postular: "postular",
  "que-hacer": "postular",
  fechas: "postular",
  bases: "bases",
  evaluacion: "bases",
  puesto: "bases",
  saber: "saber",
  sueldo: "sueldo",
  misma: "sueldo",
  parecidas: "sueldo",
  asistente: "asistente",
};

/** Lo que mide la cabecera de la app (h-16), donde se pega la barra. */
const ALTO_CABECERA = 64;

const TONO_PASTILLA = {
  no: "bg-crimson-soft text-crimsonTexto",
  confirma: "bg-amber-soft text-amberTexto",
  cumples: "bg-moss/15 text-mossTexto",
  neutro: "bg-ink/[0.06] text-inkSoft",
};

/** El número al lado del nombre de una pestaña. */
export function Pastilla({ tono = "neutro", children, etiqueta }: { tono?: keyof typeof TONO_PASTILLA; children: ReactNode; etiqueta?: string }) {
  return (
    <span className={cn("inline-flex min-w-5 items-center justify-center gap-0.5 rounded-full px-1.5 text-rotulo font-semibold tabular-nums", TONO_PASTILLA[tono])}>
      {children}
      {etiqueta && <span className="sr-only"> {etiqueta}</span>}
    </span>
  );
}

/**
 * La ficha de una plaza en pestañas (2026-11-08, el usuario: «ordénalo en subpestañas, con un top fijo»). Arriba, pegada
 * bajo la cabecera de la app al bajar, la barra con lo que decide (el veredicto, la fecha y Postular) y las pestañas;
 * abajo, una pestaña a la vez. La pestaña va en el enlace (#bases) para compartirla, sin sumar pasos al botón Atrás, y
 * cualquier enlace a una de sus anclas (#saber, #que-hacer) abre la suya.
 */
export function FichaPlaza({ barra, pestanas, inicial }: { barra: ReactNode; pestanas: PestanaPlaza[]; inicial?: string }) {
  const primera = pestanas[0]?.clave ?? "cumples";
  const valida = useCallback((c: string | undefined): ClavePestana | null => {
    const k = c ? ANCLAS[c] : undefined;
    return k && pestanas.some((p) => p.clave === k) ? k : null;
  }, [pestanas]);
  const [actual, setActual] = useState<ClavePestana>(() => valida(inicial) ?? primera);
  const ancla = useRef<HTMLDivElement>(null);
  const botones = useRef<Partial<Record<ClavePestana, HTMLButtonElement | null>>>({});

  const ir = useCallback(
    (clave: ClavePestana, opciones: { subir?: boolean; enfocar?: boolean } = {}) => {
      setActual(clave);
      try {
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${clave}`);
      } catch {
        /* sin historial: la pestaña cambia igual */
      }
      if (opciones.enfocar) botones.current[clave]?.focus();
      // Si ya bajaste, la pestaña nueva empieza arriba (con la barra pegada), no a media página.
      if (opciones.subir !== false)
        requestAnimationFrame(() => {
          const el = ancla.current;
          if (!el) return;
          const y = el.getBoundingClientRect().top + window.scrollY - ALTO_CABECERA;
          if (window.scrollY > y + 1) window.scrollTo({ top: y });
        });
    },
    [],
  );

  // La pestaña del enlace (#bases) al entrar, y los enlaces a una ancla de la ficha.
  useEffect(() => {
    const deHash = valida(window.location.hash.slice(1));
    if (deHash) setActual(deHash);
    const alHacerClic = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href^='#']");
      const k = a ? valida(a.getAttribute("href")!.slice(1)) : null;
      if (!k) return;
      e.preventDefault();
      ir(k);
    };
    const alCambiarHash = () => {
      const k = valida(window.location.hash.slice(1));
      if (k) setActual(k);
    };
    document.addEventListener("click", alHacerClic);
    window.addEventListener("hashchange", alCambiarHash);
    return () => {
      document.removeEventListener("click", alHacerClic);
      window.removeEventListener("hashchange", alCambiarHash);
    };
  }, [ir, valida]);

  const mover = (e: KeyboardEvent, i: number) => {
    const destino = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? pestanas.length - 1 : null;
    if (destino == null) return;
    e.preventDefault();
    ir(pestanas[(destino + pestanas.length) % pestanas.length].clave, { subir: false, enfocar: true });
  };

  return (
    <>
      <div ref={ancla} aria-hidden />
      <div className="sticky top-16 z-20 -mx-4 border-b border-line bg-lienzo/95 px-4 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {barra}
        <div role="tablist" aria-label="Secciones de la plaza" className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {pestanas.map((p, i) => {
            const activa = p.clave === actual;
            return (
              <button
                key={p.clave}
                ref={(el) => {
                  botones.current[p.clave] = el;
                }}
                type="button"
                role="tab"
                id={`pestana-${p.clave}`}
                aria-selected={activa}
                aria-controls={`panel-${p.clave}`}
                tabIndex={activa ? 0 : -1}
                onClick={() => ir(p.clave)}
                onKeyDown={(e) => mover(e, i)}
                className={cn(
                  "inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-dato font-semibold transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate",
                  activa ? "border-granate text-ink" : "border-transparent text-inkSoft hover:border-ink/20 hover:text-ink",
                )}
              >
                {p.titulo}
                {p.cuenta}
              </button>
            );
          })}
        </div>
      </div>
      {pestanas.map((p) => (
        <div
          key={p.clave}
          role="tabpanel"
          id={`panel-${p.clave}`}
          aria-labelledby={`pestana-${p.clave}`}
          hidden={p.clave !== actual}
          tabIndex={0}
          className="pt-5 focus-visible:outline-none sm:pt-6"
        >
          {p.contenido}
        </div>
      ))}
    </>
  );
}
