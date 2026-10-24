"use client";

import { useState } from "react";
import type { ReactNode } from "react";

/**
 * Conmutador Grafo / Lista para el mapa de poder (/app/poder). Ambas vistas quedan montadas (se ocultan con `hidden`)
 * para no perder el estado del grafo ni rehacer la tabla al cambiar. Arranca en Grafo (la vista de conjunto).
 */
export function PoderVista({ grafo, lista }: { grafo: ReactNode; lista: ReactNode }) {
  const [v, setV] = useState<"grafo" | "lista">("grafo");
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Vista del mapa de poder" className="inline-flex rounded-xl border border-line bg-paper p-0.5">
        {(["grafo", "lista"] as const).map((x) => (
          <button
            key={x}
            type="button"
            role="tab"
            aria-selected={v === x}
            onClick={() => setV(x)}
            className={`rounded-lg px-3.5 py-1.5 text-meta font-medium transition-colors duration-rapido ${
              v === x ? "bg-granate text-sobreMaiz" : "text-inkSoft hover:text-ink"
            }`}
          >
            {x === "grafo" ? "Grafo" : "Lista"}
          </button>
        ))}
      </div>
      <div hidden={v !== "grafo"}>{grafo}</div>
      <div hidden={v !== "lista"}>{lista}</div>
    </div>
  );
}
