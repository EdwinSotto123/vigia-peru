"use client";

import { cn } from "@/lib/utils";
import { STEPS } from "../constants";
import { countFindings, inferStepFromEvents } from "../utils";
import { FlowGraph } from "./FlowGraph";
import { LiveTracePanel } from "./LiveTracePanel";
import { ObservabilidadPanel } from "./ObservabilidadPanel";

export function LoadingView({ stepIdx, elapsed, codigo, liveEvents = [] }: { stepIdx: number; elapsed: number; codigo: string; liveEvents?: any[] }) {
  // Progreso global basado en elapsed vs total estimado
  const totalEta = STEPS.reduce((s, x) => s + x.eta_s, 0);
  // Inferir step real desde el stream; si no hay eventos, usar el del ETA.
  const inferredIdx = inferStepFromEvents(liveEvents);
  const effectiveStep = inferredIdx >= 0 ? Math.max(inferredIdx, stepIdx) : stepIdx;
  // Progreso: si hay eventos, usar el step real; sino mezclar con elapsed.
  const stepProgressPct = effectiveStep >= 0 ? Math.round(((effectiveStep + 1) / STEPS.length) * 100) : 0;
  const elapsedProgressPct = Math.round((elapsed / totalEta) * 100);
  const progressPct = Math.min(99, Math.max(stepProgressPct, elapsedProgressPct));
  // Agrupar pasos por "lane" (swimlane del BPMN)
  const lanes = Array.from(new Set(STEPS.map(s => s.lane))) as string[];
  const stepsByLane: Record<string, Array<{ step: typeof STEPS[number]; globalIdx: number }>> = {};
  for (const lane of lanes) stepsByLane[lane] = [];
  STEPS.forEach((s, i) => stepsByLane[s.lane].push({ step: s, globalIdx: i }));

  const LANE_VISUAL: Record<string, { color: string; label: string; bar: string }> = {
    ingesta:        { color: "text-amberTexto",  label: "Ingesta",        bar: "bg-amber/30" },
    auditoría:      { color: "text-rust",   label: "Auditoría",      bar: "bg-rust/30" },
    investigación: { color: "text-clayTexto",   label: "Investigación",  bar: "bg-clay/30" },
    dictamen:       { color: "text-moss",   label: "Dictamen",       bar: "bg-moss/30" },
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="surface relative isolate overflow-hidden p-6 sm:p-8">
        <div aria-hidden className="absolute -right-20 -top-20 -z-10 h-60 w-60 rounded-full bg-amber/15 blur-3xl" />
        <div aria-hidden className="absolute -left-32 -bottom-32 -z-10 h-80 w-80 rounded-full bg-heroViolet/10 blur-3xl" />

        {/* HEADER */}
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-soft px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amberTexto">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />
              {/* Solo el tiempo transcurrido, que es un dato. El "≈11 min" salía de sumar
                  estimaciones a mano y contradecía la mediana real de producción. */}
              procesando, {elapsed} s
            </div>
            <h2 className="mt-2 font-serif text-2xl font-bold leading-tight text-ink sm:text-3xl">
              Los agentes están leyendo el contrato
            </h2>
            <p className="mt-0.5 text-xs text-mute">
              Convocatoria <span className="font-mono">{codigo}</span>
            </p>
          </div>
          <div className="text-right">
            <div className="font-mono text-3xl font-bold tabular-nums text-heroViolet">{progressPct}%</div>
            <div className="text-[10px] uppercase tracking-widest text-mute">progreso estimado</div>
          </div>
        </div>

        {/* PROGRESS BAR GLOBAL */}
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-paperDeep">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber via-heroViolet to-moss transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>


        {/* CONTADOR DE HALLAZGOS EN VIVO */}
        {(() => {
          const findings = countFindings(liveEvents);
          if (findings <= 0) return null;
          return (
            <div className="mt-3 flex justify-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-rust/30 bg-crimson-soft/50 px-4 py-1.5 text-[12px] font-bold text-rust">
                <span className="h-2 w-2 animate-pulse rounded-full bg-rust" />
                <span className="font-mono tabular-nums text-sm">{findings}</span>
                {findings === 1 ? "señal de riesgo detectada" : "señales de riesgo detectadas"}
              </span>
            </div>
          );
        })()}

        {/* GRAFO AGÉNTICO EN VIVO — force-directed, panel lateral de descubrimiento, narración en vivo */}
        <div className="mt-5">
          <FlowGraph liveEvents={liveEvents} />
        </div>

        <div className="mt-5">
          <ObservabilidadPanel liveEvents={liveEvents} />
        </div>

      </div>

      {/* HALLAZGOS EN VIVO (stream NDJSON desde el orquestador) */}
      {liveEvents.length > 0 && <LiveTracePanel events={liveEvents} />}
    </div>
  );
}
