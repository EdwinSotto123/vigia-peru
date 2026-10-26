"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Severidad } from "@/components/ui/Severidad";
import { cn } from "@/lib/utils";

/** Lo que dispara «También en…» dentro de una señal para elegir otra entidad del índice. */
const EVENTO = "vigia:persona-entidad";

export interface EntidadDelIndice {
  /** El RUC de la entidad: va a la URL (`?sent=`). */
  clave: string;
  nombre: string;
  /** La más grave de sus señales: el ícono del índice. */
  severidad: "alta" | "media" | "baja";
  /** "3 señales, 1 alta": el mismo número de filas que muestra su detalle. */
  resumen: string;
  /** Sus señales, ya armadas en el servidor. */
  contenido: ReactNode;
}

/**
 * Las entidades de una persona como maestro-detalle: a la izquierda (arriba en el celular) la lista de entidades con
 * señales, la más grave primero; a la derecha sólo la elegida. Antes era un índice de 230 px con anclas a ocho tarjetas
 * apiladas: el conteo `shrink-0` dejaba ~50 px al nombre (una palabra por renglón, «Gobierno3 señales») y las graves
 * quedaban a dos pantallas.
 *
 * - La elegida va a la URL (`param`, por defecto `sent`) con `history.replaceState`: sin recargar ni ensuciar el
 *   historial, y el enlace comparte esa entidad. La inicial la decide el servidor (`inicial`); sin ella, la primera.
 * - Patrón de pestañas verticales de WAI-ARIA: flechas arriba/abajo, Inicio y Fin.
 * - Cada detalle se monta la primera vez que se elige (el inicial, en el servidor) y queda montado.
 * - Si al elegir el detalle quedó arriba de la pantalla (se había bajado en una entidad larga), vuelve a su comienzo.
 */
export function IndiceEntidades({
  entidades,
  inicial,
  param = "sent",
  titulo,
  pie,
}: {
  entidades: EntidadDelIndice[];
  inicial?: string;
  param?: string;
  /** El rótulo visible de la lista: "Entidades con señales". */
  titulo: string;
  /** Una línea debajo de la lista ("Sin señales en 2 entidades más"). */
  pie?: ReactNode;
}) {
  const primera = entidades[0]?.clave;
  const [actual, setActual] = useState(() => (inicial && entidades.some((e) => e.clave === inicial) ? inicial : primera));
  const [vistas, setVistas] = useState<Set<string | undefined>>(() => new Set([actual]));
  const id = useId();
  const botones = useRef<(HTMLButtonElement | null)[]>([]);
  const detalle = useRef<HTMLDivElement>(null);

  const elegir = (clave: string, enfocar = false) => {
    setActual(clave);
    setVistas((v) => (v.has(clave) ? v : new Set(v).add(clave)));
    try {
      const url = new URL(window.location.href);
      if (clave === primera) url.searchParams.delete(param);
      else url.searchParams.set(param, clave);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* sin URL no se comparte la entidad elegida, pero se elige igual */
    }
    if (enfocar) botones.current[entidades.findIndex((e) => e.clave === clave)]?.focus({ preventScroll: true });
    window.requestAnimationFrame(() => {
      const d = detalle.current;
      if (d && d.getBoundingClientRect().top < 0) d.scrollIntoView({ block: "start" });
    });
  };

  // «También en…» de una señal elige otra entidad sin salir de la pestaña.
  useEffect(() => {
    const alPedir = (e: Event) => {
      const clave = (e as CustomEvent<{ clave: string }>).detail?.clave;
      if (clave && entidades.some((x) => x.clave === clave)) elegir(clave, true);
    };
    window.addEventListener(EVENTO, alPedir);
    return () => window.removeEventListener(EVENTO, alPedir);
  });

  const alTeclado = (e: KeyboardEvent, i: number) => {
    const n = entidades.length;
    const destino =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? (i + 1) % n
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? (i - 1 + n) % n
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : -1;
    if (destino < 0) return;
    e.preventDefault();
    elegir(entidades[destino].clave, true);
  };

  return (
    <div className="lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start lg:gap-6">
      <div className="mb-4 lg:sticky lg:top-20 lg:mb-0">
        <p id={`${id}-titulo`} className="mb-1.5 px-3 text-meta font-semibold text-inkSoft">
          {titulo}
        </p>
        <div role="tablist" aria-orientation="vertical" aria-labelledby={`${id}-titulo`} className="flex flex-col gap-1">
          {entidades.map((e, i) => {
            const sel = e.clave === actual;
            return (
              <button
                key={e.clave}
                ref={(el) => {
                  botones.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${i}`}
                aria-selected={sel}
                aria-controls={`${id}-panel-${i}`}
                tabIndex={sel ? 0 : -1}
                onClick={() => elegir(e.clave)}
                onKeyDown={(ev) => alTeclado(ev, i)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors duration-rapido",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
                  sel ? "border-granate/30 bg-granate-50" : "border-transparent hover:bg-paperSoft",
                )}
              >
                <Severidad bandera={e.severidad} formato="punto" className="mt-1 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className={cn("block break-words text-dato leading-snug text-ink", sel ? "font-semibold" : "font-medium")}>{e.nombre}</span>
                  <span className="mt-0.5 block text-meta text-mute">{e.resumen}</span>
                </span>
              </button>
            );
          })}
        </div>
        {pie && <p className="mt-2 px-3 text-meta text-mute">{pie}</p>}
      </div>
      <div ref={detalle} className="min-w-0 scroll-mt-28 lg:scroll-mt-20">
        {entidades.map((e, i) => (
          <div key={e.clave} role="tabpanel" id={`${id}-panel-${i}`} aria-labelledby={`${id}-tab-${i}`} hidden={e.clave !== actual}>
            {vistas.has(e.clave) ? e.contenido : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Elige otra entidad del índice desde una señal («También en: …»). Fuera de un índice no hace nada. */
export function BotonEntidad({ clave, children }: { clave: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(EVENTO, { detail: { clave } }))}
      className="inline-flex min-h-[28px] items-center rounded-full border border-line bg-paper px-2.5 py-0.5 text-left text-meta text-inkSoft transition-colors duration-rapido hover:border-granate/40 hover:text-granate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
    >
      {children}
    </button>
  );
}
