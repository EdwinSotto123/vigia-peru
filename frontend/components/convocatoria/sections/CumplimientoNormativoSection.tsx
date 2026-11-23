"use client";

import { Scale } from "lucide-react";
import { EnlaceFuente, Seccion } from "@/components/patrones";
import { numero, porcentaje } from "@/lib/formato";
import { Severidad } from "@/components/ui/Severidad";
import { severidadDe } from "../dossier";
import { reglaLabel } from "@/lib/auditoria";
import { redactDnis } from "../../Redact";

/**
 * Las señales contrastadas con las opiniones jurídicas del OECE. Antes era una tabla de cinco columnas en la pestaña
 * Documentos que repetía cada señal (con su evidencia entera, ya en Señales) para decir, en la mayoría de las filas, «No se
 * encontró opinión relacionada» (2026-11-23, el usuario: «secciones que aparecen una vez más», «bloques grandes que dicen
 * poco»). Ahora va plegada al pie de la pestaña Señales y muestra sólo lo que agrega: la opinión que cita cada señal, su
 * parecido y su enlace; las que no tienen opinión, en una línea.
 */
export function CumplimientoNormativoSection({
  nc,
  sobreprecioMedido = true,
}: {
  nc: any;
  /** false cuando el agente de precios no pudo medir el sobreprecio: esas filas se marcan no verificables. */
  sobreprecioMedido?: boolean;
}) {
  const evals: any[] = nc?.evaluaciones || [];
  if (evals.length === 0) return null;
  const titulo = (h: any) => {
    const t = String(h?.titulo || "");
    return /^[a-z0-9_]+$/.test(t) ? reglaLabel(t) : t || "Hallazgo sin nombre";
  };
  const conOpinion = evals.filter((e: any) => e.opinion_oece);
  const sinOpinion = evals.filter((e: any) => !e.opinion_oece);
  return (
    <Seccion
      plegable
      titulo="Opiniones del OECE que citan las señales"
      descripcion={
        conOpinion.length === 0
          ? `Ninguna de las ${numero(evals.length)} señales tiene una opinión jurídica del OECE lo bastante parecida para citarla.`
          : `${numero(conOpinion.length)} de ${numero(evals.length)} señales tienen una opinión jurídica del OECE lo bastante parecida para citarla.`
      }
    >
      {conOpinion.length > 0 && (
        <ul className="divide-y divide-line/70">
          {conOpinion.map((e: any, i: number) => {
            const h = e.hallazgo || {};
            const op = e.opinion_oece;
            return (
              <li key={i} className="grid gap-x-6 gap-y-2 py-3 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Severidad bandera={severidadDe(h)} />
                    <span className="text-dato font-semibold text-ink">{titulo(h)}</span>
                    {!sobreprecioMedido && h.fuente === "market_sobreprecio" && <span className="pill border-line bg-paperSoft text-mute">no verificable</span>}
                  </p>
                  <p className="mt-1.5 flex items-start gap-1.5 text-meta text-ink">
                    <Scale size={14} className="mt-0.5 shrink-0 text-mute" aria-hidden />
                    <span className="min-w-0">
                      {op.norma ? `${op.norma} ` : ""}
                      {op.num_opinion && <span className="font-mono">{op.num_opinion}</span>}
                      {(op.art_ley || op.art_reglamento) && (
                        <span className="text-mute">
                          {", "}
                          {op.art_ley && <>Ley {op.art_ley}{op.art_reglamento ? ", " : ""}</>}
                          {op.art_reglamento && <>Reglamento {op.art_reglamento}</>}
                        </span>
                      )}
                    </span>
                  </p>
                  {op.interpretacion_snippet && <p className="mt-1 line-clamp-3 max-w-[68ch] text-meta italic leading-relaxed text-inkSoft">«{redactDnis(op.interpretacion_snippet)}»</p>}
                </div>
                <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
                  {op.score != null && (
                    <span className="text-meta text-mute">
                      <span className="font-mono text-dato font-semibold tabular-nums text-ink">{porcentaje(op.score * 100)}</span> de parecido
                    </span>
                  )}
                  {op.link && <EnlaceFuente href={op.link} className="text-meta">Abrir la opinión</EnlaceFuente>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {sinOpinion.length > 0 && (
        <p className={conOpinion.length > 0 ? "mt-2 border-t border-line pt-3 text-meta text-mute" : "text-meta text-mute"}>
          Sin una opinión parecida: {sinOpinion.map((e: any) => titulo(e.hallazgo)).join(", ")}.
        </p>
      )}
    </Seccion>
  );
}
