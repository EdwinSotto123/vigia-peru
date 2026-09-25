"use client";

import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * El panel de la zona en el celular: una hoja que sube desde abajo. Cerrada deja
 * a la vista su asa (64 px) con el nombre de la región y sus cifras, para que el
 * mapa siga entero en la pantalla; abierta ocupa el 72 % del alto.
 */
export function PanelZonaMovil({
  titulo,
  resumen,
  abierto,
  onAlternar,
  children,
}: {
  titulo: string;
  /** Las cifras de la zona en una línea. `null` = cargando. */
  resumen: ReactNode | null;
  abierto: boolean;
  onAlternar: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-panel transition-transform duration-panel ease-salida lg:hidden",
        abierto ? "translate-y-0" : "translate-y-[calc(100%-64px)]",
      )}
    >
      <div className="rounded-t-2xl border-t border-line bg-paperSoft shadow-drawer" role="region" aria-label={`Panel de ${titulo}`}>
        <button
          type="button"
          onClick={onAlternar}
          aria-expanded={abierto}
          aria-controls="panel-zona-movil"
          className="flex h-16 w-full items-center justify-between gap-3 border-b border-line bg-paperDeep px-5 text-left"
        >
          <span className="min-w-0">
            <span className="block font-display text-base font-bold leading-tight text-ink">{titulo}</span>
            <span className="mt-0.5 block truncate text-[12px] tabular-nums text-inkSoft">
              {resumen ?? (
                <>
                  {/* Un <span> y no <Skeleton> (un <div>): dentro de un botón sólo cabe contenido en línea. */}
                  <span className="inline-block h-3 w-40 animate-pulse rounded bg-paperEdge align-middle" aria-hidden />
                  <span className="sr-only">Cargando las cifras…</span>
                </>
              )}
            </span>
          </span>
          {abierto ? (
            <ChevronDown size={18} className="shrink-0 text-mute" aria-hidden />
          ) : (
            <ChevronUp size={18} className="shrink-0 text-mute" aria-hidden />
          )}
          <span className="sr-only">{abierto ? "Bajar el panel" : "Subir el panel"}</span>
        </button>
        <div id="panel-zona-movil" className="h-[72vh]">
          {children}
        </div>
      </div>
    </div>
  );
}
