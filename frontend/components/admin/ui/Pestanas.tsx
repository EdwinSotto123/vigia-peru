"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { TONO, type Tone } from "./tono";

/**
 * Pestañas de una página del panel. Antes cada página apilaba sus secciones una debajo de la otra (Fuentes y
 * procesos medía 4.8 pantallas en escritorio y 13.5 en el celular; Procesamiento, 16.3): ahora cada sección es una
 * pestaña y sólo se pinta la activa, así que los datos de las demás no se piden hasta abrirlas.
 *
 * La activa vive en la URL (`?tab=`, o el `param` que se pase): se comparte con un enlace, sobrevive a recargar y el
 * enlace del menú (sin parámetro) vuelve a la primera. Como `useSearchParams`, pide un límite de Suspense arriba.
 *
 *   const [tab, setTab] = usePestana(["fuentes", "corridas"] as const);
 *   <Pestanas etiqueta="Secciones de fuentes" pestanas={[{ clave: "fuentes", etiqueta: "Fuentes", conteo: 13 }, …]}
 *             activa={tab} onCambiar={setTab} />
 *   <PanelPestana clave={tab}>{tab === "fuentes" ? <Fuentes /> : <Corridas />}</PanelPestana>
 */
export function usePestana<T extends string>(claves: readonly T[], param = "tab"): [T, (t: T) => void] {
  const params = useSearchParams();
  const pedida = params.get(param);
  const activa = (pedida && (claves as readonly string[]).includes(pedida) ? pedida : claves[0]) as T;
  const cambiar = useCallback(
    (t: T) => {
      // Sin ir al servidor: Next sincroniza history.replaceState con useSearchParams (como el filtro de Contribuciones).
      const sp = new URLSearchParams(window.location.search);
      if (t === claves[0]) sp.delete(param);
      else sp.set(param, t);
      const qs = sp.toString();
      window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
    },
    [claves, param],
  );
  return [activa, cambiar];
}

export interface PestanaPanel<T extends string = string> {
  clave: T;
  etiqueta: string;
  /** Cuántos hay adentro (filas, pendientes). `null` = no se sabe todavía: no se muestra. */
  conteo?: number | null;
  /** Un punto de color cuando la pestaña pide atención (fallas, pendientes). */
  tono?: Tone;
}

/**
 * Ids fijos para unir cada pestaña con su panel: una página tiene un solo juego de pestañas del panel (dentro de una
 * pestaña, lo secundario va en chips de filtro).
 */
const BASE = "pestanas-admin";
const idPanel = (clave: string) => `${BASE}-panel-${clave}`;
const idTab = (clave: string) => `${BASE}-tab-${clave}`;

export function Pestanas<T extends string>({
  pestanas,
  activa,
  onCambiar,
  etiqueta,
  className,
}: {
  pestanas: PestanaPanel<T>[];
  activa: T;
  onCambiar: (t: T) => void;
  /** Nombre del grupo para el lector de pantalla: "Secciones de Fuentes y procesos". */
  etiqueta: string;
  className?: string;
}) {
  // En el celular las pestañas se deslizan de costado: la activa se trae a la vista (con `?tab=` en la URL quedaba
  // cortada en el borde). Sólo se mueve el riel, nunca la página.
  const riel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const r = riel.current;
    const sel = r?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!r || !sel || r.scrollWidth <= r.clientWidth) return;
    r.scrollLeft = Math.max(0, sel.offsetLeft - (r.clientWidth - sel.offsetWidth) / 2);
  }, [activa]);
  // Flechas, Inicio y Fin mueven el foco y eligen, como unas pestañas nativas (APG: activación automática).
  function alTeclado(e: React.KeyboardEvent<HTMLButtonElement>, i: number) {
    const n = pestanas.length;
    const destino =
      e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (destino < 0) return;
    e.preventDefault();
    onCambiar(pestanas[destino].clave);
    document.getElementById(idTab(pestanas[destino].clave))?.focus();
  }
  return (
    <div
      ref={riel}
      role="tablist"
      aria-label={etiqueta}
      className={cn(
        // `relative`: el riel es el offsetParent de las pestañas, para medir dónde queda la activa.
        "relative flex w-full gap-1 overflow-x-auto rounded-2xl border border-line bg-paperSoft p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {pestanas.map((p, i) => {
        const sel = p.clave === activa;
        return (
          <button
            key={p.clave}
            id={idTab(p.clave)}
            type="button"
            role="tab"
            aria-selected={sel}
            aria-controls={idPanel(p.clave)}
            tabIndex={sel ? 0 : -1}
            onClick={() => onCambiar(p.clave)}
            onKeyDown={(e) => alTeclado(e, i)}
            className={cn(
              "inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 text-dato font-medium transition-colors duration-rapido",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate",
              sel ? "bg-paper font-semibold text-ink shadow-[0_1px_2px_rgb(var(--ink)/0.08)]" : "text-inkSoft hover:bg-paperDeep/70 hover:text-ink",
            )}
          >
            {p.tono && p.tono !== "neutral" && <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", TONO[p.tono].punto)} />}
            {p.etiqueta}
            {p.conteo != null && (
              <span className={cn("rounded-full px-1.5 py-px font-mono text-micro tabular-nums", sel ? "bg-paperDeep text-ink" : "bg-paperDeep/70 text-mute")}>
                {p.conteo.toLocaleString("es-PE")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** El contenido de la pestaña activa, unido a su pestaña para el lector de pantalla. */
export function PanelPestana({ clave, className, children }: { clave: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="tabpanel" id={idPanel(clave)} aria-labelledby={idTab(clave)} tabIndex={0} className={cn("mt-4 focus-visible:outline-none", className)}>
      {children}
    </div>
  );
}

