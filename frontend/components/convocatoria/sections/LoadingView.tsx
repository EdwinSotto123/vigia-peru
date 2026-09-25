"use client";

import { STEPS } from "../constants";
import { countFindings, inferStepFromEvents } from "../utils";
import { FlowGraph } from "./FlowGraph";
import { LiveTracePanel } from "./LiveTracePanel";
import { ObservabilidadPanel } from "./ObservabilidadPanel";
import { plural } from "@/lib/formato";

/**
 * Lo que ve el equipo mientras corre un análisis despachado desde el buscador: progreso,
 * el grafo en vivo y la observabilidad. Sin halos de color ni degradados "de IA": una barra
 * en el granate de la marca (es progreso, no severidad) y el conteo de señales en tinta
 * neutra, porque todavía nadie las verificó.
 */
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
  const findings = countFindings(liveEvents);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="rounded-2xl border border-line bg-paper p-5 sm:p-8">
        {/* HEADER */}
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-amber-soft px-3 py-1 text-[12px] font-semibold text-amberTexto" role="status" aria-live="polite">
              <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />
              {/* Solo el tiempo transcurrido, que es un dato. El "≈11 min" salía de sumar
                  estimaciones a mano y contradecía la mediana real de producción. */}
              Procesando, {elapsed} s
            </p>
            <h2 className="mt-2 font-display text-2xl font-bold leading-tight text-ink sm:text-3xl">
              Los agentes están leyendo el contrato
            </h2>
            <p className="mt-0.5 text-[13px] text-mute">
              Convocatoria <span className="font-mono">{codigo}</span>
            </p>
          </div>
          <div className="text-right">
            <div className="font-mono text-3xl font-bold tabular-nums text-ink">{progressPct} %</div>
            <div className="text-[12px] text-mute">progreso estimado</div>
          </div>
        </div>

        {/* PROGRESS BAR GLOBAL */}
        <div
          className="mt-4 h-1.5 overflow-hidden rounded-full bg-paperDeep"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPct}
          aria-label="Progreso estimado del análisis"
        >
          <div className="h-full rounded-full bg-granate transition-[width] duration-500" style={{ width: `${progressPct}%` }} />
        </div>

        {/* CONTADOR DE SEÑALES EN VIVO: todavía sin verificar, en tinta neutra */}
        {findings > 0 && (
          <p className="mt-3 text-center text-[13px] text-inkSoft">
            <span className="font-mono font-semibold tabular-nums text-ink">{plural(findings, "señal registrada", "señales registradas")}</span> hasta
            ahora; se verifican antes de publicarse.
          </p>
        )}

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
