"use client";

import { ExternalLink, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { severidadColor } from "@/lib/formato";
import { reglaLabel } from "@/lib/auditoria";
import { redactDnis } from "../../Redact";
import { evidenciaComoTexto } from "./Evidencia";

const FUENTE_HALLAZGO: Record<string, string> = {
  compliance_rule: "Reglas de contratación",
  legal_analyst_red_flag: "Análisis legal",
  market_spec_restrictiva: "Precios de mercado",
  market_sobreprecio: "Precios de mercado",
  parser_red_flag: "Lectura del expediente",
  person_cruce: "Red de personas",
};

export function CumplimientoNormativoSection({
  nc,
  sobreprecioMedido = true,
}: {
  nc: any;
  /** false cuando el agente de precios no pudo medir el sobreprecio: esas filas se marcan no verificables. */
  sobreprecioMedido?: boolean;
}) {
  const evals: any[] = nc?.evaluaciones || [];
  const conOpinion = evals.filter((e: any) => e.opinion_oece);
  const sinOpinion = evals.filter((e: any) => !e.opinion_oece);
  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl font-bold text-ink">
              Cumplimiento normativo
            </h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-mute">
              <Scale size={11} aria-hidden /> Cada hallazgo contrastado con las opiniones jurídicas del OECE
            </p>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono text-2xl font-bold text-heroViolet">{evals.length}</div>
            <div className="text-[11px] text-mute">hallazgos evaluados</div>
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
                <th className="px-3 py-2 font-bold uppercase tracking-wider" title="Qué tan parecida es la opinión al hallazgo (búsqueda semántica)">Parecido</th>
              </tr>
            </thead>
            <tbody>
              {evals.map((e: any, i: number) => {
                const h = e.hallazgo || {};
                const op = e.opinion_oece;
                return (
                  <tr key={i} className="border-b border-line/50 align-top hover:bg-paper">
                    <td className="px-3 py-2 text-mute">
                      <span className="rounded bg-paperDeep px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-heroViolet">
                        {FUENTE_HALLAZGO[h.fuente] ?? String(h.fuente || "").replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ink">
                      <div className="font-semibold leading-tight">
                        {/^[a-z0-9_]+$/.test(String(h.titulo || "")) ? reglaLabel(h.titulo) : h.titulo}
                        {!sobreprecioMedido && h.fuente === "market_sobreprecio" && (
                          <span className="ml-1.5 rounded-full border border-line bg-paperSoft px-1.5 py-0 text-[10px] font-normal text-mute">
                            no verificable
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-mute">{redactDnis(typeof h.descripcion === "string" ? h.descripcion : evidenciaComoTexto(h.descripcion))}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                        severidadColor(h.severidad === "alta" || h.severidad === "media" ? h.severidad : "baja"),
                      )}>{h.severidad || "media"}</span>
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
                              {op.art_ley && <>Ley {op.art_ley}{op.art_reglamento ? ", " : ""}</>}
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
                               className="mt-1 inline-flex items-center gap-1 rounded-md bg-heroViolet px-2 py-0.5 text-[10px] font-bold text-paper hover:bg-heroViolet/80">
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
                        <span className="font-mono text-[11px] font-bold text-heroViolet">
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
          {conOpinion.length} de {evals.length} hallazgos tienen una opinión del OECE lo bastante parecida para citarla.
        </div>
      )}
    </section>
  );
}
