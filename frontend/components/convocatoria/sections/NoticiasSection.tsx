"use client";

import { Calendar, ExternalLink, Eye, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { redactDnis } from "../../Redact";

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

  // Texto blanco sobre ámbar no llega a 4.5:1: la media va en su fondo suave
  // con el tono de TEXTO del ámbar.
  const sevColor = (s: string) =>
    s === "alta"  ? "bg-rust text-paper" :
    s === "media" ? "bg-amber-soft text-amberTexto" :
    s === "baja"  ? "bg-paperDeep text-inkSoft" :
                    "bg-paperSoft text-inkSoft";

  const catLabel: Record<string, string> = {
    corrupcion: "Corrupción",
    sancion: "Sanción",
    denuncia: "Denuncia",
    investigacion: "Investigación",
    contraloria: "Contraloría",
    proyecto_publico: "Proyecto público",
    menciones_sin_riesgo: "Sin riesgo",
    prensa_general: "Prensa general",
  };

  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl font-bold text-ink">
              Noticias y prensa
            </h2>
            <p className="mt-0.5 text-[12px] text-mute">
              Cobertura periodística sobre el proveedor, la entidad y lo que se compró
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1 text-[10px]">
            {porSeveridad.alta > 0 && (
              <span className="rounded-full bg-rust px-2 py-0.5 font-bold text-paper">
                {porSeveridad.alta} alta
              </span>
            )}
            {porSeveridad.media > 0 && (
              <span className="rounded-full bg-amber-soft px-2 py-0.5 font-bold text-amberTexto">
                {porSeveridad.media} media
              </span>
            )}
            {porSeveridad.baja > 0 && (
              <span className="rounded-full bg-paperSoft px-2 py-0.5 font-bold text-inkSoft">
                {porSeveridad.baja} baja
              </span>
            )}
            {porSeveridad.info > 0 && (
              <span className="rounded-full bg-paperSoft px-2 py-0.5 font-bold text-inkSoft">
                {porSeveridad.info} informativa{porSeveridad.info === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
        {sintesis && (
          <p className="mt-2 text-sm leading-relaxed text-inkSoft">{redactDnis(sintesis)}</p>
        )}
      </div>

      {/* Banderas de prensa */}
      {banderasPrensa.length > 0 && (
        <div className="border-b border-line bg-crimson-soft px-5 py-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-rust">
            <ShieldAlert size={11} className="mr-1 inline" />
            Banderas en prensa ({banderasPrensa.length})
          </h3>
          <ul className="mt-2 space-y-1.5">
            {banderasPrensa.map((b: any, i: number) => (
              <li key={i} className="rounded-md bg-paper px-3 py-2 text-xs">
                <div className="flex items-baseline gap-2">
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                    sevColor(b.severidad),
                  )}>● {b.severidad || "media"}</span>
                  <strong className="text-ink">{redactDnis(b.titulo)}</strong>
                </div>
                <p className="mt-1 text-inkSoft">{redactDnis(b.descripcion)}</p>
                {b.url && (
                  <a href={b.url} target="_blank" rel="noreferrer"
                     className="mt-1 inline-flex items-center gap-1 text-[10px] text-heroViolet hover:underline">
                    Abrir nota <ExternalLink size={9} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Timeline de noticias — vertical con dots y línea conectora */}
      {sinMenciones || ordenadas.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-mute">
          <Eye size={20} className="mx-auto mb-2 text-mute opacity-50" />
          {/* La síntesis ya va en la cabecera: acá no se repite. */}
          Sin menciones relevantes en prensa peruana para los actores investigados.
          <p className="mt-2 text-[11px] text-mute">
            Que no haya cobertura no significa que no haya riesgo: solo que no hubo notas
            indexadas sobre estos actores en el período consultado.
          </p>
        </div>
      ) : (
        <ol className="relative ml-5 py-4 before:absolute before:left-3 before:top-0 before:h-full before:w-px before:bg-line">
          {ordenadas.map((n, i) => {
            const dotColor =
              n.severidad === "alta"  ? "bg-rust" :
              n.severidad === "media" ? "bg-amber" :
              n.severidad === "baja"  ? "bg-mute" : "bg-heroViolet";
            return (
              <li key={i} className="relative pl-10 pr-5 pb-5">
                {/* dot del timeline */}
                <span className={cn(
                  "absolute left-1 top-1 grid h-5 w-5 place-items-center rounded-full ring-4 ring-paper",
                  dotColor,
                )}>
                  <Calendar size={10} className="text-paper" />
                </span>
                <div className="rounded-lg border border-line bg-paperSoft p-3 hover:border-heroViolet transition-colors">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-[10px] text-mute">
                      {n.fecha || "sin fecha"}
                    </span>
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                      sevColor(n.severidad),
                    )}>● {n.severidad === "info" || !n.severidad ? "informativa" : n.severidad}</span>
                    {n.categoria && (
                      <span className="rounded-md bg-paperDeep px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-mute">
                        {catLabel[n.categoria] || String(n.categoria).replace(/_/g, " ")}
                      </span>
                    )}
                    {n.fuente && (
                      <span className="ml-auto font-bold text-heroViolet text-[11px]">{n.fuente}</span>
                    )}
                  </div>
                  {n.titulo && (
                    <h3 className="mt-2 text-sm font-bold leading-snug text-ink">
                      {redactDnis(n.titulo)}
                    </h3>
                  )}
                  <p className="mt-1 text-xs leading-relaxed text-inkSoft">{redactDnis(n.resumen)}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                    {n.actor_principal && (
                      <span className="rounded-md bg-paper px-2 py-0.5 text-mute">
                        sobre <strong className="text-ink">{redactDnis(n.actor_principal)}</strong>
                      </span>
                    )}
                    {n.url && (
                      <a href={n.url} target="_blank" rel="noreferrer"
                         className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-heroViolet px-3 py-1 text-[10px] font-bold text-paper hover:bg-heroViolet/80">
                        Abrir nota <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Desglose por actor */}
      {Object.keys(porActor).length > 0 && (
        <div className="border-t border-line bg-paperSoft px-5 py-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-mute">
            Cobertura por actor
          </h3>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {Object.entries(porActor).map(([actor, n]: any) => (
              <span key={actor}
                    className="inline-flex items-center gap-1.5 rounded-md bg-paper px-2 py-0.5 text-[11px] text-ink">
                <strong>{redactDnis(actor)}</strong>
                <span className="font-mono text-mute">{String(n)} nota{Number(n) === 1 ? "" : "s"}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
