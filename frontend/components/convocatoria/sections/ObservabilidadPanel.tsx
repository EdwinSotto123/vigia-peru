"use client";

import { AlertTriangle, CheckCircle2, Cloud, Eye, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function ObservabilidadPanel({ liveEvents = [], metrics }: { liveEvents?: any[]; metrics?: any }) {
  let liveM: any = null;
  for (let i = liveEvents.length - 1; i >= 0; i--) { if (liveEvents[i]?.kind === "metrics") { liveM = liveEvents[i]; break; } }
  const live = !!liveM;
  const m = liveM || metrics || null;          // resultado: usa métricas persistidas (llm_metrics)
  const hasM = !!m;
  // Scores del self-eval inline (eventos kind="eval"), por evaluador.
  const evalsByName: Record<string, any> = {};
  for (const e of liveEvents) { if (e?.kind === "eval" && e.evaluador) evalsByName[e.evaluador] = e; }
  const hasEvals = Object.keys(evalsByName).length > 0;
  const fmt = (n: any) => (typeof n === "number" ? n.toLocaleString() : (n ?? "—"));
  const EVALS: { n: string; label: string; d: string }[] = [
    { n: "respaldo_de_bandera", label: "Respaldo de bandera", d: "¿la bandera está respaldada por datos verificables (RUC, monto, fecha, artículo)?" },
    { n: "cita_evidencia", label: "Cita de evidencia", d: "¿cada bandera cita norma + fuente oficial (SEACE/OECE)?" },
    { n: "plausibilidad_precio", label: "Plausibilidad de precio", d: "¿el sobreprecio se sostiene con la mediana de mercado?" },
    { n: "coherencia_objeto_items", label: "Coherencia objeto ↔ ítems", d: "¿los ítems analizados pertenecen al objeto de la convocatoria?" },
    { n: "tono_no_acusatorio", label: "Tono no acusatorio", d: "¿el dictamen usa 'señal de riesgo' y nunca acusa de delito?" },
    { n: "completitud_analisis", label: "Completitud del análisis", d: "¿corrieron todas las etapas (docs, mercado, red, dictamen, banderas)?" },
    { n: "cobertura_prensa", label: "Cobertura de prensa", d: "¿el agente de prensa devolvió cobertura estructurada (noticias o 'sin menciones'), no vacío?" },
    { n: "firmantes_plausibles", label: "Firmantes plausibles", d: "¿los firmantes son reales, no placeholders de plantilla ('POSTOR N' sin DNI)?" },
  ];
  const STATS = [
    { v: fmt(m?.n_llm_calls), l: "llamadas IA" },
    { v: fmt(m?.tokens_total), l: "tokens" },
    { v: hasM ? `≈ $${Number(m.cost_usd ?? 0).toFixed(4)}` : "—", l: "costo estim." },
    { v: hasM ? `${m.tokens_prompt?.toLocaleString?.() ?? "—"} / ${m.tokens_output?.toLocaleString?.() ?? "—"}` : "in / out", l: "prompt / out" },
  ];
  const chipFor = (ev: any): React.ReactNode => {
    if (!ev) return <span className="rounded bg-line px-1.5 py-0.5 text-[8px] font-bold text-mute">pendiente</span>;
    if (ev.label != null && ev.pct == null) {
      const ok = ev.label === "ok" || ev.label === "coherente";
      return <span className={cn("rounded px-1.5 py-0.5 text-[8px] font-bold", ok ? "bg-moss/15 text-moss" : "bg-crimson-soft text-rust")}>{ev.label}</span>;
    }
    if (ev.pct != null) {
      const cls = ev.pct >= 80 ? "bg-moss/15 text-moss" : ev.pct >= 50 ? "bg-amber-soft text-amber" : "bg-crimson-soft text-rust";
      return <span className={cn("rounded px-1.5 py-0.5 text-[8px] font-bold", cls)}>{ev.pct}%{ev.n ? ` · ${ev.ok}/${ev.n}` : ""}</span>;
    }
    return null;
  };
  return (
    <section className="surface overflow-hidden p-0">
      {/* header oscuro estilo dashboard */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-ink px-5 py-3 text-paper">
        <div className="flex items-center gap-2">
          <Eye size={14} className="text-amber" />
          <span className="font-serif text-sm font-bold">Arize · Observabilidad de la IA</span>
          {live ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-moss/20 px-2 py-0.5 text-[9px] font-bold text-moss">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-moss" /> EN VIVO
            </span>
          ) : hasM ? (
            <span className="rounded-full bg-paper/15 px-2 py-0.5 text-[9px] font-bold text-paper/80">ANÁLISIS CERRADO</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {m?.phoenix_trace_id ? (
            <a
              href="https://app.phoenix.arize.com/s/edwin-soto-c"
              target="_blank"
              rel="noreferrer"
              title={`Trace ID: ${m.phoenix_trace_id} — abre el proyecto vigia-peru en Phoenix y busca este ID para ver la orquestación ADK completa`}
              className="inline-flex items-center gap-1 rounded-full bg-amber/20 px-2 py-0.5 text-[9px] font-bold text-amber hover:bg-amber/30"
            >
              Ver traza ADK en Phoenix ↗
            </a>
          ) : null}
          <span className="font-mono text-[10px] text-paper/70">Phoenix Cloud · <b className="text-paper">vigia-peru</b></span>
        </div>
      </div>

      {/* tarjetas de métricas */}
      <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.l} className="bg-paper px-3 py-3 text-center">
            <div className="font-mono text-base font-bold tabular-nums text-ink">{s.v}</div>
            <div className="text-[9px] uppercase tracking-widest text-mute">{s.l}</div>
          </div>
        ))}
      </div>
      <div className="border-b border-line bg-paperSoft px-5 py-1.5 text-center text-[10px] text-mute">
        cada llamada (tokens · costo · latencia · prompt/respuesta) queda como span en <b className="text-ink">Phoenix Cloud</b> — árbol completo por OCID
      </div>

      {/* evaluadores — 6 evaluadores ricos a todo el ancho */}
      <div className="border-b border-line bg-paper p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-ink">
            <CheckCircle2 size={13} className="text-moss" /> Evaluadores · LLM-as-judge + código (8)
            {hasEvals && <span className="rounded-full bg-moss/15 px-1.5 py-0.5 text-[8px] font-bold text-moss">auto-evaluado</span>}
          </div>
          <span className="text-[9px] text-mute">
            {hasEvals ? "evaluado al cierre del análisis" : "se ejecuta al cierre del análisis"} · 4 vía LLM-as-judge · 4 deterministas
          </span>
        </div>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {EVALS.map((e) => {
            const ev = evalsByName[e.n];
            return (
              <li key={e.n} className="rounded border border-line/70 bg-paperSoft/40 px-2.5 py-1.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[11px] font-semibold text-ink">{e.label}</span>
                  {chipFor(ev)}
                </div>
                <div className="mt-0.5 text-[10px] leading-snug text-mute">{ev?.pregunta || e.d}</div>
                {ev?.metodo && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="rounded bg-ink/5 px-1 py-0.5 text-[8px] font-medium text-clay">{ev.metodo}</span>
                    {ev.objetivo && <span className="rounded bg-ink/5 px-1 py-0.5 text-[8px] text-mute">sobre: {ev.objetivo}</span>}
                  </div>
                )}
                {ev?.reason && <div className="mt-1 border-l-2 border-line pl-2 text-[9px] italic leading-snug text-mute/90">“{ev.reason}”</div>}
                {Array.isArray(ev?.faltantes) && ev.faltantes.length > 0 && (
                  <div className="mt-1 text-[9px] font-medium text-rust">faltó: {ev.faltantes.join(" · ")}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* trazas + guardrails */}
      <div className="bg-paper p-4">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-ink"><AlertTriangle size={13} className="text-rust" /> Trazas + guardrails</div>
        <ul className="mt-1.5 grid gap-1 text-[10px] leading-snug text-mute sm:grid-cols-2">
          <li>· OpenInference instrumenta el <b className="text-ink">Runner ADK</b> (ciclo + cada <code className="text-ink">transfer_to_agent</code> entre los 11 agentes) <b className="text-ink">y</b> cada call a Gemini → árbol completo en Phoenix.</li>
          <li>· Anti-alucinación: «señal de riesgo», nunca acusación; evidencia oficial obligatoria.</li>
          <li>· Sin corroboración oficial no se emite bandera de delito (guardrail determinista).</li>
          <li>· RAG con grounding: Vertex AI Search sobre 721 opiniones OECE.</li>
        </ul>
      </div>
    </section>
  );
}
