"use client";

import { ExternalLink, Network } from "lucide-react";
import { cn } from "@/lib/utils";
import { fechaDossier } from "../dossier";
import { PersonName, redactDnis } from "../../Redact";

export function EstructuraEntidadSection({
  autoridades, entityPersonnel, entidad,
}: { autoridades?: any; entityPersonnel?: any; entidad?: any }) {
  const a = autoridades || {};
  const ep = entityPersonnel || {};
  const funcionarios: any[] = ep.funcionarios_designados || [];
  const resoluciones: any[] = ep.resoluciones_designacion || [];

  const alcaldeP = a.alcalde_provincial_actual;
  const alcaldeD = a.alcalde_distrital_actual;
  const gobernador = a.gobernador_regional_actual;
  const regidores: any[] = a.regidores_provinciales || [];

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="border-b border-line bg-paperSoft px-5 py-3">
        <h2 className="font-display text-xl font-bold text-ink">
          <Network size={16} className="mr-1.5 inline text-mute" aria-hidden />
          {/* `entidad` llega como string (nombre) o como objeto {nombre, ruc}. */}
          ¿Quién dirige y firma en {(typeof entidad === "string" ? entidad : entidad?.nombre) || a.entidad_consultada || "esta entidad"}?
        </h2>
        <p className="mt-1 text-xs text-mute">
          Las autoridades electas (según el JNE) y los funcionarios designados de
          confianza: quienes toman las decisiones de contratación de la entidad en
          el período actual.
        </p>
      </div>

      <div className="grid gap-4 px-5 py-5 lg:grid-cols-2">
        {/* AUTORIDADES ELECTAS — Capa 2 */}
        <article className="rounded-xl border border-line bg-paperSoft p-4">
          <h3 className="text-[12px] font-semibold text-ink">
            Autoridades electas (período 2023-2026)
          </h3>
          {!alcaldeP && !alcaldeD && !gobernador && regidores.length === 0 ? (
            <p className="mt-2 text-[11px] text-mute italic">
              No se identificaron autoridades electas para esta región en el JNE.
            </p>
          ) : (
            <ul className="mt-2 space-y-2 text-[12px]">
              {alcaldeP && (
                <li className="rounded-md bg-paper px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="rounded-full bg-paperDeep px-2 py-0.5 text-[11px] font-semibold text-inkSoft">
                      Alcalde provincial
                    </span>
                    <strong className="text-ink">{alcaldeP.nombre}</strong>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-inkSoft">
                    {alcaldeP.partido && <span>{alcaldeP.partido}</span>}
                    {alcaldeP.año_eleccion && <span>electo en {alcaldeP.año_eleccion}</span>}
                    {alcaldeP.provincia && <span>{alcaldeP.provincia}</span>}
                  </div>
                  {alcaldeP.fuente_url && (
                    <a href={alcaldeP.fuente_url} target="_blank" rel="noreferrer"
                       className="mt-1 inline-flex items-center gap-1 text-[11px] text-granate hover:underline">
                      <ExternalLink size={9} /> Fuente JNE
                    </a>
                  )}
                </li>
              )}
              {alcaldeD && (
                <li className="rounded-md bg-paper px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="rounded-full bg-paperDeep px-2 py-0.5 text-[11px] font-semibold text-inkSoft">
                      Alcalde distrital
                    </span>
                    <strong className="text-ink">{alcaldeD.nombre}</strong>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-inkSoft">
                    {alcaldeD.partido && <span>{alcaldeD.partido}</span>}
                    {alcaldeD.año_eleccion && <span>electo en {alcaldeD.año_eleccion}</span>}
                    {alcaldeD.distrito && <span>{alcaldeD.distrito}</span>}
                  </div>
                </li>
              )}
              {gobernador && (
                <li className="rounded-md bg-paper px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="rounded-full bg-paperDeep px-2 py-0.5 text-[11px] font-semibold text-inkSoft">
                      Gobernador regional
                    </span>
                    <strong className="text-ink">{gobernador.nombre}</strong>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-inkSoft">
                    {gobernador.partido && <span>{gobernador.partido}</span>}
                    {gobernador.año_eleccion && <span>electo en {gobernador.año_eleccion}</span>}
                    {gobernador.region && <span>{gobernador.region}</span>}
                  </div>
                </li>
              )}
              {regidores.length > 0 && (
                <li className="rounded-md bg-paper px-3 py-2">
                  <div className="text-[12px] font-semibold text-inkSoft">
                    Regidores ({regidores.length})
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {regidores.map((r, i) => (
                      <li key={i} className="text-[11px] text-ink">
                        <strong>{r.nombre}</strong>
                        {r.partido && <span className="ml-1 text-inkSoft italic">({r.partido})</span>}
                      </li>
                    ))}
                  </ul>
                </li>
              )}
            </ul>
          )}
        </article>

        {/* FUNCIONARIOS DESIGNADOS — Capa 3 */}
        <article className="rounded-xl border border-line bg-paperSoft p-4">
          <h3 className="text-[12px] font-semibold text-ink">
            Funcionarios designados de confianza
          </h3>
          {funcionarios.length === 0 ? (
            <p className="mt-2 text-[11px] text-mute italic">
              {ep.sin_data_publica
                ? "La entidad no publica su directorio en portal de transparencia."
                : "Todavía no se identificaron funcionarios designados en El Peruano ni en el portal de transparencia de la entidad."}
            </p>
          ) : (
            <ul className="mt-2 space-y-2 text-[12px]">
              {funcionarios.map((f, i) => (
                <li key={i} className="rounded-md bg-paper px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="rounded-full bg-paperDeep px-2 py-0.5 text-[11px] font-semibold text-inkSoft">
                      {f.cargo || "Funcionario"}
                    </span>
                    {f.vigente && (
                      <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-inkSoft">
                        vigente
                      </span>
                    )}
                  </div>
                  <strong className="mt-0.5 block text-ink"><PersonName name={f.nombre_completo} /></strong>
                  {f.area && (
                    <div className="text-[11px] text-inkSoft">{f.area}</div>
                  )}
                  <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-mute">
                    {f.fecha_designacion && (
                      <span>designado el {fechaDossier(f.fecha_designacion, true)}</span>
                    )}
                    {f.acto_resolutivo && (
                      <span>{f.acto_resolutivo}</span>
                    )}
                    {f.fuente_url && (
                      <a href={f.fuente_url} target="_blank" rel="noreferrer"
                         className="inline-flex items-center gap-0.5 text-granate hover:underline">
                        <ExternalLink size={9} /> Fuente
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {resoluciones.length > 0 && (
            <details className="mt-3 border-t border-line pt-2">
              <summary className="cursor-pointer text-[12px] font-semibold text-inkSoft hover:text-ink">
                Resoluciones de designación ({resoluciones.length})
              </summary>
              <ul className="mt-2 space-y-1 text-[11px]">
                {resoluciones.map((r, i) => (
                  <li key={i} className="text-ink">
                    <strong className="font-mono">{r.numero}</strong>
                    {r.fecha && <span className="ml-1 text-mute">({fechaDossier(r.fecha, true)})</span>}
                    {r.objeto && <div className="italic text-inkSoft">{r.objeto}</div>}
                    {r.url && (
                      <a href={r.url} target="_blank" rel="noreferrer" aria-label={`Abrir la resolución ${r.numero ?? ""}`}
                         className="ml-1 inline-flex min-h-[24px] min-w-[24px] items-center justify-center text-granate hover:underline">
                        <ExternalLink size={11} aria-hidden />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {ep.observaciones && (
            <p className="mt-2 border-t border-line pt-2 text-[11px] italic text-mute">
              {redactDnis(ep.observaciones)}
            </p>
          )}
        </article>
      </div>
    </section>
  );
}
