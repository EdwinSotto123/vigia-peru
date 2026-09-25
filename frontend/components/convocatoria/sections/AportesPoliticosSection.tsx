"use client";

import { ExternalLink, ShieldAlert } from "lucide-react";
import { redactDnis } from "../../Redact";
import { montoDossier } from "../dossier";
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
    <section className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="border-b border-line bg-paperSoft px-5 py-3">
        <h2 className="font-display text-xl font-bold text-ink">
          <ShieldAlert size={16} className="mr-1.5 inline text-mute" aria-hidden />
          Vinculaciones políticas
        </h2>
        <p className="mt-1 text-xs text-mute">
          Aportes a campañas registrados en ONPE Claridad y postulaciones en el
          JNE asociados al proveedor o su gerente. Una vinculación política no
          implica delito, pero amerita verificación si coincide con el partido
          que gobierna la entidad contratante.
        </p>
      </div>

      <div className="grid gap-4 px-5 py-5 lg:grid-cols-2">
        {/* APORTES */}
        <article className="rounded-xl border border-line bg-paperSoft p-4">
          <h3 className="text-[12px] font-semibold text-ink">
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
                      <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-ink">
                        {montoDossier(a.monto)}
                      </span>
                    )}
                  </div>
                  {a.fuente_url && (
                    <a href={a.fuente_url} target="_blank" rel="noreferrer"
                       className="mt-1 inline-flex min-h-[24px] items-center gap-1 text-[12px] text-granate hover:underline">
                      Fuente <ExternalLink size={11} aria-hidden />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </article>

        {/* CANDIDATURAS */}
        <article className="rounded-xl border border-line bg-paperSoft p-4">
          <h3 className="text-[12px] font-semibold text-ink">
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
                      <span className="ml-auto rounded-full bg-paperDeep px-1.5 py-0.5 text-[11px] text-mute">
                        {c.resultado}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-inkSoft">{c.partido}</div>
                  {c.fuente_url && (
                    <a href={c.fuente_url} target="_blank" rel="noreferrer"
                       className="mt-1 inline-flex min-h-[24px] items-center gap-1 text-[12px] text-granate hover:underline">
                      Fuente <ExternalLink size={11} aria-hidden />
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
          <h3 className="text-[12px] font-semibold text-inkSoft">
            Hallazgos en las fuentes consultadas
          </h3>
          <ul className="mt-1 space-y-1">
            {hallazgos.map((h: any, i: number) => (
              <li key={i} className="text-[11px] text-ink">
                <strong>{h.fuente}:</strong>{" "}
                <span className={h.estado === "alerta" || h.estado === "ok" ? "text-ink" : "text-mute"}>
                  {redactDnis(h.mensaje)}
                </span>
                {h.url && (
                  <a href={h.url} target="_blank" rel="noreferrer"
                     className="ml-1 inline-flex min-h-[24px] min-w-[24px] items-center justify-center text-granate hover:underline"
                     aria-label={`Abrir la fuente: ${h.fuente}`}>
                    <ExternalLink size={11} aria-hidden />
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
