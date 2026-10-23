"use client";

// Avance del formulario en UNA fila ("Tu denuncia: N de M", barra y un hito por paso). Lo usan FormObra y
// FormEntidad encima de las tres columnas: es lo que dice cuánto falta y se conecta con el candado de cada
// columna (el hito se marca cuando el dato mínimo de ese paso está listo).

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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-line bg-paperSoft px-4 py-3">
      <span className="inline-flex shrink-0 items-center gap-1.5 text-meta font-semibold text-ink">
        {ready ? <CheckCircle2 size={15} className="text-mossTexto" aria-hidden /> : <Eye size={15} className="text-granate" aria-hidden />}
        {ready ? "Denuncia completa: lista para enviar" : `Tu denuncia: ${doneCount} de ${milestones.length}`}
      </span>
      <div
        className="order-last h-1.5 min-w-[8rem] flex-1 basis-full overflow-hidden rounded-full bg-paperDeep sm:order-none sm:basis-0"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Avance de la denuncia"
      >
        <div className={cn("h-full rounded-full transition-[width] duration-300 ease-out", ready ? "bg-moss" : "bg-granate")} style={{ width: `${pct}%` }} />
      </div>
      <ul className="flex shrink-0 items-center gap-1.5" aria-label="Pasos">
        {milestones.map((m) => (
          <li
            key={m.label}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-micro font-medium transition-colors duration-rapido",
              m.done ? "bg-moss/10 text-mossTexto" : "bg-paperDeep text-inkSoft",
            )}
          >
            {m.done ? <Check size={11} aria-hidden /> : <span className="h-1.5 w-1.5 rounded-full bg-mute/60" aria-hidden />}
            {m.label}
          </li>
        ))}
      </ul>
      <span className="font-mono text-micro tabular-nums text-mute">{porcentaje(pct)}</span>
    </div>
  );
}
