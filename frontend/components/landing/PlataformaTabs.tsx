"use client";

import { useState } from "react";
import { Sparkles, Cpu, BadgeCheck, ShieldAlert, Gavel, Activity, Receipt } from "lucide-react";
import { PipelineInteractive } from "./PipelineInteractive";
import { FuentesCarousel } from "./FuentesCarousel";

/**
 * "La plataforma" — agrupa la PROFUNDIDAD técnica en pestañas para acortar el
 * scroll: el detalle vive a un click, no apilado. Reemplaza 3 secciones sueltas
 * (Pipeline, El motor, Fuentes).
 */
const TABS = [
  { id: "como", label: "Cómo lo hace" },
  { id: "motor", label: "El motor" },
  { id: "fuentes", label: "Las fuentes" },
];

const MOTOR = [
  { icon: <BadgeCheck size={18} />, title: "No inventa: grounding obligatorio", sub: "RAG · Vertex AI Search", desc: "Cada bandera cita la norma y la opinión OECE exacta que la respalda (721 opiniones indexadas). Es evidencia oficial, no opinión del modelo: sin fuente verificable, no se publica." },
  { icon: <ShieldAlert size={18} />, title: "No acusa: solo señala", sub: "Guardrail determinista", desc: "Decimos «señal de riesgo» o «patrón detectado», jamás «culpable». Un guardrail bloquea cualquier bandera de delito que no esté corroborada con fuente oficial. Indicio, nunca acusación." },
  { icon: <Gavel size={18} />, title: "Se auto-evalúa", sub: "6 jueces LLM-as-judge", desc: "Al cierre de cada análisis, 6 evaluadores revisan: ¿la bandera está respaldada? ¿cita su fuente? ¿el tono no acusa? ¿los ítems coinciden con el objeto? Atrapan alucinaciones antes de que las veas." },
  { icon: <Activity size={18} />, title: "Todo queda trazado", sub: "Arize Phoenix · OpenInference", desc: "Orquestador + 11 sub-agentes + cada tool, trazados paso a paso. Cualquier veredicto se rastrea hasta su fuente. Auditable de verdad, no una caja negra." },
  { icon: <Receipt size={18} />, title: "Rinde cuentas del gasto", sub: "Costo transparente", desc: "Medimos tokens y costo de cada análisis. El gasto es público en «Cuentas claras» — así cada donación se justifica y se usa para vigilar, no para otra cosa." },
  { icon: <Sparkles size={18} />, title: "Gemini en Vertex AI", sub: "Endpoint global", desc: "Gemini 2.5 sobre Vertex AI con endpoint global: enruta a la región menos saturada, sin límites de tasa. Los análisis completan siempre." },
];

export function PlataformaTabs() {
  const [tab, setTab] = useState<string>("como");
  return (
    <section id="plataforma" className="scroll-mt-20 border-y border-line bg-paperSoft py-16">
      <div className="container-page">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-clay">
            <Cpu size={11} /> La plataforma
          </div>
          <h2 className="font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl">
            No es una caja negra. <span className="text-moss">Es auditable.</span>
          </h2>
          <p className="mt-3 text-mute">
            Cómo lo hace, con qué fuentes y con qué tecnología — el detalle, a un click.
          </p>
        </div>

        {/* tab bar */}
        <div className="mt-7 flex justify-center">
          <div className="inline-flex flex-wrap justify-center gap-1 rounded-full border border-line bg-paper p-1 shadow-card">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={
                  "rounded-full px-4 py-2 text-sm font-medium transition-colors " +
                  (tab === t.id ? "bg-ink text-paper" : "text-mute hover:bg-paperDeep hover:text-ink")
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* panels */}
        <div className="mt-8">
          {tab === "como" && (
            <div className="mx-auto max-w-6xl">
              <div className="mb-4 flex flex-wrap justify-center gap-2">
                {[["8", "agentes"], ["~15 min", "por análisis"], ["~80", "llamadas IA"], ["6.4M", "filas en BD"]].map(([v, l]) => (
                  <div key={l} className="rounded-xl border border-line bg-paper px-4 py-2 text-center">
                    <div className="font-mono text-base font-bold text-ink">{v}</div>
                    <div className="text-[10px] text-mute">{l}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl border border-line bg-ink p-4 text-paper shadow-card sm:p-6">
                <PipelineInteractive />
              </div>
            </div>
          )}

          {tab === "motor" && (
            <div className="mx-auto max-w-5xl">
              <p className="mx-auto mb-7 max-w-2xl text-center text-sm leading-relaxed text-mute sm:text-base">
                Tres garantías para que una «señal de riesgo» sea confiable:{" "}
                <strong className="text-ink">no inventa</strong> (grounding con fuente oficial),{" "}
                <strong className="text-ink">no acusa</strong> (guardrails anti-alucinación) y{" "}
                <strong className="text-ink">rinde cuentas</strong> de cada sol que gasta.
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {MOTOR.map((c) => (
                  <div key={c.title} className="surface flex flex-col gap-2 p-5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-moss/10 text-moss">{c.icon}</div>
                    <div className="font-serif text-base font-bold leading-tight text-ink">{c.title}</div>
                    <div className="-mt-1 text-[10px] font-semibold uppercase tracking-widest text-clay">{c.sub}</div>
                    <p className="text-xs leading-relaxed text-mute">{c.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "fuentes" && (
            <div className="mx-auto max-w-4xl">
              <p className="mb-6 text-center text-sm text-mute">
                <span className="font-semibold text-ink">14 fuentes oficiales.</span> Toda señal lleva
                link a la fuente verificable — cada bandera se rastrea hasta su PDF firmado en el portal del Estado.
              </p>
              <FuentesCarousel />
            </div>
          )}
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-mute">
          Además, un servidor <strong className="text-ink">Vigía MCP</strong> expone las alertas a cualquier
          agente (periodista, fiscal) desde su propio asistente de IA — Vigía como fuente, no solo app.
          Construido sobre Google Cloud · ADK · Cloud Run · Cloud SQL · Secret Manager · open source.
        </p>
      </div>
    </section>
  );
}
