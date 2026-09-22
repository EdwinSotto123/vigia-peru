"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Brain, CheckCircle2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

function ExpandableThought({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const truncated = text.length > 180;
  return (
    <div
      className={cn(
        "italic text-mute cursor-pointer transition-colors hover:text-ink",
        !open && truncated && "line-clamp-2",
      )}
      onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
      title={open ? "Click para colapsar" : "Click para ver el razonamiento completo"}
    >
      {text}
      {truncated && (
        <span className="ml-1 not-italic font-semibold text-heroViolet">
          {open ? " · cerrar" : ""}
        </span>
      )}
    </div>
  );
}

export function LiveEventsPanel({ events }: { events: any[] }) {
  const last = events.slice(-30);
  const tail = useRef<HTMLDivElement | null>(null);
  // Auto-scroll SOLO si el usuario ya está cerca del fondo: si subió a leer un nodo,
  // NO lo arrastramos hacia abajo cuando avanza un paso (era molesto). getBoundingClientRect
  // es relativo al viewport → funciona con el scroll de la página.
  useEffect(() => {
    const el = tail.current;
    if (el && el.getBoundingClientRect().top <= window.innerHeight + 300)
      el.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length]);

  // Conteos para mini-stats
  const byKind: Record<string, number> = {};
  for (const e of events) byKind[e.kind || "?"] = (byKind[e.kind || "?"] || 0) + 1;

  const kindIcon = (k: string) => {
    if (k === "tool_call")    return <Sparkles size={11} className="text-heroViolet" />;
    if (k === "tool_result")  return <CheckCircle2 size={11} className="text-moss" />;
    if (k === "transfer")     return <ArrowRight size={11} className="text-amberTexto" />;
    if (k === "thought")      return <Brain size={11} className="text-mute" />;
    if (k === "phase")        return <Sparkles size={11} className="text-rust" />;
    if (k === "session")      return <Sparkles size={11} className="text-ink" />;
    if (k === "error")        return <AlertTriangle size={11} className="text-rust" />;
    return <span className="inline-block h-2 w-2 rounded-full bg-mute" />;
  };

  const fmtAgent = (a: string) => (a || "").replace(/_agent$/, "");

  const totalEvents = events.length;
  return (
    <div className="surface overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paperDeep px-5 py-3">
        <div className="flex items-baseline gap-2">
          <h3 className="font-serif text-sm font-bold text-ink">Actividad del análisis</h3>
          <span className="font-mono text-[10px] text-mute">{totalEvents} eventos</span>
        </div>
      </div>
      <div className="max-h-[280px] overflow-y-auto bg-paper px-3 py-2 font-mono text-[11px]">
        {last.map((ev, i) => (
          <div key={i} className="flex items-start gap-2 border-b border-line/40 py-1.5 last:border-0">
            <span className="mt-0.5 shrink-0">{kindIcon(ev.kind)}</span>
            {ev.agent && (
              <span className="shrink-0 rounded bg-paperDeep px-1 py-0 text-[9px] font-bold text-heroViolet">
                {fmtAgent(ev.agent)}
              </span>
            )}
            <div className="min-w-0 flex-1">
              {ev.kind === "tool_call" && (
                <div className="truncate">
                  <span className="font-bold text-ink">{ev.name}</span>
                  <span className="text-mute">(</span>
                  <span className="text-mute">{Object.keys(ev.args || {}).slice(0, 2).join(", ")}</span>
                  <span className="text-mute">)</span>
                </div>
              )}
              {ev.kind === "tool_result" && (
                <div className="truncate">
                  <span className="font-semibold text-moss">↳ {ev.name}</span>
                  <span className="ml-2 text-mute">
                    {Object.keys(ev.result_preview || {}).slice(0, 3).join(" · ") || "ok"}
                  </span>
                </div>
              )}
              {ev.kind === "transfer" && (
                <div className="truncate">
                  <span className="font-bold text-amberTexto">transfer →</span>
                  <span className="ml-1 text-ink">{fmtAgent(ev.to)}</span>
                </div>
              )}
              {ev.kind === "thought" && (
                <ExpandableThought text={ev.text || ""} />
              )}
              {ev.kind === "phase" && (
                <div className="truncate">
                  <span className="font-bold uppercase tracking-wider text-rust">[{ev.name}]</span>
                  <span className="ml-1 text-ink">{ev.msg}</span>
                </div>
              )}
              {ev.kind === "session" && (
                <div className="truncate text-mute">iniciando análisis…</div>
              )}
              {ev.kind === "error" && (
                <div className="line-clamp-2 text-rust">{ev.detail}</div>
              )}
            </div>
          </div>
        ))}
        <div ref={tail} />
      </div>
      {events.length > 30 && (
        <div className="border-t border-line bg-paperSoft px-5 py-1 text-center text-[10px] text-mute">
          mostrando últimos 30 de {events.length} eventos
        </div>
      )}
    </div>
  );
}
