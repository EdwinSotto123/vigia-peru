"use client";

/**
 * Los últimos pasos del análisis mientras corre (stream NDJSON del orquestador).
 *
 * Todo lo que pinta pasa por la redacción de `traza/redaccion`. Las personas privadas se juntan
 * de TODOS los eventos que llegaron hasta ahora, no sólo de los 24 visibles: en vivo la traza está
 * a medias (una búsqueda puede nombrar a alguien antes de que llegue el registro que lo nombra),
 * así que se tapa de más antes que de menos. Se recalcula con cada evento nuevo.
 */

import { useEffect, useMemo, useRef } from "react";
import { AgentTraceRow } from "./AgentTraceRow";
import { ProveedorSensibles, sensiblesDeTraza } from "../traza/redaccion";

const KINDS = ["tool_call", "tool_result", "transfer", "thought", "error"];

export function LiveTracePanel({ events }: { events: any[] }) {
  const steps = events.filter((e) => e && KINDS.includes(e.kind));
  const last = steps.slice(-24);
  const tail = useRef<HTMLLIElement | null>(null);
  const sensibles = useMemo(() => sensiblesDeTraza(events), [events]);
  // Auto-scroll SOLO si el usuario ya está cerca del fondo (no lo arrastramos si subió a leer).
  useEffect(() => {
    const el = tail.current;
    if (el && el.getBoundingClientRect().top <= window.innerHeight + 300)
      el.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [steps.length]);
  let nTools = 0, nRes = 0;
  for (const e of events) { if (e.kind === "tool_call") nTools++; else if (e.kind === "tool_result") nRes++; }
  return (
    <ProveedorSensibles valor={sensibles}>
      <section className="rounded-2xl border border-line bg-paperSoft overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paperDeep px-5 py-3">
          <div className="flex items-baseline gap-2">
            <span className="h-1.5 w-1.5 animate-pulse self-center rounded-full bg-moss" />
            <h3 className="font-display text-sm font-bold text-ink">Seguimiento del análisis en vivo</h3>
            <span className="font-mono text-[11px] text-mute">{steps.length} pasos</span>
          </div>
          <div className="flex gap-1.5 font-mono text-[11px]">
            {nTools > 0 && <span className="rounded bg-amber-soft px-1.5 py-0.5 font-bold text-amberTexto">{nTools} consultas</span>}
            {nRes > 0 && <span className="rounded bg-moss/10 px-1.5 py-0.5 font-bold text-mossTexto">{nRes} resultados</span>}
          </div>
        </div>
        <ol className="max-h-[440px] divide-y divide-line overflow-y-auto">
          {last.map((e, i) => <AgentTraceRow key={steps.length - last.length + i} idx={steps.length - last.length + i} ev={e} />)}
          <li ref={tail} aria-hidden className="h-0 border-0 p-0" />
        </ol>
        {steps.length > 24 && (
          <div className="border-t border-line bg-paperSoft px-5 py-1 text-center text-[11px] text-mute">
            mostrando últimos 24 de {steps.length} pasos
          </div>
        )}
      </section>
    </ProveedorSensibles>
  );
}
