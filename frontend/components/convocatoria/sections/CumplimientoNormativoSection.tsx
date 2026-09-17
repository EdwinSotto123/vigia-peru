"use client";

import { ExternalLink, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { redactDnis } from "../../Redact";

export function CumplimientoNormativoSection({ nc }: { nc: any }) {
  const evals: any[] = nc?.evaluaciones || [];
  const conOpinion = evals.filter((e: any) => e.opinion_oece);
  const sinOpinion = evals.filter((e: any) => !e.opinion_oece);
  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
              <Scale size={11} className="mr-1 inline" />
              evaluate_normative_compliance · RAG sobre 723 opiniones OECE
            </div>
            <h2 className="mt-1 font-serif text-xl font-bold text-ink">
              Cumplimiento normativo
            </h2>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono text-2xl font-bold text-clay">{evals.length}</div>
            <div className="text-[10px] uppercase tracking-wider text-mute">hallazgos evaluados</div>
          </div>
        </div>
        <p className="mt-1 text-xs text-mute">
          Cada hallazgo se cruza contra el corpus de opiniones jurídicas del OECE para
          encontrar la opinión más relevante (similaridad semántica). Esto permite citar
          jurisprudencia administrativa específica para cada bandera detectada.
        </p>
      </div>

      {evals.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-mute">
          Sin hallazgos a evaluar.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-line bg-paperSoft text-left text-mute">
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Fuente</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Hallazgo / bandera</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Severidad</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Opinión OECE relacionada</th>
                <th className="px-3 py-2 font-bold uppercase tracking-wider">Score</th>
              </tr>
            </thead>
            <tbody>
              {evals.map((e: any, i: number) => {
                const h = e.hallazgo || {};
                const op = e.opinion_oece;
                return (
                  <tr key={i} className="border-b border-line/50 align-top hover:bg-paper">
                    <td className="px-3 py-2 text-mute">
                      <span className="rounded bg-paperDeep px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-clay">
                        {(h.fuente || "").replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ink">
                      <div className="font-semibold leading-tight">{h.titulo}</div>
                      <div className="mt-0.5 text-[11px] text-mute">{redactDnis(h.descripcion)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                        h.severidad === "alta"  ? "bg-rust text-paper" :
                        h.severidad === "media" ? "bg-amber text-paper" :
                                                  "bg-paperDeep text-mute",
                      )}>● {h.severidad || "media"}</span>
                    </td>
                    <td className="px-3 py-2 text-ink">
                      {op ? (
                        <>
                          <div className="font-semibold">
                            {op.norma ? `${op.norma} ` : ""}
                            {op.num_opinion && <span className="font-mono">{op.num_opinion}</span>}
                          </div>
                          {(op.art_ley || op.art_reglamento) && (
                            <div className="text-[10px] text-mute">
                              {op.art_ley && <>Ley {op.art_ley}{op.art_reglamento ? " · " : ""}</>}
                              {op.art_reglamento && <>Reglamento {op.art_reglamento}</>}
                            </div>
                          )}
                          {op.interpretacion_snippet && (
                            <div className="mt-1 line-clamp-3 text-[11px] italic text-inkSoft">
                              "{op.interpretacion_snippet}"
                            </div>
                          )}
                          {op.link && (
                            <a href={op.link} target="_blank" rel="noreferrer"
                               className="mt-1 inline-flex items-center gap-1 rounded-md bg-clay px-2 py-0.5 text-[10px] font-bold text-paper hover:bg-clay/80">
                              Abrir opinión <ExternalLink size={9} />
                            </a>
                          )}
                        </>
                      ) : (
                        <span className="italic text-mute">No se encontró opinión relacionada.</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {op?.score != null ? (
                        <span className="font-mono text-[11px] font-bold text-clay">
                          {(op.score * 100).toFixed(0)}%
                        </span>
                      ) : (
                        <span className="text-mute">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {sinOpinion.length > 0 && (
        <div className="border-t border-line bg-paperSoft px-5 py-2 text-[10px] text-mute">
          {conOpinion.length} de {evals.length} hallazgos tienen opinión OECE relacionada (matching ≥ umbral).
        </div>
      )}
    </section>
  );
}
