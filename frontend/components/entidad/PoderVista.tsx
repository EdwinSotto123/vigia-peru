"use client";

import { useState } from "react";
import type { ReactNode } from "react";

/**
 * Conmutador de vistas del mapa de poder (/app/poder): Dependencia (Gobierno Nacional: sector → pliego → ejecutora, con
 * los autónomos marcados), Territorio (región → provincia → distrito), Instituciones (las que más contratan por rama) y
 * Lista (tabla de partidos). Todas quedan montadas (se ocultan con `hidden`) para no perder el estado. Arranca en
 * Dependencia (la estructura de quién depende de quién).
 */
const TABS = [
  ["dependencia", "Dependencia"],
  ["territorio", "Territorio"],
  ["instituciones", "Instituciones"],
  ["lista", "Lista"],
] as const;
type Vista = (typeof TABS)[number][0];

export function PoderVista({ dependencia, territorio, instituciones, lista }: { dependencia: ReactNode; territorio: ReactNode; instituciones: ReactNode; lista: ReactNode }) {
  const [v, setV] = useState<Vista>("dependencia");
  const nodo = { dependencia, territorio, instituciones, lista };
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Vista del mapa de poder" className="inline-flex flex-wrap rounded-xl border border-line bg-paper p-0.5">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={v === k}
            onClick={() => setV(k)}
            className={`rounded-lg px-3.5 py-1.5 text-meta font-medium transition-colors duration-rapido ${
              v === k ? "bg-granate text-sobreMaiz" : "text-inkSoft hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {(Object.keys(nodo) as Vista[]).map((k) => (
        <div key={k} hidden={v !== k}>{nodo[k]}</div>
      ))}
    </div>
  );
}
