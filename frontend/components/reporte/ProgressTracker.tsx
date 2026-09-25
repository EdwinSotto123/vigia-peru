"use client";

// Barra de progreso del formulario ("Tu reporte: N de M" + hitos), compartida
// por FormObra y FormEntidad (extraído de FormObra.tsx) — antes solo FormObra
// daba esta señal de avance; FormEntidad no tenía ningún feedback de cuánto
// faltaba hasta apretar enviar.

import { Check, CheckCircle2, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { porcentaje } from "@/lib/formato";

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
            <CheckCircle2 size={14} className="text-mossTexto" aria-hidden />
          ) : (
            <Eye size={14} className="text-granate" aria-hidden />
          )}
          {ready
            ? "Denuncia completa: lista para enviar"
            : `Tu denuncia: ${doneCount} de ${milestones.length}`}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-mute">{porcentaje(pct)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-paperDeep" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Avance de la denuncia">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300 ease-out",
            ready ? "bg-moss" : "bg-granate",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={cn("mt-3 grid gap-1.5", milestones.length === 3 ? "grid-cols-3" : "grid-cols-4")}>
        {milestones.map((m) => (
          <div
            key={m.label}
            className={cn(
              "flex items-center justify-center gap-1 rounded-full px-1 py-1 text-[11px] font-medium transition-colors duration-rapido",
              m.done ? "bg-moss/10 text-mossTexto" : "bg-paperDeep text-inkSoft",
            )}
          >
            {m.done ? (
              <Check size={11} aria-hidden />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-mute/60" aria-hidden />
            )}
            {m.label}
          </div>
        ))}
      </div>
    </div>
  );
}
