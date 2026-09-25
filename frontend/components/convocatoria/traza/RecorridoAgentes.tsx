"use client";

/**
 * "Recorrido": qué pasos corrieron y qué pasó en cada uno, en dos modos —Grafo y Texto— que
 * muestran lo mismo. El modo va a la URL (`?modo=texto`) con `history.replaceState`, como las
 * pestañas del kit: el enlace comparte la vista exacta. Grafo es el modo por defecto y no se
 * escribe en la URL.
 */

import { useState } from "react";
import { AlignLeft, Share2 } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { numero, plural } from "@/lib/formato";
import { cn } from "@/lib/utils";
import type { ApiResult } from "../types";
import { GrafoRecorrido } from "./GrafoRecorrido";
import type { Recorrido } from "./modelo";
import { TextoRecorrido } from "./TextoRecorrido";

type Modo = "grafo" | "texto";
const PARAM_MODO = "modo";

export function RecorridoAgentes({ recorrido, result }: { recorrido: Recorrido; result: ApiResult }) {
  // Este informe se pinta sólo en el cliente (la página espera los datos), así que leer la URL
  // al montar no desfasa la hidratación (mismo criterio que la pestaña de ResultadoView).
  const [modo, setModo] = useState<Modo>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get(PARAM_MODO) === "texto" ? "texto" : "grafo",
  );
  const cambiar = (m: Modo) => {
    setModo(m);
    try {
      const url = new URL(window.location.href);
      if (m === "grafo") url.searchParams.delete(PARAM_MODO);
      else url.searchParams.set(PARAM_MODO, m);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* sin URL no se comparte el modo, pero cambia igual */
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="sr-only">Recorrido de los agentes</h2>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-inkSoft">
          <span>
            <strong className="font-semibold tabular-nums text-ink">
              {numero(recorrido.agentesCorrieron)} de {numero(recorrido.totalAgentes)}
            </strong>{" "}
            agentes de IA corrieron
          </span>
          <span>
            <strong className="font-semibold tabular-nums text-ink">{numero(recorrido.consultas)}</strong>{" "}
            {recorrido.consultas === 1 ? "consulta a herramientas y fuentes" : "consultas a herramientas y fuentes"}
          </span>
          {recorrido.consultasFallidas > 0 && (
            <span className="text-crimsonTexto">
              <strong className="font-semibold tabular-nums">{numero(recorrido.consultasFallidas)}</strong>{" "}
              {recorrido.consultasFallidas === 1 ? "falló" : "fallaron"}
            </span>
          )}
          <span className="inline-flex items-center">
            {plural(recorrido.eventos, "evento en la traza", "eventos en la traza")}
            <Ayuda titulo="¿Qué es la traza?">
              El registro que deja cada paso del análisis: a quién llamó el coordinador, qué consultó cada agente y qué le
              respondieron. No guarda la hora de cada paso, así que el orden que se muestra es el del plan del análisis.
            </Ayuda>
          </span>
        </p>
        <SelectorModo modo={modo} onCambiar={cambiar} />
      </div>
      {modo === "grafo" ? <GrafoRecorrido recorrido={recorrido} result={result} /> : <TextoRecorrido recorrido={recorrido} result={result} />}
    </div>
  );
}

const MODOS: { clave: Modo; etiqueta: string; icono: typeof Share2 }[] = [
  { clave: "grafo", etiqueta: "Grafo", icono: Share2 },
  { clave: "texto", etiqueta: "Texto", icono: AlignLeft },
];

/** Control segmentado con la forma de `Vistas` (listado), pero de botones: cambia el modo sin navegar. */
function SelectorModo({ modo, onCambiar }: { modo: Modo; onCambiar: (m: Modo) => void }) {
  return (
    <div role="group" aria-label="Cómo ver el recorrido" className="inline-flex items-center gap-1 rounded-full border border-line bg-paper p-1">
      {MODOS.map(({ clave, etiqueta, icono: Icono }) => {
        const on = modo === clave;
        return (
          <button
            key={clave}
            type="button"
            aria-pressed={on}
            onClick={() => onCambiar(clave)}
            className={cn(
              "inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-4 py-1.5 text-[14px] font-medium transition-colors duration-rapido",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-1",
              on ? "bg-granate text-paper" : "text-inkSoft hover:bg-granate-50 hover:text-ink",
            )}
          >
            <Icono size={14} aria-hidden />
            {etiqueta}
          </button>
        );
      })}
    </div>
  );
}
