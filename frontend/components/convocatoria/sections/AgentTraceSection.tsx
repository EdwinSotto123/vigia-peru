"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentTraceEvent } from "../types";
import { AGENT_VISUAL } from "../constants";
import { TracePhaseGroup } from "./TracePhaseGroup";

export function AgentTraceSection({ trace }: { trace: AgentTraceEvent[] }) {
  const agentes = Array.from(new Set(trace.map((e) => e.agent).filter(Boolean))) as string[];
  // Agrupar eventos CONSECUTIVOS por agente activo → fases colapsables (159 filas → ~16 grupos)
  const groups: { agent: string; events: { ev: AgentTraceEvent; idx: number }[] }[] = [];
  trace.forEach((ev, idx) => {
    const ag = ev.agent || "?";
    const last = groups[groups.length - 1];
    if (last && last.agent === ag) last.events.push({ ev, idx });
    else groups.push({ agent: ag, events: [{ ev, idx }] });
  });
  const nTools = trace.filter((e) => e.kind === "tool_call").length;
  const nErr = trace.filter((e) => e.kind === "error").length;
  const [allOpen, setAllOpen] = useState(false);

  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-heroViolet">
              <Sparkles size={11} className="mr-1 inline" />
              Auditoría técnica · {trace.length} pasos · {nTools} tools
              {nErr > 0 && <span className="ml-1 text-rust">· {nErr} error{nErr > 1 ? "es" : ""}</span>}
            </div>
            <h2 className="mt-1 font-serif text-xl font-bold text-ink">Pasos del análisis</h2>
            <p className="mt-1 text-xs leading-relaxed text-mute">
              El pipeline corre una secuencia fija de agentes; cada sub-agente ejecuta su
              propio loop de tools (Gemini + grounding). Cada fase es desplegable.
            </p>
          </div>
          <button type="button" onClick={() => setAllOpen((o) => !o)}
            className="shrink-0 rounded-md border border-line bg-paper px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-mute hover:border-heroViolet/40 hover:text-heroViolet">
            {allOpen ? "Colapsar todo" : "Expandir todo"}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {agentes.map((a) => {
            const v = AGENT_VISUAL[a] || { color: "bg-mute text-paper", icon: null, label: a };
            return (
              <span key={a} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", v.color)}>
                {v.icon} {v.label}
              </span>
            );
          })}
        </div>
      </div>

      <div className="divide-y divide-line">
        {groups.map((g, gi) => <TracePhaseGroup key={`${gi}-${allOpen}`} group={g} forceOpen={allOpen} />)}
      </div>
    </section>
  );
}
