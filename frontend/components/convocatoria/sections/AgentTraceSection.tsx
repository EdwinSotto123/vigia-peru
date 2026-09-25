"use client";

/**
 * La traza técnica del análisis, leída como "qué hizo cada agente".
 *
 * Antes era una lista cronológica con un índice de chips de colores donde el color salía de
 * AGENT_VISUAL — o sea, de la escala de severidad: el agente de mercado se pintaba verde
 * (moss = verificado) y el de compliance rojo (rust = señal alta), sin que ninguno de los dos
 * colores significara nada sobre el resultado. Acá el color vuelve a estar reservado al estado
 * y a la severidad; los agentes se distinguen por su nombre, que es lo que el usuario recuerda.
 *
 * El índice de agentes es además el filtro: tocar uno recorta la traza a sus tramos. Es la misma
 * interacción que en "Quién encontró qué", una capa más abajo.
 */

import { useMemo, useState } from "react";
import { AlertCircle, FilterX } from "lucide-react";
import { cn } from "@/lib/utils";
import { nombreDeAgente } from "@/components/agentes/catalogo";
import type { AgentTraceEvent } from "../types";
import { TracePhaseGroup } from "./TracePhaseGroup";

export function AgentTraceSection({ trace }: { trace: AgentTraceEvent[] }) {
  const [agente, setAgente] = useState<string | null>(null);
  const [todoAbierto, setTodoAbierto] = useState(false);

  // Los tramos son consecutivos a propósito: el DAG intercala agentes, y ese intercalado ES
  // la información. Agrupar todo lo de un agente junto borraría el orden real.
  const grupos = useMemo(() => {
    const out: { agent: string; events: { ev: AgentTraceEvent; idx: number }[] }[] = [];
    trace.forEach((ev, idx) => {
      const ag = ev.agent || "?";
      const ultimo = out[out.length - 1];
      if (ultimo && ultimo.agent === ag) ultimo.events.push({ ev, idx });
      else out.push({ agent: ag, events: [{ ev, idx }] });
    });
    return out;
  }, [trace]);

  const indice = useMemo(() => {
    const por = new Map<string, { pasos: number; tools: Set<string>; errores: number; tramos: number }>();
    for (const g of grupos) {
      const e = por.get(g.agent) ?? { pasos: 0, tools: new Set<string>(), errores: 0, tramos: 0 };
      e.tramos++;
      for (const { ev } of g.events) {
        e.pasos++;
        if (ev.kind === "tool_call" && ev.name) e.tools.add(ev.name);
        if (ev.kind === "error") e.errores++;
      }
      por.set(g.agent, e);
    }
    return [...por.entries()]
      .map(([agent, v]) => ({ agent, ...v, nTools: v.tools.size }))
      .sort((a, b) => b.pasos - a.pasos);
  }, [grupos]);

  const nTools = trace.filter((e) => e.kind === "tool_call").length;
  const nErr = trace.filter((e) => e.kind === "error").length;
  const visibles = agente ? grupos.filter((g) => g.agent === agente) : grupos;
  const pasosVisibles = visibles.reduce((n, g) => n + g.events.length, 0);

  return (
    <section className="rounded-2xl border border-line bg-paperSoft overflow-hidden p-0">
      <header className="border-b border-line bg-paperDeep px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-xl font-bold leading-tight text-ink">Qué hizo cada agente</h2>
            <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-mute">
              La traza técnica completa, en el orden real en que ocurrió:{" "}
              <strong className="font-semibold text-ink">{trace.length} pasos</strong> de{" "}
              {indice.length} {indice.length === 1 ? "agente" : "agentes"}, {nTools} de ellos llamadas a
              herramientas
              {nErr > 0 && (
                <>
                  {" "}y <span className="font-semibold text-crimsonTexto">{nErr}</span>{" "}
                  {nErr === 1 ? "error" : "errores"}
                </>
              )}
              . Es lo que permite auditar el análisis sin rehacerlo.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTodoAbierto((o) => !o)}
            className="shrink-0 rounded-full border border-line bg-paper px-3 py-1 text-[11px] font-medium text-mute transition-colors duration-rapido hover:border-granate/40 hover:text-granate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate/50"
          >
            {todoAbierto ? "Colapsar todo" : "Expandir todo"}
          </button>
        </div>
      </header>

      {/* Índice de agentes = filtro. Cada cifra con su denominador. */}
      <ul className="divide-y divide-line/60 border-b border-line bg-paper">
        {indice.map((a) => {
          const on = agente === a.agent;
          return (
            <li key={a.agent}>
              <button
                type="button"
                onClick={() => setAgente(on ? null : a.agent)}
                aria-pressed={on}
                className={cn(
                  "flex w-full items-baseline gap-2 px-4 py-1.5 text-left transition-colors duration-rapido sm:px-5",
                  "hover:bg-paperDeep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate/50",
                  on && "bg-granate-soft hover:bg-granate-soft",
                )}
              >
                <span className={cn("w-[7.5rem] shrink-0 truncate text-[12.5px] text-ink sm:w-44", on && "font-semibold")}>
                  {nombreDeAgente(a.agent)}
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap gap-x-3 text-[12px] text-mute">
                  <span>{a.pasos} de {trace.length} pasos</span>
                  {a.nTools > 0 && (
                    <span>
                      {a.nTools} {a.nTools === 1 ? "herramienta" : "herramientas"} distintas
                    </span>
                  )}
                  {a.tramos > 1 && <span>retomó {a.tramos} veces</span>}
                </span>
                {a.errores > 0 && (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-crimsonTexto">
                    <AlertCircle size={11} aria-hidden /> {a.errores}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paperSoft px-4 py-2 sm:px-5">
        <span className="text-[12px] text-mute">
          {agente ? (
            <>
              Tramos de <strong className="font-semibold text-ink">{nombreDeAgente(agente)}</strong>:{" "}
              {pasosVisibles} de {trace.length} pasos
            </>
          ) : (
            <>Todos los tramos: {trace.length} pasos en {grupos.length} tramos</>
          )}
        </span>
        {agente && (
          <button
            type="button"
            onClick={() => setAgente(null)}
            className="pill border-line bg-paper text-[11px] text-mute transition-colors duration-rapido hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate/50"
          >
            <FilterX size={11} aria-hidden /> Ver la traza completa
          </button>
        )}
      </div>

      <div className="divide-y divide-line">
        {visibles.map((g) => (
          <TracePhaseGroup key={`${g.events[0].idx}-${todoAbierto}`} group={g} forceOpen={todoAbierto} />
        ))}
      </div>
    </section>
  );
}
