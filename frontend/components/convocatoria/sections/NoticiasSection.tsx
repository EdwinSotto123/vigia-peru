"use client";

import { ExternalLink, Newspaper } from "lucide-react";
import { Severidad } from "@/components/ui/Severidad";
import { plural } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { redactDnis } from "../../Redact";
import { fechaDossier } from "../dossier";

/**
 * Lo que dijo la prensa sobre el proveedor, la entidad y lo que se compró.
 *
 * La severidad de cada nota va con los tres canales (<Severidad>: color, ícono y palabra);
 * antes era un "● ALTA" sobre fondo rojo. La categoría la pone el agente de prensa a partir de
 * la nota: se rotula como lo que dice la nota ("presunta corrupción"), nunca como un hecho.
 */

const CATEGORIA: Record<string, string> = {
  corrupcion: "Presunta corrupción, según la nota",
  sancion: "Sanción",
  denuncia: "Denuncia",
  investigacion: "Investigación",
  contraloria: "Contraloría",
  proyecto_publico: "Proyecto público",
  menciones_sin_riesgo: "Mención sin riesgo",
  prensa_general: "Prensa general",
};

const esSeveridad = (s: unknown): s is "alta" | "media" | "baja" => s === "alta" || s === "media" || s === "baja";

/** Severidad de una nota: alta · media · baja con sus tres canales; lo demás es "Informativa". */
function SeveridadNota({ s }: { s: unknown }) {
  if (esSeveridad(s)) return <Severidad bandera={s} />;
  return <span className="pill border-line bg-paperSoft text-inkSoft">Informativa</span>;
}

export function NoticiasSection({ news }: { news: any }) {
  const noticias: any[] = news?.noticias || [];
  const banderasPrensa: any[] = news?.banderas_prensa || [];
  const sintesis = news?.resumen_ejecutivo || "";
  const sinMenciones = !!news?.sin_menciones_relevantes;
  const porSeveridad = news?.noticias_por_severidad || {};
  const porActor = news?.noticias_por_actor || {};

  // Ordenar por fecha desc
  const ordenadas = [...noticias].sort((a, b) => {
    const fa = String(a?.fecha || "0000-00-00");
    const fb = String(b?.fecha || "0000-00-00");
    return fb.localeCompare(fa);
  });

  const resumenSev = [
    porSeveridad.alta > 0 ? plural(porSeveridad.alta, "nota con señal alta", "notas con señal alta") : null,
    porSeveridad.media > 0 ? plural(porSeveridad.media, "con señal media", "con señal media") : null,
    porSeveridad.baja > 0 ? plural(porSeveridad.baja, "con señal baja", "con señal baja") : null,
    porSeveridad.info > 0 ? plural(porSeveridad.info, "informativa", "informativas") : null,
  ].filter(Boolean);

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="border-b border-line bg-paperSoft px-5 py-3">
        <h2 className="font-display text-xl font-bold text-ink">Noticias y prensa</h2>
        <p className="mt-0.5 text-[12px] text-mute">
          Cobertura periodística sobre el proveedor, la entidad y lo que se compró
          {resumenSev.length > 0 && <>: {resumenSev.join(", ")}</>}.
        </p>
        {sintesis && <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-inkSoft">{redactDnis(sintesis)}</p>}
      </div>

      {/* Señales que el agente de prensa sacó de las notas */}
      {banderasPrensa.length > 0 && (
        <div className="border-b border-line px-5 py-3">
          <h3 className="text-[13px] font-semibold text-ink">Señales en la prensa ({banderasPrensa.length})</h3>
          <ul className="mt-2 space-y-2">
            {banderasPrensa.map((b: any, i: number) => (
              <li key={i} className="rounded-xl border border-line bg-paperSoft px-3 py-2 text-[13px]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <SeveridadNota s={b.severidad} />
                  <strong className="font-semibold text-ink">{redactDnis(b.titulo)}</strong>
                </div>
                <p className="mt-1 text-inkSoft">{redactDnis(b.descripcion)}</p>
                {b.url && (
                  <a href={b.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-[24px] items-center gap-1 text-[12px] font-medium text-granate hover:underline">
                    Abrir la nota <ExternalLink size={11} aria-hidden />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {sinMenciones || ordenadas.length === 0 ? (
        <div className="px-5 py-6 text-sm text-inkSoft">
          {/* La síntesis ya va en la cabecera: acá no se repite. */}
          <p className="flex items-start gap-2">
            <Newspaper size={16} className="mt-0.5 shrink-0 text-mute" aria-hidden />
            Sin menciones relevantes en prensa peruana para los actores investigados.
          </p>
          <p className="mt-1 pl-6 text-[12px] text-mute">
            Que no haya cobertura no significa que no haya riesgo: sólo que no hubo notas indexadas sobre estos actores en el
            período consultado.
          </p>
        </div>
      ) : (
        <ol className="divide-y divide-line">
          {ordenadas.map((n, i) => (
            <li key={i} className="px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                <time className="tabular-nums text-mute">{n.fecha ? fechaDossier(n.fecha, true) : "Sin fecha"}</time>
                <SeveridadNota s={n.severidad} />
                {n.categoria && (
                  <span className="rounded-full bg-paperDeep px-2 py-0.5 text-[11px] text-inkSoft">
                    {CATEGORIA[n.categoria] || String(n.categoria).replace(/_/g, " ")}
                  </span>
                )}
                {n.fuente && <span className="ml-auto font-semibold text-ink">{n.fuente}</span>}
              </div>
              {n.titulo && <h3 className="mt-1.5 text-sm font-semibold leading-snug text-ink">{redactDnis(n.titulo)}</h3>}
              <p className="mt-1 max-w-[68ch] text-[13px] leading-relaxed text-inkSoft">{redactDnis(n.resumen)}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                {n.actor_principal && (
                  <span className="text-mute">
                    sobre <strong className="font-semibold text-ink">{redactDnis(n.actor_principal)}</strong>
                  </span>
                )}
                {n.url && (
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noreferrer"
                    className={cn("inline-flex min-h-[24px] items-center gap-1 font-medium text-granate hover:underline", n.actor_principal ? "ml-auto" : "")}
                  >
                    Abrir la nota <ExternalLink size={11} aria-hidden />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* Desglose por actor */}
      {Object.keys(porActor).length > 0 && (
        <div className="border-t border-line bg-paperSoft px-5 py-3">
          <h3 className="text-[12px] font-semibold text-inkSoft">Cobertura por actor</h3>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {Object.entries(porActor).map(([actor, n]: any) => (
              <span key={actor} className="inline-flex items-center gap-1.5 rounded-full bg-paper px-2.5 py-0.5 text-[12px] text-ink">
                <strong className="font-semibold">{redactDnis(actor)}</strong>
                <span className="tabular-nums text-mute">{plural(Number(n) || 0, "nota", "notas")}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
