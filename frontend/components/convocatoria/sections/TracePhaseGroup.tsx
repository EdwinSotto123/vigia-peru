"use client";

import { useState } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentTraceEvent } from "../types";
import { AGENT_VISUAL } from "../constants";
import { AgentTraceRow } from "./AgentTraceRow";

export function TracePhaseGroup({ group, forceOpen }: { group: { agent: string; events: { ev: AgentTraceEvent; idx: number }[] }; forceOpen: boolean }) {
  const { agent, events } = group;
  const visual = AGENT_VISUAL[agent] || { color: "bg-mute text-paper", icon: null, label: agent };
  const tools = events.filter((e) => e.ev.kind === "tool_call");
  const hasError = events.some((e) => e.ev.kind === "error");
  const hasThought = events.some((e) => e.ev.kind === "thought");
  const transferTo = events.find((e) => e.ev.kind === "transfer")?.ev.to;
  const [open, setOpen] = useState(forceOpen || hasError);
  const pad = (n: number) => String(n).padStart(2, "0");
  const idxStart = events[0].idx;
  const idxEnd = events[events.length - 1].idx;
  const toolNames = Array.from(new Set(tools.map((e) => e.ev.name))).slice(0, 4);
  const resumen = tools.length > 0
    ? `${tools.length} tool${tools.length > 1 ? "s" : ""} · ${toolNames.join(", ")}${Array.from(new Set(tools.map((e) => e.ev.name))).length > 4 ? "…" : ""}`
    : transferTo ? `delega → ${transferTo}` : hasThought ? "razonamiento del modelo" : "—";

  return (
    <div className={cn(hasError && "bg-rust/[0.04]")}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-paperSoft">
        <ChevronRight size={14} className={cn("shrink-0 text-mute transition-transform", open && "rotate-90")} />
        <span className="hidden shrink-0 font-mono text-[10px] text-mute sm:inline">{pad(idxStart)}–{pad(idxEnd)}</span>
        <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", visual.color)}>
          {visual.icon} {visual.label}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-mute">{resumen}</span>
        {hasThought && !hasError && <Sparkles size={12} className="shrink-0 text-clay" />}
        {hasError && <span className="shrink-0 rounded bg-rust px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-paper">⚠ error</span>}
        <span className="shrink-0 rounded-full bg-paperDeep px-1.5 py-0.5 font-mono text-[9px] text-mute">{events.length}</span>
      </button>
      {open && (
        <ol className="divide-y divide-line/60 border-t border-line/60 bg-paperSoft/30">
          {events.map(({ ev, idx }) => <AgentTraceRow key={idx} idx={idx} ev={ev} />)}
        </ol>
      )}
    </div>
  );
}
