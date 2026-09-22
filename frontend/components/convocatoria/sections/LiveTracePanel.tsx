"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { AgentTraceRow } from "./AgentTraceRow";

export function LiveTracePanel({ events }: { events: any[] }) {
  const KINDS = ["tool_call", "tool_result", "transfer", "thought", "error"];
  const steps = events.filter((e) => e && KINDS.includes(e.kind));
  const last = steps.slice(-24);
  const tail = useRef<HTMLDivElement | null>(null);
  // Auto-scroll SOLO si el usuario ya está cerca del fondo (no lo arrastramos si subió a leer).
  useEffect(() => {
    const el = tail.current;
    if (el && el.getBoundingClientRect().top <= window.innerHeight + 300)
      el.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [steps.length]);
  let nTools = 0, nRes = 0;
  for (const e of events) { if (e.kind === "tool_call") nTools++; else if (e.kind === "tool_result") nRes++; }
  return (
    <section className="surface overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paperDeep px-5 py-3">
        <div className="flex items-baseline gap-2">
          <span className="h-1.5 w-1.5 animate-pulse self-center rounded-full bg-moss" />
          <h3 className="font-serif text-sm font-bold text-ink">Tracking del análisis · en vivo</h3>
          <span className="font-mono text-[10px] text-mute">{steps.length} pasos</span>
        </div>
        <div className="flex gap-1.5 font-mono text-[9px]">
          {nTools > 0 && <span className="rounded bg-amber-soft px-1.5 py-0.5 font-bold text-amberTexto">{nTools} tool calls</span>}
          {nRes > 0 && <span className="rounded bg-moss/10 px-1.5 py-0.5 font-bold text-moss">{nRes} resultados</span>}
        </div>
      </div>
      <ol className="max-h-[440px] divide-y divide-line overflow-y-auto">
        {last.map((e, i) => <AgentTraceRow key={i} idx={steps.length - last.length + i} ev={e} />)}
        <div ref={tail} />
      </ol>
      {steps.length > 24 && (
        <div className="border-t border-line bg-paperSoft px-5 py-1 text-center text-[10px] text-mute">
          mostrando últimos 24 de {steps.length} pasos
        </div>
      )}
    </section>
  );
}
