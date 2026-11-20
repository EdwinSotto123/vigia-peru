"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Un texto largo del registro (la infracción, las normas, el estado judicial) en sus primeras líneas, con «Leer todo»
 * para abrirlo entero. Un texto corto se muestra entero, sin botón. El texto va tal como lo publicó la fuente.
 */
export function TextoPlegable({ texto, lineas = 3, corte = 260, className }: { texto: string; lineas?: 2 | 3 | 4; corte?: number; className?: string }) {
  const [abierto, setAbierto] = useState(false);
  const id = useId();
  const largo = texto.length > corte;
  const clamp = lineas === 2 ? "line-clamp-2" : lineas === 4 ? "line-clamp-4" : "line-clamp-3";
  return (
    <div className={cn("min-w-0", className)}>
      <p id={id} className={cn("max-w-[80ch] whitespace-pre-line text-pretty text-dato leading-relaxed text-inkSoft [overflow-wrap:anywhere]", largo && !abierto && clamp)}>
        {texto}
      </p>
      {largo && (
        <button
          type="button"
          aria-expanded={abierto}
          aria-controls={id}
          onClick={() => setAbierto((x) => !x)}
          className="mt-1 inline-flex min-h-11 items-center gap-1 rounded-lg text-meta font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate sm:min-h-8"
        >
          {abierto ? "Ocultar" : "Leer todo"}
          <ChevronDown size={14} aria-hidden className={cn("transition-transform duration-rapido motion-reduce:transition-none", abierto && "rotate-180")} />
        </button>
      )}
    </div>
  );
}
