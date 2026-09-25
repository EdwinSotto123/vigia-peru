"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { numero } from "@/lib/formato";

/**
 * Pestañas dentro de una página (DESIGN_SYSTEM.md §14.3): en vez de apilar cinco
 * secciones que obligan a bajar y bajar, cada una es una pestaña y se cambia con un clic
 * sin salir de la página.
 *
 * - Todo el contenido llega ya armado del servidor (ReactNode) y se muestra una pestaña a
 *   la vez: cambiar es instantáneo, sin pedir nada.
 * - La pestaña va a la URL (`?seccion=`) con `history.replaceState`: el enlace comparte la
 *   vista exacta ("mira las señales de este aliado") sin recargar ni ensuciar el historial.
 *   La inicial la decide el servidor (`activa`), así no hace falta `useSearchParams`.
 * - Accesible como el patrón de pestañas de WAI-ARIA: `tablist`/`tab`/`tabpanel`, flechas,
 *   Inicio y Fin; en el celular la barra se desliza en una sola fila.
 * - Cada pestaña se monta la primera vez que se abre (la inicial, en el servidor): una
 *   página con siete pestañas pesadas no dibuja las siete al cargar. Visitada, queda montada.
 * - `fija`: la barra queda pegada arriba al bajar (páginas largas como el informe).
 * - Un botón fuera de la barra ("Ver las señales") cambia de pestaña con `irAPestana()`.
 */

const EVENTO = "vigia:pestana";

/** Cambia de pestaña desde cualquier botón de la página: `irAPestana("senales")`. */
export function irAPestana(clave: string, param = "seccion") {
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: { clave, param } }));
}

export interface Pestana {
  clave: string;
  etiqueta: string;
  /** Conteo al lado del nombre. `null` = sin dato: no se muestra un 0. */
  conteo?: number | null;
  /** Ícono a la izquierda del nombre (un `<Icono size={15} aria-hidden />` ya armado). */
  icono?: ReactNode;
  contenido: ReactNode;
}

export function Pestanas({
  pestanas,
  activa,
  param = "seccion",
  etiqueta,
  fija = false,
  className,
}: {
  pestanas: Pestana[];
  /** La clave activa al cargar (del `searchParams` del servidor). */
  activa?: string;
  param?: string;
  /** Nombre de la barra para el lector de pantalla: "Secciones del perfil". */
  etiqueta: string;
  /** La barra queda fija arriba al bajar (páginas largas). */
  fija?: boolean;
  className?: string;
}) {
  const inicial = pestanas.some((p) => p.clave === activa) ? activa! : pestanas[0]?.clave;
  const [actual, setActual] = useState(inicial);
  const [visitadas, setVisitadas] = useState<Set<string | undefined>>(() => new Set([inicial]));
  const id = useId();
  const botones = useRef<(HTMLButtonElement | null)[]>([]);

  const elegir = (clave: string, enfocar = false) => {
    setActual(clave);
    setVisitadas((v) => (v.has(clave) ? v : new Set(v).add(clave)));
    try {
      const url = new URL(window.location.href);
      if (clave === pestanas[0]?.clave) url.searchParams.delete(param);
      else url.searchParams.set(param, clave);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* sin URL no se comparte la vista, pero la pestaña cambia igual */
    }
    if (enfocar) botones.current[pestanas.findIndex((p) => p.clave === clave)]?.focus();
  };

  // `irAPestana()` desde cualquier botón de la página.
  useEffect(() => {
    const alPedir = (e: Event) => {
      const d = (e as CustomEvent<{ clave: string; param: string }>).detail;
      if (d?.param === param && pestanas.some((p) => p.clave === d.clave)) elegir(d.clave, true);
    };
    window.addEventListener(EVENTO, alPedir);
    return () => window.removeEventListener(EVENTO, alPedir);
  });

  const alTeclado = (e: React.KeyboardEvent, i: number) => {
    const n = pestanas.length;
    const destino =
      e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (destino < 0) return;
    e.preventDefault();
    elegir(pestanas[destino].clave, true);
  };

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={etiqueta}
        className={cn(
          "-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] sm:mx-0 sm:px-0",
          fija && "sticky top-0 z-barra bg-paper/95 backdrop-blur",
        )}
      >
        {pestanas.map((p, i) => {
          const sel = p.clave === actual;
          return (
            <button
              key={p.clave}
              ref={(el) => {
                botones.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${p.clave}`}
              aria-selected={sel}
              aria-controls={`${id}-panel-${p.clave}`}
              tabIndex={sel ? 0 : -1}
              onClick={() => elegir(p.clave)}
              onKeyDown={(e) => alTeclado(e, i)}
              className={cn(
                "relative -mb-px inline-flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 text-[14px] font-medium transition-colors duration-rapido",
                sel ? "border-granate text-granate" : "border-transparent text-inkSoft hover:border-line hover:text-ink",
              )}
            >
              {p.icono}
              {p.etiqueta}
              {p.conteo != null && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[12px] font-semibold tabular-nums",
                    sel ? "bg-granate-50 text-granate" : "bg-paperDeep text-mute",
                  )}
                >
                  {numero(p.conteo)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {pestanas.map((p) => (
        <div
          key={p.clave}
          role="tabpanel"
          id={`${id}-panel-${p.clave}`}
          aria-labelledby={`${id}-tab-${p.clave}`}
          hidden={p.clave !== actual}
          tabIndex={0}
          className="pt-5 focus-visible:outline-none"
        >
          {visitadas.has(p.clave) ? p.contenido : null}
        </div>
      ))}
    </div>
  );
}

/** La primera línea de una pestaña: qué muestra (una oración, ⓘ) y su acción, a la derecha. */
export function CabeceraPestana({ children, ayuda, acciones }: { children?: ReactNode; ayuda?: ReactNode; acciones?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="inline-flex items-center gap-1 text-[14px] text-inkSoft">
        {children}
        {ayuda}
      </p>
      {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
    </div>
  );
}
