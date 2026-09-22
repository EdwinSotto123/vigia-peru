"use client";

/**
 * Bitácora en vivo: los últimos `max` eventos del pipeline en lenguaje humano, con la
 * hora relativa. `warn` en ámbar, `error` en óxido, `final` en musgo. El más reciente arriba.
 */

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { haceCuanto, humanizar, type EventoFase } from "@/lib/auditoria";

interface Props {
  eventos: EventoFase[];
  ahora: number;
  max?: number;
  activo?: boolean;
  compacto?: boolean;
}

function hora(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function Bitacora({ eventos, ahora, max = 12, activo = false, compacto = false }: Props) {
  const ultimos = eventos.slice(-max).reverse();
  if (!ultimos.length) {
    return (
      <p className={`text-mute ${compacto ? "text-[11px]" : "text-[12px]"}`} aria-live="polite">
        {activo ? "Esperando el primer evento de los agentes…" : "Sin eventos registrados."}
      </p>
    );
  }
  return (
    <ol className={compacto ? "space-y-1" : "space-y-1.5"} aria-live="polite" aria-relevant="additions" aria-label="Bitácora del análisis">
      {ultimos.map((ev, i) => {
        const tono = ev.kind === "error" ? "text-rust" : ev.kind === "warn" ? "text-amberTexto" : ev.kind === "final" ? "text-moss" : "text-inkSoft";
        const ms = ahora - new Date(ev.ts).getTime();
        return (
          <li key={`${ev.ts}-${ev.name}-${i}`} className={`flex items-start gap-2 ${compacto ? "text-[11px]" : "text-[12.5px]"} ${i === 0 && activo ? "animate-slideUp" : ""}`}>
            <span className={`mt-[3px] shrink-0 ${tono}`} aria-hidden>
              {ev.kind === "error" ? <XCircle size={12} /> : ev.kind === "warn" ? <AlertTriangle size={12} /> : ev.kind === "final" ? <CheckCircle2 size={12} /> : <span className={`block h-1.5 w-1.5 translate-y-[3px] rounded-full ${i === 0 && activo ? "bg-amber" : "bg-line"}`} />}
            </span>
            <span className={`min-w-0 flex-1 leading-snug ${tono}`}>
              {humanizar(ev)}
              <span className="sr-only">{ev.kind === "error" ? " (error)" : ev.kind === "warn" ? " (advertencia)" : ""}</span>
            </span>
            <time dateTime={ev.ts} title={hora(ev.ts)} className="shrink-0 font-mono text-[10px] tabular-nums text-mute" suppressHydrationWarning>
              {ahora > 0 && Number.isFinite(ms) ? haceCuanto(ms) : ""}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
