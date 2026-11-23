"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Un botón que abre un panel (los filtros de la bandeja, guardar una búsqueda). Desde sm el panel cuelga del botón; en el
 * celular sube como una hoja abajo, sobre la barra de la app, con su fondo. Se cierra con Escape, al tocar fuera o con
 * su X, y el foco vuelve al botón. Al abrir, el foco va al primer control del panel.
 */
export function Desplegable({
  etiqueta, cuenta = 0, activo = false, Icono, children, ancho = "sm:w-80", alinear = "izquierda",
}: {
  etiqueta: string;
  /** Cuántos valores hay elegidos (se muestra junto a la etiqueta). */
  cuenta?: number;
  activo?: boolean;
  Icono?: typeof ChevronDown;
  children: (cerrar: () => void) => ReactNode;
  /** El ancho desde sm, como clase completa («sm:w-96»): Tailwind no ve clases armadas. */
  ancho?: string;
  alinear?: "izquierda" | "derecha";
}) {
  const [abierto, setAbierto] = useState(false);
  const id = useId();
  const caja = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const marcado = activo || cuenta > 0;

  const cerrar = () => {
    setAbierto(false);
    boton.current?.focus();
  };

  useEffect(() => {
    if (!abierto) return;
    panel.current?.querySelector<HTMLElement>("input, select, button, textarea, a[href]")?.focus();
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setAbierto(false);
        boton.current?.focus();
      }
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);

  return (
    <div ref={caja} className="relative">
      <button
        ref={boton}
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        aria-controls={id}
        className={cn(
          "inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-dato font-medium transition-colors duration-rapido",
          marcado ? "border-granate/50 bg-granate-50 text-ink" : "border-line bg-caja text-inkSoft hover:border-ink/20 hover:text-ink",
        )}
      >
        {Icono && <Icono size={15} aria-hidden />}
        {etiqueta}
        {cuenta > 0 && <span className="rounded-full bg-granate px-1.5 text-rotulo font-bold tabular-nums leading-5 text-paper">{cuenta}</span>}
        <ChevronDown size={15} aria-hidden className={cn("transition-transform duration-rapido", abierto && "rotate-180")} />
      </button>
      {abierto && (
        <>
          <span aria-hidden className="gs-velo fixed inset-0 z-40 bg-ink/30 sm:hidden" />
          <div
            ref={panel}
            id={id}
            role="dialog"
            aria-label={etiqueta}
            className={cn(
              "gs-panel z-50 rounded-xl border border-line bg-caja p-3 shadow-pop",
              "fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.25rem)] max-h-[70vh] overflow-y-auto",
              "sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:mt-2 sm:max-h-[min(70vh,28rem)]",
              alinear === "derecha" ? "sm:right-0" : "sm:left-0",
              ancho,
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2 sm:hidden">
              <p className="text-dato font-bold text-ink">{etiqueta}</p>
              <button type="button" onClick={cerrar} aria-label="Cerrar" className="grid h-10 w-10 place-items-center rounded-full text-inkSoft hover:bg-ink/[0.06]">
                <X size={18} aria-hidden />
              </button>
            </div>
            {children(cerrar)}
          </div>
        </>
      )}
    </div>
  );
}
