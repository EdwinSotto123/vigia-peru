"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Camera, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { FotoCaja } from "./FotoCaja";
import { FormMedicamento } from "./piezas";

type Modo = "texto" | "foto";

/**
 * La tarjeta de búsqueda de «Verifica un medicamento» (2026-11-22, la maqueta del usuario): dos pestañas, «Buscar por
 * texto» (el buscador y, debajo, escanear la caja) y «Buscar con una foto» (la zona grande para la foto). Pestañas de
 * verdad (role tablist, flechas del teclado); `?modo=foto` abre la de la foto.
 */
export function BuscadorMedicamento({ accion, modoInicial = "texto" }: { accion: string; modoInicial?: Modo }) {
  const [modo, setModo] = useState<Modo>(modoInicial);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const MODOS: { k: Modo; t: string; corto: string; Icono: typeof Search }[] = [
    { k: "texto", t: "Buscar por texto", corto: "Por texto", Icono: Search },
    { k: "foto", t: "Buscar con una foto", corto: "Con una foto", Icono: Camera },
  ];
  const teclas = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const j = (i + (e.key === "ArrowRight" ? 1 : MODOS.length - 1)) % MODOS.length;
    setModo(MODOS[j].k);
    tabs.current[j]?.focus();
  };
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-paper shadow-[0_8px_30px_-18px_rgb(0_0_0/0.25)]">
      <div role="tablist" aria-label="Cómo buscar" className="grid grid-cols-2 border-b border-line">
        {MODOS.map(({ k, t, corto, Icono }, i) => (
          <button
            key={k}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            id={`buscar-tab-${k}`}
            role="tab"
            type="button"
            aria-selected={modo === k}
            aria-controls={`buscar-panel-${k}`}
            tabIndex={modo === k ? 0 : -1}
            onClick={() => setModo(k)}
            onKeyDown={(e) => teclas(e, i)}
            className={cn(
              "relative inline-flex min-h-14 items-center justify-center gap-2 px-3 text-dato font-semibold transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate",
              modo === k ? "text-ink" : "bg-paperSoft/60 text-inkSoft hover:text-ink",
            )}
          >
            <Icono size={18} aria-hidden className={modo === k ? "text-granate" : "text-mute"} />
            <span className="sm:hidden">{corto}</span>
            <span className="hidden sm:inline">{t}</span>
            {modo === k && <span aria-hidden className="absolute inset-x-6 bottom-0 h-0.5 rounded-full bg-granate" />}
          </button>
        ))}
      </div>

      <div id="buscar-panel-texto" role="tabpanel" aria-labelledby="buscar-tab-texto" hidden={modo !== "texto"} className="px-4 py-5 sm:px-6">
        <FormMedicamento accion={accion} grande />
        <div aria-hidden className="my-4 flex items-center gap-3 text-meta text-mute">
          <span className="h-px flex-1 bg-line" />o<span className="h-px flex-1 bg-line" />
        </div>
        <FotoCaja accion={accion} variante="centrado" />
      </div>

      <div id="buscar-panel-foto" role="tabpanel" aria-labelledby="buscar-tab-foto" hidden={modo !== "foto"} className="px-4 py-5 sm:px-6">
        {modo === "foto" && <FotoCaja accion={accion} variante="zona" />}
      </div>
    </div>
  );
}
