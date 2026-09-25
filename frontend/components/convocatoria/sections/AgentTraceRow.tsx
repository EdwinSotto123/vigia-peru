"use client";

/**
 * Una línea de la traza técnica: una llamada a herramienta, su respuesta, una delegación, un
 * razonamiento o un error.
 *
 * Tres cosas cambiaron respecto de la versión anterior:
 *  · la fila expandible es un `<button>` de verdad (era un `div` con onClick: invisible para el
 *    teclado, que es justamente el usuario que audita este panel);
 *  · "▶ ver" / "▼ ocultar" / "ⓘ" eran caracteres haciendo de íconos — ahora son lucide;
 *  · la explicación de la herramienta vive en un <Popover> del top layer, así no la recorta el
 *    contenedor con scroll en el que este panel siempre está metido.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { Popover } from "@/components/ui/Flotante";
import { cn } from "@/lib/utils";
import type { AgentTraceEvent } from "../types";
import { TOOL_INFO } from "../constants";
import { nombreDeAgente } from "@/components/agentes/catalogo";

function linkify(text: string): React.ReactNode {
  const parts = String(text || "").split(/(https?:\/\/[^\s"'<>)\]]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a
        key={i}
        href={p}
        target="_blank"
        rel="noreferrer"
        className="break-all text-granate underline decoration-granate/40 hover:text-granate-deep"
        onClick={(e) => e.stopPropagation()}
      >
        {p}
      </a>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

const KIND_LABEL: Record<string, string> = {
  tool_call: "llama",
  tool_result: "responde",
  transfer: "delega",
  thought: "razona",
  error: "error",
};

export function AgentTraceRow({
  idx,
  ev,
  mostrarAgente = true,
}: {
  idx: number;
  ev: AgentTraceEvent;
  /** El panel en vivo muestra filas sueltas y necesita el nombre; dentro de un tramo sobra. */
  mostrarAgente?: boolean;
}) {
  const [expandido, setExpandido] = useState(false);

  let preview: React.ReactNode = null;
  let payload: string | null = null;
  let hayMas = false;

  const safeJson = (v: any) => {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  };

  if (ev.kind === "tool_call") {
    const argsStr = safeJson(ev.args || {});
    hayMas = argsStr.length > 100;
    payload = argsStr;
    preview = (
      <>
        <span className="font-mono text-[12.5px] font-semibold text-ink">{ev.name}</span>
        <span className="text-[11px] text-mute"> ( </span>
        {Object.entries(ev.args || {}).map(([k, v], i) => (
          <span key={k} className="text-[11px]">
            {i > 0 && <span className="text-mute">, </span>}
            <span className="text-mute">{k}=</span>
            <span className="font-mono text-inkSoft">
              {(() => {
                const s = JSON.stringify(v);
                return s && s.length > 140 ? s.slice(0, 140) + "…" : s;
              })()}
            </span>
          </span>
        ))}
        <span className="text-[11px] text-mute"> )</span>
      </>
    );
  } else if (ev.kind === "tool_result") {
    const result = ev.result_preview;
    const fullStr = safeJson(result);
    hayMas = fullStr.length > 100;
    payload = fullStr;
    const keys = result && typeof result === "object" ? Object.keys(result).slice(0, 5) : [];
    preview = (
      <>
        <span className="font-mono text-[12.5px] text-mute">{ev.name}</span>
        <span className="text-[11px] text-mute"> → </span>
        <span className="font-mono text-[11.5px] text-ink">
          {keys.length > 0 ? `{ ${keys.join(", ")} }` : String(JSON.stringify(result) ?? "").slice(0, 100)}
        </span>
      </>
    );
  } else if (ev.kind === "transfer") {
    preview = <span className="text-[12.5px] text-ink">{nombreDeAgente(ev.to)}</span>;
  } else if (ev.kind === "thought") {
    const t = ev.text || "";
    hayMas = t.length > 200;
    payload = t;
    preview = (
      <span className="text-[12px] italic text-inkSoft">
        &quot;{t.slice(0, 200)}
        {hayMas ? "…" : ""}&quot;
      </span>
    );
  } else if (ev.kind === "error") {
    payload = ev.detail || "";
    hayMas = (ev.detail || "").length > 200;
    preview = (
      <span className="text-[12px] text-crimsonTexto">
        {(ev.detail || "").slice(0, 200)}
        {hayMas ? "…" : ""}
      </span>
    );
  }

  const puedeExpandir = hayMas && !!payload;
  const infoKey = ev.kind === "tool_call" || ev.kind === "tool_result" ? ev.name : ev.kind === "transfer" ? ev.to : undefined;
  const info = infoKey ? TOOL_INFO[infoKey] || "Paso del pipeline de análisis." : null;

  const fila = (
    <>
      <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-[11px] tabular-nums text-mute">
        {String(idx).padStart(2, "0")}
      </span>
      {mostrarAgente && (
        <span className="mt-0.5 hidden w-28 shrink-0 truncate text-[11px] text-mute sm:inline-block">
          {nombreDeAgente(ev.agent)}
        </span>
      )}
      <span
        className={cn(
          "mt-0.5 w-14 shrink-0 font-mono text-[11px] uppercase tracking-wide",
          ev.kind === "error" ? "font-semibold text-crimsonTexto" : "text-mute",
        )}
      >
        {KIND_LABEL[ev.kind ?? ""] ?? ev.kind}
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-1">{preview}</span>
    </>
  );

  return (
    <li className={cn("px-3 py-2 sm:px-5", ev.kind === "error" && "bg-crimson-soft/40")}>
      <div className="flex items-start gap-2">
        {puedeExpandir ? (
          <button
            type="button"
            onClick={() => setExpandido((v) => !v)}
            aria-expanded={expandido}
            className="flex min-w-0 flex-1 items-start gap-2 rounded-lg text-left transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate/50"
          >
            {fila}
            {expandido ? (
              <ChevronDown size={13} aria-hidden className="mt-0.5 shrink-0 text-granate" />
            ) : (
              <ChevronRight size={13} aria-hidden className="mt-0.5 shrink-0 text-granate" />
            )}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-start gap-2">{fila}</div>
        )}
        {info && (
          <Popover
            titulo={infoKey ?? "Herramienta"}
            anchoClase="w-72"
            className="mt-0.5 shrink-0 rounded-full p-0.5 text-mute transition-colors duration-rapido hover:text-granate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate/50"
            trigger={<Info size={13} aria-hidden />}
          >
            {info}
          </Popover>
        )}
      </div>
      {expandido && payload && (
        <div className="ml-8 mt-2 rounded-xl border border-line bg-paperSoft p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-mute">
              {ev.kind === "tool_call"
                ? "Lo que se le pidió"
                : ev.kind === "tool_result"
                  ? "Lo que devolvió"
                  : ev.kind === "thought"
                    ? "Razonamiento"
                    : ev.kind === "error"
                      ? "Error completo"
                      : "Contenido"}
            </span>
            <button
              type="button"
              className="rounded text-[11px] font-medium text-granate transition-colors duration-rapido hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate/50"
              onClick={() => navigator.clipboard?.writeText(payload || "")}
            >
              copiar
            </button>
          </div>
          <pre className="scrollbar-warm max-h-[400px] overflow-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-ink">
            {linkify(payload)}
          </pre>
        </div>
      )}
    </li>
  );
}
