"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { AgentTraceEvent } from "../types";
import { AGENT_VISUAL, TOOL_INFO } from "../constants";

function linkify(text: string): React.ReactNode {
  const parts = String(text || "").split(/(https?:\/\/[^\s"'<>)\]]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noreferrer"
        className="text-clay underline decoration-clay/40 hover:text-rust break-all"
        onClick={(e) => e.stopPropagation()}>{p}</a>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export function AgentTraceRow({ idx, ev }: { idx: number; ev: AgentTraceEvent }) {
  const [expanded, setExpanded] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const agent = ev.agent || "?";
  const visual = AGENT_VISUAL[agent] || { color: "bg-mute text-paper", icon: null, label: agent };

  let kindLabel: string = ev.kind || "?";
  let preview: React.ReactNode = null;
  let fullPayload: string | null = null;
  let hasMore = false;

  const safeJson = (v: any) => {
    try { return JSON.stringify(v, null, 2); }
    catch { return String(v); }
  };

  if (ev.kind === "tool_call") {
    kindLabel = "TOOL_CALL";
    const argsStr = safeJson(ev.args || {});
    hasMore = argsStr.length > 100;
    fullPayload = argsStr;
    preview = (
      <>
        <span className="font-mono text-sm font-bold text-ink">{ev.name}</span>
        <span className="text-[10px] text-mute"> ( </span>
        {Object.entries(ev.args || {}).map(([k, v], i) => (
          <span key={k} className="text-[10px]">
            {i > 0 && <span className="text-mute">, </span>}
            <span className="text-mute">{k}=</span>
            <span className="font-mono text-clay">{(() => { const s = JSON.stringify(v); return s.length > 140 ? s.slice(0, 140) + "…" : s; })()}</span>
          </span>
        ))}
        <span className="text-[10px] text-mute"> )</span>
      </>
    );
  } else if (ev.kind === "tool_result") {
    kindLabel = "TOOL_RESULT";
    const result = ev.result_preview;
    const fullStr = safeJson(result);
    hasMore = fullStr.length > 100;
    fullPayload = fullStr;
    const keys = result && typeof result === "object" ? Object.keys(result).slice(0, 5) : [];
    preview = (
      <>
        <span className="font-mono text-sm text-mute">{ev.name}</span>
        <span className="text-[10px] text-mute"> → </span>
        <span className="font-mono text-[11px] text-ink">
          {keys.length > 0 ? `{ ${keys.join(", ")} }` : JSON.stringify(result).slice(0, 100)}
        </span>
      </>
    );
  } else if (ev.kind === "transfer") {
    kindLabel = "TRANSFER";
    preview = (
      <>
        <span className="text-[11px] text-mute">→</span>
        <span className="font-mono text-sm font-bold text-clay">{ev.to}</span>
      </>
    );
  } else if (ev.kind === "thought") {
    kindLabel = "THOUGHT";
    const t = ev.text || "";
    hasMore = t.length > 200;
    fullPayload = t;
    preview = <span className="text-xs italic text-inkSoft">&quot;{t.slice(0, 200)}{hasMore ? "…" : ""}&quot;</span>;
  } else if (ev.kind === "error") {
    kindLabel = "ERROR";
    fullPayload = ev.detail || "";
    hasMore = (ev.detail || "").length > 200;
    preview = <span className="text-xs text-rust">{(ev.detail || "").slice(0, 200)}{hasMore ? "…" : ""}</span>;
  }

  const canExpand = hasMore && !!fullPayload;
  // Clave de info: tool_call/tool_result → nombre de la tool; transfer → agente destino.
  const infoKey = (ev.kind === "tool_call" || ev.kind === "tool_result") ? ev.name
                : ev.kind === "transfer" ? (ev as any).to : undefined;
  const info = infoKey ? (TOOL_INFO[infoKey as string] || "Paso del pipeline de análisis.") : null;
  return (
    <li className={cn("px-5 py-2.5 transition-colors", canExpand ? "cursor-pointer hover:bg-paperSoft" : "hover:bg-paperSoft/40")}>
      <div className="flex items-start gap-3" onClick={() => canExpand && setExpanded(v => !v)}>
        <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-[10px] text-mute">{String(idx).padStart(2, "0")}</span>
        <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider", visual.color)}>
          {visual.icon}{visual.label}
        </span>
        <span className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider",
          ev.kind === "tool_call"   && "bg-amber-soft text-amber",
          ev.kind === "tool_result" && "bg-moss/10 text-moss",
          ev.kind === "transfer"    && "bg-crimson-soft text-rust",
          ev.kind === "thought"     && "bg-paperDeep text-mute",
          ev.kind === "error"       && "bg-rust text-paper",
        )}>{kindLabel}</span>
        <div className="flex flex-wrap items-baseline gap-1 min-w-0 flex-1">{preview}</div>
        {info && (
          <button
            type="button"
            title={info}
            aria-label="Qué hace esta herramienta"
            className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line font-mono text-[9px] font-bold text-mute hover:border-clay hover:text-clay"
            onClick={(e) => { e.stopPropagation(); setInfoOpen(v => !v); }}
          >
            i
          </button>
        )}
        {canExpand && (
          <span className="mt-0.5 shrink-0 text-[10px] font-mono text-clay">
            {expanded ? "▼ ocultar" : "▶ ver"}
          </span>
        )}
      </div>
      {infoOpen && info && (
        <div className="mt-1.5 ml-9 rounded-md border border-clay/30 bg-clay/5 px-3 py-2 text-[11px] leading-relaxed text-ink">
          <span className="font-mono font-bold text-clay">ⓘ {ev.name}</span> — {info}
        </div>
      )}
      {expanded && fullPayload && (
        <div className="mt-2 ml-9 rounded-md border border-line bg-paperSoft p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-widest text-mute">
              {ev.kind === "tool_call" ? "Entrada" :
               ev.kind === "tool_result" ? "Salida" :
               ev.kind === "thought" ? "Razonamiento" :
               ev.kind === "error" ? "ERROR COMPLETO" : "PAYLOAD"}
            </span>
            <button
              type="button"
              className="text-[9px] font-mono text-clay hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard?.writeText(fullPayload || "");
              }}
            >
              copiar
            </button>
          </div>
          <pre className="max-h-[400px] overflow-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-ink">
            {linkify(fullPayload)}
          </pre>
        </div>
      )}
    </li>
  );
}
