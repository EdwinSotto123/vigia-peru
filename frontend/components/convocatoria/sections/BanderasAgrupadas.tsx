"use client";

import { useState } from "react";
import { ChevronRight, ExternalLink, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { redactDnis } from "../../Redact";
import type { Bandera } from "../types";
import { AGENTE_VISUAL } from "../constants";
import { inferAgente } from "../utils";
import { BlurFade } from "@/components/magicui/BlurFade";
import { NumberTicker } from "@/components/magicui/NumberTicker";

export function BanderasAgrupadas({ banderas, reglas_evaluadas }: { banderas: Bandera[]; reglas_evaluadas: number }) {
  const [filtroSev, setFiltroSev] = useState<"todas" | "alta" | "media" | "baja">("todas");
  const [filtroAgente, setFiltroAgente] = useState<string>("todos");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const banderasFiltradas = banderas.filter(b => {
    if (filtroSev !== "todas" && b.severidad !== filtroSev) return false;
    if (filtroAgente !== "todos" && inferAgente(b) !== filtroAgente) return false;
    return true;
  });

  const conteoSev = {
    alta:  banderas.filter(b => b.severidad === "alta").length,
    media: banderas.filter(b => b.severidad === "media").length,
    baja:  banderas.filter(b => b.severidad === "baja").length,
  };
  const agentesUnicos = Array.from(new Set(banderas.map(inferAgente)));
  const conteoAgente: Record<string, number> = {};
  for (const a of agentesUnicos) conteoAgente[a] = banderas.filter(b => inferAgente(b) === a).length;

  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-heroViolet">
              <ShieldAlert size={11} /> Banderas detectadas · {reglas_evaluadas} reglas evaluadas
            </div>
            {/* Cifra protagonista del bloque: cuenta al entrar en pantalla. */}
            <h2 className="mt-1 flex items-baseline gap-1 font-serif text-xl font-bold text-ink">
              <NumberTicker value={banderas.length} format="entero" />
              <span>bandera{banderas.length === 1 ? "" : "s"} en total</span>
            </h2>
          </div>
          {/* CONTADORES POR SEVERIDAD */}
          <div className="flex gap-2">
            {(["alta", "media", "baja"] as const).map(s => (
              conteoSev[s] > 0 && (
                <span key={s} className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest",
                  s === "alta"  && "bg-rust/15 text-rust",
                  s === "media" && "bg-amber/15 text-amber",
                  s === "baja"  && "bg-line text-ink",
                )}>
                  ● {conteoSev[s]} {s}
                </span>
              )
            ))}
          </div>
        </div>

        {/* FILTROS */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => { setFiltroSev("todas"); setFiltroAgente("todos"); }}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
              filtroSev === "todas" && filtroAgente === "todos"
                ? "border-heroViolet bg-heroViolet text-paper"
                : "border-line bg-paperSoft text-mute hover:text-ink",
            )}
          >Todas ({banderas.length})</button>
          {(["alta", "media", "baja"] as const).map(s => (
            conteoSev[s] > 0 && (
              <button
                key={s}
                type="button"
                onClick={() => setFiltroSev(filtroSev === s ? "todas" : s)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
                  filtroSev === s
                    ? (s === "alta" ? "border-rust bg-rust text-paper" :
                       s === "media" ? "border-amber bg-amber text-paper" :
                                       "border-mute bg-mute text-paper")
                    : "border-line bg-paperSoft text-mute hover:text-ink",
                )}
              >● {s} ({conteoSev[s]})</button>
            )
          ))}
          {agentesUnicos.length > 1 && (
            <div className="ml-1 flex gap-1.5 border-l border-line pl-2">
              {agentesUnicos.map(a => {
                const v = AGENTE_VISUAL[a] || AGENTE_VISUAL["?"];
                return (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setFiltroAgente(filtroAgente === a ? "todos" : a)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
                      filtroAgente === a
                        ? cn("border-transparent", v.chipClass.replace("/15", "/30"), "font-bold")
                        : cn("border-line bg-paperSoft hover:text-ink", v.iconClass),
                    )}
                  >{v.label} ({conteoAgente[a]})</button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* LISTA DE BANDERAS */}
      <ul className="divide-y divide-line">
        {banderasFiltradas.map((b, i) => {
          const agt = inferAgente(b);
          const av = AGENTE_VISUAL[agt] || AGENTE_VISUAL["?"];
          const isOpen = expandedIdx === i;
          // Cascada de entrada solo en los primeros ~14 (delayMs tope ~780ms) — pasado eso
          // el delay se congela en vez de seguir creciendo, para que colas largas de
          // banderas no tarden cada vez más en terminar de aparecer.
          return (
            <BlurFade as="li" key={i} delayMs={Math.min(i, 13) * 60}>
              <button
                type="button"
                onClick={() => setExpandedIdx(isOpen ? null : i)}
                className={cn(
                  "block w-full px-5 py-3 text-left transition-colors hover:bg-paperSoft",
                  b.severidad === "alta"  && "border-l-4 border-l-rust",
                  b.severidad === "media" && "border-l-4 border-l-amber",
                  b.severidad === "baja"  && "border-l-4 border-l-line",
                )}
              >
                <div className="flex items-start gap-3">
                  <span className={cn(
                    "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                    b.severidad === "alta"  ? "bg-rust text-paper" :
                    b.severidad === "media" ? "bg-amber text-paper" :
                                              "bg-line text-ink",
                  )}>!</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                        av.chipClass,
                      )}>{av.label}</span>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-mute">{b.regla}</span>
                      {b.vector && (
                        <span className="rounded bg-paperDeep px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-mute">
                          vector: {b.vector}
                        </span>
                      )}
                      {b.item_afectado && (
                        <span className="text-[9px] font-mono text-mute">ítem #{b.item_afectado}</span>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink line-clamp-2">{redactDnis(b.evidencia)}</p>
                  </div>
                  <ChevronRight
                    size={14}
                    className={cn("mt-0.5 shrink-0 text-heroViolet transition-transform duration-200", isOpen && "rotate-90")}
                  />
                </div>
              </button>

              {/* EXPANDED — detalle completo. animate-fadeIn: se revela contenido nuevo
                  al expandir, no un salto brusco de layout. */}
              {isOpen && (
                <div className="animate-fadeIn border-t border-line bg-paperSoft px-5 py-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-widest text-mute">Evidencia completa</div>
                      <p className="mt-1 text-sm leading-relaxed text-ink">{redactDnis(b.evidencia)}</p>
                    </div>
                    {b.evidencia_textual && (
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-widest text-mute">Texto del documento</div>
                        <blockquote className="mt-1 border-l-2 border-heroViolet/40 pl-2 text-xs italic text-inkSoft">
                          &quot;{redactDnis(b.evidencia_textual)}&quot;
                        </blockquote>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg bg-paper p-2.5">
                      <div className="text-[9px] font-bold uppercase tracking-widest text-heroViolet">Norma citada</div>
                      <div className="mt-0.5 text-xs text-ink">{b.norma || "—"}</div>
                    </div>
                    {b.opinion_oece_relacionada?.num_opinion && (
                      <div className="rounded-lg bg-paper p-2.5">
                        <div className="text-[9px] font-bold uppercase tracking-widest text-heroViolet">Opinión OECE</div>
                        <div className="mt-0.5 text-xs text-ink">
                          <strong className="font-mono">{b.opinion_oece_relacionada.num_opinion}</strong>
                          {b.opinion_oece_relacionada.url && (
                            <a href={b.opinion_oece_relacionada.url} target="_blank" rel="noreferrer"
                               className="ml-2 inline-flex items-center gap-1 text-heroViolet hover:underline">
                              abrir <ExternalLink size={9} />
                            </a>
                          )}
                        </div>
                        {b.opinion_oece_relacionada.snippet && (
                          <p className="mt-1 text-[11px] italic text-inkSoft line-clamp-3">
                            &quot;{b.opinion_oece_relacionada.snippet}&quot;
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  {b.fuente_url && (
                    <div className="mt-2 flex justify-end">
                      <a href={b.fuente_url} target="_blank" rel="noreferrer"
                         className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-heroViolet hover:underline">
                        Ver fuente <ExternalLink size={10} />
                      </a>
                    </div>
                  )}
                </div>
              )}
            </BlurFade>
          );
        })}
      </ul>

      {banderasFiltradas.length === 0 && (
        <div className="px-5 py-8 text-center text-sm text-mute">
          Ninguna bandera coincide con los filtros aplicados.
        </div>
      )}
    </section>
  );
}
