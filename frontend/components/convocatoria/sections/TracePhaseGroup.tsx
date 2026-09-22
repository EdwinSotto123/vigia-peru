"use client";

/**
 * Un tramo de la traza: todo lo que hizo un agente sin que otro lo interrumpiera.
 *
 * El color dejó de identificar al agente (venía de AGENT_VISUAL, que reusaba los tokens de
 * severidad) y quedó reservado a lo único que aquí es semántico: que el tramo haya fallado.
 */

import { useState } from "react";
import { AlertCircle, ChevronRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { nombreDeAgente } from "@/components/agentes/catalogo";
import type { AgentTraceEvent } from "../types";
import { AgentTraceRow } from "./AgentTraceRow";

export function TracePhaseGroup({
  group,
  forceOpen,
}: {
  group: { agent: string; events: { ev: AgentTraceEvent; idx: number }[] };
  forceOpen: boolean;
}) {
  const { agent, events } = group;
  const tools = events.filter((e) => e.ev.kind === "tool_call");
  const hasError = events.some((e) => e.ev.kind === "error");
  const hasThought = events.some((e) => e.ev.kind === "thought");
  const transferTo = events.find((e) => e.ev.kind === "transfer")?.ev.to;
  const [abierto, setAbierto] = useState(forceOpen || hasError);
  const pad = (n: number) => String(n).padStart(2, "0");
  const idxStart = events[0].idx;
  const idxEnd = events[events.length - 1].idx;
  const distintas = Array.from(new Set(tools.map((e) => e.ev.name).filter(Boolean))) as string[];
  const resumen =
    tools.length > 0
      ? `${tools.length} ${tools.length === 1 ? "llamada" : "llamadas"} · ${distintas.slice(0, 3).join(", ")}${distintas.length > 3 ? ` +${distintas.length - 3}` : ""}`
      : transferTo
        ? `delega en ${nombreDeAgente(transferTo)}`
        : hasThought
          ? "razonamiento del modelo"
          : `${events.length} ${events.length === 1 ? "paso" : "pasos"}`;

  return (
    <div className={cn(hasError && "bg-crimson-soft/40")}>
      <button
        type="button"
        onClick={() => setAbierto((o) => !o)}
        aria-expanded={abierto}
        className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heroViolet/50 sm:px-5"
      >
        <ChevronRight
          size={14}
          aria-hidden
          className={cn("shrink-0 text-mute transition-transform duration-rapido", abierto && "rotate-90")}
        />
        <span className="hidden shrink-0 font-mono text-[10px] tabular-nums text-mute sm:inline">
          {pad(idxStart)}–{pad(idxEnd)}
        </span>
        <span className="w-[6.5rem] shrink-0 truncate text-[12.5px] font-medium text-ink sm:w-40">
          {nombreDeAgente(agent)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-mute">{resumen}</span>
        {hasThought && !hasError && <Sparkles size={12} aria-hidden className="shrink-0 text-mute" />}
        {hasError && (
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-rust">
            <AlertCircle size={11} aria-hidden /> falló
          </span>
        )}
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-mute">{events.length}</span>
      </button>
      {abierto && (
        <ol className="divide-y divide-line/60 border-t border-line/60 bg-paperSoft/40">
          {events.map(({ ev, idx }) => (
            <AgentTraceRow key={idx} idx={idx} ev={ev} mostrarAgente={false} />
          ))}
        </ol>
      )}
    </div>
  );
}
