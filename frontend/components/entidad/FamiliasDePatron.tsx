"use client";

import type { ReactNode } from "react";
import { irAPestana } from "@/components/patrones/Pestanas";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * Elige una entrada de un índice (`IndiceAntecedentes`) desde fuera de él, sin ir al servidor: escribe su parámetro en la
 * URL (el índice lo lee con `useSearchParams`) y, si la entrada está en otra subpestaña, la abre antes. Antes las familias
 * eran enlaces: cada clic volvía a pedir la ficha entera de la entidad para cambiar una fila del índice.
 */
function elegirEnIndice(param: string, valor: string, pestana?: { param: string; clave: string }) {
  if (pestana) irAPestana(pestana.clave, pestana.param);
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(param, valor);
    window.history.replaceState(window.history.state, "", url);
  } catch {
    /* sin URL no hay cómo avisarle al índice: no pasa nada */
  }
}

/** Un enlace de texto que abre una entrada de un índice (y su subpestaña), sin recargar. */
export function EnIndice({ param, valor, pestana, className, children }: { param: string; valor: string; pestana?: { param: string; clave: string }; className?: string; children: ReactNode }) {
  return (
    <button type="button" onClick={() => elegirEnIndice(param, valor, pestana)} className={cn("text-left", className)}>
      {children}
    </button>
  );
}

export interface FamiliaConCasos {
  clave: string;
  corto: string;
  explica: string;
  /** Cuántas entradas del índice son de esta familia. */
  n: number;
  /** Cuántas de ellas son de señal alta. */
  graves: number;
  /** La primera de sus entradas en el índice: la que abre su tarjeta. */
  primera: string;
}

/**
 * Las familias con casos (concertación, compras partidas, familia y política, sanciones…), de un vistazo y todas: cada
 * tarjeta dice cuántos patrones o antecedentes de esa familia hay en la entidad y abre el primero en el índice de abajo.
 */
export function FamiliasDePatron({ familias, param, uno, varios, etiqueta }: { familias: FamiliaConCasos[]; param: string; uno: string; varios: string; etiqueta: string }) {
  if (!familias.length) return null;
  return (
    <ul className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6" aria-label={etiqueta}>
      {familias.map((f) => (
        <li key={f.clave}>
          <button
            type="button"
            onClick={() => elegirEnIndice(param, f.primera)}
            title={f.explica}
            className="block h-full w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-left transition-colors hover:border-granate/40 hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
          >
            <span className="block text-meta font-medium text-inkSoft">{f.corto}</span>
            <span className="mt-0.5 flex items-baseline gap-1.5">
              <span className={cn("font-display text-seccion font-bold tabular-nums", f.graves ? "text-crimsonTexto" : "text-ink")}>{numero(f.n)}</span>
              <span className="text-rotulo text-mute">{f.n === 1 ? uno : varios}</span>
            </span>
            <span className="mt-0.5 block text-rotulo text-mute">{f.graves ? `${numero(f.graves)} de señal alta` : "ninguno de señal alta"}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
