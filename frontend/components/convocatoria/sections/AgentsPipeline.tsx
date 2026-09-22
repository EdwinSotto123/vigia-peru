"use client";

/**
 * Qué agentes van a leer el contrato, antes de pedir el análisis.
 *
 * Acá vivía una lista `AGENTS` escrita a mano con siete agentes y "~60–180 s", mientras otras
 * páginas del mismo producto decían 11 agentes, 10 fases, 13 nodos y 12 claves. Ahora el
 * conjunto, el orden y los recuentos salen del catálogo (`components/agentes/catalogo`), que a
 * su vez sale de `CARRILES` + `FASES` de lib/auditoria — o sea, del DAG real de deterministic.py.
 * Si el backend agrega o quita un agente, esta pantalla cambia sola.
 *
 * La duración que se promete es la real medida en producción (~10 min, PRODUCT.md), no la que
 * quedaba mejor.
 */

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { CarrilesAgentes } from "@/components/agentes/CarrilesAgentes";
import { TOTAL_AGENTES, TOTAL_CARRILES, TOTAL_PASOS } from "@/components/agentes/catalogo";
import { cn } from "@/lib/utils";

export function AgentsPipeline() {
  const [abierto, setAbierto] = useState(false);
  return (
    <details
      className="overflow-hidden rounded-2xl border border-line bg-paper"
      onToggle={(e) => setAbierto((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors duration-rapido hover:bg-paperSoft [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink">
            {TOTAL_AGENTES} agentes de IA leen el contrato, en {TOTAL_CARRILES} carriles paralelos
          </div>
          <div className="mt-0.5 text-[12px] leading-snug text-mute">
            {abierto
              ? `Cada uno mira una cosa distinta y deja su rastro: ${TOTAL_PASOS} pasos en total, contando los dos que no son agentes.`
              : "Expediente ∥ proveedor ∥ síntesis · tarda unos 10 minutos y la traza queda pública."}
          </div>
        </div>
        <ChevronRight
          size={16}
          aria-hidden
          className={cn("shrink-0 text-mute transition-transform duration-rapido", abierto && "rotate-90")}
        />
      </summary>
      <div className="border-t border-line bg-paperSoft px-4 py-3">
        <CarrilesAgentes />
        <p className="mt-3 border-t border-line pt-2 text-[11px] leading-snug text-mute">
          El análisis completo tarda unos 10 minutos: los tres carriles avanzan a la vez, pero la
          síntesis espera a que terminen todos. Cuando acaba, cada señal queda con el agente que la
          encontró, su norma y su fuente oficial.
        </p>
      </div>
    </details>
  );
}
