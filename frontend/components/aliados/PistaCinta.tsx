"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * La pista de la cinta de aportes, con su botón para detenerla (WCAG 2.2.2: lo que se mueve solo más de cinco segundos
 * tiene que poder pararse; detenerse al pasar el cursor no alcanza con el teclado ni en el celular).
 *
 * Detenida, la cinta vuelve al principio y queda como una fila quieta que se desliza a mano, sin la copia decorativa:
 * lo mismo que con «reducir movimiento» (globals.css), donde además el botón no aparece porque nada se mueve.
 * Los aportes llegan ya armados del servidor (`children`); aquí sólo vive el estado.
 */
export function PistaCinta({ duracion, children }: { duracion: number; children: ReactNode }) {
  const [detenida, setDetenida] = useState(false);
  const estilo = { "--cinta-duracion": `${duracion}s`, ...(detenida ? { animation: "none" } : {}) } as CSSProperties;
  return (
    <div className="relative">
      <div className={cn("cinta-marco relative py-3", detenida ? "overflow-x-auto [&_.cinta-copia]:hidden" : "overflow-hidden")}>
        {!detenida && (
          <>
            <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-ink to-transparent" />
            <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-10 w-14 bg-gradient-to-l from-ink to-transparent" />
          </>
        )}
        <div className={detenida ? "flex w-max px-4 sm:px-5" : "cinta-pista"} style={estilo}>
          {children}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setDetenida((d) => !d)}
        aria-pressed={detenida}
        aria-label={detenida ? "Volver a mover la cinta de aportes" : "Detener la cinta de aportes"}
        title={detenida ? "Volver a moverla" : "Detenerla"}
        className="absolute right-2 top-1/2 z-20 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-paper/25 bg-ink text-paper transition-colors duration-rapido hover:border-maiz hover:text-maiz motion-reduce:hidden"
      >
        {detenida ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
      </button>
    </div>
  );
}
