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
 * La duración ya no se escribe a mano ("unos 10 minutos" quedó viejo cuando los carriles
 * pasaron a correr en paralelo): es la mediana medida en producción que publica el API
 * (/financiamiento/procesamientos/resumen → estimado.medianaSeg). Sin ese dato, no se promete
 * ninguna duración.
 */

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { CarrilesAgentes } from "@/components/agentes/CarrilesAgentes";
import { TOTAL_AGENTES, TOTAL_CARRILES, TOTAL_PASOS } from "@/components/agentes/catalogo";
import { cn } from "@/lib/utils";
import { duracionEnPalabras } from "./conteoRiesgo";

export function AgentsPipeline({
  medianaSeg = null,
  nLecturas = null,
}: {
  /** Mediana real de duración de una lectura, en segundos. */
  medianaSeg?: number | null;
  /** Sobre cuántas lecturas se calculó la mediana. */
  nLecturas?: number | null;
}) {
  const [abierto, setAbierto] = useState(false);
  const duracion = duracionEnPalabras(medianaSeg);
  const nPasosExtra = TOTAL_PASOS - TOTAL_AGENTES; // pasos del DAG que no son uno de los agentes
  return (
    <details
      className="overflow-hidden rounded-2xl border border-line bg-paper"
      onToggle={(e) => setAbierto((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors duration-rapido hover:bg-paperSoft [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink">
            {TOTAL_AGENTES} agentes de IA leen el contrato: {TOTAL_CARRILES > 2 ? "dos ramas en paralelo y una síntesis al final" : `${TOTAL_CARRILES} carriles`}
          </div>
          <div className="mt-0.5 text-[12px] leading-snug text-mute">
            {abierto
              ? `Cada uno mira una cosa distinta y deja su rastro. Son ${TOTAL_PASOS} pasos en total${
                  nPasosExtra > 0 ? `, ${TOTAL_AGENTES} agentes y ${nPasosExtra} de consulta o verificación` : ""
                }.`
              : duracion
                ? `Una lectura completa tarda ${duracion}, y la traza queda pública.`
                : "Cada señal queda con su traza pública."}
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
          Los carriles avanzan a la vez, pero la síntesis espera a que terminen todos
          {duracion ? (
            <>
              ; la lectura completa tarda {duracion}
              {nLecturas ? ` (mediana de ${nLecturas} lecturas recientes)` : ""}
            </>
          ) : null}
          . Cuando acaba, cada señal queda con el agente que la encontró, su norma y su fuente oficial.
        </p>
      </div>
    </details>
  );
}
