"use client";

import { ExternalLink, Scale } from "lucide-react";
import { plural, porcentaje } from "@/lib/formato";
import { Severidad } from "@/components/ui/Severidad";
import { severidadDe } from "../dossier";
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
    <section className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="border-b border-line bg-paperSoft px-5 py-3">
        <h2 className="font-display text-xl font-bold text-ink">Cumplimiento normativo</h2>
        <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-mute">
          <Scale size={12} aria-hidden /> {plural(evals.length, "hallazgo contrastado", "hallazgos contrastados")} con las opiniones jurídicas del OECE
        </p>
        <p className="mt-1 max-w-[68ch] text-xs leading-relaxed text-mute">
          Cada hallazgo se busca entre las opiniones jurídicas del OECE para encontrar la más parecida, y así citar la
          interpretación administrativa que corresponde a cada señal.
        </p>
      </div>

      {evals.length === 0 ? (
        <p className="px-5 py-6 text-sm text-mute">No hubo hallazgos que contrastar con las opiniones del OECE.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-line bg-paperSoft text-left text-[12px] text-inkSoft">
                <th scope="col" className="px-3 py-2 font-semibold">Quién lo encontró</th>
                <th scope="col" className="px-3 py-2 font-semibold">Hallazgo</th>
                <th scope="col" className="px-3 py-2 font-semibold">Severidad</th>
                <th scope="col" className="px-3 py-2 font-semibold">Opinión del OECE relacionada</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold" title="Qué tan parecida es la opinión al hallazgo (búsqueda semántica)">Parecido</th>
              </tr>
            </thead>
            <tbody>
              {evals.map((e: any, i: number) => {
                const h = e.hallazgo || {};
                const op = e.opinion_oece;
                return (
                  <tr key={i} className="border-b border-line/50 align-top hover:bg-paperSoft">
                    <td className="px-3 py-2 text-mute">
                      <span className="rounded-full bg-paperDeep px-2 py-0.5 text-[11px] text-inkSoft">
                        {FUENTE_HALLAZGO[h.fuente] ?? String(h.fuente || "").replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ink">
                      <div className="font-semibold leading-tight">
                        {/^[a-z0-9_]+$/.test(String(h.titulo || "")) ? reglaLabel(h.titulo) : h.titulo}
                        {!sobreprecioMedido && h.fuente === "market_sobreprecio" && (
                          <span className="ml-1.5 rounded-full border border-line bg-paperSoft px-1.5 py-0 text-[11px] font-normal text-mute">
                            no verificable
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-mute">{redactDnis(typeof h.descripcion === "string" ? h.descripcion : evidenciaComoTexto(h.descripcion))}</div>
                    </td>
                    <td className="px-3 py-2">
                      <Severidad bandera={severidadDe(h)} formato="linea" />
                    </td>
                    <td className="px-3 py-2 text-ink">
                      {op ? (
                        <>
                          <div className="font-semibold">
                            {op.norma ? `${op.norma} ` : ""}
                            {op.num_opinion && <span className="font-mono">{op.num_opinion}</span>}
                          </div>
                          {(op.art_ley || op.art_reglamento) && (
                            <div className="text-[11px] text-mute">
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
                               className="mt-1 inline-flex min-h-[24px] items-center gap-1 text-[12px] font-semibold text-granate hover:underline">
                              Abrir la opinión <ExternalLink size={11} aria-hidden />
                            </a>
                          )}
                        </>
                      ) : (
                        <span className="italic text-mute">No se encontró opinión relacionada.</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {op?.score != null ? (
                        <span className="font-mono text-[12px] font-semibold tabular-nums text-ink">
                          {porcentaje(op.score * 100)}
                        </span>
                      ) : (
                        <span className="text-mute">Sin dato</span>
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
        <div className="border-t border-line bg-paperSoft px-5 py-2 text-[12px] text-mute">
          {conOpinion.length} de {evals.length} hallazgos tienen una opinión del OECE lo bastante parecida para citarla.
        </div>
      )}
    </section>
  );
}
