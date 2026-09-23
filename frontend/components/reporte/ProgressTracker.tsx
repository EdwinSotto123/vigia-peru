"use client";

// Barra de progreso del formulario ("Tu reporte: N de M" + hitos), compartida
// por FormObra y FormEntidad (extraído de FormObra.tsx) — antes solo FormObra
// daba esta señal de avance; FormEntidad no tenía ningún feedback de cuánto
// faltaba hasta apretar enviar.

import { Check, Eye, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Milestone {
  label: string;
  done: boolean;
}

export function ProgressTracker({ milestones }: { milestones: Milestone[] }) {
  const doneCount = milestones.filter((m) => m.done).length;
  const ready = doneCount === milestones.length;
  const pct = (doneCount / milestones.length) * 100;
  return (
    <div className="rounded-2xl border border-line bg-paperSoft p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
          {ready ? (
            <Sparkles size={13} className="text-mossTexto" aria-hidden />
          ) : (
            <Eye size={13} className="text-heroViolet" aria-hidden />
          )}
          {ready
            ? "Denuncia completa: lista para enviar"
            : `Tu denuncia: ${doneCount} de ${milestones.length}`}
        </span>
        <span className="font-mono text-[11px] text-mute">{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-paperDeep">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            ready ? "bg-moss" : "bg-heroViolet",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={cn("mt-3 grid gap-1.5", milestones.length === 3 ? "grid-cols-3" : "grid-cols-4")}>
        {milestones.map((m) => (
          <div
            key={m.label}
            className={cn(
              "flex items-center justify-center gap-1 rounded-lg px-1 py-1 text-[10px] font-medium transition-colors",
              m.done ? "bg-moss/10 text-mossTexto" : "bg-paperDeep/60 text-mute",
            )}
          >
            {m.done ? (
              <Check size={11} />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-mute/40" />
            )}
            {m.label}
          </div>
        ))}
      </div>
    </div>
  );
}
