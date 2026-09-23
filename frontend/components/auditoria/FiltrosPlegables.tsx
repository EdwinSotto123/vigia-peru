"use client";

/**
 * Los filtros de /app/auditoria, plegados en móvil. En 390 px los tres controles apilados
 * empujaban el tablero una pantalla hacia abajo: se entraba a mirar la cola y lo primero era
 * un formulario. En móvil queda un botón que dice cuántos filtros hay puestos; desde `sm`
 * los controles se ven siempre, como antes.
 *
 * `children` llega ya renderizado desde el server component (nunca una función).
 */

import { useId, useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";

export function FiltrosPlegables({ activos, columnas, children }: { activos: number; columnas: 2 | 3; children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const id = useId();
  return (
    <div className="w-full sm:w-auto">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-controls={id}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink sm:hidden"
      >
        <span className="inline-flex items-center gap-2">
          <SlidersHorizontal size={14} className="text-mute" aria-hidden />
          Filtrar{activos > 0 ? ` (${activos} ${activos === 1 ? "puesto" : "puestos"})` : ""}
        </span>
        <ChevronDown size={14} className={`text-mute transition-transform ${abierto ? "rotate-180" : ""}`} aria-hidden />
      </button>
      <div
        id={id}
        className={`${abierto ? "mt-2 grid" : "hidden"} w-full grid-cols-1 gap-2 sm:mt-0 sm:grid sm:w-auto sm:gap-1.5 ${
          columnas === 3 ? "sm:grid-cols-3 lg:min-w-[34rem]" : "sm:grid-cols-2 lg:min-w-[24rem]"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
