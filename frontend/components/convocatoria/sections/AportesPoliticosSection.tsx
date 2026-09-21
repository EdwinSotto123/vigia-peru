"use client";

import { ExternalLink, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { PersonaVinculacionesPanel } from "./PersonaVinculacionesPanel";

export function AportesPoliticosSection({ web, person, ctx }: { web: any; person: any; ctx?: any }) {
  // Extrae datos de ONPE/JNE de web_research + person_network
  const hallazgos = (web?.hallazgos_por_fuente || []).filter((h: any) =>
    String(h.fuente || "").match(/ONPE|JNE/i)
  );
  const persona = person?.persona_principal || {};
  const aportes = persona.aportes_campañas || persona.aportes_campanas || [];
  const candidaturas = persona.candidaturas || [];
  // Determinar si hay alguna actividad política detectada
  const hayActividad =
    aportes.length > 0 || candidaturas.length > 0 ||
    hallazgos.some((h: any) => h.estado === "alerta" || h.estado === "ok");

  if (!hayActividad && hallazgos.length === 0) return null;

  return (
    <section className="surface overflow-hidden p-0">
      <div className="border-b border-line bg-paperDeep px-5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-heroViolet">
          <ShieldAlert size={11} className="mr-1 inline" />
          Aportes políticos y candidaturas · ONPE + JNE
        </div>
        <h2 className="mt-1 font-serif text-xl font-bold text-ink">
          Vinculaciones políticas
        </h2>
        <p className="mt-1 text-xs text-mute">
          Aportes a campañas registrados en ONPE Claridad y postulaciones en el
          JNE asociados al proveedor o su gerente. Una vinculación política no
          implica delito — pero amerita verificación si coincide con el partido
          que gobierna la entidad contratante.
        </p>
      </div>

      <div className="grid gap-4 px-5 py-5 lg:grid-cols-2">
        {/* APORTES */}
        <article className="rounded-md border border-line bg-paperSoft p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-heroViolet">
            Aportes ONPE Claridad ({aportes.length})
          </h3>
          {aportes.length === 0 ? (
            <p className="mt-2 text-[11px] text-mute italic">
              Sin aportes registrados a partidos políticos.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {aportes.map((a: any, i: number) => (
                <li key={i} className="rounded-md bg-paper px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[11px] font-bold text-ink">{a.año}</span>
                    <strong className="text-sm text-ink">{a.partido}</strong>
                    {a.monto != null && (
                      <span className="ml-auto font-mono text-xs font-bold text-heroViolet">
                        S/. {Number(a.monto).toLocaleString()}
                      </span>
                    )}
                  </div>
                  {a.fuente_url && (
                    <a href={a.fuente_url} target="_blank" rel="noreferrer"
                       className="mt-1 inline-flex items-center gap-1 text-[10px] text-heroViolet hover:underline">
                      Fuente <ExternalLink size={9} />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </article>

        {/* CANDIDATURAS */}
        <article className="rounded-md border border-line bg-paperSoft p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-heroViolet">
            Candidaturas JNE ({candidaturas.length})
          </h3>
          {candidaturas.length === 0 ? (
            <p className="mt-2 text-[11px] text-mute italic">
              Sin candidaturas registradas.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {candidaturas.map((c: any, i: number) => (
                <li key={i} className="rounded-md bg-paper px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[11px] font-bold text-ink">{c.año}</span>
                    <strong className="text-sm text-ink">{c.cargo}</strong>
                    {c.resultado && (
                      <span className="ml-auto rounded-full bg-paperDeep px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-mute">
                        {c.resultado}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-inkSoft">{c.partido}</div>
                  {c.fuente_url && (
                    <a href={c.fuente_url} target="_blank" rel="noreferrer"
                       className="mt-1 inline-flex items-center gap-1 text-[10px] text-heroViolet hover:underline">
                      Fuente <ExternalLink size={9} />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      {/* HALLAZGOS de las fuentes ONPE/JNE */}
      {hallazgos.length > 0 && (
        <div className="border-t border-line bg-paperSoft px-5 py-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-mute">
            Hallazgos en las fuentes consultadas
          </h3>
          <ul className="mt-1 space-y-1">
            {hallazgos.map((h: any, i: number) => (
              <li key={i} className="text-[11px] text-ink">
                <strong>{h.fuente}:</strong>{" "}
                <span className={h.estado === "alerta" ? "text-rust" : h.estado === "ok" ? "text-moss" : "text-mute"}>
                  {h.mensaje}
                </span>
                {h.url && (
                  <a href={h.url} target="_blank" rel="noreferrer"
                     className="ml-2 inline-flex items-center gap-0.5 text-heroViolet hover:underline">
                    <ExternalLink size={9} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* VINCULACIONES POR PERSONA — incluye socios, familia, firmantes, comité */}
      {ctx?.datos_peru_por_persona && Object.keys(ctx.datos_peru_por_persona).length > 0 && (
        <PersonaVinculacionesPanel ctx={ctx} />
      )}
    </section>
  );
}
